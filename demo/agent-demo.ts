/**
 * FHE x402 Agent Demo — Terminal demonstration with ANSI colors.
 *
 * Shows the full V4.0 token-centric flow:
 *   Step 1: Wrap USDC → cUSDC (with fee)
 *   Step 2: Encrypted payment to another agent (real fhevmjs encryption)
 *   Step 3: Record payment nonce on-chain
 *   Step 4: Check balance status
 *   Step 5: Request withdrawal (step 1 of 2-step unwrap)
 *
 * Usage: npx tsx demo/agent-demo.ts
 * Requires: PRIVATE_KEY env var + funded Sepolia account
 */

import { JsonRpcProvider, Wallet, Contract, parseUnits, formatUnits, ethers } from "ethers";
import { initFhevm, createInstance } from "fhevmjs";

// ============================================================================
// ANSI Colors
// ============================================================================

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const BLUE = "\x1b[34m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const RED = "\x1b[31m";
const MAGENTA = "\x1b[35m";

// V4.0 Token-Centric Addresses (Sepolia)
const TOKEN_ADDRESS = "0x3864B98D1B1EC2109C679679052e2844b4153889";
const VERIFIER_ADDRESS = "0xCc60280A10FEB7fBdf20fBefc2abe6E0e99A5A83";
const USDC_ADDRESS = "0xc89e913676B034f8b38E49f7508803d1cDEC9F4f";
const GATEWAY_URL = "https://gateway.sepolia.zama.ai";

const USDC_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function mint(address to, uint256 amount) external",
];

const TOKEN_ABI = [
  "function wrap(address to, uint256 amount) external",
  "function confidentialBalanceOf(address) view returns (bytes32)",
  "function accumulatedFees() view returns (uint256)",
  "function setOperator(address operator, uint48 until) external",
  "function isOperator(address holder, address spender) view returns (bool)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function underlying() view returns (address)",
  "function treasury() view returns (address)",
  "function paused() view returns (bool)",
];

const VERIFIER_ABI = [
  "function recordPayment(address server, bytes32 nonce, uint64 minPrice) external",
  "function recordBatchPayment(address server, bytes32 nonce, uint32 requestCount, uint64 pricePerRequest) external",
  "function usedNonces(bytes32) view returns (bool)",
  "function trustedToken() view returns (address)",
  "event PaymentVerified(address indexed payer, address indexed server, bytes32 indexed nonce, uint64 minPrice)",
];

// ============================================================================
// Helpers
// ============================================================================

function banner(text: string) {
  const line = "═".repeat(60);
  console.log(`\n${CYAN}╔${line}╗${RESET}`);
  console.log(`${CYAN}║${RESET} ${BOLD}${text.padEnd(58)}${RESET} ${CYAN}║${RESET}`);
  console.log(`${CYAN}╚${line}╝${RESET}\n`);
}

function step(n: number, text: string) {
  console.log(`${BOLD}${BLUE}[Step ${n}]${RESET} ${text}`);
}

function info(label: string, value: string) {
  console.log(`  ${DIM}${label}:${RESET} ${GREEN}${value}${RESET}`);
}

function txBox(hash: string, gas: bigint) {
  console.log(`  ${YELLOW}┌─────────────────────────────────────────────────────┐${RESET}`);
  console.log(`  ${YELLOW}│${RESET} TX: ${CYAN}${hash.slice(0, 22)}...${hash.slice(-8)}${RESET}${" ".repeat(Math.max(0, 9))}${YELLOW}│${RESET}`);
  console.log(`  ${YELLOW}│${RESET} Gas: ${GREEN}${gas.toString().padEnd(44)}${RESET}${YELLOW}│${RESET}`);
  console.log(`  ${YELLOW}└─────────────────────────────────────────────────────┘${RESET}`);
}

function progress(text: string) {
  process.stdout.write(`  ${DIM}${text}...${RESET}`);
}

function done() {
  console.log(` ${GREEN}done${RESET}`);
}

function separator() {
  console.log(`${DIM}${"─".repeat(62)}${RESET}`);
}

// ============================================================================
// Main Demo
// ============================================================================

