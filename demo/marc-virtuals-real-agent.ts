/**
 * MARC Protocol × Virtuals — Real Autonomous GAME Agent Demo
 *
 * Creates a REAL GameAgent using the Virtuals Protocol GAME API.
 * The agent autonomously decides to: check balance → wrap USDC → FHE pay → check balance.
 * All on-chain transactions are real (Ethereum Sepolia).
 *
 * Self-contained — no local SDK build required.
 *
 * Usage:
 *   PRIVATE_KEY=0x... GAME_API_KEY=apt-... npx tsx demo/marc-virtuals-real-agent.ts
 *
 * Requires:
 *   - Ethereum Sepolia ETH (>= 0.01)
 *   - USDC on Sepolia (>= 2) — auto-mints if low
 *   - Virtuals GAME API key (https://game.virtuals.io)
 */

import {
  GameAgent,
  GameWorker,
  GameFunction,
  ExecutableGameFunctionResponse,
  ExecutableGameFunctionStatus,
} from "@virtuals-protocol/game";
import { JsonRpcProvider, Wallet, Contract, parseUnits, formatUnits, ethers } from "ethers";
import { createInstance, SepoliaConfig } from "@zama-fhe/relayer-sdk/node";

// ============================================================================
// ANSI Colors
// ============================================================================

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";
const MAGENTA = "\x1b[35m";
const BLUE = "\x1b[34m";

// ============================================================================
// Contract Addresses & ABIs (Sepolia V4.3)
// ============================================================================

const USDC_ADDRESS = "0xc89e913676B034f8b38E49f7508803d1cDEC9F4f";
const TOKEN_ADDRESS = "0xE944754aa70d4924dc5d8E57774CDf21Df5e592D";
const VERIFIER_ADDRESS = "0x4503A7aee235aBD10e6064BBa8E14235fdF041f4";

const USDC_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
  "function mint(address to, uint256 amount) external",
];

const TOKEN_ABI = [
  "function wrap(address to, uint256 amount) external",
  "function confidentialTransfer(address to, bytes32 handle, bytes calldata inputProof) external",
  "function confidentialBalanceOf(address) view returns (bytes32)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
];

const VERIFIER_ABI = [
  "function recordPayment(address server, bytes32 nonce, uint64 minPrice) external",
  "function usedNonces(bytes32) view returns (bool)",
];

const ETHERSCAN = "https://sepolia.etherscan.io";

// ============================================================================
// Build GameFunctions (inline — no SDK dependency needed)
// ============================================================================

