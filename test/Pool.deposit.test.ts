import { expect } from "chai";
import { ethers } from "hardhat";
import { fhevm } from "hardhat";
import { FhevmType } from "@fhevm/hardhat-plugin";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("ConfidentialPaymentPool — Deposit", function () {
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

    // Deploy MockUSDC
    const MockUSDC = await ethers.getContractFactory("MockUSDC");
    usdc = await MockUSDC.deploy();
    await usdc.waitForDeployment();

    // Deploy Pool
    const Pool = await ethers.getContractFactory("ConfidentialPaymentPool");
    pool = await Pool.deploy(await usdc.getAddress(), treasury.address);
    await pool.waitForDeployment();
    poolAddress = await pool.getAddress();

    // Mint USDC to alice
    await usdc.mint(alice.address, 100_000_000n); // 100 USDC
    await usdc.connect(alice).approve(poolAddress, 100_000_000n);
  });

  it("should deposit and credit encrypted balance", async function () {
    await pool.connect(alice).deposit(10_000_000); // 10 USDC

    // Net = 10_000_000 - fee. Fee = max(10_000_000 * 10 / 10_000, 10_000) = max(10_000, 10_000) = 10_000
    // Net = 10_000_000 - 10_000 = 9_990_000
    const encBalance = await pool.balanceOf(alice.address);
    const balance = await fhevm.userDecryptEuint(FhevmType.euint64, encBalance, poolAddress, alice);
    expect(balance).to.equal(9_990_000n);
  });

  it("should revert on zero deposit", async function () {
    await expect(pool.connect(alice).deposit(0)).to.be.revertedWithCustomError(pool, "ZeroAmount");
  });

  it("should emit Deposited event", async function () {
    const tx = await pool.connect(alice).deposit(5_000_000);
    const receipt = await tx.wait();

    const event = receipt.logs.find((log: any) => {
      try {
        const parsed = pool.interface.parseLog({ topics: log.topics, data: log.data });
        return parsed?.name === "Deposited";
      } catch {
        return false;
      }
    });
    expect(event).to.not.be.undefined;
  });

  it("should credit fee to treasury", async function () {
    await pool.connect(alice).deposit(10_000_000); // 10 USDC, fee = 10_000

    const encTreasuryBal = await pool.balanceOf(treasury.address);
    const treasuryBal = await fhevm.userDecryptEuint(FhevmType.euint64, encTreasuryBal, poolAddress, treasury);
    expect(treasuryBal).to.equal(10_000n);
  });

  it("should accumulate balance on multiple deposits", async function () {
    await pool.connect(alice).deposit(5_000_000); // fee=10_000, net=4_990_000
    await pool.connect(alice).deposit(3_000_000); // fee=10_000, net=2_990_000

    const encBalance = await pool.balanceOf(alice.address);
    const balance = await fhevm.userDecryptEuint(FhevmType.euint64, encBalance, poolAddress, alice);
    expect(balance).to.equal(7_980_000n);
  });

  it("should mark user as initialized after deposit", async function () {
    expect(await pool.isInitialized(alice.address)).to.equal(false);
    await pool.connect(alice).deposit(1_000_000);
    expect(await pool.isInitialized(alice.address)).to.equal(true);
  });

  it("should transfer USDC from user to pool", async function () {
    const balBefore = await usdc.balanceOf(alice.address);
    await pool.connect(alice).deposit(5_000_000);
    const balAfter = await usdc.balanceOf(alice.address);
    expect(balBefore - balAfter).to.equal(5_000_000n);
  });

  it("should apply minimum fee for small deposits", async function () {
    // Deposit 100_000 (0.1 USDC)
    // Fee = max(100_000 * 10 / 10_000, 10_000) = max(100, 10_000) = 10_000
    // Net = 100_000 - 10_000 = 90_000
    await pool.connect(alice).deposit(100_000);

    const encBalance = await pool.balanceOf(alice.address);
    const balance = await fhevm.userDecryptEuint(FhevmType.euint64, encBalance, poolAddress, alice);
    expect(balance).to.equal(90_000n);
  });

  it("should apply percentage fee for large deposits", async function () {
    // Deposit 50_000_000 (50 USDC)
    // Fee = max(50_000_000 * 10 / 10_000, 10_000) = max(50_000, 10_000) = 50_000
    // Net = 50_000_000 - 50_000 = 49_950_000
    await pool.connect(alice).deposit(50_000_000);

    const encBalance = await pool.balanceOf(alice.address);
    const balance = await fhevm.userDecryptEuint(FhevmType.euint64, encBalance, poolAddress, alice);
    expect(balance).to.equal(49_950_000n);
  });

  it("should revert when USDC allowance is insufficient", async function () {
    // Reset allowance to 0
    await usdc.connect(alice).approve(poolAddress, 0);

    await expect(pool.connect(alice).deposit(1_000_000)).to.be.reverted;
  });

  it("should revert when USDC balance is insufficient", async function () {
    const bob = (await ethers.getSigners())[3];
    await usdc.connect(bob).approve(poolAddress, 1_000_000_000n);
    // Bob has 0 USDC
    await expect(pool.connect(bob).deposit(1_000_000)).to.be.reverted;
  });
});
