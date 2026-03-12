import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedisBatchCreditStore } from "../src/redisBatchCreditStore.js";
import type { RedisLike } from "../src/redisNonceStore.js";

function createMockRedis(): RedisLike & { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
  };
}

describe("RedisBatchCreditStore", () => {
  let redis: ReturnType<typeof createMockRedis>;
  let store: RedisBatchCreditStore;

  beforeEach(() => {
    redis = createMockRedis();
    store = new RedisBatchCreditStore(redis);
  });

  describe("get()", () => {
    it("returns 0 for unknown payer/nonce", async () => {
      expect(await store.get("0xabc", "nonce-1")).toBe(0);
    });

    it("returns remaining credits", async () => {
      redis.get.mockResolvedValue(JSON.stringify({ remaining: 5, pricePerRequest: "100000", payer: "0xabc", server: "0xdef" }));
      expect(await store.get("0xabc", "nonce-1")).toBe(5);
    });
  });

  describe("register()", () => {
    it("registers new batch credits", async () => {
      await store.register("0xABC", "0xDEF", "nonce-1", 10, "100000");
      expect(redis.set).toHaveBeenCalledWith(
        "fhe-x402:batch:0xabc:nonce-1",
        expect.stringContaining('"remaining":10'),
        "EX",
        604800
      );
    });

    it("does not overwrite existing credits", async () => {
      redis.get.mockResolvedValue(JSON.stringify({ remaining: 5 }));
      await store.register("0xABC", "0xDEF", "nonce-1", 10, "100000");
      // set should NOT have been called (NX guard)
      expect(redis.set).not.toHaveBeenCalled();
    });
  });

  describe("consume()", () => {
    it("consumes one credit", async () => {
      redis.get.mockResolvedValue(JSON.stringify({ remaining: 3, pricePerRequest: "100000", payer: "0xabc", server: "0xdef" }));
      const result = await store.consume("0xabc", "nonce-1");
      expect(result).toBe(true);
      expect(redis.set).toHaveBeenCalledWith(
        "fhe-x402:batch:0xabc:nonce-1",
        expect.stringContaining('"remaining":2'),
        "EX",
        604800
      );
    });

    it("returns false when no credits left", async () => {
      redis.get.mockResolvedValue(JSON.stringify({ remaining: 0 }));
      expect(await store.consume("0xabc", "nonce-1")).toBe(false);
    });

    it("returns false for unknown key", async () => {
      redis.get.mockResolvedValue(null);
      expect(await store.consume("0xabc", "nonce-1")).toBe(false);
    });

    it("sets short TTL when credits exhausted", async () => {
      redis.get.mockResolvedValue(JSON.stringify({ remaining: 1, pricePerRequest: "100000", payer: "0xabc", server: "0xdef" }));
      await store.consume("0xabc", "nonce-1");
      expect(redis.set).toHaveBeenCalledWith(
        "fhe-x402:batch:0xabc:nonce-1",
        expect.stringContaining('"remaining":0'),
        "EX",
        1
      );
    });
  });

  describe("custom options", () => {
    it("uses custom prefix and TTL", async () => {
      const customStore = new RedisBatchCreditStore(redis, { prefix: "app:", ttlSeconds: 3600 });
      await customStore.register("0xABC", "0xDEF", "n1", 5, "100000");
      expect(redis.set).toHaveBeenCalledWith(
        "app:0xabc:n1",
        expect.any(String),
        "EX",
        3600
      );
    });
  });
});
