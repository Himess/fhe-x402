/**
 * Sepolia On-Chain — FHE Edge Cases & Stress Tests
 *
 * Real @zama-fhe/relayer-sdk encryption against Zama coprocessor.
 * Tests edge cases and unusual patterns:
 *   1. Self-transfer (sender = recipient)
 *   2. Minimum amount transfer (1 raw unit = 0.000001 USDC)
 *   3. Large amount transfer (1000 USDC)
 *   4. Rapid sequential transfers (same recipient)
 *   5. Transfer to fresh address (no prior cUSDC)
 *   6. Multiple wraps then multiple transfers (balance accumulation)
 *   7. Nonce boundary tests (edge values)
 *   8. Encryption determinism check (same amount → different ciphertext)
 *   9. Balance handle mutation tracking across operations
 *  10. Fee precision tests (boundary amounts)
 *
 * Run: npx hardhat test test/Sepolia.fhe-edge-cases.test.ts --network sepolia
 */

import { expect } from "chai";
import { ethers } from "hardhat";
import type { Contract, Signer } from "ethers";

const MOCK_USDC = "0xc89e913676B034f8b38E49f7508803d1cDEC9F4f";
const CUSDC = "0xE944754aa70d4924dc5d8E57774CDf21Df5e592D";
const VERIFIER = "0x4503A7aee235aBD10e6064BBa8E14235fdF041f4";

const ZERO_HANDLE = "0x" + "00".repeat(32);

const USDC_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
  "function mint(address, uint256)",
];

const TOKEN_ABI = [
  "function wrap(address to, uint256 amount)",
  "function confidentialBalanceOf(address) view returns (bytes32)",
  "function accumulatedFees() view returns (uint256)",
  "function rate() view returns (uint256)",
  "function paused() view returns (bool)",
  "function confidentialTransfer(address to, bytes32 encryptedAmount, bytes inputProof) returns (bytes32)",
  "event ConfidentialTransfer(address indexed from, address indexed to, bytes32 indexed amount)",
];

const VERIFIER_ABI = [
  "function usedNonces(bytes32) view returns (bool)",
  "function recordPayment(address server, bytes32 nonce, uint64 minPrice)",
  "function recordBatchPayment(address server, bytes32 nonce, uint32 requestCount, uint64 pricePerRequest)",
];

