/**
 * FHE x402 Plugin for ElizaOS
 *
 * Adds encrypted USDC payment actions to an ElizaOS agent.
 * Uses FHE to hide payment amounts on-chain.
 *
 * V4.0 token-centric: agents hold cUSDC directly via ConfidentialUSDC.
 * No pool contract. Wrap/unwrap USDC <-> cUSDC, pay via confidentialTransfer.
 */

import { fheFetch, TOKEN_ABI, VERIFIER_ABI } from "fhe-x402-sdk";
import type { FhevmInstance } from "fhe-x402-sdk";
import { JsonRpcProvider, Wallet, Contract } from "ethers";
import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk";

// ElizaOS plugin interface (simplified)
interface Action {
  name: string;
  description: string;
  handler: (context: ActionContext) => Promise<ActionResult>;
}

interface ActionContext {
  params: Record<string, string>;
  getService: (name: string) => unknown;
}

interface ActionResult {
  success: boolean;
  data?: unknown;
  message?: string;
}

interface Plugin {
  name: string;
  actions: Action[];
  initialize: () => Promise<void>;
}

const TOKEN_ADDRESS = "0xE944754aa70d4924dc5d8E57774CDf21Df5e592D"; // ConfidentialUSDC
const VERIFIER_ADDRESS = "0x4503A7aee235aBD10e6064BBa8E14235fdF041f4"; // X402PaymentVerifier
const USDC_ADDRESS = "0xc89e913676B034f8b38E49f7508803d1cDEC9F4f"; // MockUSDC

let token: Contract;
let verifier: Contract;
let signer: Wallet;
let fhevmInstance: FhevmInstance;

export const fhePlugin: Plugin = {
  name: "fhe-x402",

  actions: [
    {
      name: "FHE_PAY",
      description: "Make an encrypted payment to access a paid API endpoint via fheFetch",
      handler: async (ctx: ActionContext): Promise<ActionResult> => {
        const url = ctx.params.url;
        if (!url) return { success: false, message: "URL required" };

        // fheFetch handles the 402 flow automatically:
        // 1. GET url -> 402
        // 2. Encrypt amount with @zama-fhe/relayer-sdk -> cUSDC.confidentialTransfer() + verifier.recordPayment()
        // 3. Retry with Payment header -> 200
        try {
          const response = await fheFetch(url, {
            tokenAddress: TOKEN_ADDRESS,
            verifierAddress: VERIFIER_ADDRESS,
            rpcUrl: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
            signer,
            fhevmInstance,
          });
          if (response.ok) {
            const data = await response.json();
            return { success: true, data };
          }
          return { success: false, message: `Payment failed: ${response.status}` };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { success: false, message: msg };
        }
      },
    },

    {
      name: "FHE_BALANCE",
      description: "Check the agent's USDC balance and encrypted cUSDC balance",
      handler: async (): Promise<ActionResult> => {
        const address = await signer.getAddress();

        // Public USDC balance
        const usdc = new Contract(
          USDC_ADDRESS,
          ["function balanceOf(address) view returns (uint256)"],
          signer
        );
        const usdcBalance: bigint = await usdc.balanceOf(address);
        const usdcFormatted = (Number(usdcBalance) / 1_000_000).toFixed(2);

        // Encrypted cUSDC balance (returns an encrypted handle — not readable off-chain without decryption)
        const cUsdcHandle: string = await token.confidentialBalanceOf(address);

        return {
          success: true,
          data: {
            usdc: usdcFormatted,
            usdcRaw: usdcBalance.toString(),
            cUsdcHandle,
          },
          message: `Public USDC: ${usdcFormatted}, cUSDC handle: ${cUsdcHandle}`,
        };
      },
    },

    {
      name: "FHE_WRAP",
      description: "Wrap USDC into encrypted cUSDC (ConfidentialUSDC). Approve + wrap in one step.",
      handler: async (ctx: ActionContext): Promise<ActionResult> => {
        const amount = ctx.params.amount;
        if (!amount) return { success: false, message: "Amount required (in USDC)" };

        const amountRaw = BigInt(Math.round(parseFloat(amount) * 1_000_000));

        try {
          // Approve ConfidentialUSDC to pull USDC
          const usdc = new Contract(
            USDC_ADDRESS,
            ["function approve(address, uint256) returns (bool)"],
            signer
          );
          const approveTx = await usdc.approve(TOKEN_ADDRESS, amountRaw);
          await approveTx.wait();

          // Wrap USDC -> cUSDC (0.1% fee charged on wrap)
          const address = await signer.getAddress();
          const tx = await token.wrap(address, amountRaw);
          const receipt = await tx.wait();

          return {
            success: true,
            data: { txHash: receipt.hash, amount },
            message: `Wrapped ${amount} USDC -> cUSDC | TX: ${receipt.hash}`,
          };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { success: false, message: `Wrap failed: ${msg}` };
        }
      },
    },

    {
      name: "FHE_UNWRAP",
      description: "Unwrap cUSDC back to USDC. Requires FHE-encrypted amount. This is async — KMS decryption finalizes later via finalizeUnwrap.",
      handler: async (ctx: ActionContext): Promise<ActionResult> => {
        const amount = ctx.params.amount;
        if (!amount) return { success: false, message: "Amount required (in USDC)" };

        const amountRaw = BigInt(Math.round(parseFloat(amount) * 1_000_000));

        try {
          const address = await signer.getAddress();

          // Encrypt the amount for the unwrap call
          const input = fhevmInstance.createEncryptedInput(TOKEN_ADDRESS, address);
          input.add64(amountRaw);
          const { handles, inputProof } = await input.encrypt();

          // Request unwrap: cUSDC -> USDC (0.1% fee charged on unwrap)
          // This initiates KMS decryption — finalizeUnwrap is called by the KMS callback
          const tx = await token.unwrap(address, address, handles[0], inputProof);
          const receipt = await tx.wait();

          return {
            success: true,
            data: {
              action: "unwrap_requested",
              amount,
              txHash: receipt.hash,
              blockNumber: receipt.blockNumber,
            },
            message: `Unwrap requested for ${amount} cUSDC -> USDC | TX: ${receipt.hash} (KMS finalization pending)`,
          };
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          return { success: false, message: `Unwrap failed: ${msg}` };
        }
      },
    },
  ],

  initialize: async () => {
    const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
    const provider = new JsonRpcProvider(rpcUrl);
    signer = new Wallet(process.env.PRIVATE_KEY!, provider);
    token = new Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);
    verifier = new Contract(VERIFIER_ADDRESS, VERIFIER_ABI, signer);

    // Initialize @zama-fhe/relayer-sdk for real FHE encryption
    fhevmInstance = await createInstance({
      ...SepoliaConfig,
      network: rpcUrl,
    }) as unknown as FhevmInstance;

    console.log("[FHE x402] Plugin initialized — token-centric V4.0");
  },
};
