import { Contract, ethers } from "ethers";
import type {
  FhePaymentRequirements,
  FhePaymentPayload,
  FhePaymentRequired,
  FhevmInstance,
} from "./types.js";
import { FHE_SCHEME } from "./types.js";
import { PaymentError, EncryptionError } from "./errors.js";

// ============================================================================
// Types
// ============================================================================

export interface FhePaymentHandlerOptions {
  maxPayment?: bigint;
  allowedNetworks?: string[];
}

export interface FhePaymentResult {
  paymentHeader: string;
  txHash: string;
  verifierTxHash: string;
  nonce: string;
}

// ============================================================================
// Handler
// ============================================================================

/**
 * Handles x402 FHE payment flows.
 *
 * V4.0 Flow (token-centric):
 * 1. Parse 402 response → extract payment requirements
 * 2. Select matching requirement
 * 3. Encrypt amount with fhevmjs
 * 4. Call cUSDC.confidentialTransfer() (fee-free agent-to-agent)
 * 5. Call verifier.recordPayment() (on-chain nonce)
 * 6. Return txHash + verifierTxHash + nonce for retry header
 */
export class FhePaymentHandler {
  private signer: ethers.Signer;
  private fhevmInstance: FhevmInstance;
  private options: FhePaymentHandlerOptions;

  constructor(
    signer: ethers.Signer,
    fhevmInstance: FhevmInstance,
    options: FhePaymentHandlerOptions = {}
  ) {
    this.signer = signer;
    this.fhevmInstance = fhevmInstance;
    this.options = options;
  }

  async parsePaymentRequired(
    response: Response
  ): Promise<FhePaymentRequired | null> {
    if (response.status !== 402) return null;
    try {
      const body = await response.json();
      if (!body || body.x402Version !== 1 || !Array.isArray(body.accepts)) {
        return null;
      }
      return body as FhePaymentRequired;
    } catch {
      return null;
    }
  }

  selectRequirement(
    requirements: FhePaymentRequirements[]
  ): FhePaymentRequirements | null {
    for (const req of requirements) {
      if (req.scheme !== FHE_SCHEME) continue;
      if (
        this.options.allowedNetworks?.length &&
        !this.options.allowedNetworks.includes(req.network)
      ) {
        continue;
      }
      if (this.options.maxPayment && this.options.maxPayment > 0n) {
        const price = BigInt(req.price);
        if (price > this.options.maxPayment) continue;
      }
      return req;
    }
    return null;
  }

  async createPayment(
    requirements: FhePaymentRequirements
  ): Promise<FhePaymentResult> {
    const signerAddress = await this.signer.getAddress();
    const amount = BigInt(requirements.price);

    // Create nonce
    const nonce = ethers.hexlify(ethers.randomBytes(32));

    // Encrypt amount with fhevmjs
    let encrypted: { handles: string[]; inputProof: string };
    try {
      const input = this.fhevmInstance.createEncryptedInput(
        requirements.tokenAddress,
        signerAddress
      );
      input.add64(amount);
      encrypted = await input.encrypt();
    } catch (err) {
      throw new EncryptionError(
        `FHE encryption failed: ${err instanceof Error ? err.message : String(err)}`,
        { amount: amount.toString(), tokenAddress: requirements.tokenAddress }
      );
    }

    // Step 1: Call cUSDC.confidentialTransfer() — fee-free agent-to-agent transfer
    const tokenABI = [
      "function confidentialTransfer(address to, bytes32 encryptedAmount, bytes calldata inputProof) external returns (bytes32)",
    ];
    const token = new Contract(requirements.tokenAddress, tokenABI, this.signer);

    const tx = await token.confidentialTransfer(
      requirements.recipientAddress,
      encrypted.handles[0],
      encrypted.inputProof
    );
    const receipt = await tx.wait();

    if (!receipt || receipt.status === 0) {
      throw new PaymentError("Payment transaction failed", {
        txHash: tx.hash,
        to: requirements.recipientAddress,
        amount: amount.toString(),
      });
    }

    // Step 2: Call verifier.recordPayment() — on-chain nonce
    const verifierABI = [
      "function recordPayment(address payer, address server, bytes32 nonce) external",
    ];
    const verifier = new Contract(requirements.verifierAddress, verifierABI, this.signer);

    const vTx = await verifier.recordPayment(
      signerAddress,
      requirements.recipientAddress,
      nonce
    );
    const vReceipt = await vTx.wait();

    if (!vReceipt || vReceipt.status === 0) {
      throw new PaymentError("Verifier recordPayment failed", {
        txHash: vTx.hash,
        nonce,
      });
    }

    // Build payment payload
    const payload: FhePaymentPayload = {
      scheme: FHE_SCHEME,
      txHash: tx.hash,
      verifierTxHash: vTx.hash,
      nonce,
      from: signerAddress,
      chainId: requirements.chainId,
    };

    const paymentHeader = encodePaymentHeader(payload);

    return {
      paymentHeader,
      txHash: tx.hash,
      verifierTxHash: vTx.hash,
      nonce,
    };
  }

  async handlePaymentRequired(
    response: Response
  ): Promise<FhePaymentResult | null> {
    const paymentRequired = await this.parsePaymentRequired(response);
    if (!paymentRequired) return null;

    const requirement = this.selectRequirement(paymentRequired.accepts);
    if (!requirement) return null;

    return this.createPayment(requirement);
  }
}

// ============================================================================
// Encoding
// ============================================================================

function encodePaymentHeader(payload: FhePaymentPayload): string {
  const json = JSON.stringify(payload);
  return Buffer.from(json).toString("base64");
}

export function decodePaymentHeader(header: string): FhePaymentPayload {
  const json = Buffer.from(header, "base64").toString("utf-8");
  const parsed = JSON.parse(json);
  if (
    !parsed ||
    typeof parsed.scheme !== "string" ||
    typeof parsed.txHash !== "string" ||
    typeof parsed.nonce !== "string" ||
    typeof parsed.from !== "string" ||
    typeof parsed.chainId !== "number"
  ) {
    throw new Error("Invalid payment payload: missing required fields");
  }
  return parsed as FhePaymentPayload;
}
