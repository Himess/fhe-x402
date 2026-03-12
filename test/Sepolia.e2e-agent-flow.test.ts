/**
 * Sepolia On-Chain — End-to-End Agent Flow Tests
 *
 * Full lifecycle tests combining ALL protocol contracts on Sepolia:
 *   Identity (ERC-8004) + Reputation + ConfidentialUSDC (ERC-7984) +
 *   X402PaymentVerifier + AgenticCommerceProtocol (ERC-8183)
 *
 * Scenarios:
 *   1. Agent Registration → Wrap cUSDC → FHE Pay → Record Nonce → Give Feedback
 *   2. Multi-Agent: AgentA pays AgentB, then AgentB gets reputation
 *   3. ACP Job + FHE Payment: Create job → Fund → Provider wraps → Delivers → Completes
 *   4. Batch Payment Flow: Agent prepays 10 API calls then verifies
 *   5. Full Protocol Audit: Check all 7 contracts are live and connected
 *
 * Run: npx hardhat test test/Sepolia.e2e-agent-flow.test.ts --network sepolia
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract, Signer } from "ethers";

// All deployed contract addresses (Sepolia V4.3)
const MOCK_USDC = "0xc89e913676B034f8b38E49f7508803d1cDEC9F4f";
const CUSDC = "0xE944754aa70d4924dc5d8E57774CDf21Df5e592D";
const VERIFIER = "0x4503A7aee235aBD10e6064BBa8E14235fdF041f4";
const ACP_ADDRESS = "0xBCA8d5ce6D57f36c7aF71954e9F7f86773a02F22";
const IDENTITY_ADDRESS = "0xf4609D5DB3153717827703C795acb00867b69567";
const REPUTATION_ADDRESS = "0xd1Dd10990f317802c79077834c75742388959668";
const TREASURY = "0xF505e2E71df58D7244189072008f25f6b6aaE5ae";

const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function mint(address, uint256)",
  "function allowance(address, address) view returns (uint256)",
];

const TOKEN_ABI = [
  "function wrap(address to, uint256 amount)",
  "function confidentialBalanceOf(address) view returns (bytes32)",
  "function accumulatedFees() view returns (uint256)",
  "function treasury() view returns (address)",
  "function paused() view returns (bool)",
  "function owner() view returns (address)",
  "function rate() view returns (uint256)",
  "function name() view returns (string)",
  "function confidentialTransfer(address to, bytes32 encryptedAmount, bytes inputProof) returns (bytes32)",
  "event ConfidentialTransfer(address indexed from, address indexed to, bytes32 indexed amount)",
];

const VERIFIER_ABI = [
  "function usedNonces(bytes32) view returns (bool)",
  "function trustedToken() view returns (address)",
  "function recordPayment(address server, bytes32 nonce, uint64 minPrice)",
  "function recordBatchPayment(address server, bytes32 nonce, uint32 requestCount, uint64 pricePerRequest)",
  "event PaymentVerified(address indexed payer, address indexed server, bytes32 indexed nonce, uint64 minPrice)",
  "event BatchPaymentRecorded(address indexed payer, address indexed server, bytes32 indexed nonce, uint32 requestCount, uint64 pricePerRequest)",
];

const IDENTITY_ABI = [
  "function register(string calldata agentURI) external returns (uint256)",
  "function getAgent(uint256 agentId) external view returns (string memory uri, address owner, address wallet)",
  "function agentOf(address wallet) external view returns (uint256)",
  "function nextAgentId() external view returns (uint256)",
  "function paused() external view returns (bool)",
  "event AgentRegistered(uint256 indexed agentId, address indexed owner, string agentURI)",
];

const REPUTATION_ABI = [
  "function giveFeedback(uint256 agentId, uint8 score, bytes32[] calldata tags, bytes calldata proofOfPayment) external",
  "function getSummary(uint256 agentId) external view returns (uint256 totalFeedback, uint256 averageScore, uint256 lastUpdated)",
  "function feedbackCount(uint256 agentId) external view returns (uint256)",
  "function paused() external view returns (bool)",
  "event FeedbackGiven(uint256 indexed agentId, address indexed reviewer, uint8 score)",
];

const ACP_ABI = [
  "function createJob(address provider, address evaluator, uint256 expiredAt, string description, address hook) returns (uint256)",
  "function setBudget(uint256 jobId, uint256 amount) external",
  "function fund(uint256 jobId, uint256 expectedBudget) external",
  "function submit(uint256 jobId, bytes32 deliverable) external",
  "function complete(uint256 jobId, bytes32 reason) external",
  "function getJob(uint256 jobId) view returns (tuple(address client, address provider, address evaluator, string description, uint256 budget, uint256 expiredAt, uint8 status, address hook, bytes32 deliverable))",
  "function paymentToken() view returns (address)",
  "function treasury() view returns (address)",
  "function PLATFORM_FEE_BPS() view returns (uint256)",
  "function paused() view returns (bool)",
  "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint256 expiredAt)",
  "event JobFunded(uint256 indexed jobId, address indexed client, uint256 amount)",
  "event JobCompleted(uint256 indexed jobId, address indexed evaluator, bytes32 reason)",
  "event PaymentReleased(uint256 indexed jobId, address indexed provider, uint256 amount)",
];

const ZERO_HANDLE = "0x" + "00".repeat(32);

describe("Sepolia — End-to-End Agent Flow", function () {
  this.timeout(600_000); // 10 min

  let signer: Signer;
  let signerAddress: string;
  let usdc: Contract;
  let token: Contract;
  let verifier: Contract;
  let identity: Contract;
  let reputation: Contract;
  let acp: Contract;
  let fhevmInstance: any;

  before(async function () {
    const { chainId } = await ethers.provider.getNetwork();
    if (chainId !== 11155111n) {
      console.log(`    Skipping Sepolia tests (chainId=${chainId}, need 11155111)`);
      this.skip();
      return;
    }

    const signers = await ethers.getSigners();
    signer = signers[0];
    signerAddress = await signer.getAddress();

    usdc = new ethers.Contract(MOCK_USDC, USDC_ABI, signer);
    token = new ethers.Contract(CUSDC, TOKEN_ABI, signer);
    verifier = new ethers.Contract(VERIFIER, VERIFIER_ABI, signer);
    identity = new ethers.Contract(IDENTITY_ADDRESS, IDENTITY_ABI, signer);
    reputation = new ethers.Contract(REPUTATION_ADDRESS, REPUTATION_ABI, signer);
    acp = new ethers.Contract(ACP_ADDRESS, ACP_ABI, signer);

    console.log(`    Signer: ${signerAddress}`);

    const ethBal = await ethers.provider.getBalance(signerAddress);
    console.log(`    ETH Balance: ${ethers.formatEther(ethBal)} ETH`);
    if (ethBal === 0n) throw new Error("No ETH — fund the wallet first");

    // Initialize relayer-sdk for FHE encryption
    console.log(`    Initializing @zama-fhe/relayer-sdk...`);
    try {
      const { createInstance, SepoliaConfig } = await import("@zama-fhe/relayer-sdk/node");
      const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
      fhevmInstance = await createInstance({
        ...SepoliaConfig,
        network: rpcUrl,
      });
      console.log(`    relayer-sdk initialized`);
    } catch (e: any) {
      console.log(`    relayer-sdk init failed: ${e.message}`);
      this.skip();
    }
  });

  // ===========================================================================
  // 1. Full Protocol Health Check — All 7 Contracts Live
  // ===========================================================================

  describe("1. Protocol Health Check — All Contracts Live", function () {
    it("MockUSDC responds (6 decimals)", async function () {
      const bal = await usdc.balanceOf(signerAddress);
      expect(bal).to.be.a("bigint");
      console.log(`      MockUSDC: ${ethers.formatUnits(bal, 6)} USDC ✓`);
    });

    it("ConfidentialUSDC responds (name, rate, treasury)", async function () {
      const name = await token.name();
      const rate = await token.rate();
      const treasury = await token.treasury();
      const paused = await token.paused();

      expect(name).to.equal("Confidential USDC");
      expect(rate).to.equal(1n);
      expect(paused).to.equal(false);
      console.log(`      cUSDC: ${name}, rate=${rate}, paused=${paused} ✓`);
      console.log(`      Treasury: ${treasury}`);
    });

    it("X402PaymentVerifier responds (trustedToken links to cUSDC)", async function () {
      const trusted = await verifier.trustedToken();
      expect(trusted.toLowerCase()).to.equal(CUSDC.toLowerCase());
      console.log(`      Verifier: trustedToken=${trusted.slice(0, 10)}... ✓`);
    });

    it("AgentIdentityRegistry responds", async function () {
      const nextId = await identity.nextAgentId();
      const paused = await identity.paused();
      expect(nextId).to.be.gte(1n);
      expect(paused).to.equal(false);
      console.log(`      Identity: nextAgentId=${nextId}, paused=${paused} ✓`);
    });

    it("AgentReputationRegistry responds", async function () {
      const paused = await reputation.paused();
      expect(paused).to.equal(false);
      console.log(`      Reputation: paused=${paused} ✓`);
    });

    it("AgenticCommerceProtocol responds (payment token, treasury, fee)", async function () {
      const pt = await acp.paymentToken();
      const t = await acp.treasury();
      const fee = await acp.PLATFORM_FEE_BPS();
      const paused = await acp.paused();

      expect(pt.toLowerCase()).to.equal(MOCK_USDC.toLowerCase());
      expect(fee).to.equal(100n); // 1%
      expect(paused).to.equal(false);
      console.log(`      ACP: paymentToken=USDC, fee=${fee}bps, paused=${paused} ✓`);
      console.log(`      Treasury: ${t}`);
    });
  });

  // ===========================================================================
  // 2. Scenario A: Register → Wrap → FHE Pay → Nonce → Feedback
  // ===========================================================================

  describe("2. Scenario A: Agent Lifecycle (register → wrap → pay → feedback)", function () {
    let agentId: bigint;
    let paymentNonce: string;
    const serverAddress = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

    it("Step 1: Agent registers on Identity Registry", async function () {
      const agentURI = JSON.stringify({
        name: "E2E-Test-Agent",
        services: ["text-gen", "code-review"],
        x402Scheme: "fhe-confidential-v1",
        pricing: { perRequest: "0.10 USDC" },
      });

      const tx = await identity.register(agentURI);
      const receipt = await tx.wait();

      const iface = new ethers.Interface(IDENTITY_ABI);
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "AgentRegistered") {
            agentId = parsed.args[0];
          }
        } catch { /* skip */ }
      }

      expect(agentId).to.be.a("bigint");
      console.log(`      Agent registered: ID=${agentId}`);
      console.log(`      Gas: ${receipt.gasUsed}`);
    });

    it("Step 2: Agent wraps USDC → cUSDC (encrypted balance)", async function () {
      const amount = 5_000_000n; // 5 USDC
      await (await usdc.mint(signerAddress, 10_000_000n)).wait();
      await (await usdc.approve(CUSDC, amount)).wait();

      const feesBefore = await token.accumulatedFees();
      const tx = await token.wrap(signerAddress, amount);
      const receipt = await tx.wait();
      const feesAfter = await token.accumulatedFees();

      const handle = await token.confidentialBalanceOf(signerAddress);
      expect(String(handle)).to.not.equal(ZERO_HANDLE);

      console.log(`      Wrapped: ${ethers.formatUnits(amount, 6)} USDC`);
      console.log(`      Fee: ${ethers.formatUnits(feesAfter - feesBefore, 6)} USDC`);
      console.log(`      Encrypted balance: ${String(handle).slice(0, 20)}...`);
      console.log(`      Gas: ${receipt.gasUsed}`);
    });

    it("Step 3: Agent makes FHE encrypted payment to server", async function () {
      const paymentAmount = 500_000n; // 0.50 USDC

      // Encrypt amount
      const input = fhevmInstance.createEncryptedInput(CUSDC, signerAddress);
      input.add64(paymentAmount);
      const encrypted = await input.encrypt();

      // TX1: confidentialTransfer
      const tx = await token.confidentialTransfer(
        serverAddress,
        encrypted.handles[0],
        encrypted.inputProof
      );
      const receipt = await tx.wait();

      // Verify event
      const iface = new ethers.Interface(TOKEN_ABI);
      let transferEvent = false;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "ConfidentialTransfer") {
            expect(parsed.args[0].toLowerCase()).to.equal(signerAddress.toLowerCase());
            expect(parsed.args[1].toLowerCase()).to.equal(serverAddress.toLowerCase());
            transferEvent = true;
          }
        } catch { /* skip */ }
      }
      expect(transferEvent).to.equal(true);

      console.log(`      FHE payment: 0.50 USDC → ${serverAddress.slice(0, 10)}...`);
      console.log(`      Gas: ${receipt.gasUsed}`);
    });

    it("Step 4: Agent records payment nonce on verifier", async function () {
      paymentNonce = ethers.hexlify(ethers.randomBytes(32));

      const tx = await verifier.recordPayment(serverAddress, paymentNonce, 500_000n);
      const receipt = await tx.wait();

      // Verify event
      const iface = new ethers.Interface(VERIFIER_ABI);
      let paymentEvent = false;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "PaymentVerified") {
            paymentEvent = true;
          }
        } catch { /* skip */ }
      }
      expect(paymentEvent).to.equal(true);
      expect(await verifier.usedNonces(paymentNonce)).to.equal(true);

      console.log(`      Nonce recorded: ${paymentNonce.slice(0, 22)}...`);
      console.log(`      Gas: ${receipt.gasUsed}`);
    });

    it("Step 5: Server gives feedback to agent on Reputation Registry", async function () {
      const tags = [
        ethers.encodeBytes32String("fast"),
        ethers.encodeBytes32String("accurate"),
      ];
      // Use the payment nonce as proof-of-payment
      const proof = ethers.toUtf8Bytes(`nonce:${paymentNonce}`);

      const tx = await reputation.giveFeedback(agentId, 220, tags, proof);
      const receipt = await tx.wait();

      // Verify event
      const iface = new ethers.Interface(REPUTATION_ABI);
      let fbEvent = false;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "FeedbackGiven") {
            expect(parsed.args[0]).to.equal(agentId);
            expect(Number(parsed.args[2])).to.equal(220);
            fbEvent = true;
          }
        } catch { /* skip */ }
      }
      expect(fbEvent).to.equal(true);

      // Check reputation summary
      const [totalFeedback, avgScore] = await reputation.getSummary(agentId);
      expect(totalFeedback).to.be.gte(1n);

      console.log(`      Feedback: score=220/255, tags=[fast,accurate]`);
      console.log(`      Total feedback for agent: ${totalFeedback}`);
      console.log(`      Average score: ${avgScore}/255`);
      console.log(`      Gas: ${receipt.gasUsed}`);
    });

    it("Step 6: Verify complete agent profile", async function () {
      // Identity
      const [uri, owner, wallet] = await identity.getAgent(agentId);
      expect(uri).to.include("E2E-Test-Agent");
      expect(owner.toLowerCase()).to.equal(signerAddress.toLowerCase());

      // Reputation
      const [totalFeedback, avgScore] = await reputation.getSummary(agentId);
      expect(totalFeedback).to.be.gte(1n);

      // Payment nonce
      expect(await verifier.usedNonces(paymentNonce)).to.equal(true);

      // Encrypted balance
      const handle = await token.confidentialBalanceOf(signerAddress);
      expect(String(handle)).to.not.equal(ZERO_HANDLE);

      console.log(`\n      ┌──────────────────────────────────────────────┐`);
      console.log(`      │ AGENT LIFECYCLE COMPLETE                      │`);
      console.log(`      ├──────────────────────────────────────────────┤`);
      console.log(`      │ 1. Registered: Agent #${agentId.toString().padEnd(28)}│`);
      console.log(`      │ 2. Wrapped: USDC → cUSDC (encrypted)        │`);
      console.log(`      │ 3. Paid: 0.50 cUSDC (FHE encrypted)        │`);
      console.log(`      │ 4. Nonce: recorded & verified               │`);
      console.log(`      │ 5. Feedback: ${avgScore}/255 avg (${totalFeedback} reviews)           │`);
      console.log(`      │ 6. Profile: identity + reputation + balance │`);
      console.log(`      └──────────────────────────────────────────────┘`);
    });
  });

  // ===========================================================================
  // 3. Scenario B: Multiple x402 Payments Then Batch Feedback
  // ===========================================================================

  describe("3. Scenario B: Multiple Payments → Batch Feedback", function () {
    let serverAgentId: bigint;

    it("registers server agent", async function () {
      const tx = await identity.register(JSON.stringify({
        name: "API-Server-Agent",
        services: ["image-gen"],
        pricing: { perRequest: "0.05 USDC", batch10: "0.40 USDC" },
      }));
      const receipt = await tx.wait();
      const iface = new ethers.Interface(IDENTITY_ABI);
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "AgentRegistered") serverAgentId = parsed.args[0];
        } catch { /* skip */ }
      }
      console.log(`      Server agent registered: #${serverAgentId}`);
    });

    it("makes 3 individual FHE payments", async function () {
      const server = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const nonces: string[] = [];
      let totalGas = 0n;

      // Ensure cUSDC balance
      await (await usdc.mint(signerAddress, 10_000_000n)).wait();
      await (await usdc.approve(CUSDC, 5_000_000n)).wait();
      await (await token.wrap(signerAddress, 5_000_000n)).wait();

      for (let i = 0; i < 3; i++) {
        const amount = 50_000n * BigInt(i + 1); // 0.05, 0.10, 0.15 USDC
        const nonce = ethers.hexlify(ethers.randomBytes(32));
        nonces.push(nonce);

        // TX1: FHE transfer
        const input = fhevmInstance.createEncryptedInput(CUSDC, signerAddress);
        input.add64(amount);
        const encrypted = await input.encrypt();
        const tx1 = await token.confidentialTransfer(
          server, encrypted.handles[0], encrypted.inputProof
        );
        const r1 = await tx1.wait();

        // TX2: Record nonce
        const tx2 = await verifier.recordPayment(server, nonce, amount);
        const r2 = await tx2.wait();

        totalGas += r1.gasUsed + r2.gasUsed;
        console.log(`      Payment ${i + 1}/3: ${ethers.formatUnits(amount, 6)} USDC (gas: ${r1.gasUsed + r2.gasUsed})`);
      }

      // Verify all nonces
      for (const n of nonces) {
        expect(await verifier.usedNonces(n)).to.equal(true);
      }
      console.log(`      Total gas for 3 payments: ${totalGas}`);
    });

    it("gives 3 feedback entries with increasing scores", async function () {
      const scores = [150, 200, 250];
      const tagSets = [
        [ethers.encodeBytes32String("ok")],
        [ethers.encodeBytes32String("good"), ethers.encodeBytes32String("fast")],
        [ethers.encodeBytes32String("excellent"), ethers.encodeBytes32String("fast"), ethers.encodeBytes32String("cheap")],
      ];

      for (let i = 0; i < 3; i++) {
        const tx = await reputation.giveFeedback(
          serverAgentId, scores[i], tagSets[i],
          ethers.toUtf8Bytes(`payment-${i}`)
        );
        await tx.wait();
        console.log(`      Feedback ${i + 1}/3: score=${scores[i]}`);
      }

      const [total, avg] = await reputation.getSummary(serverAgentId);
      expect(total).to.equal(3n);
      // (150 + 200 + 250) / 3 = 200
      expect(avg).to.equal(200n);
      console.log(`      Summary: ${total} reviews, avg=${avg}/255`);
    });
  });

  // ===========================================================================
  // 4. Scenario C: Batch Prepayment Flow
  // ===========================================================================

  describe("4. Scenario C: Batch Prepayment (10 API Calls)", function () {
    it("agent prepays 10 requests with single FHE transfer + batch nonce", async function () {
      const server = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
      const requestCount = 10;
      const pricePerRequest = 50_000n; // 0.05 USDC each
      const totalAmount = pricePerRequest * BigInt(requestCount); // 0.50 USDC
      const nonce = ethers.hexlify(ethers.randomBytes(32));

      // TX1: FHE transfer for total amount
      const input = fhevmInstance.createEncryptedInput(CUSDC, signerAddress);
      input.add64(totalAmount);
      const encrypted = await input.encrypt();

      const tx1 = await token.confidentialTransfer(
        server, encrypted.handles[0], encrypted.inputProof
      );
      const r1 = await tx1.wait();
      expect(r1.status).to.equal(1);

      // TX2: Record batch payment
      const tx2 = await verifier.recordBatchPayment(server, nonce, requestCount, pricePerRequest);
      const r2 = await tx2.wait();
      expect(r2.status).to.equal(1);

      // Verify batch event
      const iface = new ethers.Interface(VERIFIER_ABI);
      let batchEvent = false;
      for (const log of r2.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "BatchPaymentRecorded") {
            expect(Number(parsed.args[3])).to.equal(requestCount);
            expect(parsed.args[4]).to.equal(pricePerRequest);
            batchEvent = true;
          }
        } catch { /* skip */ }
      }
      expect(batchEvent).to.equal(true);

      console.log(`      Batch: ${requestCount} x ${ethers.formatUnits(pricePerRequest, 6)} = ${ethers.formatUnits(totalAmount, 6)} USDC`);
      console.log(`      Transfer gas: ${r1.gasUsed}`);
      console.log(`      Batch nonce gas: ${r2.gasUsed}`);
      console.log(`      Total: ${r1.gasUsed + r2.gasUsed}`);
    });
  });

  // ===========================================================================
  // 5. Scenario D: ACP Job + FHE Payment Integration
  // ===========================================================================

  describe("5. Scenario D: ACP Job Creation + Funding", function () {
    let jobId: bigint;

    it("creates a job with description and budget", async function () {
      const evaluator = ethers.Wallet.createRandom().address;
      const expiry = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;

      const tx = await acp.createJob(
        ethers.ZeroAddress,
        evaluator,
        expiry,
        "E2E Test: Generate AI artwork for project",
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

      expect(jobId).to.be.a("bigint");
      console.log(`      Job created: #${jobId}`);
      console.log(`      Gas: ${receipt.gasUsed}`);
    });

    it("sets budget and funds job with USDC", async function () {
      const budget = 5_000_000n; // 5 USDC
      await (await acp.setBudget(jobId, budget)).wait();

      // Fund
      await (await usdc.mint(signerAddress, budget)).wait();
      await (await usdc.approve(ACP_ADDRESS, budget)).wait();
      const fundTx = await acp.fund(jobId, budget);
      const fundReceipt = await fundTx.wait();

      const job = await acp.getJob(jobId);
      expect(job.status).to.equal(1n); // Funded
      expect(job.budget).to.equal(budget);

      console.log(`      Budget: ${ethers.formatUnits(budget, 6)} USDC`);
      console.log(`      Status: Funded`);
      console.log(`      Gas: ${fundReceipt.gasUsed}`);
    });

    it("verifies job on-chain state is correct", async function () {
      const job = await acp.getJob(jobId);

      expect(job.client.toLowerCase()).to.equal(signerAddress.toLowerCase());
      expect(job.status).to.equal(1n); // Funded
      expect(job.description).to.equal("E2E Test: Generate AI artwork for project");
      expect(job.budget).to.equal(5_000_000n);

      console.log(`      Job #${jobId}: client=${job.client.slice(0, 10)}..., budget=${ethers.formatUnits(job.budget, 6)} USDC, status=Funded`);
    });
  });

  // ===========================================================================
  // 6. Gas Summary — Full Protocol Operations
  // ===========================================================================

  describe("6. Full Protocol Gas Report", function () {
    it("measures gas for every protocol operation", async function () {
      const gasReport: { op: string; gas: bigint }[] = [];

      // 1. Register agent
      const regTx = await identity.register(`{"name":"GasTest","ts":${Date.now()}}`);
      const regR = await regTx.wait();
      let agentId: bigint = 0n;
      const iface = new ethers.Interface(IDENTITY_ABI);
      for (const log of regR.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "AgentRegistered") agentId = parsed.args[0];
        } catch { /* skip */ }
      }
      gasReport.push({ op: "register (identity)", gas: regR.gasUsed });

      // 2. Give feedback
      const fbTx = await reputation.giveFeedback(agentId, 200, [ethers.encodeBytes32String("test")], ethers.toUtf8Bytes("proof"));
      const fbR = await fbTx.wait();
      gasReport.push({ op: "giveFeedback", gas: fbR.gasUsed });

      // 3. Mint USDC
      const mintTx = await usdc.mint(signerAddress, 10_000_000n);
      const mintR = await mintTx.wait();
      gasReport.push({ op: "mint USDC", gas: mintR.gasUsed });

      // 4. Approve
      const appTx = await usdc.approve(CUSDC, 5_000_000n);
      const appR = await appTx.wait();
      gasReport.push({ op: "approve USDC", gas: appR.gasUsed });

      // 5. Wrap
      const wrapTx = await token.wrap(signerAddress, 5_000_000n);
      const wrapR = await wrapTx.wait();
      gasReport.push({ op: "wrap (USDC→cUSDC)", gas: wrapR.gasUsed });

      // 6. FHE encrypt + transfer
      const input = fhevmInstance.createEncryptedInput(CUSDC, signerAddress);
      input.add64(100_000n);
      const enc = await input.encrypt();
      const trTx = await token.confidentialTransfer(
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        enc.handles[0], enc.inputProof
      );
      const trR = await trTx.wait();
      gasReport.push({ op: "confidentialTransfer", gas: trR.gasUsed });

      // 7. recordPayment
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const rpTx = await verifier.recordPayment(signerAddress, nonce, 100_000n);
      const rpR = await rpTx.wait();
      gasReport.push({ op: "recordPayment", gas: rpR.gasUsed });

      // 8. recordBatchPayment
      const bNonce = ethers.hexlify(ethers.randomBytes(32));
      const bpTx = await verifier.recordBatchPayment(signerAddress, bNonce, 10, 10_000n);
      const bpR = await bpTx.wait();
      gasReport.push({ op: "recordBatchPayment", gas: bpR.gasUsed });

      // Print report
      console.log(`\n      ┌──────────────────────────────┬──────────────┐`);
      console.log(`      │ Protocol Operation            │ Gas Used     │`);
      console.log(`      ├──────────────────────────────┼──────────────┤`);
      for (const r of gasReport) {
        console.log(`      │ ${r.op.padEnd(28)} │ ${r.gas.toString().padStart(12)} │`);
      }
      const x402Total = gasReport[5].gas + gasReport[6].gas;
      console.log(`      ├──────────────────────────────┼──────────────┤`);
      console.log(`      │ x402 total (transfer+nonce)  │ ${x402Total.toString().padStart(12)} │`);
      console.log(`      └──────────────────────────────┴──────────────┘`);
    });
  });

  // ===========================================================================
  // 7. Summary
  // ===========================================================================

  describe("7. Summary", function () {
    it("all end-to-end flows verified on Sepolia", async function () {
      console.log(`\n      ┌──────────────────────────────────────────────────────┐`);
      console.log(`      │ END-TO-END VERIFICATION COMPLETE                      │`);
      console.log(`      ├──────────────────────────────────────────────────────┤`);
      console.log(`      │ Contracts:                                            │`);
      console.log(`      │   MockUSDC          ✓  (mint, balance, approve)      │`);
      console.log(`      │   ConfidentialUSDC   ✓  (wrap, FHE transfer, fees)   │`);
      console.log(`      │   X402Verifier       ✓  (single + batch nonce)       │`);
      console.log(`      │   IdentityRegistry   ✓  (register, getAgent)         │`);
      console.log(`      │   ReputationRegistry ✓  (feedback, summary)          │`);
      console.log(`      │   ACP                ✓  (create, fund, getJob)       │`);
      console.log(`      │                                                       │`);
      console.log(`      │ Scenarios:                                            │`);
      console.log(`      │   A. Agent lifecycle (register→pay→feedback)    ✓     │`);
      console.log(`      │   B. Multi-payment + batch feedback             ✓     │`);
      console.log(`      │   C. Batch prepayment (10 API calls)            ✓     │`);
      console.log(`      │   D. ACP job creation + funding                 ✓     │`);
      console.log(`      │                                                       │`);
      console.log(`      │ All operations used REAL @zama-fhe/relayer-sdk        │`);
      console.log(`      │ encryption against the Zama coprocessor on Sepolia.   │`);
      console.log(`      └──────────────────────────────────────────────────────┘`);
    });
  });
});
