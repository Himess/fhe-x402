import { describe, it, expect } from "vitest";
import { fhePaymentMethod, fhePaymentProof } from "../src/erc8004/index.js";

describe("fhePaymentMethod", () => {
  it("returns default payment method entry", () => {
    const result = fhePaymentMethod({
      tokenAddress: "0xfF87ec6cb07D8Aa26ABc81037e353A28c7752d73",
      verifierAddress: "0x1234567890abcdef1234567890abcdef12345678",
    });

    expect(result.scheme).toBe("fhe-confidential-v1");
    expect(result.network).toBe("eip155:11155111");
    expect(result.token).toBe("USDC");
    expect(result.tokenAddress).toBe("0xfF87ec6cb07D8Aa26ABc81037e353A28c7752d73");
    expect(result.verifier).toBe("0x1234567890abcdef1234567890abcdef12345678");
    expect(result.privacyLevel).toBe("encrypted-balances");
    expect(result.features).toContain("fhe-encrypted-amounts");
    expect(result.features).toContain("token-centric");
    expect(result.description).toBeDefined();
  });

  it("uses custom network and token", () => {
    const result = fhePaymentMethod({
      tokenAddress: "0x1111111111111111111111111111111111111111",
      verifierAddress: "0x2222222222222222222222222222222222222222",
      network: "eip155:1",
      token: "WETH",
    });

    expect(result.network).toBe("eip155:1");
    expect(result.token).toBe("WETH");
  });

  it("uses custom facilitator URL", () => {
    const result = fhePaymentMethod({
      tokenAddress: "0x1111111111111111111111111111111111111111",
      verifierAddress: "0x2222222222222222222222222222222222222222",
      facilitatorUrl: "https://custom.facilitator.com",
    });

    expect(result).toBeDefined();
    expect(result.scheme).toBe("fhe-confidential-v1");
  });
});

describe("fhePaymentProof", () => {
  it("creates nonce-based payment proof", () => {
    const result = fhePaymentProof(
      "0xabc123nonce",
      "0xfF87ec6cb07D8Aa26ABc81037e353A28c7752d73"
    );

    expect(result.type).toBe("fhe-x402-nonce");
    expect(result.nonce).toBe("0xabc123nonce");
    expect(result.tokenAddress).toBe("0xfF87ec6cb07D8Aa26ABc81037e353A28c7752d73");
    expect(result.network).toBe("eip155:11155111");
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it("uses custom network", () => {
    const result = fhePaymentProof(
      "0xnonce",
      "0x1111111111111111111111111111111111111111",
      "eip155:1"
    );

    expect(result.network).toBe("eip155:1");
  });
});
