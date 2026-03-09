/**
 * ERC-8004 integration helpers for FHE x402.
 * Generates registration file entries and payment proof for feedback.
 */

export interface FhePaymentMethod {
  scheme: "fhe-confidential-v1";
  network: string;
  token: string;
  tokenAddress: string;
  verifier: string;
  privacyLevel: "encrypted-balances";
  features: string[];
  description: string;
}

export interface PaymentProofForFeedback {
  type: "fhe-x402-nonce";
  nonce: string;
  tokenAddress: string;
  network: string;
  timestamp: number;
}

/**
 * Generate ERC-8004 compatible payment method entry
 * for agent registration files.
 */
export function fhePaymentMethod(config: {
  tokenAddress: string;
  verifierAddress: string;
  facilitatorUrl?: string;
  network?: string;
  token?: string;
}): FhePaymentMethod {
  return {
    scheme: "fhe-confidential-v1",
    network: config.network || "eip155:11155111",
    token: config.token || "USDC",
    tokenAddress: config.tokenAddress,
    verifier: config.verifierAddress,
    privacyLevel: "encrypted-balances",
    features: [
      "fhe-encrypted-amounts",
      "token-centric",
      "fee-free-transfers",
    ],
    description: "FHE-encrypted x402 payment via ConfidentialUSDC token",
  };
}

/**
 * Generate proof-of-payment for ERC-8004 feedback submission.
 * Uses nonce as proof that a real payment was made,
 * without revealing the encrypted amount.
 */
export function fhePaymentProof(
  nonce: string,
  tokenAddress: string,
  network?: string
): PaymentProofForFeedback {
  return {
    type: "fhe-x402-nonce",
    nonce,
    tokenAddress,
    network: network || "eip155:11155111",
    timestamp: Date.now(),
  };
}