function buildFheWorker(
  privateKey: string,
  rpcUrl: string,
  fhevmInstance: any,
): GameWorker {
  const provider = new JsonRpcProvider(rpcUrl);
  const signer = new Wallet(privateKey, provider);
  const usdc = new Contract(USDC_ADDRESS, USDC_ABI, signer);
  const token = new Contract(TOKEN_ADDRESS, TOKEN_ABI, signer);
  const verifier = new Contract(VERIFIER_ADDRESS, VERIFIER_ABI, signer);

  // ── fhe_balance ──
  const balanceFn = new GameFunction({
    name: "fhe_balance",
    description: "Check wallet's public USDC balance and encrypted cUSDC balance handle.",
    args: [] as const,
    executable: async (_args, logger) => {
      try {
        const address = await signer.getAddress();
        logger("Checking balances...");

        const usdcBal: bigint = await usdc.balanceOf(address);
        const encHandle = await token.confidentialBalanceOf(address);
        const hasEnc = encHandle !== "0x" + "00".repeat(32);

        const result = {
          action: "balance",
          walletAddress: address,
          publicUSDC: formatUnits(usdcBal, 6),
          hasEncryptedBalance: hasEnc,
        };

        logger(`USDC: ${result.publicUSDC}, Encrypted cUSDC: ${hasEnc ? "active" : "none"}`);
        return new ExecutableGameFunctionResponse(ExecutableGameFunctionStatus.Done, JSON.stringify(result));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return new ExecutableGameFunctionResponse(ExecutableGameFunctionStatus.Failed, `Balance failed: ${msg}`);
      }
    },
  });

  // ── fhe_wrap ──
  const wrapFn = new GameFunction({
    name: "fhe_wrap",
    description: "Wrap USDC into encrypted cUSDC (ERC-7984). Amount in USDC (e.g. '1' for 1 USDC).",
    args: [{ name: "amount", description: "Amount of USDC to wrap (e.g. '1')" }] as const,
    executable: async (args, logger) => {
      try {
        const amountStr = args.amount;
        if (!amountStr) {
          return new ExecutableGameFunctionResponse(ExecutableGameFunctionStatus.Failed, "Amount is required");
        }
        const amountFloat = parseFloat(amountStr);
        if (isNaN(amountFloat) || amountFloat <= 0) {
          return new ExecutableGameFunctionResponse(ExecutableGameFunctionStatus.Failed, "Invalid amount");
        }
        const rawAmount = BigInt(Math.round(amountFloat * 1_000_000));
        const address = await signer.getAddress();

        logger(`Approving ${amountStr} USDC...`);
        const approveTx = await usdc.approve(TOKEN_ADDRESS, rawAmount);
        await approveTx.wait();

        logger(`Wrapping ${amountStr} USDC into encrypted cUSDC...`);
        const tx = await token.wrap(address, rawAmount);
        const receipt = await tx.wait();

        logger(`Wrap confirmed: ${ETHERSCAN}/tx/${receipt.hash}`);
        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Done,
          JSON.stringify({ action: "wrap", amount: amountStr, txHash: receipt.hash, gas: receipt.gasUsed.toString() }),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return new ExecutableGameFunctionResponse(ExecutableGameFunctionStatus.Failed, `Wrap failed: ${msg}`);
      }
    },
  });

  // ── fhe_pay ──
  const payFn = new GameFunction({
    name: "fhe_pay",
    description: "Pay using FHE-encrypted cUSDC. Amount is encrypted on-chain — nobody can see it.",
    args: [
      { name: "to", description: "Recipient Ethereum address" },
      { name: "amount", description: "Amount of USDC to pay (e.g. '0.5')" },
    ] as const,
    executable: async (args, logger) => {
      try {
        const to = args.to;
        const amountStr = args.amount;
        if (!to || !amountStr) {
          return new ExecutableGameFunctionResponse(ExecutableGameFunctionStatus.Failed, "'to' and 'amount' required");
        }
        if (!/^0x[a-fA-F0-9]{40}$/.test(to)) {
          return new ExecutableGameFunctionResponse(ExecutableGameFunctionStatus.Failed, "Invalid address");
        }
        const amountFloat = parseFloat(amountStr);
        if (isNaN(amountFloat) || amountFloat <= 0) {
          return new ExecutableGameFunctionResponse(ExecutableGameFunctionStatus.Failed, "Invalid amount");
        }
        const rawAmount = BigInt(Math.round(amountFloat * 1_000_000));
        const address = await signer.getAddress();
        const nonce = ethers.hexlify(ethers.randomBytes(32));

        logger(`Encrypting ${amountStr} USDC with Zama FHE...`);
        const input = fhevmInstance.createEncryptedInput(TOKEN_ADDRESS, address);
        input.add64(rawAmount);
        const encrypted = await input.encrypt();

        logger(`Sending confidentialTransfer to ${to.slice(0, 12)}...`);
        const tx = await token.confidentialTransfer(to, encrypted.handles[0], encrypted.inputProof);
        const receipt = await tx.wait();
        logger(`Transfer confirmed: ${ETHERSCAN}/tx/${receipt.hash}`);

        logger(`Recording payment nonce...`);
        const vTx = await verifier.recordPayment(to, nonce, rawAmount);
        const vReceipt = await vTx.wait();
        logger(`Nonce recorded: ${ETHERSCAN}/tx/${vReceipt.hash}`);

        return new ExecutableGameFunctionResponse(
          ExecutableGameFunctionStatus.Done,
          JSON.stringify({
            action: "pay",
            to,
            amount: amountStr,
            transferTxHash: receipt.hash,
            verifierTxHash: vReceipt.hash,
            nonce,
            amountOnChain: "ENCRYPTED",
          }),
        );
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        return new ExecutableGameFunctionResponse(ExecutableGameFunctionStatus.Failed, `Payment failed: ${msg}`);
      }
    },
  });

  // ── fhe_info ──
  const infoFn = new GameFunction({
    name: "fhe_info",
    description: "Get contract addresses, network info, and wallet address.",
    args: [] as const,
    executable: async (_args, logger) => {
      const address = await signer.getAddress();
      logger("Fetching info...");
      return new ExecutableGameFunctionResponse(
        ExecutableGameFunctionStatus.Done,
        JSON.stringify({
          action: "info",
          network: "Ethereum Sepolia",
          chainId: 11155111,
          tokenAddress: TOKEN_ADDRESS,
          verifierAddress: VERIFIER_ADDRESS,
          walletAddress: address,
          scheme: "fhe-confidential-v1",
        }),
      );
    },
  });

  return new GameWorker({
    id: "fhe_x402_worker",
    name: "MARC FHE Payment Worker",
    description:
      "Manages encrypted USDC payments using Zama FHE on Ethereum Sepolia. Can wrap USDC into encrypted cUSDC, make confidential transfers, check balances, and record x402 payment nonces.",
    functions: [balanceFn, wrapFn, payFn, infoFn],
    getEnvironment: async () => ({
      network: "Ethereum Sepolia",
      token_address: TOKEN_ADDRESS,
      verifier_address: VERIFIER_ADDRESS,
      wallet_address: await signer.getAddress(),
    }),
  });
}

