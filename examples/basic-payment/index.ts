/**
 * Basic FHE x402 Payment Example
 *
 * Demonstrates the simplest flow: fheFetch automatically handles
 * 402 responses by encrypting payment via FHE and retrying.
 *
 * Usage: PRIVATE_KEY=0x... npx tsx examples/basic-payment/index.ts
 */
import { fheFetch } from "marc-protocol-sdk";
import { Wallet, JsonRpcProvider } from "ethers";
import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/node";

const RPC_URL = "https://ethereum-sepolia-rpc.publicnode.com";
const TOKEN_ADDRESS = "0xE944754aa70d4924dc5d8E57774CDf21Df5e592D";
const VERIFIER_ADDRESS = "0x4503A7aee235aBD10e6064BBa8E14235fdF041f4";

async function main() {
  const provider = new JsonRpcProvider(RPC_URL);
  const signer = new Wallet(process.env.PRIVATE_KEY!, provider);
  const fhevmInstance = await createInstance({ ...SepoliaConfig, network: RPC_URL });

  console.log("Agent:", await signer.getAddress());
  console.log("Making x402 payment...\n");

  const response = await fheFetch("https://api.example.com/premium-data", {
    tokenAddress: TOKEN_ADDRESS,
    verifierAddress: VERIFIER_ADDRESS,
    rpcUrl: RPC_URL,
    signer,
    fhevmInstance,
    maxPayment: 5_000_000n, // 5 USDC max
  });

  if (response.ok) {
    const data = await response.json();
    console.log("Paid & received:", data);
  } else {
    console.error("Failed:", response.status);
  }
}

main().catch(console.error);
