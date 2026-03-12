import { ethers } from "hardhat";
import { fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";

/**
 * E2E Demo Script — FHE x402 Payment Protocol (V4.0 Token-Centric)
 *
 * Flow:
 * 1. Deploy MockUSDC + ConfidentialUSDC + X402PaymentVerifier
 * 2. Mint USDC to Alice, approve, wrap USDC → cUSDC (shows fee)
 * 3. Alice does confidentialTransfer to Bob (encrypted amount, FHE)
 * 4. Record payment on verifier (recordPayment with nonce + minPrice)
 * 5. Query encrypted balances
 * 6. Bob requests unwrap (cUSDC → USDC)
 *
 * Run: npx hardhat run scripts/demo.ts
 */
async function main() {
  console.log("═══════════════════════════════════════");
  console.log("  FHE x402 Payment Protocol — Demo");
  console.log("  V4.0 Token-Centric Architecture");
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
  console.log(`  MockUSDC:            ${usdcAddress}`);

  const ConfidentialUSDC = await ethers.getContractFactory("ConfidentialUSDC");
  const token = await ConfidentialUSDC.deploy(usdcAddress, treasury.address);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log(`  ConfidentialUSDC:    ${tokenAddress}`);

  const Verifier = await ethers.getContractFactory("X402PaymentVerifier");
  const verifier = await Verifier.deploy(tokenAddress);
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();
  console.log(`  X402PaymentVerifier: ${verifierAddress}\n`);

  // ═══════════════════════════════════════
  // 2. Fund Alice, approve, and wrap
  // ═══════════════════════════════════════
  console.log("Step 2: Funding Alice and wrapping USDC → cUSDC...");

  const mintAmount = 100_000_000n; // 100 USDC (6 decimals)
  const wrapAmount = 50_000_000n;  // 50 USDC

  await usdc.mint(alice.address, mintAmount);
  console.log(`  Minted ${Number(mintAmount) / 1_000_000} USDC to Alice`);

  await usdc.connect(alice).approve(tokenAddress, mintAmount);
  console.log(`  Alice approved ConfidentialUSDC to spend USDC`);

  await token.connect(alice).wrap(alice.address, wrapAmount);
  // Fee: max(50_000_000 * 10 / 10_000, 10_000) = max(50_000, 10_000) = 50_000
  // Net cUSDC: 50_000_000 - 50_000 = 49_950_000
  console.log(`  Wrapped 50 USDC (fee: 0.05 USDC → treasury)`);

  const aliceEnc1 = await token.confidentialBalanceOf(alice.address);
  const aliceBal1 = await fhevm.userDecryptEuint(FhevmType.euint64, aliceEnc1, tokenAddress, alice);
  console.log(`  Alice cUSDC balance: ${Number(aliceBal1) / 1_000_000} USDC (encrypted)\n`);

  // ═══════════════════════════════════════
  // 3. Alice → Bob confidentialTransfer
  // ═══════════════════════════════════════
  console.log("Step 3: Alice transfers 5 cUSDC to Bob (encrypted)...");

  const transferAmount = 5_000_000n; // 5 USDC
  const input = fhevm.createEncryptedInput(tokenAddress, alice.address);
  input.add64(transferAmount);
  const encrypted = await input.encrypt();

  const transferTx = await token.connect(alice).confidentialTransfer(
    bob.address,
    encrypted.handles[0],
    encrypted.inputProof
  );
  const transferReceipt = await transferTx.wait();
  console.log(`  TX hash: ${transferTx.hash}`);
  console.log(`  Gas used: ${transferReceipt!.gasUsed.toString()}`);
  console.log(`  Transfer: 5 cUSDC (fee-free, encrypted amount)\n`);

  // ═══════════════════════════════════════
  // 4. Record payment on verifier
  // ═══════════════════════════════════════
  console.log("Step 4: Recording payment nonce on verifier...");

  const nonce = ethers.hexlify(ethers.randomBytes(32));
  const minPrice = 5_000_000n; // 5 USDC

  const recordTx = await verifier.connect(alice).recordPayment(
    bob.address, // server (payment recipient)
    nonce,
    minPrice
  );
  const recordReceipt = await recordTx.wait();
  console.log(`  Nonce: ${nonce}`);
  console.log(`  MinPrice: ${Number(minPrice) / 1_000_000} USDC`);
  console.log(`  TX hash: ${recordTx.hash}`);
  console.log(`  Gas used: ${recordReceipt!.gasUsed.toString()}`);

  const nonceUsed = await verifier.usedNonces(nonce);
  console.log(`  Nonce recorded: ${nonceUsed ? "YES" : "NO"}\n`);

  // ═══════════════════════════════════════
  // 5. Query encrypted balances
  // ═══════════════════════════════════════
  console.log("Step 5: Querying encrypted balances...");

  const aliceEnc2 = await token.confidentialBalanceOf(alice.address);
  const aliceBal2 = await fhevm.userDecryptEuint(FhevmType.euint64, aliceEnc2, tokenAddress, alice);
  console.log(`  Alice:    ${Number(aliceBal2) / 1_000_000} cUSDC`);

  const bobEnc = await token.confidentialBalanceOf(bob.address);
  const bobBal = await fhevm.userDecryptEuint(FhevmType.euint64, bobEnc, tokenAddress, bob);
  console.log(`  Bob:      ${Number(bobBal) / 1_000_000} cUSDC`);

  const treasuryEnc = await token.confidentialBalanceOf(treasury.address);
  const treasuryBal = await fhevm.userDecryptEuint(FhevmType.euint64, treasuryEnc, tokenAddress, treasury);
  console.log(`  Treasury: ${Number(treasuryBal) / 1_000_000} cUSDC (from wrap fee)\n`);

  // ═══════════════════════════════════════
  // 6. Bob requests unwrap
  // ═══════════════════════════════════════
  console.log("Step 6: Bob requests unwrap (cUSDC → USDC)...");

  const wInput = fhevm.createEncryptedInput(tokenAddress, bob.address);
  wInput.add64(bobBal); // Unwrap all
  const wEncrypted = await wInput.encrypt();

  await token.connect(bob).unwrap(
    bob.address,   // from
    bob.address,   // to (receive USDC)
    wEncrypted.handles[0],
    wEncrypted.inputProof
  );
  console.log(`  Unwrap requested for ${Number(bobBal) / 1_000_000} cUSDC`);
  console.log(`  (In production: wait for KMS async decryption → finalizeUnwrap)\n`);

  // ═══════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════
  console.log("═══════════════════════════════════════");
  console.log("  Demo Complete!");
  console.log("═══════════════════════════════════════");
  console.log("  Architecture: V4.0 Token-Centric");
  console.log("  Scheme: fhe-confidential-v1");
  console.log("  Contracts: ConfidentialUSDC + X402PaymentVerifier");
  console.log("  Encrypted: amounts (FHE euint64)");
  console.log("  Public: participants, minPrice, nonce");
  console.log("  Fee: 0.1% (min 0.01 USDC) on wrap/unwrap only");
  console.log("  Transfers: fee-free (confidentialTransfer)");
  console.log("═══════════════════════════════════════");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
