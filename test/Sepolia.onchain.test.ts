/**
 * Sepolia On-Chain Integration Tests
 *
 * These tests run against REAL deployed contracts on Ethereum Sepolia.
 * They verify that the contracts work correctly on a live network.
 *
 * Prerequisites:
 *   - .env with PRIVATE_KEY (funded with Sepolia ETH + MockUSDC)
 *   - .env with SEPOLIA_RPC_URL
 *   - Deployed contracts (MockUSDC, ConfidentialUSDC, X402PaymentVerifier)
 *
 * Run: npx hardhat test test/Sepolia.onchain.test.ts --network sepolia
 */

import { expect } from "chai";
import hre from "hardhat";
import { ethers } from "hardhat";
import type { Contract, Signer } from "ethers";

// Deployed contract addresses on Sepolia
const MOCK_USDC_ADDRESS = "0xc89e913676B034f8b38E49f7508803d1cDEC9F4f";
const CONFIDENTIAL_USDC_ADDRESS = "0xE944754aa70d4924dc5d8E57774CDf21Df5e592D";
const X402_VERIFIER_ADDRESS = "0x4503A7aee235aBD10e6064BBa8E14235fdF041f4";

// Minimal ABIs — only what we need for testing
const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function mint(address, uint256)",
  "function decimals() view returns (uint8)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
];

const CUSDC_ABI = [
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
  "event ConfidentialTransfer(address indexed from, address indexed to, bytes32 indexed amount)",
  "event OperatorSet(address indexed holder, address indexed operator, uint48 until)",
];

const VERIFIER_ABI = [
  "function trustedToken() view returns (address)",
  "function usedNonces(bytes32) view returns (bool)",
  "function recordPayment(address server, bytes32 nonce, uint64 minPrice)",
  "function recordBatchPayment(address server, bytes32 nonce, uint32 requestCount, uint64 pricePerRequest)",
  "event PaymentVerified(address indexed payer, address indexed server, bytes32 indexed nonce, uint64 minPrice)",
  "event BatchPaymentRecorded(address indexed payer, address indexed server, bytes32 indexed nonce, uint32 requestCount, uint64 pricePerRequest)",
];

const ACP_ABI = [
  "function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) returns (uint256)",
  "function setProvider(uint256 jobId, address provider) external",
  "function setBudget(uint256 jobId, uint256 amount) external",
  "function fund(uint256 jobId, uint256 expectedBudget) external",
  "function submit(uint256 jobId, bytes32 deliverable) external",
  "function complete(uint256 jobId, bytes32 reason) external",
  "function reject(uint256 jobId, bytes32 reason) external",
  "function claimRefund(uint256 jobId) external",
  "function getJob(uint256 jobId) view returns (tuple(address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook, bytes32 deliverable))",
  "function treasury() view returns (address)",
  "function paymentToken() view returns (address)",
  "function PLATFORM_FEE_BPS() view returns (uint256)",
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt)",
  "event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount)",
  "event JobSubmitted(uint256 indexed jobId, address indexed provider, bytes32 deliverable)",
  "event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason)",
  "event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount)",
  "event JobRejected(uint256 indexed jobId, address indexed rejector, bytes32 reason)",
  "event Refunded(uint256 indexed jobId, address indexed client, uint256 amount)",
];

