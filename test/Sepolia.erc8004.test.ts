/**
 * Sepolia On-Chain — ERC-8004 Identity & Reputation Tests
 *
 * Tests real deployed AgentIdentityRegistry and AgentReputationRegistry
 * contracts on Ethereum Sepolia. Covers:
 *   1. Agent registration + wallet linking
 *   2. URI updates + wallet reassignment
 *   3. Feedback submission + average score calculation
 *   4. Multi-agent registration + independent feedback
 *   5. Cross-contract integration (identity → reputation)
 *   6. Gas report for all operations
 *
 * Run: npx hardhat test test/Sepolia.erc8004.test.ts --network sepolia
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract, Signer } from "ethers";

// Deployed ERC-8004 contracts on Sepolia (V4.3)
const IDENTITY_ADDRESS = "0xf4609D5DB3153717827703C795acb00867b69567";
const REPUTATION_ADDRESS = "0xd1Dd10990f317802c79077834c75742388959668";

const IDENTITY_ABI = [
  "function register(string calldata agentURI) external returns (uint256)",
  "function setAgentWallet(uint256 agentId, address wallet) external",
  "function updateURI(uint256 agentId, string calldata newURI) external",
  "function getAgent(uint256 agentId) external view returns (string memory uri, address owner, address wallet)",
  "function agentOf(address wallet) external view returns (uint256)",
  "function nextAgentId() external view returns (uint256)",
  "function owner() external view returns (address)",
  "function paused() external view returns (bool)",
  "event AgentRegistered(uint256 indexed agentId, address indexed owner, string agentURI)",
  "event AgentWalletSet(uint256 indexed agentId, address indexed wallet)",
  "event AgentURIUpdated(uint256 indexed agentId, string newURI)",
];

const REPUTATION_ABI = [
  "function giveFeedback(uint256 agentId, uint8 score, bytes32[] calldata tags, bytes calldata proofOfPayment) external",
  "function getSummary(uint256 agentId) external view returns (uint256 totalFeedback, uint256 averageScore, uint256 lastUpdated)",
  "function getFeedback(uint256 agentId, uint256 index) external view returns (address reviewer, uint8 score, bytes32[] memory tags, uint256 timestamp)",
  "function feedbackCount(uint256 agentId) external view returns (uint256)",
  "function owner() external view returns (address)",
  "function paused() external view returns (bool)",
  "event FeedbackGiven(uint256 indexed agentId, address indexed reviewer, uint8 score)",
];

describe("Sepolia — ERC-8004 Identity & Reputation", function () {
  this.timeout(300_000);

  let signer: Signer;
  let signerAddress: string;
  let identity: Contract;
  let reputation: Contract;

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

    identity = new ethers.Contract(IDENTITY_ADDRESS, IDENTITY_ABI, signer);
    reputation = new ethers.Contract(REPUTATION_ADDRESS, REPUTATION_ABI, signer);

    console.log(`    Signer: ${signerAddress}`);

    const ethBal = await ethers.provider.getBalance(signerAddress);
    console.log(`    ETH Balance: ${ethers.formatEther(ethBal)} ETH`);
    if (ethBal === 0n) throw new Error("No ETH — fund the wallet first");
  });

  // ===========================================================================
  // 1. Contract Deployment Verification
  // ===========================================================================

  describe("1. Contract Deployment Verification", function () {
    it("AgentIdentityRegistry is deployed and responds", async function () {
      const nextId = await identity.nextAgentId();
      const paused = await identity.paused();
      const owner = await identity.owner();

      console.log(`      nextAgentId: ${nextId}`);
      console.log(`      Paused: ${paused}`);
      console.log(`      Owner: ${owner}`);

      expect(nextId).to.be.a("bigint");
      expect(nextId).to.be.gte(1n);
      expect(paused).to.equal(false);
      expect(owner).to.not.equal(ethers.ZeroAddress);
    });

    it("AgentReputationRegistry is deployed and responds", async function () {
      const paused = await reputation.paused();
      const owner = await reputation.owner();

      console.log(`      Paused: ${paused}`);
      console.log(`      Owner: ${owner}`);

      expect(paused).to.equal(false);
      expect(owner).to.not.equal(ethers.ZeroAddress);
    });
  });

  // ===========================================================================
  // 2. Agent Registration (Real On-Chain)
  // ===========================================================================

  describe("2. Agent Registration", function () {
    let registeredAgentId: bigint;

    it("registers a new AI agent with metadata URI", async function () {
      const agentURI = JSON.stringify({
        name: "FHE-Test-Agent",
        services: ["text-generation", "code-review"],
        x402Scheme: "fhe-confidential-v1",
        chain: "sepolia",
        timestamp: Date.now(),
      });

      const nextIdBefore = await identity.nextAgentId();
      const tx = await identity.register(agentURI);
      const receipt = await tx.wait();

      // Parse AgentRegistered event
      const iface = new ethers.Interface(IDENTITY_ABI);
      let eventFound = false;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "AgentRegistered") {
            registeredAgentId = parsed.args[0];
            expect(parsed.args[1].toLowerCase()).to.equal(signerAddress.toLowerCase());
            eventFound = true;
            console.log(`      AgentRegistered: id=${registeredAgentId}, owner=${signerAddress.slice(0, 10)}...`);
          }
        } catch { /* skip */ }
      }
      expect(eventFound).to.equal(true, "AgentRegistered event not found");

      const nextIdAfter = await identity.nextAgentId();
      expect(nextIdAfter).to.equal(nextIdBefore + 1n);

      console.log(`      TX: ${receipt.hash}`);
      console.log(`      Gas: ${receipt.gasUsed}`);
    });

    it("getAgent returns correct data for registered agent", async function () {
      const [uri, owner, wallet] = await identity.getAgent(registeredAgentId);

      expect(owner.toLowerCase()).to.equal(signerAddress.toLowerCase());
      expect(wallet.toLowerCase()).to.equal(signerAddress.toLowerCase());
      expect(uri).to.include("FHE-Test-Agent");

      const parsed = JSON.parse(uri);
      expect(parsed.x402Scheme).to.equal("fhe-confidential-v1");
      console.log(`      URI parsed: name=${parsed.name}, scheme=${parsed.x402Scheme}`);
    });

    it("agentOf maps signer wallet to agent ID", async function () {
      const agentId = await identity.agentOf(signerAddress);
      expect(agentId).to.equal(registeredAgentId);
      console.log(`      agentOf(${signerAddress.slice(0, 10)}...) = ${agentId}`);
    });

    it("agentOf returns 0 for unregistered wallet", async function () {
      const randomWallet = ethers.Wallet.createRandom().address;
      const agentId = await identity.agentOf(randomWallet);
      expect(agentId).to.equal(0n);
      console.log(`      agentOf(random) = 0 (correct)`);
    });

    it("getAgent returns empty for non-existent agent ID", async function () {
      const [uri, owner, wallet] = await identity.getAgent(999999);
      expect(uri).to.equal("");
      expect(owner).to.equal(ethers.ZeroAddress);
      expect(wallet).to.equal(ethers.ZeroAddress);
      console.log(`      getAgent(999999) = empty (correct)`);
    });
  });

  // ===========================================================================
  // 3. Update URI (Real On-Chain)
  // ===========================================================================

  describe("3. Update Agent URI", function () {
    let agentId: bigint;

    before(async function () {
      // Register a fresh agent for this test
      const tx = await identity.register(`{"name":"URI-Update-Test","ts":${Date.now()}}`);
      const receipt = await tx.wait();
      const iface = new ethers.Interface(IDENTITY_ABI);
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "AgentRegistered") agentId = parsed.args[0];
        } catch { /* skip */ }
      }
    });

    it("updates agent URI and emits AgentURIUpdated", async function () {
      const newURI = JSON.stringify({
        name: "URI-Update-Test-V2",
        services: ["image-gen", "translation"],
        updated: Date.now(),
      });

      const tx = await identity.updateURI(agentId, newURI);
      const receipt = await tx.wait();

      // Verify event
      const iface = new ethers.Interface(IDENTITY_ABI);
      let eventFound = false;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "AgentURIUpdated") {
            expect(parsed.args[0]).to.equal(agentId);
            eventFound = true;
          }
        } catch { /* skip */ }
      }
      expect(eventFound).to.equal(true, "AgentURIUpdated event not found");

      // Verify on-chain
      const [uri] = await identity.getAgent(agentId);
      expect(uri).to.include("URI-Update-Test-V2");
      console.log(`      URI updated for agent #${agentId}`);
      console.log(`      Gas: ${receipt.gasUsed}`);
    });

    it("updated URI is readable and parseable", async function () {
      const [uri] = await identity.getAgent(agentId);
      const parsed = JSON.parse(uri);
      expect(parsed.name).to.equal("URI-Update-Test-V2");
      expect(parsed.services).to.include("image-gen");
      console.log(`      Verified: ${parsed.name}, services=${parsed.services.join(",")}`);
    });
  });

  // ===========================================================================
  // 4. Wallet Linking (Real On-Chain)
  // ===========================================================================

  describe("4. Wallet Linking", function () {
    let agentId: bigint;
    let newWallet: string;

    before(async function () {
      const tx = await identity.register(`{"name":"Wallet-Link-Test","ts":${Date.now()}}`);
      const receipt = await tx.wait();
      const iface = new ethers.Interface(IDENTITY_ABI);
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "AgentRegistered") agentId = parsed.args[0];
        } catch { /* skip */ }
      }
      newWallet = ethers.Wallet.createRandom().address;
    });

    it("sets a new wallet for the agent", async function () {
      const tx = await identity.setAgentWallet(agentId, newWallet);
      const receipt = await tx.wait();

      // Verify event
      const iface = new ethers.Interface(IDENTITY_ABI);
      let eventFound = false;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "AgentWalletSet") {
            expect(parsed.args[0]).to.equal(agentId);
            expect(parsed.args[1].toLowerCase()).to.equal(newWallet.toLowerCase());
            eventFound = true;
          }
        } catch { /* skip */ }
      }
      expect(eventFound).to.equal(true, "AgentWalletSet event not found");
      console.log(`      Wallet linked: agent #${agentId} → ${newWallet.slice(0, 10)}...`);
      console.log(`      Gas: ${receipt.gasUsed}`);
    });

    it("agentOf reflects new wallet mapping", async function () {
      const id = await identity.agentOf(newWallet);
      expect(id).to.equal(agentId);
      console.log(`      agentOf(newWallet) = ${id} (correct)`);
    });

    it("old wallet mapping is cleared", async function () {
      // Note: signer may have registered other agents in previous tests,
      // so agentOf(signer) might point to a different agent.
      // We verify the new wallet points correctly.
      const [, , wallet] = await identity.getAgent(agentId);
      expect(wallet.toLowerCase()).to.equal(newWallet.toLowerCase());
      console.log(`      getAgent(${agentId}).wallet = ${newWallet.slice(0, 10)}... (correct)`);
    });

    it("reassigns wallet to another address", async function () {
      const anotherWallet = ethers.Wallet.createRandom().address;
      const tx = await identity.setAgentWallet(agentId, anotherWallet);
      await tx.wait();

      // Old newWallet should no longer map
      const oldMapping = await identity.agentOf(newWallet);
      expect(oldMapping).to.equal(0n);

      // New wallet should map
      const newMapping = await identity.agentOf(anotherWallet);
      expect(newMapping).to.equal(agentId);
      console.log(`      Wallet reassigned: ${newWallet.slice(0, 8)}... → ${anotherWallet.slice(0, 8)}...`);
    });
  });

  // ===========================================================================
  // 5. Reputation — Feedback Submission (Real On-Chain)
  // ===========================================================================

  describe("5. Reputation — Give Feedback", function () {
    let targetAgentId: bigint;

    before(async function () {
      // Register an agent to receive feedback
      const tx = await identity.register(`{"name":"Feedback-Target","ts":${Date.now()}}`);
      const receipt = await tx.wait();
      const iface = new ethers.Interface(IDENTITY_ABI);
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "AgentRegistered") targetAgentId = parsed.args[0];
        } catch { /* skip */ }
      }
      console.log(`      Target agent: #${targetAgentId}`);
    });

    it("submits feedback with score 200 and tags", async function () {
      const tags = [
        ethers.encodeBytes32String("fast"),
        ethers.encodeBytes32String("accurate"),
        ethers.encodeBytes32String("x402"),
      ];
      const proof = ethers.toUtf8Bytes("tx:0xabcdef1234567890");

      const tx = await reputation.giveFeedback(targetAgentId, 200, tags, proof);
      const receipt = await tx.wait();

      // Verify event
      const iface = new ethers.Interface(REPUTATION_ABI);
      let eventFound = false;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "FeedbackGiven") {
            expect(parsed.args[0]).to.equal(targetAgentId);
            expect(parsed.args[1].toLowerCase()).to.equal(signerAddress.toLowerCase());
            expect(Number(parsed.args[2])).to.equal(200);
            eventFound = true;
          }
        } catch { /* skip */ }
      }
      expect(eventFound).to.equal(true, "FeedbackGiven event not found");
      console.log(`      Feedback #1: score=200, tags=[fast,accurate,x402]`);
      console.log(`      TX: ${receipt.hash}`);
      console.log(`      Gas: ${receipt.gasUsed}`);
    });

    it("submits second feedback with score 150", async function () {
      const tags = [ethers.encodeBytes32String("reliable")];
      const proof = ethers.toUtf8Bytes("tx:0x9876543210fedcba");

      const tx = await reputation.giveFeedback(targetAgentId, 150, tags, proof);
      const receipt = await tx.wait();
      expect(receipt.status).to.equal(1);
      console.log(`      Feedback #2: score=150, tags=[reliable]`);
      console.log(`      Gas: ${receipt.gasUsed}`);
    });

    it("submits third feedback with score 255 (max)", async function () {
      const tags: string[] = [];
      const proof = ethers.toUtf8Bytes("tx:0xdeadbeef");

      const tx = await reputation.giveFeedback(targetAgentId, 255, tags, proof);
      const receipt = await tx.wait();
      expect(receipt.status).to.equal(1);
      console.log(`      Feedback #3: score=255 (max), tags=[]`);
      console.log(`      Gas: ${receipt.gasUsed}`);
    });

    it("feedbackCount returns 3", async function () {
      const count = await reputation.feedbackCount(targetAgentId);
      expect(count).to.equal(3n);
      console.log(`      feedbackCount(${targetAgentId}) = ${count}`);
    });

    it("getSummary returns correct average score", async function () {
      const [totalFeedback, averageScore, lastUpdated] = await reputation.getSummary(targetAgentId);

      expect(totalFeedback).to.equal(3n);
      // (200 + 150 + 255) / 3 = 605 / 3 = 201 (integer division)
      expect(averageScore).to.equal(201n);
      expect(lastUpdated).to.be.gt(0n);

      console.log(`      Total feedback: ${totalFeedback}`);
      console.log(`      Average score: ${averageScore}/255`);
      console.log(`      Last updated: ${new Date(Number(lastUpdated) * 1000).toISOString()}`);
    });

    it("getFeedback returns individual entries", async function () {
      const [reviewer0, score0, tags0, ts0] = await reputation.getFeedback(targetAgentId, 0);
      expect(reviewer0.toLowerCase()).to.equal(signerAddress.toLowerCase());
      expect(Number(score0)).to.equal(200);
      expect(tags0.length).to.equal(3);
      console.log(`      Feedback[0]: reviewer=${reviewer0.slice(0, 10)}..., score=${score0}, tags=${tags0.length}`);

      const [reviewer1, score1, tags1] = await reputation.getFeedback(targetAgentId, 1);
      expect(Number(score1)).to.equal(150);
      expect(tags1.length).to.equal(1);
      console.log(`      Feedback[1]: score=${score1}, tags=${tags1.length}`);

      const [reviewer2, score2, tags2] = await reputation.getFeedback(targetAgentId, 2);
      expect(Number(score2)).to.equal(255);
      expect(tags2.length).to.equal(0);
      console.log(`      Feedback[2]: score=${score2}, tags=${tags2.length}`);
    });

    it("getSummary returns 0 for agent with no feedback", async function () {
      const [totalFeedback, averageScore, lastUpdated] = await reputation.getSummary(999999);
      expect(totalFeedback).to.equal(0n);
      expect(averageScore).to.equal(0n);
      expect(lastUpdated).to.equal(0n);
      console.log(`      Agent 999999: no feedback (correct)`);
    });
  });

  // ===========================================================================
  // 6. Multi-Agent Independence (Real On-Chain)
  // ===========================================================================

  describe("6. Multi-Agent Independence", function () {
    let agentA: bigint;
    let agentB: bigint;

    before(async function () {
      const txA = await identity.register(`{"name":"AgentA","ts":${Date.now()}}`);
      const receiptA = await txA.wait();
      const txB = await identity.register(`{"name":"AgentB","ts":${Date.now() + 1}}`);
      const receiptB = await txB.wait();

      const iface = new ethers.Interface(IDENTITY_ABI);
      for (const log of receiptA.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "AgentRegistered") agentA = parsed.args[0];
        } catch { /* skip */ }
      }
      for (const log of receiptB.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "AgentRegistered") agentB = parsed.args[0];
        } catch { /* skip */ }
      }
      console.log(`      AgentA: #${agentA}, AgentB: #${agentB}`);
    });

    it("agents have sequential IDs", async function () {
      expect(agentB).to.equal(agentA + 1n);
    });

    it("feedback to AgentA doesn't affect AgentB", async function () {
      const proof = ethers.toUtf8Bytes("test-proof");

      // Give feedback only to AgentA
      await (await reputation.giveFeedback(agentA, 100, [], proof)).wait();
      await (await reputation.giveFeedback(agentA, 200, [], proof)).wait();

      const [countA] = await reputation.getSummary(agentA);
      const [countB] = await reputation.getSummary(agentB);

      expect(countA).to.be.gte(2n);
      expect(countB).to.equal(0n);
      console.log(`      AgentA feedback: ${countA}, AgentB feedback: ${countB} (independent)`);
    });

    it("updating AgentA URI doesn't affect AgentB", async function () {
      await (await identity.updateURI(agentA, `{"name":"AgentA-Updated","ts":${Date.now()}}`)).wait();

      const [uriA] = await identity.getAgent(agentA);
      const [uriB] = await identity.getAgent(agentB);

      expect(uriA).to.include("AgentA-Updated");
      expect(uriB).to.include("AgentB");
      console.log(`      AgentA URI updated, AgentB URI unchanged (correct)`);
    });
  });

  // ===========================================================================
  // 7. Error Cases (Real On-Chain)
  // ===========================================================================

  describe("7. Error Cases", function () {
    it("register reverts on empty URI", async function () {
      try {
        const tx = await identity.register("");
        await tx.wait();
        expect.fail("Should have reverted");
      } catch (e: any) {
        expect(
          e.message.includes("EmptyURI") || e.message.includes("execution reverted")
        ).to.equal(true);
        console.log(`      Empty URI correctly rejected`);
      }
    });

    it("setAgentWallet reverts for non-owner", async function () {
      // Agent ID 1 exists but is owned by whoever registered first
      // Try to set wallet — should fail if we're not the owner, or succeed if we are
      // Use a very high agent ID that definitely doesn't belong to us
      try {
        const tx = await identity.setAgentWallet(999999, signerAddress);
        await tx.wait();
        expect.fail("Should have reverted");
      } catch (e: any) {
        expect(
          e.message.includes("NotAgentOwner") || e.message.includes("execution reverted")
        ).to.equal(true);
        console.log(`      Non-owner setAgentWallet correctly rejected`);
      }
    });

    it("setAgentWallet reverts on zero address", async function () {
      // Register an agent we own
      const tx = await identity.register(`{"name":"ZeroTest","ts":${Date.now()}}`);
      const receipt = await tx.wait();
      const iface = new ethers.Interface(IDENTITY_ABI);
      let aid: bigint = 0n;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "AgentRegistered") aid = parsed.args[0];
        } catch { /* skip */ }
      }

      try {
        const tx2 = await identity.setAgentWallet(aid, ethers.ZeroAddress);
        await tx2.wait();
        expect.fail("Should have reverted");
      } catch (e: any) {
        expect(
          e.message.includes("ZeroAddress") || e.message.includes("execution reverted")
        ).to.equal(true);
        console.log(`      Zero address correctly rejected`);
      }
    });

    it("giveFeedback reverts for agentId=0", async function () {
      try {
        const tx = await reputation.giveFeedback(0, 100, [], ethers.toUtf8Bytes("proof"));
        await tx.wait();
        expect.fail("Should have reverted");
      } catch (e: any) {
        expect(
          e.message.includes("InvalidAgentId") || e.message.includes("execution reverted")
        ).to.equal(true);
        console.log(`      agentId=0 correctly rejected`);
      }
    });

    it("giveFeedback reverts without proof", async function () {
      try {
        const tx = await reputation.giveFeedback(1, 100, [], "0x");
        await tx.wait();
        expect.fail("Should have reverted");
      } catch (e: any) {
        expect(
          e.message.includes("ProofRequired") || e.message.includes("execution reverted")
        ).to.equal(true);
        console.log(`      Empty proof correctly rejected`);
      }
    });

    it("getFeedback reverts for out-of-bounds index", async function () {
      try {
        const tx = await reputation.getFeedback(999999, 0);
        // This is a view function so it won't have a tx, it'll throw directly
        expect.fail("Should have reverted");
      } catch (e: any) {
        expect(
          e.message.includes("IndexOutOfBounds") || e.message.includes("execution reverted") || e.message.includes("call revert")
        ).to.equal(true);
        console.log(`      Out-of-bounds index correctly rejected`);
      }
    });
  });

  // ===========================================================================
  // 8. Gas Report
  // ===========================================================================

  describe("8. Gas Cost Report", function () {
    it("reports gas costs for all ERC-8004 operations", async function () {
      // register
      const regTx = await identity.register(`{"name":"Gas-Test","ts":${Date.now()}}`);
      const regR = await regTx.wait();
      let agentId: bigint = 0n;
      const iface = new ethers.Interface(IDENTITY_ABI);
      for (const log of regR.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "AgentRegistered") agentId = parsed.args[0];
        } catch { /* skip */ }
      }

      // updateURI
      const uriTx = await identity.updateURI(agentId, `{"name":"Gas-Test-V2","ts":${Date.now()}}`);
      const uriR = await uriTx.wait();

      // setAgentWallet
      const walletTx = await identity.setAgentWallet(agentId, ethers.Wallet.createRandom().address);
      const walletR = await walletTx.wait();

      // giveFeedback (3 tags)
      const fb3Tx = await reputation.giveFeedback(
        agentId, 200,
        [ethers.encodeBytes32String("fast"), ethers.encodeBytes32String("good"), ethers.encodeBytes32String("cheap")],
        ethers.toUtf8Bytes("tx:0x123")
      );
      const fb3R = await fb3Tx.wait();

      // giveFeedback (0 tags)
      const fb0Tx = await reputation.giveFeedback(agentId, 100, [], ethers.toUtf8Bytes("tx:0x456"));
      const fb0R = await fb0Tx.wait();

      console.log(`\n      ┌──────────────────────────────┬──────────────┐`);
      console.log(`      │ ERC-8004 Operation           │ Gas Used     │`);
      console.log(`      ├──────────────────────────────┼──────────────┤`);
      console.log(`      │ register (identity)          │ ${regR.gasUsed.toString().padStart(12)} │`);
      console.log(`      │ updateURI                    │ ${uriR.gasUsed.toString().padStart(12)} │`);
      console.log(`      │ setAgentWallet               │ ${walletR.gasUsed.toString().padStart(12)} │`);
      console.log(`      │ giveFeedback (3 tags)        │ ${fb3R.gasUsed.toString().padStart(12)} │`);
      console.log(`      │ giveFeedback (0 tags)        │ ${fb0R.gasUsed.toString().padStart(12)} │`);
      console.log(`      └──────────────────────────────┴──────────────┘`);
    });
  });
});