describe("Sepolia — FHE Edge Cases & Stress Tests", function () {
  this.timeout(600_000); // 10 min — edge cases may be slow

  let signer: Signer;
  let signerAddress: string;
  let usdc: Contract;
  let token: Contract;
  let verifier: Contract;
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

    console.log(`    Signer: ${signerAddress}`);

    const ethBal = await ethers.provider.getBalance(signerAddress);
    console.log(`    ETH Balance: ${ethers.formatEther(ethBal)} ETH`);
    if (ethBal === 0n) throw new Error("No ETH — fund the wallet first");

    // Initialize relayer-sdk
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

    // Ensure we have plenty of USDC + cUSDC for tests
    console.log(`    Preparing funds...`);
    await (await usdc.mint(signerAddress, 2000_000_000n)).wait(); // 2000 USDC
    await (await usdc.approve(CUSDC, 1500_000_000n)).wait();
    await (await token.wrap(signerAddress, 1500_000_000n)).wait(); // 1500 USDC → cUSDC
    console.log(`    Wrapped 1500 USDC → cUSDC`);
  });

  // ===========================================================================
  // 1. Self-Transfer
  // ===========================================================================

  describe("1. Self-Transfer (sender = recipient)", function () {
    it("encrypts and transfers to self", async function () {
      const handleBefore = String(await token.confidentialBalanceOf(signerAddress));

      const input = fhevmInstance.createEncryptedInput(CUSDC, signerAddress);
      input.add64(100_000n); // 0.10 USDC
      const encrypted = await input.encrypt();

      const tx = await token.confidentialTransfer(
        signerAddress,
        encrypted.handles[0],
        encrypted.inputProof
      );
      const receipt = await tx.wait();

      const handleAfter = String(await token.confidentialBalanceOf(signerAddress));
      console.log(`      Self-transfer: 0.10 USDC`);
      console.log(`      Handle changed: ${handleBefore !== handleAfter}`);
      console.log(`      Gas: ${receipt.gasUsed}`);
      expect(receipt.status).to.equal(1);
      // Handle may or may not change on self-transfer (FHE.select behavior)
    });
  });

  // ===========================================================================
  // 2. Minimum Amount Transfer
  // ===========================================================================

  describe("2. Minimum Amount Transfer (1 raw = 0.000001 USDC)", function () {
    it("encrypts and transfers 1 raw unit", async function () {
      const recipient = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

      const input = fhevmInstance.createEncryptedInput(CUSDC, signerAddress);
      input.add64(1n); // 1 raw unit = 0.000001 USDC
      const encrypted = await input.encrypt();

      const tx = await token.confidentialTransfer(
        recipient,
        encrypted.handles[0],
        encrypted.inputProof
      );
      const receipt = await tx.wait();

      console.log(`      Min transfer: 1 raw (0.000001 USDC)`);
      console.log(`      Gas: ${receipt.gasUsed}`);
      expect(receipt.status).to.equal(1);

      // Verify event emitted
      const iface = new ethers.Interface(TOKEN_ABI);
      let eventFound = false;
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "ConfidentialTransfer") eventFound = true;
        } catch { /* skip */ }
      }
      expect(eventFound).to.equal(true, "ConfidentialTransfer event emitted for min amount");
    });
  });

  // ===========================================================================
  // 3. Large Amount Transfer
  // ===========================================================================

  describe("3. Large Amount Transfer (1000 USDC)", function () {
    it("encrypts and transfers 1000 USDC", async function () {
      const recipient = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
      const largeAmount = 1000_000_000n; // 1000 USDC

      const input = fhevmInstance.createEncryptedInput(CUSDC, signerAddress);
      input.add64(largeAmount);
      const encrypted = await input.encrypt();

      console.log(`      Encrypting 1000 USDC...`);
      console.log(`      Handle: ${encrypted.handles[0].slice(0, 20)}...`);
      console.log(`      Proof size: ${encrypted.inputProof.length} bytes`);

      const tx = await token.confidentialTransfer(
        recipient,
        encrypted.handles[0],
        encrypted.inputProof
      );
      const receipt = await tx.wait();

      console.log(`      Large transfer: 1000 USDC`);
      console.log(`      TX: ${receipt.hash}`);
      console.log(`      Gas: ${receipt.gasUsed}`);
      expect(receipt.status).to.equal(1);
    });
  });

  // ===========================================================================
  // 4. Rapid Sequential Transfers (same recipient)
  // ===========================================================================

  describe("4. Rapid Sequential Transfers (3x to same recipient)", function () {
    it("sends 3 encrypted transfers to the same address", async function () {
      const recipient = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";
      const amounts = [50_000n, 100_000n, 200_000n]; // 0.05, 0.10, 0.20 USDC
      let totalGas = 0n;

      for (let i = 0; i < amounts.length; i++) {
        const input = fhevmInstance.createEncryptedInput(CUSDC, signerAddress);
        input.add64(amounts[i]);
        const encrypted = await input.encrypt();

        const tx = await token.confidentialTransfer(
          recipient,
          encrypted.handles[0],
          encrypted.inputProof
        );
        const receipt = await tx.wait();
        totalGas += receipt.gasUsed;
        console.log(`      Transfer ${i + 1}/3: ${ethers.formatUnits(amounts[i], 6)} USDC → gas: ${receipt.gasUsed}`);
        expect(receipt.status).to.equal(1);
      }

      console.log(`      Total gas (3 transfers): ${totalGas}`);
      console.log(`      Avg gas per transfer: ${totalGas / 3n}`);
    });
  });

  // ===========================================================================
  // 5. Transfer to Fresh Address (never received cUSDC)
  // ===========================================================================

  describe("5. Transfer to Fresh Address", function () {
    it("transfers to an address with no prior cUSDC", async function () {
      const freshRecipient = ethers.Wallet.createRandom().address;

      // Verify fresh address has zero handle
      const handleBefore = String(await token.confidentialBalanceOf(freshRecipient));
      expect(handleBefore).to.equal(ZERO_HANDLE);
      console.log(`      Fresh address has zero handle: ✓`);

      // Transfer
      const input = fhevmInstance.createEncryptedInput(CUSDC, signerAddress);
      input.add64(50_000n); // 0.05 USDC
      const encrypted = await input.encrypt();

      const tx = await token.confidentialTransfer(
        freshRecipient,
        encrypted.handles[0],
        encrypted.inputProof
      );
      const receipt = await tx.wait();

      // Check handle changed
      const handleAfter = String(await token.confidentialBalanceOf(freshRecipient));
      expect(handleAfter).to.not.equal(ZERO_HANDLE);
      console.log(`      Fresh address now has handle: ${handleAfter.slice(0, 20)}...`);
      console.log(`      Gas: ${receipt.gasUsed}`);
    });
  });

  // ===========================================================================
  // 6. Multiple Wraps + Multiple Transfers
  // ===========================================================================

  describe("6. Multiple Wraps Then Multiple Transfers", function () {
    it("wraps 3 times then transfers 3 times", async function () {
      const wrapAmounts = [100_000n, 200_000n, 500_000n]; // 0.10, 0.20, 0.50
      let totalWrapGas = 0n;

      // 3 sequential wraps
      for (let i = 0; i < wrapAmounts.length; i++) {
        await (await usdc.approve(CUSDC, wrapAmounts[i])).wait();
        const wrapTx = await token.wrap(signerAddress, wrapAmounts[i]);
        const wrapR = await wrapTx.wait();
        totalWrapGas += wrapR.gasUsed;
        console.log(`      Wrap ${i + 1}/3: ${ethers.formatUnits(wrapAmounts[i], 6)} USDC (gas: ${wrapR.gasUsed})`);
      }

      // 3 sequential transfers
      const recipients = [
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
        "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
      ];
      const transferAmounts = [50_000n, 100_000n, 200_000n];
      let totalTransferGas = 0n;

      for (let i = 0; i < 3; i++) {
        const input = fhevmInstance.createEncryptedInput(CUSDC, signerAddress);
        input.add64(transferAmounts[i]);
        const encrypted = await input.encrypt();

        const tx = await token.confidentialTransfer(
          recipients[i], encrypted.handles[0], encrypted.inputProof
        );
        const r = await tx.wait();
        totalTransferGas += r.gasUsed;
        console.log(`      Transfer ${i + 1}/3: ${ethers.formatUnits(transferAmounts[i], 6)} USDC (gas: ${r.gasUsed})`);
      }

      console.log(`      Total wrap gas: ${totalWrapGas}`);
      console.log(`      Total transfer gas: ${totalTransferGas}`);
    });
  });

  // ===========================================================================
  // 7. Encryption Determinism Check
  // ===========================================================================

  describe("7. Encryption Non-Determinism (same amount → different ciphertext)", function () {
    it("encrypting the same amount twice produces different handles", async function () {
      const amount = 100_000n;

      const input1 = fhevmInstance.createEncryptedInput(CUSDC, signerAddress);
      input1.add64(amount);
      const enc1 = await input1.encrypt();

      const input2 = fhevmInstance.createEncryptedInput(CUSDC, signerAddress);
      input2.add64(amount);
      const enc2 = await input2.encrypt();

      console.log(`      Handle 1: ${enc1.handles[0].slice(0, 30)}...`);
      console.log(`      Handle 2: ${enc2.handles[0].slice(0, 30)}...`);

      // FHE encryption is randomized — same plaintext → different ciphertext
      expect(enc1.handles[0]).to.not.equal(enc2.handles[0]);
      console.log(`      Handles are different: ✓ (FHE randomization working)`);
    });

    it("different proof bytes for same amount", async function () {
      const amount = 50_000n;

      const input1 = fhevmInstance.createEncryptedInput(CUSDC, signerAddress);
      input1.add64(amount);
      const enc1 = await input1.encrypt();

      const input2 = fhevmInstance.createEncryptedInput(CUSDC, signerAddress);
      input2.add64(amount);
      const enc2 = await input2.encrypt();

      // Proofs should also differ
      const proof1Hex = ethers.hexlify(enc1.inputProof);
      const proof2Hex = ethers.hexlify(enc2.inputProof);
      expect(proof1Hex).to.not.equal(proof2Hex);
      console.log(`      Proof 1 length: ${enc1.inputProof.length}`);
      console.log(`      Proof 2 length: ${enc2.inputProof.length}`);
      console.log(`      Proofs are different: ✓`);
    });
  });

  // ===========================================================================
  // 8. Balance Handle Mutation Tracking
  // ===========================================================================

  describe("8. Balance Handle Mutation Across Operations", function () {
    it("tracks handle changes: wrap → transfer → transfer → wrap", async function () {
      const handles: string[] = [];

      // Initial handle
      handles.push(String(await token.confidentialBalanceOf(signerAddress)));
      console.log(`      [0] Initial: ${handles[0].slice(0, 20)}...`);

      // Wrap
      await (await usdc.approve(CUSDC, 100_000n)).wait();
      await (await token.wrap(signerAddress, 100_000n)).wait();
      handles.push(String(await token.confidentialBalanceOf(signerAddress)));
      console.log(`      [1] After wrap: ${handles[1].slice(0, 20)}...`);

      // Transfer 1
      const input1 = fhevmInstance.createEncryptedInput(CUSDC, signerAddress);
      input1.add64(10_000n);
      const enc1 = await input1.encrypt();
      await (await token.confidentialTransfer(
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        enc1.handles[0], enc1.inputProof
      )).wait();
      handles.push(String(await token.confidentialBalanceOf(signerAddress)));
      console.log(`      [2] After transfer 1: ${handles[2].slice(0, 20)}...`);

      // Transfer 2
      const input2 = fhevmInstance.createEncryptedInput(CUSDC, signerAddress);
      input2.add64(10_000n);
      const enc2 = await input2.encrypt();
      await (await token.confidentialTransfer(
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
        enc2.handles[0], enc2.inputProof
      )).wait();
      handles.push(String(await token.confidentialBalanceOf(signerAddress)));
      console.log(`      [3] After transfer 2: ${handles[3].slice(0, 20)}...`);

      // Second wrap
      await (await usdc.approve(CUSDC, 50_000n)).wait();
      await (await token.wrap(signerAddress, 50_000n)).wait();
      handles.push(String(await token.confidentialBalanceOf(signerAddress)));
      console.log(`      [4] After wrap 2: ${handles[4].slice(0, 20)}...`);

      // Verify all handles are different (each operation mutates the encrypted state)
      const uniqueHandles = new Set(handles);
      console.log(`      Unique handles: ${uniqueHandles.size} / ${handles.length}`);
      expect(uniqueHandles.size).to.equal(handles.length);
      console.log(`      All handles unique: ✓ (FHE state mutation verified)`);
    });
  });

  // ===========================================================================
  // 9. Fee Precision Boundary Tests
  // ===========================================================================

  describe("9. Fee Precision Boundary Tests", function () {
    it("minimum wrap (fee floor = 0.01 USDC = 10000 raw)", async function () {
      const feesBefore = await token.accumulatedFees();

      // Wrap exactly 1 USDC → fee = max(1*0.001, 0.01) = 0.01 USDC
      await (await usdc.approve(CUSDC, 1_000_000n)).wait();
      await (await token.wrap(signerAddress, 1_000_000n)).wait();

      const feesAfter = await token.accumulatedFees();
      const fee = feesAfter - feesBefore;
      console.log(`      1 USDC wrap fee: ${ethers.formatUnits(fee, 6)} USDC`);
      expect(fee).to.equal(10_000n); // min fee
    });

    it("exact breakeven (10 USDC → 0.1% = 0.01 USDC = min fee)", async function () {
      const feesBefore = await token.accumulatedFees();

      await (await usdc.approve(CUSDC, 10_000_000n)).wait();
      await (await token.wrap(signerAddress, 10_000_000n)).wait();

      const feesAfter = await token.accumulatedFees();
      const fee = feesAfter - feesBefore;
      console.log(`      10 USDC wrap fee: ${ethers.formatUnits(fee, 6)} USDC`);
      // 10 * 0.1% = 0.01 USDC = 10000 raw (exactly min fee)
      expect(fee).to.equal(10_000n);
    });

    it("above breakeven (11 USDC → 0.1% = 0.011 USDC > min)", async function () {
      const feesBefore = await token.accumulatedFees();

      await (await usdc.approve(CUSDC, 11_000_000n)).wait();
      await (await token.wrap(signerAddress, 11_000_000n)).wait();

      const feesAfter = await token.accumulatedFees();
      const fee = feesAfter - feesBefore;
      console.log(`      11 USDC wrap fee: ${ethers.formatUnits(fee, 6)} USDC`);
      // 11 * 0.1% = 0.011 USDC = 11000 raw
      expect(fee).to.equal(11_000n);
    });

    it("large amount (500 USDC → 0.1% = 0.50 USDC)", async function () {
      const feesBefore = await token.accumulatedFees();

      await (await usdc.approve(CUSDC, 500_000_000n)).wait();
      await (await token.wrap(signerAddress, 500_000_000n)).wait();

      const feesAfter = await token.accumulatedFees();
      const fee = feesAfter - feesBefore;
      console.log(`      500 USDC wrap fee: ${ethers.formatUnits(fee, 6)} USDC`);
      expect(fee).to.equal(500_000n);
    });
  });

  // ===========================================================================
  // 10. Nonce Edge Cases
  // ===========================================================================

  describe("10. Nonce Edge Cases", function () {
    it("records payment with minimum nonce (all zeros except last byte)", async function () {
      const nonce = "0x" + "00".repeat(31) + "01";
      const tx = await verifier.recordPayment(signerAddress, nonce, 10_000n);
      const receipt = await tx.wait();

      expect(await verifier.usedNonces(nonce)).to.equal(true);
      console.log(`      Min nonce recorded: ${nonce.slice(0, 20)}...`);
      console.log(`      Gas: ${receipt.gasUsed}`);
    });

    it("records payment with maximum nonce (all 0xFF)", async function () {
      const nonce = "0x" + "ff".repeat(32);
      const tx = await verifier.recordPayment(signerAddress, nonce, 10_000n);
      const receipt = await tx.wait();

      expect(await verifier.usedNonces(nonce)).to.equal(true);
      console.log(`      Max nonce recorded: ${nonce.slice(0, 20)}...`);
      console.log(`      Gas: ${receipt.gasUsed}`);
    });

    it("records 10 sequential payments and verifies all nonces", async function () {
      const nonces: string[] = [];
      let totalGas = 0n;

      for (let i = 0; i < 10; i++) {
        const nonce = ethers.hexlify(ethers.randomBytes(32));
        nonces.push(nonce);
        const tx = await verifier.recordPayment(signerAddress, nonce, BigInt(i + 1) * 10_000n);
        const r = await tx.wait();
        totalGas += r.gasUsed;
      }

      // Verify all nonces are marked as used
      for (const n of nonces) {
        expect(await verifier.usedNonces(n)).to.equal(true);
      }

      console.log(`      10 nonces recorded and verified`);
      console.log(`      Total gas: ${totalGas}, avg: ${totalGas / 10n}`);
    });

    it("batch payment with max request count (1000)", async function () {
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const tx = await verifier.recordBatchPayment(signerAddress, nonce, 1000, 1_000n); // 1000 x 0.001 USDC
      const receipt = await tx.wait();

      expect(await verifier.usedNonces(nonce)).to.equal(true);
      console.log(`      Batch: 1000 requests @ 0.001 USDC each`);
      console.log(`      Gas: ${receipt.gasUsed}`);
    });

    it("batch payment with price=1 (minimum per request)", async function () {
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const tx = await verifier.recordBatchPayment(signerAddress, nonce, 5, 1n); // 5 x 0.000001 USDC
      const receipt = await tx.wait();

      expect(await verifier.usedNonces(nonce)).to.equal(true);
      console.log(`      Batch: 5 requests @ 0.000001 USDC each`);
      console.log(`      Gas: ${receipt.gasUsed}`);
    });
  });

  // ===========================================================================
  // 11. Full x402 Payment with Edge Amounts
  // ===========================================================================

  describe("11. Full x402 Payment — Edge Amounts", function () {
    it("x402 payment with minimum amount (0.01 USDC)", async function () {
      const server = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const nonce = ethers.hexlify(ethers.randomBytes(32));

      // TX1: Encrypt and transfer
      const input = fhevmInstance.createEncryptedInput(CUSDC, signerAddress);
      input.add64(10_000n); // 0.01 USDC
      const encrypted = await input.encrypt();

      const tx1 = await token.confidentialTransfer(
        server, encrypted.handles[0], encrypted.inputProof
      );
      const r1 = await tx1.wait();
      expect(r1.status).to.equal(1);

      // TX2: Record nonce
      const tx2 = await verifier.recordPayment(server, nonce, 10_000n);
      const r2 = await tx2.wait();
      expect(r2.status).to.equal(1);

      console.log(`      x402 min payment: 0.01 USDC`);
      console.log(`      Transfer gas: ${r1.gasUsed}, Record gas: ${r2.gasUsed}`);
      console.log(`      Total: ${r1.gasUsed + r2.gasUsed}`);
    });

    it("x402 payment with large amount (100 USDC)", async function () {
      const server = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
      const nonce = ethers.hexlify(ethers.randomBytes(32));

      const input = fhevmInstance.createEncryptedInput(CUSDC, signerAddress);
      input.add64(100_000_000n); // 100 USDC
      const encrypted = await input.encrypt();

      const tx1 = await token.confidentialTransfer(
        server, encrypted.handles[0], encrypted.inputProof
      );
      const r1 = await tx1.wait();
      expect(r1.status).to.equal(1);

      const tx2 = await verifier.recordPayment(server, nonce, 100_000_000n);
      const r2 = await tx2.wait();
      expect(r2.status).to.equal(1);

      console.log(`      x402 large payment: 100 USDC`);
      console.log(`      Transfer gas: ${r1.gasUsed}, Record gas: ${r2.gasUsed}`);
      console.log(`      Total: ${r1.gasUsed + r2.gasUsed}`);
    });
  });

  // ===========================================================================
  // 12. Gas Comparison Report
  // ===========================================================================

  describe("12. Edge Case Gas Report", function () {
    it("compares gas across different transfer amounts", async function () {
      const amounts = [1n, 1_000n, 100_000n, 1_000_000n, 10_000_000n];
      const labels = ["0.000001", "0.001", "0.10", "1.00", "10.00"];
      const gasUsed: bigint[] = [];

      for (let i = 0; i < amounts.length; i++) {
        const input = fhevmInstance.createEncryptedInput(CUSDC, signerAddress);
        input.add64(amounts[i]);
        const encrypted = await input.encrypt();

        const tx = await token.confidentialTransfer(
          "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
          encrypted.handles[0],
          encrypted.inputProof
        );
        const r = await tx.wait();
        gasUsed.push(r.gasUsed);
      }

      console.log(`\n      ┌───────────────────────────┬──────────────┐`);
      console.log(`      │ Transfer Amount (USDC)    │ Gas Used     │`);
      console.log(`      ├───────────────────────────┼──────────────┤`);
      for (let i = 0; i < amounts.length; i++) {
        console.log(`      │ ${labels[i].padEnd(25)} │ ${gasUsed[i].toString().padStart(12)} │`);
      }
      console.log(`      └───────────────────────────┴──────────────┘`);
      console.log(`      Gas is constant regardless of amount (FHE property) ✓`);

      // Verify gas is roughly constant (within 10% variance)
      const avg = gasUsed.reduce((a, b) => a + b) / BigInt(gasUsed.length);
      for (const g of gasUsed) {
        const variance = Number(g > avg ? g - avg : avg - g) / Number(avg);
        expect(variance).to.be.lt(0.1, "Gas variance should be < 10%");
      }
    });
  });
});
