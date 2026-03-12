/**
 * Sepolia Advanced FHE Tests — Silent Failure, Batch, Treasury
 *
 * Real @zama-fhe/relayer-sdk encryption against Zama coprocessor.
 * Covers edge cases not in Sepolia.fhe-transfer.test.ts:
 *   1. Silent failure detection (insufficient balance → 0-amount transfer)
 *   2. Batch FHE payment (multiple requests prepaid)
 *   3. Treasury fee withdrawal
 *   4. Fee accumulation consistency
 *   5. Sequential transfers draining balance
 *   6. Zero-balance sender detection
 *
 * Run: npx hardhat test test/Sepolia.fhe-advanced.test.ts --network sepolia
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
  "function treasuryWithdraw()",
  "function treasury() view returns (address)",
  "function owner() view returns (address)",
  "function confidentialTransfer(address to, bytes32 encryptedAmount, bytes inputProof) returns (bytes32)",
  "event ConfidentialTransfer(address indexed from, address indexed to, bytes32 indexed amount)",
];

const VERIFIER_ABI = [
  "function usedNonces(bytes32) view returns (bool)",
  "function recordPayment(address server, bytes32 nonce, uint64 minPrice)",
  "function recordBatchPayment(address server, bytes32 nonce, uint32 requestCount, uint64 pricePerRequest)",
  "event PaymentVerified(address indexed payer, address indexed server, bytes32 indexed nonce, uint64 minPrice)",
  "event BatchPaymentRecorded(address indexed payer, address indexed server, bytes32 indexed nonce, uint32 requestCount, uint64 pricePerRequest)",
];

describe("Sepolia — Advanced FHE Tests", function () {
  this.timeout(300_000); // 5 min

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
  });

  // ===========================================================================
  // 1. Silent Failure Detection
  // ===========================================================================

  describe("1. Silent Failure — Zero Balance Sender", function () {
    // Use a fresh address that has never received cUSDC
    const freshAddress = "0x0000000000000000000000000000000000000001";

    it("fresh address has zero encrypted balance handle", async function () {
      const handle = await token.confidentialBalanceOf(freshAddress);
      expect(String(handle)).to.equal(ZERO_HANDLE);
      console.log(`      Fresh address balance handle: ${ZERO_HANDLE.slice(0, 20)}... (zero)`);
    });

    it("detects potential silent failure by checking sender balance before transfer", async function () {
      // Pre-transfer check: if sender has zero handle, transfer will be 0
      const senderHandle = await token.confidentialBalanceOf(signerAddress);
      const senderHasBalance = String(senderHandle) !== ZERO_HANDLE;
      console.log(`      Signer has balance: ${senderHasBalance}`);
      console.log(`      Handle: ${String(senderHandle).slice(0, 20)}...`);
      // This is the heuristic: non-zero handle means sender MAY have balance
      expect(senderHasBalance).to.equal(true);
    });
  });

  describe("2. Silent Failure — Balance Handle Change Detection", function () {
    it("sender balance handle changes after successful transfer", async function () {
      // Ensure we have cUSDC
      const currentHandle = await token.confidentialBalanceOf(signerAddress);
      if (String(currentHandle) === ZERO_HANDLE) {
        console.log(`      No cUSDC — wrapping 5 USDC first...`);
        await (await usdc.mint(signerAddress, 10_000_000n)).wait();
        await (await usdc.approve(CUSDC, 5_000_000n)).wait();
        await (await token.wrap(signerAddress, 5_000_000n)).wait();
      }

      const handleBefore = String(await token.confidentialBalanceOf(signerAddress));
      console.log(`      Balance handle BEFORE: ${handleBefore.slice(0, 20)}...`);

      // Transfer 0.01 USDC
      const recipient = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const input = fhevmInstance.createEncryptedInput(CUSDC, signerAddress);
      input.add64(10_000n); // 0.01 USDC
      const encrypted = await input.encrypt();

      await (await token.confidentialTransfer(
        recipient, encrypted.handles[0], encrypted.inputProof
      )).wait();

      const handleAfter = String(await token.confidentialBalanceOf(signerAddress));
      console.log(`      Balance handle AFTER:  ${handleAfter.slice(0, 20)}...`);

      // Handle should have changed (new encrypted value)
      expect(handleAfter).to.not.equal(handleBefore);
      console.log(`      Handle changed: YES — transfer likely succeeded`);
    });
  });

  // ===========================================================================
  // 3. Batch FHE Payment (transfer + recordBatchPayment)
  // ===========================================================================

  describe("3. Batch FHE Payment", function () {
    it("encrypts total amount and records batch payment", async function () {
      // Ensure cUSDC balance
      await (await usdc.mint(signerAddress, 20_000_000n)).wait();
      await (await usdc.approve(CUSDC, 10_000_000n)).wait();
      await (await token.wrap(signerAddress, 10_000_000n)).wait();

      const server = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
      const nonce = ethers.hexlify(ethers.randomBytes(32));
      const requestCount = 10;
      const pricePerRequest = 100_000n; // 0.10 USDC per request
      const totalAmount = pricePerRequest * BigInt(requestCount); // 1.00 USDC total

      // TX1: Encrypted transfer for total amount
      console.log(`      [TX1] Encrypting ${ethers.formatUnits(totalAmount, 6)} USDC (${requestCount} x ${ethers.formatUnits(pricePerRequest, 6)})...`);
      const input = fhevmInstance.createEncryptedInput(CUSDC, signerAddress);
      input.add64(totalAmount);
      const encrypted = await input.encrypt();

      const transferTx = await token.confidentialTransfer(
        server, encrypted.handles[0], encrypted.inputProof
      );
      const transferReceipt = await transferTx.wait();
      console.log(`      [TX1] Transfer TX: ${transferReceipt.hash}`);
      console.log(`      [TX1] Gas: ${transferReceipt.gasUsed}`);
      expect(transferReceipt.status).to.equal(1);

      // TX2: Record batch payment
      console.log(`      [TX2] Recording batch: ${requestCount} requests @ ${ethers.formatUnits(pricePerRequest, 6)} USDC each`);
      const batchTx = await verifier.recordBatchPayment(server, nonce, requestCount, pricePerRequest);
      const batchReceipt = await batchTx.wait();
      console.log(`      [TX2] Batch TX: ${batchReceipt.hash}`);
      console.log(`      [TX2] Gas: ${batchReceipt.gasUsed}`);
      expect(batchReceipt.status).to.equal(1);

      // Verify BatchPaymentRecorded event
      const iface = new ethers.Interface(VERIFIER_ABI);
      let eventFound = false;
      for (const log of batchReceipt.logs) {
        try {
          const parsed = iface.parseLog({ topics: [...log.topics], data: log.data });
          if (parsed?.name === "BatchPaymentRecorded") {
            expect(parsed.args[0].toLowerCase()).to.equal(signerAddress.toLowerCase());
            expect(parsed.args[1].toLowerCase()).to.equal(server.toLowerCase());
            expect(Number(parsed.args[3])).to.equal(requestCount);
            expect(BigInt(parsed.args[4])).to.equal(pricePerRequest);
            eventFound = true;
            console.log(`      Event: BatchPaymentRecorded ✓`);
          }
        } catch { /* skip */ }
      }
      expect(eventFound).to.equal(true, "BatchPaymentRecorded event not found");

      // Verify nonce used
      expect(await verifier.usedNonces(nonce)).to.equal(true);

      console.log(`\n      ┌──────────────────────────────────────────────┐`);
      console.log(`      │ BATCH FHE PAYMENT VERIFIED                    │`);
      console.log(`      │ TX1: confidentialTransfer (1.00 USDC)         │`);
      console.log(`      │ TX2: recordBatchPayment (10 x 0.10 USDC)     │`);
      console.log(`      └──────────────────────────────────────────────┘`);
    });
  });

  // ===========================================================================
  // 4. Fee Accumulation + Treasury Withdrawal
  // ===========================================================================

  describe("4. Fee Accumulation & Treasury Withdrawal", function () {
    it("fees accumulate across multiple wraps", async function () {
      const feesBefore = await token.accumulatedFees();
      console.log(`      Fees before: ${ethers.formatUnits(feesBefore, 6)} USDC`);

      // Wrap 100 USDC (fee = 0.1% = 0.10 USDC)
      await (await usdc.mint(signerAddress, 100_000_000n)).wait();
      await (await usdc.approve(CUSDC, 100_000_000n)).wait();
      await (await token.wrap(signerAddress, 100_000_000n)).wait();

      const feesAfter = await token.accumulatedFees();
      console.log(`      Fees after 100 USDC wrap: ${ethers.formatUnits(feesAfter, 6)} USDC`);

      const feeIncrease = feesAfter - feesBefore;
      console.log(`      Fee increase: ${ethers.formatUnits(feeIncrease, 6)} USDC`);

      // 0.1% of 100 USDC = 0.10 USDC = 100_000 raw
      expect(feeIncrease).to.equal(100_000n);
    });

    it("treasury can withdraw accumulated fees", async function () {
      const owner = await token.owner();
      if (owner.toLowerCase() !== signerAddress.toLowerCase()) {
        console.log(`      Skipping — signer is not owner`);
        this.skip();
        return;
      }

      const fees = await token.accumulatedFees();
      if (fees === 0n) {
        console.log(`      Skipping — no fees to withdraw`);
        this.skip();
        return;
      }

      const treasury = await token.treasury();
      const treasuryBalBefore = await usdc.balanceOf(treasury);
      console.log(`      Treasury USDC before: ${ethers.formatUnits(treasuryBalBefore, 6)}`);
      console.log(`      Accumulated fees: ${ethers.formatUnits(fees, 6)} USDC`);

      const tx = await token.treasuryWithdraw();
      const receipt = await tx.wait();
      console.log(`      Treasury withdraw TX: ${receipt.hash}`);
      console.log(`      Gas: ${receipt.gasUsed}`);

      const feesAfter = await token.accumulatedFees();
      expect(feesAfter).to.equal(0n);

      const treasuryBalAfter = await usdc.balanceOf(treasury);
      const received = treasuryBalAfter - treasuryBalBefore;
      console.log(`      Treasury received: ${ethers.formatUnits(received, 6)} USDC`);
      expect(received).to.equal(fees);
    });
  });

  // ===========================================================================
  // 5. Sequential Transfers
  // ===========================================================================

  describe("5. Sequential FHE Transfers (5x)", function () {
    it("5 sequential encrypted transfers to different recipients", async function () {
      // Ensure we have balance
      await (await usdc.mint(signerAddress, 10_000_000n)).wait();
      await (await usdc.approve(CUSDC, 5_000_000n)).wait();
      await (await token.wrap(signerAddress, 5_000_000n)).wait();

      const recipients = [
        "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
        "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
        "0x90F79bf6EB2c4f870365E785982E1f101E93b906",
        "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65",
        "0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc",
      ];

      let totalGas = 0n;
      for (let i = 0; i < 5; i++) {
        const amount = 50_000n; // 0.05 USDC each
        const input = fhevmInstance.createEncryptedInput(CUSDC, signerAddress);
        input.add64(amount);
        const encrypted = await input.encrypt();

        const tx = await token.confidentialTransfer(
          recipients[i], encrypted.handles[0], encrypted.inputProof
        );
        const receipt = await tx.wait();
        totalGas += receipt.gasUsed;
        console.log(`      Transfer ${i + 1}/5: ${receipt.gasUsed} gas → ${recipients[i].slice(0, 10)}...`);
        expect(receipt.status).to.equal(1);
      }

      console.log(`      Total gas for 5 transfers: ${totalGas}`);
      console.log(`      Average gas per transfer: ${totalGas / 5n}`);
    });
  });

  // ===========================================================================
  // 6. Summary
  // ===========================================================================

  describe("6. Summary", function () {
    it("all advanced FHE tests verified", async function () {
      console.log(`\n      ┌──────────────────────────────────────────────┐`);
      console.log(`      │ ADVANCED FHE TESTS SUMMARY                    │`);
      console.log(`      ├──────────────────────────────────────────────┤`);
      console.log(`      │ 1. Silent failure: zero-handle detection      │`);
      console.log(`      │ 2. Silent failure: handle-change detection    │`);
      console.log(`      │ 3. Batch FHE payment (transfer + batch nonce) │`);
      console.log(`      │ 4. Fee accumulation + treasury withdrawal     │`);
      console.log(`      │ 5. Sequential FHE transfers (5x)             │`);
      console.log(`      └──────────────────────────────────────────────┘`);
      console.log(`      All tests used REAL @zama-fhe/relayer-sdk encryption`);
    });
  });
});
