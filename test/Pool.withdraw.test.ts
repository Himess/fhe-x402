import { expect } from "chai";
import { ethers } from "hardhat";
import { fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("ConfidentialPaymentPool — Withdraw", function () {
  let pool: any;
  let usdc: any;
  let deployer: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let treasury: HardhatEthersSigner;
  let poolAddress: string;

  beforeEach(async function () {
    const signers = await ethers.getSigners();
    deployer = signers[0];
    alice = signers[1];
    treasury = signers[2];

    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();

    const Pool = await ethers.getContractFactory("ConfidentialPaymentPool");
    pool = await Pool.deploy(await usdc.getAddress(), treasury.address);
    await pool.waitForDeployment();
    poolAddress = await pool.getAddress();

    // Fund alice
    await usdc.mint(alice.address, 100_000_000n);
    await usdc.connect(alice).approve(poolAddress, 100_000_000n);
    await pool.connect(alice).deposit(20_000_000); // fee=20_000, net=19_980_000
  });

  it("should request withdraw successfully", async function () {
    const input = fhevm.createEncryptedInput(poolAddress, alice.address);
    input.add64(5_000_000n);
    const encrypted = await input.encrypt();

    await pool.connect(alice).requestWithdraw(encrypted.handles[0], encrypted.inputProof);
    expect(await pool.withdrawRequested(alice.address)).to.equal(true);
  });

  it("should emit WithdrawRequested event", async function () {
    const input = fhevm.createEncryptedInput(poolAddress, alice.address);
    input.add64(5_000_000n);
    const encrypted = await input.encrypt();

    const tx = await pool.connect(alice).requestWithdraw(encrypted.handles[0], encrypted.inputProof);
    const receipt = await tx.wait();

    const event = receipt.logs.find((log: any) => {
      try {
        const parsed = pool.interface.parseLog({ topics: log.topics, data: log.data });
        return parsed?.name === "WithdrawRequested";
      } catch {
        return false;
      }
    });
    expect(event).to.not.be.undefined;
  });

  it("should revert on double withdraw request", async function () {
    const input1 = fhevm.createEncryptedInput(poolAddress, alice.address);
    input1.add64(1_000_000n);
    const enc1 = await input1.encrypt();
    await pool.connect(alice).requestWithdraw(enc1.handles[0], enc1.inputProof);

    const input2 = fhevm.createEncryptedInput(poolAddress, alice.address);
    input2.add64(1_000_000n);
    const enc2 = await input2.encrypt();

    await expect(
      pool.connect(alice).requestWithdraw(enc2.handles[0], enc2.inputProof)
    ).to.be.revertedWithCustomError(pool, "WithdrawAlreadyRequested");
  });

  it("should deduct balance on withdraw request", async function () {
    const balBefore = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await pool.balanceOf(alice.address),
      poolAddress,
      alice
    );

    const input = fhevm.createEncryptedInput(poolAddress, alice.address);
    input.add64(5_000_000n);
    const encrypted = await input.encrypt();
    await pool.connect(alice).requestWithdraw(encrypted.handles[0], encrypted.inputProof);

    const balAfter = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await pool.balanceOf(alice.address),
      poolAddress,
      alice
    );
    expect(balBefore - balAfter).to.equal(5_000_000n);
  });

  it("should store pending withdraw amount", async function () {
    const input = fhevm.createEncryptedInput(poolAddress, alice.address);
    input.add64(3_000_000n);
    const encrypted = await input.encrypt();
    await pool.connect(alice).requestWithdraw(encrypted.handles[0], encrypted.inputProof);

    // The pending withdraw handle should exist
    const pendingHandle = await pool.pendingWithdrawOf(alice.address);
    // It's a handle, not zero
    expect(pendingHandle).to.not.equal(0n);
  });

  it("should revert finalizeWithdraw without request", async function () {
    await expect(
      pool.connect(alice).finalizeWithdraw(1_000_000, "0x")
    ).to.be.revertedWithCustomError(pool, "WithdrawNotRequested");
  });

  it("should silently cap withdraw to 0 on insufficient balance", async function () {
    // Alice has ~19_990_000 net (20M deposit - 10_000 fee)
    const input = fhevm.createEncryptedInput(poolAddress, alice.address);
    input.add64(50_000_000n); // More than balance
    const encrypted = await input.encrypt();

    await pool.connect(alice).requestWithdraw(encrypted.handles[0], encrypted.inputProof);

    // Balance should be unchanged (withdrew 0 due to insufficient funds)
    const balAfter = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      await pool.balanceOf(alice.address),
      poolAddress,
      alice
    );
    expect(balAfter).to.equal(19_980_000n);
  });

  it("should handle user with no balance requesting withdraw", async function () {
    const bob = (await ethers.getSigners())[3];
    const input = fhevm.createEncryptedInput(poolAddress, bob.address);
    input.add64(1_000_000n);
    const encrypted = await input.encrypt();

    // Should not revert — silent failure (caps to 0)
    await pool.connect(bob).requestWithdraw(encrypted.handles[0], encrypted.inputProof);
    expect(await pool.withdrawRequested(bob.address)).to.equal(true);
  });
});
