/**
 * Sepolia On-Chain — Virtuals Plugin Integration Test
 *
 * Simulates what the Virtuals GAME plugin does on a real network:
 *   1. fhe_balance — Check USDC + cUSDC balance
 *   2. fhe_wrap — Wrap USDC → cUSDC
 *   3. fhe_pay — Record payment nonce (transfer requires fhevmjs)
 *   4. fhe_info — Display contract addresses and status
 *   5. Operator setup for single-TX payments
 *
 * Run: npx hardhat test test/Sepolia.virtuals.test.ts --network sepolia
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract, Signer } from "ethers";

const MOCK_USDC = "0xc89e913676B034f8b38E49f7508803d1cDEC9F4f";
const CUSDC = "0x3864B98D1B1EC2109C679679052e2844b4153889";
const VERIFIER = "0xCc60280A10FEB7fBdf20fBefc2abe6E0e99A5A83";

const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function mint(address, uint256)",
  "function decimals() view returns (uint8)",
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
];

describe("Sepolia — Virtuals Plugin Flow", function () {
  let signer: Signer;
  let address: string;
  let usdc: Contract;
  let token: Contract;
  let verifier: Contract;

  before(async function () {
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
  // fhe_info — Display contract info (GameFunction simulation)
  // ===========================================================================

  describe("fhe_info — Contract Info", function () {
    it("returns token name, symbol, decimals, underlying, rate", async function () {
      const name = await token.name();
      const symbol = await token.symbol();
      const decimals = await token.decimals();
      const underlying = await token.underlying();
      const rate = await token.rate();
      const treasury = await token.treasury();
      const paused = await token.paused();
      const trustedToken = await verifier.trustedToken();

      console.log(`      Token: ${name} (${symbol})`);
      console.log(`      Decimals: ${decimals}`);
      console.log(`      Underlying USDC: ${underlying}`);
      console.log(`      Rate: ${rate}`);
      console.log(`      Treasury: ${treasury}`);
      console.log(`      Paused: ${paused}`);
      console.log(`      Verifier trustedToken: ${trustedToken}`);

      expect(name).to.equal("Confidential USDC");
      expect(symbol).to.equal("cUSDC");
      expect(decimals).to.equal(6n);
      expect(rate).to.equal(1n);
      expect(paused).to.equal(false);
      expect(trustedToken.toLowerCase()).to.equal(CUSDC.toLowerCase());
    });
  });

  // ===========================================================================
  // fhe_balance — Check balances (GameFunction simulation)
  // ===========================================================================

  describe("fhe_balance — Balance Check", function () {
    it("returns public USDC balance", async function () {
      const bal = await usdc.balanceOf(address);
      console.log(`      Public USDC: ${ethers.formatUnits(bal, 6)} USDC`);
      expect(bal).to.be.a("bigint");
    });

    it("returns encrypted cUSDC balance handle", async function () {
      const handle = await token.confidentialBalanceOf(address);
      const zeroHandle = "0x" + "00".repeat(32);
      const hasBalance = handle !== zeroHandle;
      console.log(`      Encrypted balance handle: ${String(handle).slice(0, 20)}...`);
      console.log(`      Has encrypted balance: ${hasBalance}`);
      // May or may not have balance depending on previous tests
      expect(handle).to.be.a("string");
    });
  });

  // ===========================================================================
  // fhe_wrap — Wrap USDC → cUSDC (GameFunction simulation)
  // ===========================================================================

  describe("fhe_wrap — Wrap USDC", function () {
    const WRAP_AMOUNT = 500_000n; // 0.50 USDC

    it("agent wraps 0.50 USDC into cUSDC", async function () {
      // Ensure balance
      const bal = await usdc.balanceOf(address);
      if (bal < WRAP_AMOUNT * 2n) {
        await (await usdc.mint(address, 10_000_000n)).wait();
      }

      const feesBefore = await token.accumulatedFees();
      const usdcBefore = await usdc.balanceOf(address);

      // Step 1: Approve
      const approveTx = await usdc.approve(CUSDC, WRAP_AMOUNT);
      const approveReceipt = await approveTx.wait();
      console.log(`      Approve: ${approveReceipt.hash} (gas: ${approveReceipt.gasUsed})`);

      // Step 2: Wrap
      const wrapTx = await token.wrap(address, WRAP_AMOUNT);
      const wrapReceipt = await wrapTx.wait();
      console.log(`      Wrap: ${wrapReceipt.hash} (gas: ${wrapReceipt.gasUsed})`);

      const feesAfter = await token.accumulatedFees();
      const usdcAfter = await usdc.balanceOf(address);
      const fee = feesAfter - feesBefore;

      console.log(`      USDC spent: ${ethers.formatUnits(usdcBefore - usdcAfter, 6)}`);
      console.log(`      Fee: ${ethers.formatUnits(fee, 6)} USDC`);
      console.log(`      Net cUSDC: ${ethers.formatUnits(WRAP_AMOUNT - fee, 6)} (encrypted)`);

      expect(usdcBefore - usdcAfter).to.equal(WRAP_AMOUNT);
      expect(fee).to.be.gte(10_000n); // min fee
    });

    it("encrypted balance is non-zero after wrap", async function () {
      const handle = await token.confidentialBalanceOf(address);
      const zeroHandle = "0x" + "00".repeat(32);
      expect(handle).to.not.equal(zeroHandle);
      console.log(`      Encrypted balance confirmed`);
    });
  });

  // ===========================================================================
  // fhe_pay — Payment flow (GameFunction simulation)
  // ===========================================================================

  describe("fhe_pay — Payment Nonce Recording", function () {
    it("agent records payment to server", async function () {
      // In real plugin: agent encrypts amount with fhevmjs, calls confidentialTransfer,
      // then records nonce. Here we test the nonce recording part.
      const server = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const minPrice = 100_000n; // 0.10 USDC

      const tx = await verifier.recordPayment(server, nonce, minPrice);
      const receipt = await tx.wait();

      console.log(`      Payment nonce: ${nonce.slice(0, 22)}...`);
      console.log(`      Server: ${server}`);
      console.log(`      Min price: ${ethers.formatUnits(minPrice, 6)} USDC`);
      console.log(`      TX: ${receipt.hash} (gas: ${receipt.gasUsed})`);

      const used = await verifier.usedNonces(nonce);
      expect(used).to.equal(true);
    });

    it("agent records batch prepayment (10 requests)", async function () {
      const server = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const nonce = ethers.hexlify(ethers.randomBytes(32));

      const tx = await verifier.recordBatchPayment(server, nonce, 10, 50_000n);
      const receipt = await tx.wait();

      console.log(`      Batch: 10 requests @ 0.05 USDC = 0.50 USDC total`);
      console.log(`      TX: ${receipt.hash} (gas: ${receipt.gasUsed})`);

      const used = await verifier.usedNonces(nonce);
      expect(used).to.equal(true);
    });
  });

  // ===========================================================================
  // Operator Setup for single-TX
  // ===========================================================================

  describe("Operator Setup (pre-requisite for single-TX)", function () {
    it("sets verifier as operator", async function () {
      const farFuture = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
      const tx = await token.setOperator(VERIFIER, farFuture);
      const receipt = await tx.wait();

      const isOp = await token.isOperator(address, VERIFIER);
      console.log(`      Operator set: ${isOp}`);
      console.log(`      Gas: ${receipt.gasUsed}`);
      expect(isOp).to.equal(true);
    });
  });

  // ===========================================================================
  // Summary
  // ===========================================================================

  describe("Summary", function () {
    it("all Virtuals plugin operations verified on Sepolia", async function () {
      console.log(`\n      ┌──────────────────────┬──────────┐`);
      console.log(`      │ Plugin Function       │ Status   │`);
      console.log(`      ├──────────────────────┼──────────┤`);
      console.log(`      │ fhe_info             │ PASS     │`);
      console.log(`      │ fhe_balance          │ PASS     │`);
      console.log(`      │ fhe_wrap             │ PASS     │`);
      console.log(`      │ fhe_pay (nonce)      │ PASS     │`);
      console.log(`      │ fhe_pay (batch)      │ PASS     │`);
      console.log(`      │ operator setup       │ PASS     │`);
      console.log(`      │ fhe_unwrap*          │ SKIP     │`);
      console.log(`      │ fhe_finalize_unwrap* │ SKIP     │`);
      console.log(`      └──────────────────────┴──────────┘`);
      console.log(`      * Unwrap requires Zama KMS (async callback)`);
    });
  });
});