describe("Sepolia On-Chain Integration", function () {
  let signer: Signer;
  let signerAddress: string;
  let usdc: Contract;
  let cUSDC: Contract;
  let verifier: Contract;

  before(async function () {
    const signers = await ethers.getSigners();
    signer = signers[0];
    signerAddress = await signer.getAddress();

    console.log(`    Signer: ${signerAddress}`);

    usdc = new ethers.Contract(MOCK_USDC_ADDRESS, USDC_ABI, signer);
    cUSDC = new ethers.Contract(CONFIDENTIAL_USDC_ADDRESS, CUSDC_ABI, signer);
    verifier = new ethers.Contract(X402_VERIFIER_ADDRESS, VERIFIER_ABI, signer);

    const ethBalance = await ethers.provider.getBalance(signerAddress);
    console.log(`    ETH Balance: ${ethers.formatEther(ethBalance)} ETH`);

    if (ethBalance === 0n) {
      throw new Error("Signer has no ETH. Fund the wallet with Sepolia ETH first.");
    }
  });

  // ===========================================================================
  // 1. Contract Deployment Verification
  // ===========================================================================

  describe("1. Contract Deployment Verification", function () {
    it("MockUSDC is deployed and responds", async function () {
      const name = await usdc.name();
      const symbol = await usdc.symbol();
      const decimals = await usdc.decimals();

      console.log(`      MockUSDC: ${name} (${symbol}), ${decimals} decimals`);

      expect(name).to.be.a("string");
      expect(decimals).to.equal(6n);
    });

    it("ConfidentialUSDC is deployed and responds", async function () {
      const name = await cUSDC.name();
      const symbol = await cUSDC.symbol();
      const decimals = await cUSDC.decimals();
      const underlying = await cUSDC.underlying();

      console.log(`      cUSDC: ${name} (${symbol}), ${decimals} decimals`);
      console.log(`      Underlying: ${underlying}`);

      expect(name).to.be.a("string");
      expect(decimals).to.equal(6n);
      expect(underlying.toLowerCase()).to.equal(MOCK_USDC_ADDRESS.toLowerCase());
    });

    it("X402PaymentVerifier is deployed and responds", async function () {
      const trustedToken = await verifier.trustedToken();

      console.log(`      Trusted Token: ${trustedToken}`);

      expect(trustedToken.toLowerCase()).to.equal(
        CONFIDENTIAL_USDC_ADDRESS.toLowerCase()
      );
    });

    it("ConfidentialUSDC owner and treasury are set", async function () {
      const owner = await cUSDC.owner();
      const treasury = await cUSDC.treasury();
      const paused = await cUSDC.paused();

      console.log(`      Owner: ${owner}`);
      console.log(`      Treasury: ${treasury}`);
      console.log(`      Paused: ${paused}`);

      expect(owner).to.not.equal(ethers.ZeroAddress);
      expect(treasury).to.not.equal(ethers.ZeroAddress);
      expect(paused).to.equal(false);
    });

    it("ConfidentialUSDC rate is 1 (1:1 USDC:cUSDC)", async function () {
      const rate = await cUSDC.rate();
      console.log(`      Rate: ${rate}`);
      expect(rate).to.equal(1n);
    });
  });

  // ===========================================================================
  // 2. MockUSDC Operations
  // ===========================================================================

  describe("2. MockUSDC Balances & Minting", function () {
    it("reads USDC balance of signer", async function () {
      const balance = await usdc.balanceOf(signerAddress);
      console.log(`      USDC Balance: ${ethers.formatUnits(balance, 6)} USDC`);
      expect(balance).to.be.a("bigint");
    });

    it("mints USDC and balance increases", async function () {
      const before = await usdc.balanceOf(signerAddress);
      const mintAmount = 1_000_000n; // 1 USDC
      const tx = await usdc.mint(signerAddress, mintAmount);
      await tx.wait();
      const after = await usdc.balanceOf(signerAddress);
      console.log(`      Minted: ${ethers.formatUnits(mintAmount, 6)} USDC`);
      expect(after - before).to.equal(mintAmount);
    });
  });

  // ===========================================================================
  // 3. Wrap USDC → cUSDC (Real On-Chain)
  // ===========================================================================

  describe("3. Wrap USDC → cUSDC", function () {
    const WRAP_AMOUNT = 100_000n; // 0.10 USDC

    it("mints MockUSDC if balance is low", async function () {
      const balance = await usdc.balanceOf(signerAddress);

      if (balance < WRAP_AMOUNT * 2n) {
        console.log(`      Minting 10 USDC...`);
        const tx = await usdc.mint(signerAddress, 10_000_000n);
        await tx.wait();
        const newBalance = await usdc.balanceOf(signerAddress);
        console.log(`      New balance: ${ethers.formatUnits(newBalance, 6)} USDC`);
      } else {
        console.log(`      Balance sufficient: ${ethers.formatUnits(balance, 6)} USDC`);
      }
    });

    it("approves ConfidentialUSDC to spend USDC", async function () {
      const tx = await usdc.approve(CONFIDENTIAL_USDC_ADDRESS, WRAP_AMOUNT);
      const receipt = await tx.wait();

      console.log(`      Approve TX: ${receipt.hash}`);
      expect(receipt.status).to.equal(1);
    });

    it("wraps USDC into cUSDC and collects fee", async function () {
      const feesBefore = await cUSDC.accumulatedFees();

      const tx = await cUSDC.wrap(signerAddress, WRAP_AMOUNT);
      const receipt = await tx.wait();

      console.log(`      Wrap TX: ${receipt.hash}`);
      console.log(`      Gas used: ${receipt.gasUsed.toString()}`);
      expect(receipt.status).to.equal(1);

      // Verify fee was accumulated
      const feesAfter = await cUSDC.accumulatedFees();
      const feeDelta = feesAfter - feesBefore;
      console.log(`      Fee accumulated: ${ethers.formatUnits(feeDelta, 6)} USDC`);

      // Min fee is 0.01 USDC = 10000 raw
      expect(feeDelta).to.be.gte(10_000n);
    });

    it("fee is min 0.01 USDC for small amounts", async function () {
      // Wrap exactly 0.10 USDC → fee should be min(0.1*0.001=0.0001, 0.01) = 0.01 USDC
      const feesBefore = await cUSDC.accumulatedFees();

      const smallAmount = 100_000n; // 0.10 USDC
      const appTx = await usdc.approve(CONFIDENTIAL_USDC_ADDRESS, smallAmount);
      await appTx.wait();
      const wrapTx = await cUSDC.wrap(signerAddress, smallAmount);
      await wrapTx.wait();

      const feesAfter = await cUSDC.accumulatedFees();
      const fee = feesAfter - feesBefore;
      console.log(`      Fee for 0.10 USDC wrap: ${ethers.formatUnits(fee, 6)} USDC`);
      // 0.10 * 0.1% = 0.0001, but min fee is 0.01
      expect(fee).to.equal(10_000n);
    });

    it("fee is 0.1% for large amounts", async function () {
      const feesBefore = await cUSDC.accumulatedFees();

      const largeAmount = 100_000_000n; // 100 USDC
      const mintTx = await usdc.mint(signerAddress, largeAmount);
      await mintTx.wait();
      const appTx = await usdc.approve(CONFIDENTIAL_USDC_ADDRESS, largeAmount);
      await appTx.wait();
      const wrapTx = await cUSDC.wrap(signerAddress, largeAmount);
      await wrapTx.wait();

      const feesAfter = await cUSDC.accumulatedFees();
      const fee = feesAfter - feesBefore;
      console.log(`      Fee for 100 USDC wrap: ${ethers.formatUnits(fee, 6)} USDC`);
      // 100 * 0.1% = 0.10 USDC = 100_000 raw
      expect(fee).to.equal(100_000n);
    });

    it("signer has encrypted balance after wrap", async function () {
      const handle = await cUSDC.confidentialBalanceOf(signerAddress);
      const zeroHandle = "0x" + "00".repeat(32);

      console.log(`      Encrypted balance handle: ${handle}`);
      expect(handle).to.not.equal(zeroHandle);
    });
  });

  // ===========================================================================
  // 4. X402PaymentVerifier — recordPayment (Real On-Chain)
  // ===========================================================================

  describe("4. recordPayment on Verifier", function () {
    let testNonce: string;

    it("records a payment with unique nonce", async function () {
      testNonce = ethers.hexlify(ethers.randomBytes(32));
      const server = signerAddress;
      const minPrice = 50_000n; // 0.05 USDC

      const tx = await verifier.recordPayment(server, testNonce, minPrice);
      const receipt = await tx.wait();

      console.log(`      recordPayment TX: ${receipt.hash}`);
      console.log(`      Gas used: ${receipt.gasUsed.toString()}`);
      console.log(`      Nonce: ${testNonce}`);
      expect(receipt.status).to.equal(1);

      // Verify PaymentVerified event
      const iface = new ethers.Interface(VERIFIER_ABI);
      let found = false;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "PaymentVerified") {
            console.log(`      Event: PaymentVerified(payer=${parsed.args[0]}, server=${parsed.args[1]}, minPrice=${parsed.args[3]})`);
            expect(parsed.args[0].toLowerCase()).to.equal(signerAddress.toLowerCase());
            found = true;
          }
        } catch { /* skip non-matching logs */ }
      }
      expect(found).to.equal(true, "PaymentVerified event not found");
    });

    it("nonce is marked as used", async function () {
      const used = await verifier.usedNonces(testNonce);
      expect(used).to.equal(true);
    });

    it("rejects duplicate nonce", async function () {
      try {
        const tx = await verifier.recordPayment(signerAddress, testNonce, 50_000n);
        await tx.wait();
        expect.fail("Should have reverted");
      } catch (e: any) {
        console.log(`      Correctly reverted: ${e.message.slice(0, 80)}...`);
        expect(
          e.message.includes("NonceAlreadyUsed") || e.message.includes("execution reverted")
        ).to.equal(true);
      }
    });

    it("records 5 sequential payments with different nonces", async function () {
      const nonces: string[] = [];
      for (let i = 0; i < 5; i++) {
        const nonce = ethers.hexlify(ethers.randomBytes(32));
        nonces.push(nonce);
        const tx = await verifier.recordPayment(signerAddress, nonce, 10_000n * BigInt(i + 1));
        await tx.wait();
      }

      // Verify all nonces are used
      for (const n of nonces) {
        const used = await verifier.usedNonces(n);
        expect(used).to.equal(true);
      }
      console.log(`      5 sequential payments recorded, all nonces verified`);
    });
  });

  // ===========================================================================
  // 5. recordBatchPayment (Real On-Chain)
  // ===========================================================================

  describe("5. recordBatchPayment on Verifier", function () {
    it("records a batch payment with unique nonce", async function () {
      const batchNonce = ethers.hexlify(ethers.randomBytes(32));
      const server = signerAddress;
      const requestCount = 10;
      const pricePerRequest = 100_000n; // 0.10 USDC each

      const tx = await verifier.recordBatchPayment(
        server,
        batchNonce,
        requestCount,
        pricePerRequest
      );
      const receipt = await tx.wait();

      console.log(`      recordBatchPayment TX: ${receipt.hash}`);
      console.log(`      Gas used: ${receipt.gasUsed.toString()}`);
      console.log(`      Requests: ${requestCount}, Price: ${ethers.formatUnits(pricePerRequest, 6)} USDC each`);
      expect(receipt.status).to.equal(1);

      // Verify BatchPaymentRecorded event
      const iface = new ethers.Interface(VERIFIER_ABI);
      let found = false;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "BatchPaymentRecorded") {
            console.log(`      Event: BatchPaymentRecorded(requestCount=${parsed.args[3]}, pricePerRequest=${parsed.args[4]})`);
            expect(Number(parsed.args[3])).to.equal(requestCount);
            expect(parsed.args[4]).to.equal(pricePerRequest);
            found = true;
          }
        } catch { /* skip non-matching logs */ }
      }
      expect(found).to.equal(true, "BatchPaymentRecorded event not found");

      const used = await verifier.usedNonces(batchNonce);
      expect(used).to.equal(true);
    });

    it("batch nonce rejects zero request count", async function () {
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      try {
        const tx = await verifier.recordBatchPayment(signerAddress, nonce, 0, 100_000n);
        await tx.wait();
        expect.fail("Should have reverted");
      } catch (e: any) {
        console.log(`      Correctly reverted for zero requestCount`);
        expect(
          e.message.includes("ZeroRequestCount") || e.message.includes("execution reverted")
        ).to.equal(true);
      }
    });
  });

  // ===========================================================================
  // 6. ERC-7984 Operator Tests (Real On-Chain)
  // ===========================================================================

  describe("6. ERC-7984 Operator", function () {
    it("setOperator grants operator role to verifier", async function () {
      const farFuture = Math.floor(Date.now() / 1000) + 365 * 24 * 60 * 60;
      const tx = await cUSDC.setOperator(X402_VERIFIER_ADDRESS, farFuture);
      const receipt = await tx.wait();

      console.log(`      setOperator TX: ${receipt.hash}`);
      console.log(`      Gas used: ${receipt.gasUsed.toString()}`);
      expect(receipt.status).to.equal(1);
    });

    it("isOperator returns true for verifier", async function () {
      const isOp = await cUSDC.isOperator(signerAddress, X402_VERIFIER_ADDRESS);
      console.log(`      isOperator(signer, verifier): ${isOp}`);
      expect(isOp).to.equal(true);
    });

    it("isOperator returns true for self", async function () {
      const isOp = await cUSDC.isOperator(signerAddress, signerAddress);
      expect(isOp).to.equal(true);
    });

    it("isOperator returns false for random address", async function () {
      const random = ethers.Wallet.createRandom().address;
      const isOp = await cUSDC.isOperator(signerAddress, random);
      expect(isOp).to.equal(false);
    });

    it("setOperator with expiry 0 revokes operator", async function () {
      const random = ethers.Wallet.createRandom().address;
      // Grant then revoke
      const grantTx = await cUSDC.setOperator(random, Math.floor(Date.now() / 1000) + 3600);
      await grantTx.wait();
      let isOp = await cUSDC.isOperator(signerAddress, random);
      expect(isOp).to.equal(true);

      const revokeTx = await cUSDC.setOperator(random, 0);
      await revokeTx.wait();
      isOp = await cUSDC.isOperator(signerAddress, random);
      expect(isOp).to.equal(false);
      console.log(`      Operator granted then revoked successfully`);
    });
  });

  // ===========================================================================
  // 7. ACP Job Lifecycle (Deploy fresh ACP on Sepolia)
  // ===========================================================================

  describe("7. ACP Job Lifecycle (fresh deploy)", function () {
    let acp: Contract;
    let acpAddress: string;
    let jobId: bigint;

    before(async function () {
      // Deploy ACP using USDC as payment token
      const ACP = await ethers.getContractFactory("AgenticCommerceProtocol");
      const acpContract = await ACP.deploy(MOCK_USDC_ADDRESS, signerAddress);
      await acpContract.waitForDeployment();
      acpAddress = await acpContract.getAddress();
      acp = new ethers.Contract(acpAddress, ACP_ABI, signer);
      console.log(`      ACP deployed at: ${acpAddress}`);
    });

    it("ACP has correct paymentToken and treasury", async function () {
      const pt = await acp.paymentToken();
      const t = await acp.treasury();
      const fee = await acp.PLATFORM_FEE_BPS();

      console.log(`      Payment Token: ${pt}`);
      console.log(`      Treasury: ${t}`);
      console.log(`      Platform Fee: ${fee} bps (${Number(fee) / 100}%)`);

      expect(pt.toLowerCase()).to.equal(MOCK_USDC_ADDRESS.toLowerCase());
      expect(t.toLowerCase()).to.equal(signerAddress.toLowerCase());
      expect(fee).to.equal(100n);
    });

    it("creates a job", async function () {
      const evaluator = ethers.Wallet.createRandom().address;
      const expiry = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60; // 1 week

      const tx = await acp.createJob(
        ethers.ZeroAddress, // provider TBD
        evaluator,
        expiry,
        "Test AI task on Sepolia",
        ethers.ZeroAddress // no hook
      );
      const receipt = await tx.wait();

      // Parse event to get jobId
      const iface = new ethers.Interface(ACP_ABI);
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "JobCreated") {
            jobId = parsed.args[0];
            console.log(`      JobCreated: jobId=${jobId}`);
          }
        } catch { /* skip */ }
      }

      expect(jobId).to.be.a("bigint");
      console.log(`      Gas used: ${receipt.gasUsed.toString()}`);
    });

    it("reads job struct", async function () {
      const job = await acp.getJob(jobId);
      console.log(`      Client: ${job.client}`);
      console.log(`      Status: ${job.status} (0=Open)`);
      console.log(`      Description: ${job.description}`);

      expect(job.client.toLowerCase()).to.equal(signerAddress.toLowerCase());
      expect(job.status).to.equal(0n); // Open
    });

    it("sets provider and budget", async function () {
      const provider = ethers.Wallet.createRandom().address;
      const provTx = await acp.setProvider(jobId, provider);
      await provTx.wait();

      const budget = 10_000_000n; // 10 USDC
      const budTx = await acp.setBudget(jobId, budget);
      await budTx.wait();

      const job = await acp.getJob(jobId);
      expect(job.provider.toLowerCase()).to.equal(provider.toLowerCase());
      expect(job.budget).to.equal(budget);
      console.log(`      Provider: ${provider}`);
      console.log(`      Budget: ${ethers.formatUnits(budget, 6)} USDC`);
    });

    it("funds the job (escrow)", async function () {
      const job = await acp.getJob(jobId);

      // Approve ACP to spend USDC
      const appTx = await usdc.approve(acpAddress, job.budget);
      await appTx.wait();

      const fundTx = await acp.fund(jobId, job.budget);
      const receipt = await fundTx.wait();

      const updatedJob = await acp.getJob(jobId);
      expect(updatedJob.status).to.equal(1n); // Funded
      console.log(`      Job funded, status: Funded`);
      console.log(`      Gas used: ${receipt.gasUsed.toString()}`);
    });

    it("client rejects funded job and gets refund", async function () {
      const balBefore = await usdc.balanceOf(signerAddress);

      const reason = ethers.encodeBytes32String("Test rejection");
      const tx = await acp.reject(jobId, reason);
      const receipt = await tx.wait();

      const balAfter = await usdc.balanceOf(signerAddress);
      const job = await acp.getJob(jobId);

      expect(job.status).to.equal(4n); // Rejected
      expect(balAfter - balBefore).to.equal(job.budget);
      console.log(`      Job rejected, refund: ${ethers.formatUnits(job.budget, 6)} USDC`);
      console.log(`      Gas used: ${receipt.gasUsed.toString()}`);
    });
  });

  // ===========================================================================
  // 8. ACP Full Lifecycle — Complete Flow
  // ===========================================================================

  describe("8. ACP Complete Flow (create → fund → submit → complete)", function () {
    let acp: Contract;
    let acpAddress: string;
    let jobId: bigint;
    let providerWallet: any;
    let evaluatorWallet: any;

    before(async function () {
      const ACP = await ethers.getContractFactory("AgenticCommerceProtocol");
      const acpContract = await ACP.deploy(MOCK_USDC_ADDRESS, signerAddress);
      await acpContract.waitForDeployment();
      acpAddress = await acpContract.getAddress();
      acp = new ethers.Contract(acpAddress, ACP_ABI, signer);

      // Create funded wallets for provider and evaluator
      providerWallet = ethers.Wallet.createRandom().connect(ethers.provider);
      evaluatorWallet = ethers.Wallet.createRandom().connect(ethers.provider);

      // Fund them with ETH for gas
      const fundProv = await signer.sendTransaction({
        to: providerWallet.address,
        value: ethers.parseEther("0.01"),
      });
      await fundProv.wait();
      const fundEval = await signer.sendTransaction({
        to: evaluatorWallet.address,
        value: ethers.parseEther("0.01"),
      });
      await fundEval.wait();

      console.log(`      ACP: ${acpAddress}`);
      console.log(`      Provider: ${providerWallet.address}`);
      console.log(`      Evaluator: ${evaluatorWallet.address}`);
    });

    it("creates job with provider and evaluator", async function () {
      const expiry = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
      const tx = await acp.createJob(
        providerWallet.address,
        evaluatorWallet.address,
        expiry,
        "Full lifecycle test: AI image generation",
        ethers.ZeroAddress
      );
      const receipt = await tx.wait();

      const iface = new ethers.Interface(ACP_ABI);
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "JobCreated") jobId = parsed.args[0];
        } catch { /* skip */ }
      }
      console.log(`      Job #${jobId} created`);
    });

    it("sets budget and funds", async function () {
      const budget = 5_000_000n; // 5 USDC
      await (await acp.setBudget(jobId, budget)).wait();
      await (await usdc.approve(acpAddress, budget)).wait();
      await (await acp.fund(jobId, budget)).wait();

      const job = await acp.getJob(jobId);
      expect(job.status).to.equal(1n); // Funded
      console.log(`      Funded: 5 USDC escrowed`);
    });

    it("provider submits deliverable", async function () {
      const acpAsProvider = new ethers.Contract(acpAddress, ACP_ABI, providerWallet);
      const deliverable = ethers.encodeBytes32String("ipfs://QmTest123");
      const tx = await acpAsProvider.submit(jobId, deliverable);
      const receipt = await tx.wait();

      const job = await acp.getJob(jobId);
      expect(job.status).to.equal(2n); // Submitted
      console.log(`      Submitted: ${deliverable}`);
      console.log(`      Gas used: ${receipt.gasUsed.toString()}`);
    });

    it("evaluator completes job, provider gets paid, treasury gets fee", async function () {
      const providerBalBefore = await usdc.balanceOf(providerWallet.address);
      const treasuryBalBefore = await usdc.balanceOf(signerAddress);

      const acpAsEvaluator = new ethers.Contract(acpAddress, ACP_ABI, evaluatorWallet);
      const reason = ethers.encodeBytes32String("Excellent work");
      const tx = await acpAsEvaluator.complete(jobId, reason);
      const receipt = await tx.wait();

      const job = await acp.getJob(jobId);
      expect(job.status).to.equal(3n); // Completed

      const providerBalAfter = await usdc.balanceOf(providerWallet.address);
      const treasuryBalAfter = await usdc.balanceOf(signerAddress);

      const payout = providerBalAfter - providerBalBefore;
      const fee = treasuryBalAfter - treasuryBalBefore;

      console.log(`      Job completed!`);
      console.log(`      Provider payout: ${ethers.formatUnits(payout, 6)} USDC`);
      console.log(`      Treasury fee: ${ethers.formatUnits(fee, 6)} USDC`);
      console.log(`      Gas used: ${receipt.gasUsed.toString()}`);

      // Budget was 5 USDC, fee is 1% = 0.05 USDC, payout = 4.95 USDC
      expect(payout).to.equal(4_950_000n);
      expect(fee).to.equal(50_000n);
    });
  });

  // ===========================================================================
  // 9. Fee Accumulation Consistency
  // ===========================================================================

  describe("9. Fee Accumulation Consistency", function () {
    it("accumulated fees increase monotonically across wraps", async function () {
      const fees0 = await cUSDC.accumulatedFees();

      // Wrap 1: small (min fee)
      await (await usdc.mint(signerAddress, 1_000_000n)).wait();
      await (await usdc.approve(CONFIDENTIAL_USDC_ADDRESS, 100_000n)).wait();
      await (await cUSDC.wrap(signerAddress, 100_000n)).wait();
      const fees1 = await cUSDC.accumulatedFees();
      expect(fees1).to.be.gt(fees0);

      // Wrap 2: medium
      await (await usdc.approve(CONFIDENTIAL_USDC_ADDRESS, 500_000n)).wait();
      await (await cUSDC.wrap(signerAddress, 500_000n)).wait();
      const fees2 = await cUSDC.accumulatedFees();
      expect(fees2).to.be.gt(fees1);

      console.log(`      fees0: ${ethers.formatUnits(fees0, 6)}`);
      console.log(`      fees1: ${ethers.formatUnits(fees1, 6)} (+${ethers.formatUnits(fees1 - fees0, 6)})`);
      console.log(`      fees2: ${ethers.formatUnits(fees2, 6)} (+${ethers.formatUnits(fees2 - fees1, 6)})`);
    });
  });

  // ===========================================================================
  // 10. Gas Cost Report
  // ===========================================================================

  describe("10. Gas Cost Summary", function () {
    it("reports gas costs for key operations", async function () {
      const balance = await usdc.balanceOf(signerAddress);
      if (balance < 100_000n) {
        const mintTx = await usdc.mint(signerAddress, 10_000_000n);
        await mintTx.wait();
      }

      // Measure approve
      const approveTx = await usdc.approve(CONFIDENTIAL_USDC_ADDRESS, 100_000n);
      const approveReceipt = await approveTx.wait();

      // Measure wrap
      const wrapTx = await cUSDC.wrap(signerAddress, 100_000n);
      const wrapReceipt = await wrapTx.wait();

      // Measure recordPayment
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const rpTx = await verifier.recordPayment(signerAddress, nonce, 50_000n);
      const rpReceipt = await rpTx.wait();

      // Measure recordBatchPayment
      const batchNonce = ethers.hexlify(ethers.randomBytes(32));
      const bpTx = await verifier.recordBatchPayment(signerAddress, batchNonce, 10, 100_000n);
      const bpReceipt = await bpTx.wait();

      // Measure setOperator
      const random = ethers.Wallet.createRandom().address;
      const opTx = await cUSDC.setOperator(random, Math.floor(Date.now() / 1000) + 3600);
      const opReceipt = await opTx.wait();

      console.log(`\n      ┌─────────────────────────┬──────────────┐`);
      console.log(`      │ Operation               │ Gas Used     │`);
      console.log(`      ├─────────────────────────┼──────────────┤`);
      console.log(`      │ USDC approve            │ ${approveReceipt.gasUsed.toString().padStart(12)} │`);
      console.log(`      │ cUSDC wrap              │ ${wrapReceipt.gasUsed.toString().padStart(12)} │`);
      console.log(`      │ recordPayment           │ ${rpReceipt.gasUsed.toString().padStart(12)} │`);
      console.log(`      │ recordBatchPayment      │ ${bpReceipt.gasUsed.toString().padStart(12)} │`);
      console.log(`      │ setOperator             │ ${opReceipt.gasUsed.toString().padStart(12)} │`);
      console.log(`      └─────────────────────────┴──────────────┘`);
    });
  });
});