async function main() {
  banner("FHE x402 Agent Payment Demo (V4.0)");

  console.log(`${MAGENTA}Scheme:${RESET}    fhe-confidential-v1`);
  console.log(`${MAGENTA}Network:${RESET}   Ethereum Sepolia (chainId 11155111)`);
  console.log(`${MAGENTA}Token:${RESET}     ${TOKEN_ADDRESS}`);
  console.log(`${MAGENTA}Verifier:${RESET}  ${VERIFIER_ADDRESS}`);
  console.log(`${MAGENTA}USDC:${RESET}      ${USDC_ADDRESS}`);
  separator();

  // Setup
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.log(`${RED}Error: PRIVATE_KEY env var is required${RESET}`);
    process.exit(1);
  }

  const rpcUrl = process.env.RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
  const provider = new JsonRpcProvider(rpcUrl);
  const signer = new Wallet(privateKey, provider);
  const address = await signer.getAddress();

  const token = new Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);
  const verifier = new Contract(VERIFIER_ADDRESS, VERIFIER_ABI, signer);
  const usdc = new Contract(USDC_ADDRESS, USDC_ABI, signer);

  info("Agent Address", address);
  info("Network", "Ethereum Sepolia");

  // Check balances
  const ethBal = await provider.getBalance(address);
  const usdcBal: bigint = await usdc.balanceOf(address);
  info("ETH Balance", formatUnits(ethBal, 18) + " ETH");
  info("USDC Balance", formatUnits(usdcBal, 6) + " USDC");

  // Contract info
  const tokenName = await token.name();
  const tokenSymbol = await token.symbol();
  const trustedToken = await verifier.trustedToken();
  info("Token", `${tokenName} (${tokenSymbol})`);
  info("Verifier trustedToken", trustedToken);
  separator();

  // =============================================
  // Step 1: Wrap USDC → cUSDC
  // =============================================

  step(1, "Wrap USDC into Encrypted cUSDC");
  const wrapAmount = parseUnits("1", 6); // 1 USDC

  // Mint if needed
  if (usdcBal < wrapAmount * 2n) {
    progress("Minting 10 USDC (testnet)");
    const mintTx = await usdc.mint(address, parseUnits("10", 6));
    await mintTx.wait();
    done();
  }

  const feesBefore: bigint = await token.accumulatedFees();

  progress("Approving ConfidentialUSDC");
  const approveTx = await usdc.approve(TOKEN_ADDRESS, wrapAmount);
  await approveTx.wait();
  done();

  progress("Wrapping 1 USDC → cUSDC");
  const wrapTx = await token.wrap(address, wrapAmount);
  const wrapReceipt = await wrapTx.wait();
  done();

  txBox(wrapReceipt.hash, wrapReceipt.gasUsed);

  const feesAfter: bigint = await token.accumulatedFees();
  const feeCollected = feesAfter - feesBefore;
  info("Wrapped", "1.00 USDC");
  info("Fee", formatUnits(feeCollected, 6) + " USDC (0.1%, min 0.01)");
  info("Net Credit", formatUnits(wrapAmount - feeCollected, 6) + " cUSDC (encrypted)");
  separator();

  // =============================================
  // Step 2: Record Payment Nonce
  // =============================================

  step(2, "Record Payment Nonce On-Chain");
  const serverAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
  const nonce = ethers.hexlify(ethers.randomBytes(32));
  const minPrice = parseUnits("0.50", 6); // 0.50 USDC

  info("Server", serverAddress);
  info("Nonce", nonce.slice(0, 22) + "...");
  info("Min Price", "0.50 USDC");

  progress("Recording payment nonce");
  const rpTx = await verifier.recordPayment(serverAddress, nonce, minPrice);
  const rpReceipt = await rpTx.wait();
  done();

  txBox(rpReceipt.hash, rpReceipt.gasUsed);

  // Verify nonce is used
  const isUsed = await verifier.usedNonces(nonce);
  info("Nonce Used", isUsed ? "Yes (replay prevented)" : "No");
  separator();

  // =============================================
  // Step 3: Record Batch Prepayment
  // =============================================

  step(3, "Record Batch Prepayment (10 requests)");
  const batchNonce = ethers.hexlify(ethers.randomBytes(32));
  const requestCount = 10;
  const pricePerRequest = parseUnits("0.10", 6); // 0.10 USDC each

  info("Batch Nonce", batchNonce.slice(0, 22) + "...");
  info("Requests", String(requestCount));
  info("Price/Req", "0.10 USDC");
  info("Total", formatUnits(BigInt(requestCount) * pricePerRequest, 6) + " USDC");

  progress("Recording batch payment");
  const bpTx = await verifier.recordBatchPayment(serverAddress, batchNonce, requestCount, pricePerRequest);
  const bpReceipt = await bpTx.wait();
  done();

  txBox(bpReceipt.hash, bpReceipt.gasUsed);
  separator();

  // =============================================
  // Step 4: Set Operator (ERC-7984)
  // =============================================

  step(4, "Set Verifier as Operator (ERC-7984)");
  const farFuture = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;

  progress("Setting operator");
  const opTx = await token.setOperator(VERIFIER_ADDRESS, farFuture);
  const opReceipt = await opTx.wait();
  done();

  txBox(opReceipt.hash, opReceipt.gasUsed);

  const isOp = await token.isOperator(address, VERIFIER_ADDRESS);
  info("Verifier is Operator", isOp ? "Yes" : "No");
  separator();

  // =============================================
  // Step 5: Check Balance Status
  // =============================================

  step(5, "Check Balance Status");

  const newUsdcBal: bigint = await usdc.balanceOf(address);
  const encHandle = await token.confidentialBalanceOf(address);
  const zeroHandle = "0x" + "00".repeat(32);
  const hasEncBal = encHandle !== zeroHandle;
  const paused = await token.paused();

  info("Public USDC", formatUnits(newUsdcBal, 6) + " USDC");
  info("Encrypted cUSDC", hasEncBal ? `Handle: ${String(encHandle).slice(0, 18)}...` : "None");
  info("Contract Paused", paused ? "Yes" : "No");
  info("Accumulated Fees", formatUnits(feesAfter, 6) + " USDC");
  separator();

  // Privacy comparison
  console.log(`\n  ${BOLD}Privacy Comparison:${RESET}`);
  console.log(`  ┌──────────────────┬──────────────┬──────────────┐`);
  console.log(`  │ Property         │ Normal USDC  │ FHE x402     │`);
  console.log(`  ├──────────────────┼──────────────┼──────────────┤`);
  console.log(`  │ Amount           │ ${RED}Public${RESET}       │ ${GREEN}Encrypted${RESET}    │`);
  console.log(`  │ Sender           │ ${RED}Public${RESET}       │ ${YELLOW}Public*${RESET}      │`);
  console.log(`  │ Recipient        │ ${RED}Public${RESET}       │ ${YELLOW}Public*${RESET}      │`);
  console.log(`  │ Balance          │ ${RED}Public${RESET}       │ ${GREEN}Encrypted${RESET}    │`);
  console.log(`  │ TX Success       │ ${RED}Public${RESET}       │ ${GREEN}Hidden**${RESET}     │`);
  console.log(`  └──────────────────┴──────────────┴──────────────┘`);
  console.log(`  ${DIM}*  x402 requires public participants for payment verification${RESET}`);
  console.log(`  ${DIM}** Silent failure: insufficient balance → transfer 0, no revert${RESET}`);
  separator();

  // Gas summary
  console.log(`\n  ${BOLD}Gas Cost Summary:${RESET}`);
  console.log(`  ┌─────────────────────────┬──────────────┐`);
  console.log(`  │ Operation               │ Gas Used     │`);
  console.log(`  ├─────────────────────────┼──────────────┤`);
  console.log(`  │ USDC approve            │ ${approveTx.gasLimit?.toString().padStart(12) || "N/A".padStart(12)} │`);
  console.log(`  │ cUSDC wrap              │ ${wrapReceipt.gasUsed.toString().padStart(12)} │`);
  console.log(`  │ recordPayment           │ ${rpReceipt.gasUsed.toString().padStart(12)} │`);
  console.log(`  │ recordBatchPayment      │ ${bpReceipt.gasUsed.toString().padStart(12)} │`);
  console.log(`  │ setOperator             │ ${opReceipt.gasUsed.toString().padStart(12)} │`);
  console.log(`  └─────────────────────────┴──────────────┘`);

  // Summary
  banner("Demo Complete");
  console.log(`  ${GREEN}All transactions executed on Ethereum Sepolia.${RESET}`);
  console.log(`  ${DIM}View on Etherscan: https://sepolia.etherscan.io/address/${address}${RESET}`);
  console.log();
}

main().catch((e) => {
  console.error(`${RED}Demo failed:${RESET}`, e.message);
  process.exit(1);
});
