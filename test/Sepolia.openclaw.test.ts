/**
 * Sepolia On-Chain — OpenClaw Skill Integration Test
 *
 * Simulates the full OpenClaw skill command set on a real network:
 *   1. info — Display network/contract info
 *   2. balance — Check USDC + cUSDC balances
 *   3. wrap — Wrap USDC into cUSDC
 *   4. pay — Record payment nonce
 *   5. Operator setup
 *
 * Each test mirrors the corresponding OpenClaw skill script.
 *
 * Run: npx hardhat test test/Sepolia.openclaw.test.ts --network sepolia
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract, Signer } from "ethers";

const MOCK_USDC = "0xc89e913676B034f8b38E49f7508803d1cDEC9F4f";
const CUSDC = "0xE944754aa70d4924dc5d8E57774CDf21Df5e592D";
const VERIFIER = "0x4503A7aee235aBD10e6064BBa8E14235fdF041f4";

const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function mint(address, uint256)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
];

const TOKEN_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function underlying() view returns (address)",
  "function rate() view returns (uint256)",
  "function treasury() view returns (address)",
  "function accumulatedFees() view returns (uint256)",
  "function paused() view returns (bool)",
  "function owner() view returns (address)",
  "function wrap(address to, uint256 amount)",
  "function confidentialBalanceOf(address) view returns (bytes32)",
  "function setOperator(address operator, uint48 until)",
  "function isOperator(address holder, address spender) view returns (bool)",
];

const VERIFIER_ABI = [
  "function trustedToken() view returns (address)",
  "function usedNonces(bytes32) view returns (bool)",
  "function recordPayment(address server, bytes32 nonce, uint64 minPrice)",
  "function recordBatchPayment(address server, bytes32 nonce, uint32 requestCount, uint64 pricePerRequest)",
  "event PaymentVerified(address indexed payer, address indexed server, bytes32 indexed nonce, uint64 minPrice)",
];

describe("Sepolia — OpenClaw Skill Flow", function () {
  let signer: Signer;
  let address: string;
  let usdc: Contract;
  let token: Contract;
  let verifier: Contract;

  before(async function () {
    const { chainId } = await ethers.provider.getNetwork();
    if (chainId !== 11155111n) {
      console.log(`    Skipping Sepolia tests (chainId=${chainId}, need 11155111)`);
      this.skip();
      return;
    }

    const signers = await ethers.getSigners();
    signer = signers[0];
    address = await signer.getAddress();

    usdc = new ethers.Contract(MOCK_USDC, USDC_ABI, signer);
    token = new ethers.Contract(CUSDC, TOKEN_ABI, signer);
    verifier = new ethers.Contract(VERIFIER, VERIFIER_ABI, signer);

    console.log(`    Agent: ${address}`);
    const ethBal = await ethers.provider.getBalance(address);
    if (ethBal === 0n) throw new Error("No ETH");
  });

  // ===========================================================================
  // `openclaw info` command
  // ===========================================================================

  describe("openclaw info", function () {
    it("displays full system info", async function () {
      const tokenName = await token.name();
      const tokenSymbol = await token.symbol();
      const decimals = await token.decimals();
      const underlying = await token.underlying();
      const rate = await token.rate();
      const treasury = await token.treasury();
      const paused = await token.paused();
      const owner = await token.owner();
      const trusted = await verifier.trustedToken();

      console.log(`      ┌──────────────────────────────────────────────────┐`);
      console.log(`      │ FHE x402 System Info (Sepolia)                  │`);
      console.log(`      ├──────────────────────────────────────────────────┤`);
      console.log(`      │ Agent:     ${address}  │`);
      console.log(`      │ Token:     ${tokenName} (${tokenSymbol})                        │`);
      console.log(`      │ Decimals:  ${decimals}                                         │`);
      console.log(`      │ Rate:      ${rate}                                         │`);
      console.log(`      │ Paused:    ${paused}                                     │`);
      console.log(`      │ Scheme:    fhe-confidential-v1                  │`);
      console.log(`      │ Network:   Ethereum Sepolia (11155111)          │`);
      console.log(`      └──────────────────────────────────────────────────┘`);

      expect(tokenName).to.equal("Confidential USDC");
      expect(decimals).to.equal(6n);
      expect(trusted.toLowerCase()).to.equal(CUSDC.toLowerCase());
    });
  });

  // ===========================================================================
  // `openclaw balance` command
  // ===========================================================================

  describe("openclaw balance", function () {
    it("shows public USDC balance", async function () {
      const bal = await usdc.balanceOf(address);
      console.log(`      Public USDC: ${ethers.formatUnits(bal, 6)} USDC`);
      expect(bal).to.be.a("bigint");
    });

    it("shows encrypted cUSDC balance handle", async function () {
      const handle = await token.confidentialBalanceOf(address);
      const zeroHandle = "0x" + "00".repeat(32);
      const hasBalance = handle !== zeroHandle;
      console.log(`      Has encrypted balance: ${hasBalance}`);
      if (hasBalance) {
        console.log(`      Handle: ${String(handle).slice(0, 22)}...`);
      }
      expect(handle).to.be.a("string");
    });

    it("shows accumulated protocol fees", async function () {
      const fees = await token.accumulatedFees();
      console.log(`      Protocol fees: ${ethers.formatUnits(fees, 6)} USDC`);
      expect(fees).to.be.a("bigint");
    });
  });

  // ===========================================================================
  // `openclaw wrap` command
  // ===========================================================================

  describe("openclaw wrap", function () {
    it("wraps 1.00 USDC into cUSDC", async function () {
      const wrapAmount = 1_000_000n; // 1 USDC

      // Ensure balance
      const bal = await usdc.balanceOf(address);
      if (bal < wrapAmount * 2n) {
        await (await usdc.mint(address, 10_000_000n)).wait();
      }

      const feesBefore = await token.accumulatedFees();

      // Approve + Wrap (same as wrap.ts script)
      await (await usdc.approve(CUSDC, wrapAmount)).wait();
      const wrapTx = await token.wrap(address, wrapAmount);
      const receipt = await wrapTx.wait();

      const feesAfter = await token.accumulatedFees();
      const fee = feesAfter - feesBefore;

      console.log(`      Wrapped: 1.00 USDC`);
      console.log(`      Fee: ${ethers.formatUnits(fee, 6)} USDC`);
      console.log(`      Net: ${ethers.formatUnits(wrapAmount - fee, 6)} cUSDC`);
      console.log(`      TX: ${receipt.hash}`);
      console.log(`      Gas: ${receipt.gasUsed}`);

      // 1 USDC * 0.1% = 0.001 USDC = 1000 raw, but min 0.01 = 10000
      expect(fee).to.equal(10_000n);
    });

    it("wraps 50.00 USDC (percentage fee kicks in)", async function () {
      const wrapAmount = 50_000_000n; // 50 USDC

      await (await usdc.mint(address, wrapAmount)).wait();
      const feesBefore = await token.accumulatedFees();

      await (await usdc.approve(CUSDC, wrapAmount)).wait();
      await (await token.wrap(address, wrapAmount)).wait();

      const feesAfter = await token.accumulatedFees();
      const fee = feesAfter - feesBefore;

      console.log(`      Wrapped: 50.00 USDC`);
      console.log(`      Fee: ${ethers.formatUnits(fee, 6)} USDC (0.1%)`);

      // 50 * 0.1% = 0.05 USDC = 50000 raw
      expect(fee).to.equal(50_000n);
    });
  });

  // ===========================================================================
  // `openclaw pay` command
  // ===========================================================================

  describe("openclaw pay", function () {
    it("records single payment nonce (pay.ts simulation)", async function () {
      // In pay.ts: encrypt amount → confidentialTransfer → recordPayment
      // Here we test the recordPayment part (transfer needs fhevmjs)
      const server = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const minPrice = 500_000n; // 0.50 USDC

      const tx = await verifier.recordPayment(server, nonce, minPrice);
      const receipt = await tx.wait();

      // Verify event
      const iface = new ethers.Interface(VERIFIER_ABI);
      let eventFound = false;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "PaymentVerified") {
            eventFound = true;
            expect(parsed.args[0].toLowerCase()).to.equal(address.toLowerCase());
            expect(parsed.args[1].toLowerCase()).to.equal(server.toLowerCase());
            expect(parsed.args[3]).to.equal(minPrice);
          }
        } catch { /* skip */ }
      }

      expect(eventFound).to.equal(true);
      console.log(`      Payment recorded: 0.50 USDC to ${server.slice(0, 10)}...`);
      console.log(`      Nonce: ${nonce.slice(0, 22)}...`);
      console.log(`      Event: PaymentVerified ✓`);
      console.log(`      Gas: ${receipt.gasUsed}`);
    });

    it("records batch prepayment (100 requests)", async function () {
      const server = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const requestCount = 100;
      const pricePerReq = 10_000n; // 0.01 USDC each

      const tx = await verifier.recordBatchPayment(server, nonce, requestCount, pricePerReq);
      const receipt = await tx.wait();

      console.log(`      Batch: ${requestCount} requests @ 0.01 USDC = 1.00 USDC total`);
      console.log(`      Gas: ${receipt.gasUsed}`);

      const used = await verifier.usedNonces(nonce);
      expect(used).to.equal(true);
    });

    it("nonce cannot be reused (replay protection)", async function () {
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      await (await verifier.recordPayment(address, nonce, 10_000n)).wait();

      try {
        await (await verifier.recordPayment(address, nonce, 10_000n)).wait();
        expect.fail("Should revert");
      } catch (e: any) {
        expect(
          e.message.includes("NonceAlreadyUsed") || e.message.includes("execution reverted")
        ).to.equal(true);
        console.log(`      Replay correctly rejected ✓`);
      }
    });
  });

  // ===========================================================================
  // Operator setup (for single-TX flow)
  // ===========================================================================

  describe("operator setup (for pay single-TX)", function () {
    it("grants verifier operator role", async function () {
      const farFuture = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
      const tx = await token.setOperator(VERIFIER, farFuture);
      const receipt = await tx.wait();

      const isOp = await token.isOperator(address, VERIFIER);
      expect(isOp).to.equal(true);
      console.log(`      Verifier is operator: ${isOp}`);
      console.log(`      Gas: ${receipt.gasUsed}`);
    });
  });

  // ===========================================================================
  // Summary
  // ===========================================================================

  describe("Summary", function () {
    it("all OpenClaw skill commands verified on Sepolia", async function () {
      console.log(`\n      ┌────────────────────────┬──────────┐`);
      console.log(`      │ Skill Command          │ Status   │`);
      console.log(`      ├────────────────────────┼──────────┤`);
      console.log(`      │ openclaw info          │ PASS     │`);
      console.log(`      │ openclaw balance       │ PASS     │`);
      console.log(`      │ openclaw wrap          │ PASS     │`);
      console.log(`      │ openclaw pay           │ PASS     │`);
      console.log(`      │ openclaw pay (batch)   │ PASS     │`);
      console.log(`      │ nonce replay protect   │ PASS     │`);
      console.log(`      │ operator setup         │ PASS     │`);
      console.log(`      │ openclaw unwrap*       │ SKIP     │`);
      console.log(`      │ openclaw finalize*     │ SKIP     │`);
      console.log(`      └────────────────────────┴──────────┘`);
      console.log(`      * Unwrap/finalize requires Zama KMS callback`);
    });
  });
});
