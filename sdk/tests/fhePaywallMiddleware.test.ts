import { describe, it, expect, vi, beforeEach } from "vitest";
import { fhePaywall } from "../src/fhePaywallMiddleware.js";
import { FHE_SCHEME } from "../src/types.js";
import type { FhePaywallConfig, FhePaymentPayload } from "../src/types.js";

// ============================================================================
// Mock Express req/res/next
// ============================================================================

function createMockReq(overrides: Record<string, any> = {}): any {
  return {
    protocol: "https",
    method: "GET",
    originalUrl: "/api/data",
    headers: {},
    socket: { remoteAddress: "127.0.0.1" },
    get: vi.fn().mockReturnValue("api.example.com"),
    ...overrides,
  };
}

function createMockRes(): any {
  const res: any = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: null as any,
    status: vi.fn().mockImplementation(function (this: any, code: number) {
      this.statusCode = code;
      return this;
    }),
    json: vi.fn().mockImplementation(function (this: any, body: any) {
      this.body = body;
      return this;
    }),
    setHeader: vi.fn().mockImplementation(function (this: any, key: string, value: string) {
      this.headers[key] = value;
      return this;
    }),
  };
  return res;
}

function createMockNext(): any {
  return vi.fn();
}

function createDefaultConfig(overrides: Partial<FhePaywallConfig> = {}): FhePaywallConfig {
  return {
    price: "1000000",
    asset: "USDC",
    poolAddress: "0x1234567890123456789012345678901234567890",
    recipientAddress: "0xaabbccddee112233445566778899aabbccddeeff",
    rpcUrl: "http://localhost:8545",
    ...overrides,
  };
}

function encodePaymentHeader(payload: FhePaymentPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

// ============================================================================
// Tests
// ============================================================================

describe("fhePaywall middleware", () => {
  describe("configuration", () => {
    it("should throw on invalid pool address", () => {
      expect(() =>
        fhePaywall(createDefaultConfig({ poolAddress: "not-an-address" }))
      ).toThrow("Invalid pool address");
    });

    it("should throw on invalid recipient address", () => {
      expect(() =>
        fhePaywall(createDefaultConfig({ recipientAddress: "not-an-address" }))
      ).toThrow("Invalid recipient address");
    });

    it("should create middleware with valid config", () => {
      const middleware = fhePaywall(createDefaultConfig());
      expect(typeof middleware).toBe("function");
    });
  });

  describe("402 response (no Payment header)", () => {
    it("should return 402 with requirements when no Payment header", async () => {
      const middleware = fhePaywall(createDefaultConfig());
      const req = createMockReq();
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(402);
      expect(res.json).toHaveBeenCalled();
      expect(res.body.x402Version).toBe(1);
      expect(res.body.accepts).toHaveLength(1);
      expect(res.body.accepts[0].scheme).toBe(FHE_SCHEME);
      expect(next).not.toHaveBeenCalled();
    });

    it("should include correct price in requirements", async () => {
      const middleware = fhePaywall(createDefaultConfig({ price: "5000000" }));
      const req = createMockReq();
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req, res, next);

      expect(res.body.accepts[0].price).toBe("5000000");
    });

    it("should include resource info", async () => {
      const middleware = fhePaywall(createDefaultConfig());
      const req = createMockReq();
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req, res, next);

      expect(res.body.resource.method).toBe("GET");
      expect(res.body.resource.url).toContain("/api/data");
    });

    it("should include pool and recipient addresses", async () => {
      const config = createDefaultConfig();
      const middleware = fhePaywall(config);
      const req = createMockReq();
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req, res, next);

      expect(res.body.accepts[0].poolAddress).toBe(config.poolAddress);
      expect(res.body.accepts[0].recipientAddress).toBe(config.recipientAddress);
    });

    it("should include chainId", async () => {
      const middleware = fhePaywall(createDefaultConfig());
      const req = createMockReq();
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req, res, next);

      expect(res.body.accepts[0].chainId).toBe(11155111);
    });
  });

  describe("Payment header validation", () => {
    it("should reject oversized Payment header", async () => {
      const middleware = fhePaywall(createDefaultConfig());
      const req = createMockReq({
        headers: { payment: "x".repeat(200_000) },
      });
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.body.error).toBe("Payment header too large");
    });

    it("should reject invalid base64 header", async () => {
      const middleware = fhePaywall(createDefaultConfig());
      const req = createMockReq({
        headers: { payment: "!!not-base64!!" },
      });
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("should reject wrong scheme", async () => {
      const middleware = fhePaywall(createDefaultConfig());
      const payload = {
        scheme: "wrong-scheme",
        txHash: "0xabc",
        nonce: "0x" + "ff".repeat(32),
        from: "0xSender",
        chainId: 11155111,
      };
      const req = createMockReq({
        headers: { payment: encodePaymentHeader(payload as any) },
      });
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.body.error).toBe("Unsupported payment scheme");
    });

    it("should reject missing required fields", async () => {
      const middleware = fhePaywall(createDefaultConfig());
      const payload = {
        scheme: FHE_SCHEME,
        // missing txHash, nonce, from
      };
      const req = createMockReq({
        headers: { payment: encodePaymentHeader(payload as any) },
      });
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.body.error).toBe("Missing required payment fields");
    });
  });

  describe("Rate limiting", () => {
    it("should allow requests under rate limit", async () => {
      const middleware = fhePaywall(createDefaultConfig({ maxRateLimit: 100 }));
      const req = createMockReq();
      const res = createMockRes();
      const next = createMockNext();

      await middleware(req, res, next);

      // Should get 402 (no payment), not 429
      expect(res.status).toHaveBeenCalledWith(402);
    });

    it("should reject requests over rate limit", async () => {
      const middleware = fhePaywall(
        createDefaultConfig({ maxRateLimit: 2, rateLimitWindowMs: 60000 })
      );

      // Send 3 requests from same IP
      for (let i = 0; i < 3; i++) {
        const req = createMockReq({ socket: { remoteAddress: "10.0.0.99" } });
        const res = createMockRes();
        const next = createMockNext();
        await middleware(req, res, next);

        if (i >= 2) {
          expect(res.status).toHaveBeenCalledWith(429);
          expect(res.body.error).toBe("Too many requests");
        }
      }
    });
  });

  describe("Nonce tracking", () => {
    it("should reject duplicate nonces", async () => {
      const middleware = fhePaywall(createDefaultConfig());
      const nonce = "0x" + "aa".repeat(32);

      // First request with this nonce — will fail verification but nonce is tracked
      const payload: FhePaymentPayload = {
        scheme: FHE_SCHEME,
        txHash: "0xtxhash1",
        nonce,
        from: "0xSender",
        chainId: 11155111,
      };

      const req1 = createMockReq({
        headers: { payment: encodePaymentHeader(payload) },
        socket: { remoteAddress: "10.0.1.1" },
      });
      const res1 = createMockRes();
      await middleware(req1, res1, createMockNext());

      // Second request with same nonce
      const req2 = createMockReq({
        headers: { payment: encodePaymentHeader({ ...payload, txHash: "0xtxhash2" }) },
        socket: { remoteAddress: "10.0.1.2" },
      });
      const res2 = createMockRes();
      await middleware(req2, res2, createMockNext());

      expect(res2.status).toHaveBeenCalledWith(400);
      expect(res2.body.error).toBe("Nonce already used");
    });
  });
});
