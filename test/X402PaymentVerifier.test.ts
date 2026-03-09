import { expect } from "chai";
import { ethers } from "hardhat";

describe("X402PaymentVerifier", function () {
  let verifier: any;
  let payer: any;
  let server: any;
  let other: any;

  beforeEach(async function () {
    [payer, server, other] = await ethers.getSigners();
    const Verifier = await ethers.getContractFactory("X402PaymentVerifier");
    verifier = await Verifier.deploy();
    await verifier.waitForDeployment();
  });

  it("deploys correctly", async function () {
    const address = await verifier.getAddress();
    expect(address).to.be.properAddress;
  });

  it("recordPayment emits PaymentVerified event", async function () {
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    await expect(verifier.recordPayment(payer.address, server.address, nonce))
      .to.emit(verifier, "PaymentVerified");
  });

  it("recordPayment marks nonce as used", async function () {
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    await verifier.recordPayment(payer.address, server.address, nonce);
    expect(await verifier.usedNonces(nonce)).to.equal(true);
  });

  it("recordPayment reverts on duplicate nonce", async function () {
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    await verifier.recordPayment(payer.address, server.address, nonce);
    await expect(verifier.recordPayment(payer.address, server.address, nonce))
      .to.be.revertedWithCustomError(verifier, "NonceAlreadyUsed");
  });

  it("different nonces work independently", async function () {
    const nonce1 = ethers.hexlify(ethers.randomBytes(32));
    const nonce2 = ethers.hexlify(ethers.randomBytes(32));

    await verifier.recordPayment(payer.address, server.address, nonce1);
    await verifier.recordPayment(payer.address, server.address, nonce2);

    expect(await verifier.usedNonces(nonce1)).to.equal(true);
    expect(await verifier.usedNonces(nonce2)).to.equal(true);
  });

  it("anyone can call recordPayment (permissionless)", async function () {
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    await expect(verifier.connect(other).recordPayment(payer.address, server.address, nonce))
      .to.not.be.reverted;
  });

  it("event contains correct payer, server, nonce", async function () {
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    await expect(verifier.recordPayment(payer.address, server.address, nonce))
      .to.emit(verifier, "PaymentVerified")
      .withArgs(payer.address, server.address, nonce);
  });

  it("usedNonces returns false for unused nonce", async function () {
    const nonce = ethers.hexlify(ethers.randomBytes(32));
    expect(await verifier.usedNonces(nonce)).to.equal(false);
  });

  it("multiple payments from same payer work", async function () {
    const nonce1 = ethers.hexlify(ethers.randomBytes(32));
    const nonce2 = ethers.hexlify(ethers.randomBytes(32));
    const nonce3 = ethers.hexlify(ethers.randomBytes(32));

    await verifier.recordPayment(payer.address, server.address, nonce1);
    await verifier.recordPayment(payer.address, other.address, nonce2);
    await verifier.recordPayment(payer.address, server.address, nonce3);

    expect(await verifier.usedNonces(nonce1)).to.equal(true);
    expect(await verifier.usedNonces(nonce2)).to.equal(true);
    expect(await verifier.usedNonces(nonce3)).to.equal(true);
  });

  it("multiple payments to same server work", async function () {
    const nonce1 = ethers.hexlify(ethers.randomBytes(32));
    const nonce2 = ethers.hexlify(ethers.randomBytes(32));
    const nonce3 = ethers.hexlify(ethers.randomBytes(32));

    await verifier.recordPayment(payer.address, server.address, nonce1);
    await verifier.recordPayment(other.address, server.address, nonce2);
    await verifier.recordPayment(payer.address, server.address, nonce3);

    expect(await verifier.usedNonces(nonce1)).to.equal(true);
    expect(await verifier.usedNonces(nonce2)).to.equal(true);
    expect(await verifier.usedNonces(nonce3)).to.equal(true);
  });
});
