import { describe, it, expect, vi, beforeEach } from "vitest";
import { RedisNonceStore } from "../src/redisNonceStore.js";
import type { RedisLike } from "../src/redisNonceStore.js";

function createMockRedis(): RedisLike & { get: ReturnType<typeof vi.fn>; set: ReturnType<typeof vi.fn> } {
  return {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue("OK"),
  };
}

describe("RedisNonceStore", () => {
  let redis: ReturnType<typeof createMockRedis>;
  let store: RedisNonceStore;

  beforeEach(() => {
    redis = createMockRedis();
    store = new RedisNonceStore(redis);
  });

  describe("check()", () => {
    it("returns true for new nonce", async () => {
      redis.get.mockResolvedValue(null);
      expect(await store.check("nonce-1")).toBe(true);
      expect(redis.get).toHaveBeenCalledWith("fhe-x402:nonce:nonce-1");
    });

    it("returns false for existing nonce", async () => {
      redis.get.mockResolvedValue("1");
      expect(await store.check("nonce-1")).toBe(false);
    });
  });

  describe("add()", () => {
    it("sets key with TTL", async () => {
      await store.add("nonce-2");
      expect(redis.set).toHaveBeenCalledWith("fhe-x402:nonce:nonce-2", "1", "EX", 86400);
    });
  });

  describe("checkAndAdd()", () => {
    it("returns true for new nonce (SET NX succeeds)", async () => {
      redis.set.mockResolvedValue("OK");
      expect(await store.checkAndAdd("nonce-3")).toBe(true);
      expect(redis.set).toHaveBeenCalledWith("fhe-x402:nonce:nonce-3", "1", "EX", 86400, "NX");
    });

    it("returns false for existing nonce (SET NX fails)", async () => {
      redis.set.mockResolvedValue(null);
      expect(await store.checkAndAdd("nonce-3")).toBe(false);
    });
  });

  describe("custom options", () => {
    it("uses custom prefix", async () => {
      const customStore = new RedisNonceStore(redis, { prefix: "myapp:" });
      await customStore.check("n1");
      expect(redis.get).toHaveBeenCalledWith("myapp:n1");
    });

    it("uses custom TTL", async () => {
      const customStore = new RedisNonceStore(redis, { ttlSeconds: 3600 });
      await customStore.add("n2");
      expect(redis.set).toHaveBeenCalledWith("fhe-x402:nonce:n2", "1", "EX", 3600);
    });
  });

  describe("NonceStore interface compliance", () => {
    it("implements check, add, checkAndAdd", () => {
      expect(typeof store.check).toBe("function");
      expect(typeof store.add).toBe("function");
      expect(typeof store.checkAndAdd).toBe("function");
    });
  });
});