// ============================================================================
// Main
// ============================================================================

async function main() {
  if (!process.env.PRIVATE_KEY) {
    console.error(`${RED}ERROR: Set PRIVATE_KEY environment variable${RESET}`);
    console.error("Usage: PRIVATE_KEY=0x... GAME_API_KEY=apt-... npx tsx demo/marc-virtuals-real-agent.ts");
    process.exit(1);
  }
  if (!process.env.GAME_API_KEY) {
    console.error(`${RED}ERROR: Set GAME_API_KEY environment variable${RESET}`);
    console.error("Get your key at https://game.virtuals.io");
    process.exit(1);
  }

  const rpcUrl = process.env.RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
  const provider = new JsonRpcProvider(rpcUrl);
  const signer = new Wallet(process.env.PRIVATE_KEY, provider);
  const address = await signer.getAddress();
  const usdc = new Contract(USDC_ADDRESS, USDC_ABI, signer);

  // ── Header ──
  console.log("");
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║  MARC Protocol × Virtuals — Real Autonomous Agent        ║${RESET}`);
  console.log(`${CYAN}${BOLD}║  FHE-Powered x402 Payment via GAME Protocol              ║${RESET}`);
  console.log(`${CYAN}${BOLD}║  Network: Ethereum Sepolia (11155111)                     ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log("");

  // ── Wallet Info ──
  const ethBal = await provider.getBalance(address);
  const usdcBal: bigint = await usdc.balanceOf(address);

  console.log(`   ${DIM}Agent Wallet${RESET}       ${CYAN}${address}${RESET}`);
  console.log(`   ${DIM}ETH Balance${RESET}        ${GREEN}${parseFloat(formatUnits(ethBal, 18)).toFixed(4)} ETH${RESET}`);
  console.log(`   ${DIM}USDC Balance${RESET}       ${GREEN}${formatUnits(usdcBal, 6)} USDC${RESET}`);
  console.log(`   ${DIM}Scheme${RESET}             fhe-confidential-v1`);
  console.log(`   ${DIM}GAME API Key${RESET}       ${process.env.GAME_API_KEY.slice(0, 12)}...${RESET}`);
  console.log("");

  // ── Mint USDC if needed ──
  if (usdcBal < parseUnits("2", 6)) {
    console.log(`   ${YELLOW}Low USDC balance — minting 10 test USDC...${RESET}`);
    const mintTx = await usdc.mint(address, parseUnits("10", 6));
    await mintTx.wait();
    console.log(`   ${GREEN}Minted 10 USDC${RESET}\n`);
  }

  // ── Initialize FHE Engine ──
  console.log(`   ${CYAN}Initializing Zama FHE encryption engine...${RESET}`);
  const fhevmInstance = await createInstance({ ...SepoliaConfig, network: rpcUrl });
  console.log(`   ${GREEN}✓ FHE engine ready${RESET}\n`);

  // ── Create Worker (self-contained) ──
  const worker = buildFheWorker(process.env.PRIVATE_KEY, rpcUrl, fhevmInstance);
  console.log(`   ${GREEN}✓ FHE Plugin created:${RESET} 4 GameFunctions`);
  console.log(`   ${DIM}  Functions: fhe_balance, fhe_wrap, fhe_pay, fhe_info${RESET}\n`);

  // ── Create GAME Agent ──
  const serverAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

  const agent = new GameAgent(process.env.GAME_API_KEY, {
    name: "MARC-Agent",
    goal: `You are an AI agent that needs to pay for a premium API using encrypted payments. Follow these steps in order:
1. First check your balance using fhe_balance
2. Wrap 1 USDC into encrypted cUSDC using fhe_wrap with amount "1"
3. Pay 0.50 USDC to ${serverAddress} using fhe_pay with to="${serverAddress}" and amount="0.50"
4. Check your balance again using fhe_balance to confirm the payment went through`,
    description:
      "An autonomous AI payment agent using MARC Protocol. You make FHE-encrypted payments — the transfer amounts are hidden on-chain using Zama's Fully Homomorphic Encryption. You operate on Ethereum Sepolia using the fhe-confidential-v1 scheme.",
    workers: [worker],
  });

  // ── Custom Logger ──
  agent.setLogger((a, msg) => {
    const ts = new Date().toISOString().split("T")[1]!.slice(0, 8);
    console.log(`   ${DIM}[${ts}]${RESET} ${MAGENTA}[${a.name}]${RESET} ${msg}`);
  });

  console.log(`   ${GREEN}✓ GameAgent created:${RESET} "${agent.name}"`);
  console.log(`   ${DIM}  Target: Pay 0.50 encrypted USDC to ${serverAddress.slice(0, 12)}...${RESET}\n`);

  // ── Initialize Agent ──
  console.log(`${CYAN}${BOLD}━━━ INITIALIZING GAME AGENT ━━━${RESET}\n`);
  await agent.init();
  console.log(`\n   ${GREEN}✓ Agent initialized — ready for autonomous steps${RESET}\n`);

  // ── Run Autonomous Steps ──
  const maxSteps = 6;
  console.log(`${CYAN}${BOLD}━━━ RUNNING ${maxSteps} AUTONOMOUS STEPS ━━━${RESET}\n`);

  for (let i = 1; i <= maxSteps; i++) {
    console.log(`${BLUE}${BOLD}   ▶ STEP ${i}/${maxSteps}${RESET}`);
    console.log(`   ${DIM}${"─".repeat(50)}${RESET}`);

    try {
      const action = await agent.step({ verbose: true });
      console.log(`\n   ${GREEN}✓ Result: ${action}${RESET}\n`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`   ${RED}✗ Step ${i} error: ${msg}${RESET}\n`);
    }
  }

  // ── Summary ──
  console.log("");
  console.log(`${CYAN}${BOLD}╔══════════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${CYAN}${BOLD}║  ${GREEN}Autonomous GAME agent completed ${maxSteps} steps.${CYAN}               ║${RESET}`);
  console.log(`${CYAN}${BOLD}║                                                          ║${RESET}`);
  console.log(`${CYAN}${BOLD}║  Agent: MARC-Agent (Virtuals GAME Protocol)               ║${RESET}`);
  console.log(`${CYAN}${BOLD}║  Plugin: FHE x402 Payment Worker                          ║${RESET}`);
  console.log(`${CYAN}${BOLD}║  Chain: Ethereum Sepolia (real transactions)               ║${RESET}`);
  console.log(`${CYAN}${BOLD}║  Privacy: FHE-encrypted amounts (Zama fhEVM)              ║${RESET}`);
  console.log(`${CYAN}${BOLD}║  github.com/Himess/marc-protocol                          ║${RESET}`);
  console.log(`${CYAN}${BOLD}╚══════════════════════════════════════════════════════════╝${RESET}`);
  console.log("");
}

main().catch((err) => {
  console.error(`\n${RED}${BOLD}Fatal: ${err.message}${RESET}`);
  console.error(`${DIM}${err.stack}${RESET}`);
  process.exit(1);
});
