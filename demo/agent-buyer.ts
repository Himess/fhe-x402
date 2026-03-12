/**
 * FHE x402 Agent Buyer — Client that buys API data using encrypted payments.
 *
 * Usage: npx tsx demo/agent-buyer.ts
 * Requires: PRIVATE_KEY env var, seller server running
 */

import { JsonRpcProvider, Wallet } from "ethers";
import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk";
import { fheFetch } from "fhe-x402-sdk";

const API_URL = process.env.API_URL || "http://localhost:3001/api/premium/data";
const RPC_URL = process.env.RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
const TOKEN_ADDRESS = "0xE944754aa70d4924dc5d8E57774CDf21Df5e592D"; // ConfidentialUSDC
const VERIFIER_ADDRESS = "0x4503A7aee235aBD10e6064BBa8E14235fdF041f4"; // X402PaymentVerifier

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error("PRIVATE_KEY env var is required");
    process.exit(1);
  }

  const provider = new JsonRpcProvider(RPC_URL);
  const signer = new Wallet(privateKey, provider);
  const address = await signer.getAddress();

  console.log(`[Buyer] Agent address: ${address}`);
  console.log(`[Buyer] Target API: ${API_URL}`);
  console.log(`[Buyer] Token: ${TOKEN_ADDRESS}`);
  console.log(`[Buyer] Verifier: ${VERIFIER_ADDRESS}`);
  console.log();

  // Initialize @zama-fhe/relayer-sdk for real FHE encryption
  console.log("[Buyer] Initializing relayer-sdk (TFHE WASM)...");
  const fhevmInstance = await createInstance({
    ...SepoliaConfig,
    network: RPC_URL,
  });
  console.log("[Buyer] relayer-sdk ready.");
  console.log();

  console.log("[Buyer] Fetching API data with auto-402 payment...");

  try {
    const response = await fheFetch(API_URL, {
      tokenAddress: TOKEN_ADDRESS,
      verifierAddress: VERIFIER_ADDRESS,
      rpcUrl: RPC_URL,
      signer,
      fhevmInstance: fhevmInstance as any,
    });

    if (response.ok) {
      const data = await response.json();
      console.log("[Buyer] Payment successful! Data received:");
      console.log(JSON.stringify(data, null, 2));
    } else {
      console.log(`[Buyer] Request failed: ${response.status} ${response.statusText}`);
    }
  } catch (e: any) {
    console.log(`[Buyer] Error: ${e.message}`);
    console.log("[Buyer] Note: This demo requires the seller server to be running.");
    console.log("[Buyer] Run: npx tsx demo/agent-seller.ts");
  }
}

main().catch(console.error);
