import { ethers } from "hardhat";
import { fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

/**
 * E2E Demo Script — FHE x402 Payment Protocol
 *
 * Flow:
 * 1. Deploy MockUSDC + ConfidentialPaymentPool
 * 2. Alice deposits USDC → encrypted balance
 * 3. Alice pays Bob (encrypted amount, public minPrice)
 * 4. Query encrypted balances
 * 5. Bob requests withdrawal
 *
 * Run: npx hardhat run scripts/demo.ts
 */
async function main() {
  console.log("═══════════════════════════════════════");
  console.log("  FHE x402 Payment Protocol — Demo");
  console.log("═══════════════════════════════════════\n");

  const signers = await ethers.getSigners();
  const deployer = signers[0];
  const alice = signers[1];
  const bob = signers[2];
  const treasury = signers[3];

  console.log("Deployer:", deployer.address);
  console.log("Alice:", alice.address);
  console.log("Bob:", bob.address);
  console.log("Treasury:", treasury.address);
  console.log();

  // ═══════════════════════════════════════
  // 1. Deploy contracts
  // ═══════════════════════════════════════
  console.log("Step 1: Deploying contracts...");

  const MockUSDC = await ethers.getContractFactory("MockUSDC");
  const usdc = await MockUSDC.deploy();
  await usdc.waitForDeployment();
  const usdcAddress = await usdc.getAddress();
  console.log(`  MockUSDC: ${usdcAddress}`);

  const Pool = await ethers.getContractFactory("ConfidentialPaymentPool");
  const pool = await Pool.deploy(usdcAddress, treasury.address);
  await pool.waitForDeployment();
  const poolAddress = await pool.getAddress();
  console.log(`  Pool: ${poolAddress}\n`);

  // ═══════════════════════════════════════
  // 2. Fund Alice & deposit
  // ═══════════════════════════════════════
  console.log("Step 2: Funding Alice and depositing...");

  await usdc.mint(alice.address, 100_000_000n); // 100 USDC
  await usdc.connect(alice).approve(poolAddress, 100_000_000n);

  await pool.connect(alice).deposit(50_000_000); // 50 USDC
  // Fee: max(50_000_000*10/10_000, 10_000) = max(50_000, 10_000) = 50_000
  // Net: 49_950_000

  const aliceEnc1 = await pool.balanceOf(alice.address);
  const aliceBal1 = await fhevm.userDecryptEuint(FhevmType.euint64, aliceEnc1, poolAddress, alice);
  console.log(`  Alice deposited 50 USDC (fee: 0.05 USDC)`);
  console.log(`  Alice encrypted balance: ${Number(aliceBal1) / 1_000_000} USDC\n`);

  // ═══════════════════════════════════════
  // 3. Alice pays Bob
  // ═══════════════════════════════════════
  console.log("Step 3: Alice pays Bob (5 USDC encrypted)...");

  const nonce = ethers.hexlify(ethers.randomBytes(32));
  const input = fhevm.createEncryptedInput(poolAddress, alice.address);
  input.add64(5_000_000n); // 5 USDC
  const encrypted = await input.encrypt();

  const tx = await pool.connect(alice).pay(
    bob.address,
    encrypted.handles[0],
    encrypted.inputProof,
    5_000_000, // minPrice = 5 USDC
    nonce
  );
  const receipt = await tx.wait();
  console.log(`  TX hash: ${tx.hash}`);
  console.log(`  Nonce: ${nonce}`);

  // Verify PaymentExecuted event
  const payEvent = receipt!.logs.find((log: any) => {
    try {
      const parsed = pool.interface.parseLog({ topics: log.topics, data: log.data });
      return parsed?.name === "PaymentExecuted";
    } catch {
      return false;
    }
  });
  console.log(`  PaymentExecuted event: ${payEvent ? "YES" : "NO"}\n`);

  // ═══════════════════════════════════════
  // 4. Query balances
  // ═══════════════════════════════════════
  console.log("Step 4: Querying encrypted balances...");

  const aliceEnc2 = await pool.balanceOf(alice.address);
  const aliceBal2 = await fhevm.userDecryptEuint(FhevmType.euint64, aliceEnc2, poolAddress, alice);
  console.log(`  Alice: ${Number(aliceBal2) / 1_000_000} USDC`);

  const bobEnc = await pool.balanceOf(bob.address);
  const bobBal = await fhevm.userDecryptEuint(FhevmType.euint64, bobEnc, poolAddress, bob);
  console.log(`  Bob: ${Number(bobBal) / 1_000_000} USDC`);

  const treasuryEnc = await pool.balanceOf(treasury.address);
  const treasuryBal = await fhevm.userDecryptEuint(FhevmType.euint64, treasuryEnc, poolAddress, treasury);
  console.log(`  Treasury: ${Number(treasuryBal) / 1_000_000} USDC\n`);

  // ═══════════════════════════════════════
  // 5. Bob requests withdrawal
  // ═══════════════════════════════════════
  console.log("Step 5: Bob requests withdrawal...");

  const wInput = fhevm.createEncryptedInput(poolAddress, bob.address);
  wInput.add64(bobBal); // Withdraw all
  const wEncrypted = await wInput.encrypt();

  await pool.connect(bob).requestWithdraw(wEncrypted.handles[0], wEncrypted.inputProof);
  console.log(`  Withdraw requested for ${Number(bobBal) / 1_000_000} USDC`);
  console.log(`  (In production: wait for KMS async decryption → finalizeWithdraw)\n`);

  // ═══════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════
  console.log("═══════════════════════════════════════");
  console.log("  Demo Complete!");
  console.log("═══════════════════════════════════════");
  console.log("  Scheme: fhe-confidential-v1");
  console.log("  Encrypted: amounts (FHE euint64)");
  console.log("  Public: participants, minPrice, nonce");
  console.log("  Fee: 0.1% (min 0.01 USDC)");
  console.log("═══════════════════════════════════════");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
