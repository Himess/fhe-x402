import { describe, it, expect, vi, beforeEach } from "vitest";

const mockConfidentialBalanceOf = vi.fn();

vi.mock("ethers", async () => {
  const actual = await vi.importActual("ethers");
  return {
    ...actual,
    ethers: {
      ...(actual as any).ethers,
      Contract: vi.fn().mockImplementation(() => ({
        confidentialBalanceOf: mockConfidentialBalanceOf,
      })),
    },
  };
});

import {
  checkSenderHasBalance,
  checkBalanceChanged,
  getBalanceBefore,
  verifyAfterTransfer,
} from "../src/silentFailureGuard.js";

const ZERO_HANDLE = "0x" + "00".repeat(32);
const NON_ZERO_HANDLE = "0x" + "ab".repeat(32);
const CHANGED_HANDLE = "0x" + "cd".repeat(32);

const mockProvider = {} as any;

describe("silentFailureGuard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("checkSenderHasBalance", () => {
    it("returns likelyValid=false for zero handle", async () => {
      mockConfidentialBalanceOf.mockResolvedValue(ZERO_HANDLE);
      const result = await checkSenderHasBalance("0xtoken", "0xsender", mockProvider);
      expect(result.likelyValid).toBe(false);
      expect(result.reason).toContain("zero");
    });

    it("returns likelyValid=true for non-zero handle", async () => {
      mockConfidentialBalanceOf.mockResolvedValue(NON_ZERO_HANDLE);
      const result = await checkSenderHasBalance("0xtoken", "0xsender", mockProvider);
      expect(result.likelyValid).toBe(true);
    });
  });

  describe("checkBalanceChanged", () => {
    it("returns likelyValid=false when handle unchanged", async () => {
      mockConfidentialBalanceOf.mockResolvedValue(NON_ZERO_HANDLE);
      const result = await checkBalanceChanged("0xtoken", "0xsender", NON_ZERO_HANDLE, mockProvider);
      expect(result.likelyValid).toBe(false);
      expect(result.reason).toContain("unchanged");
    });

    it("returns likelyValid=true when handle changed", async () => {
      mockConfidentialBalanceOf.mockResolvedValue(CHANGED_HANDLE);
      const result = await checkBalanceChanged("0xtoken", "0xsender", NON_ZERO_HANDLE, mockProvider);
      expect(result.likelyValid).toBe(true);
      expect(result.reason).toContain("changed");
    });
  });

  describe("verifyAfterTransfer", () => {
    it("detects guaranteed failure when balance was zero before", async () => {
      const result = await verifyAfterTransfer("0xtoken", "0xsender", ZERO_HANDLE, mockProvider);
      expect(result.likelyValid).toBe(false);
      expect(result.reason).toContain("guaranteed silent failure");
    });

    it("detects likely failure when handle unchanged", async () => {
      mockConfidentialBalanceOf.mockResolvedValue(NON_ZERO_HANDLE);
      const result = await verifyAfterTransfer("0xtoken", "0xsender", NON_ZERO_HANDLE, mockProvider);
      expect(result.likelyValid).toBe(false);
    });

    it("passes when handle changed", async () => {
      mockConfidentialBalanceOf.mockResolvedValue(CHANGED_HANDLE);
      const result = await verifyAfterTransfer("0xtoken", "0xsender", NON_ZERO_HANDLE, mockProvider);
      expect(result.likelyValid).toBe(true);
    });
  });

  describe("getBalanceBefore", () => {
    it("returns balance handle", async () => {
      mockConfidentialBalanceOf.mockResolvedValue(NON_ZERO_HANDLE);
      const handle = await getBalanceBefore("0xtoken", "0xsender", mockProvider);
      expect(handle).toBe(NON_ZERO_HANDLE);
    });
  });
});
