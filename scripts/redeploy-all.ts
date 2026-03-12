/**
 * Redeploy ConfidentialUSDC + X402PaymentVerifier to Sepolia.
 * Reuses existing MockUSDC at 0xc89e913676B034f8b38E49f7508803d1cDEC9F4f.
 *
 * Usage: npx hardhat run scripts/redeploy-all.ts --network sepolia
 */
import { ethers } from "hardhat";

const MOCK_USDC = "0xc89e913676B034f8b38E49f7508803d1cDEC9F4f";

async function main() {
  const [deployer] = await ethers.getSigners();
  const deployerAddress = await deployer.getAddress();
  console.log("Deployer:", deployerAddress);

  const balance = await ethers.provider.getBalance(deployerAddress);
  console.log("ETH Balance:", ethers.formatEther(balance));

  // Deploy ConfidentialUSDC
  console.log("\nDeploying ConfidentialUSDC V4.3...");
  console.log("  underlying:", MOCK_USDC);
  console.log("  treasury:", deployerAddress);

  const Token = await ethers.getContractFactory("ConfidentialUSDC");
  const token = await Token.deploy(MOCK_USDC, deployerAddress);
  await token.waitForDeployment();
  const tokenAddress = await token.getAddress();
  console.log("  ConfidentialUSDC:", tokenAddress);

  // Deploy X402PaymentVerifier
  console.log("\nDeploying X402PaymentVerifier V4.3...");
  console.log("  trustedToken:", tokenAddress);

  const Verifier = await ethers.getContractFactory("X402PaymentVerifier");
  const verifier = await Verifier.deploy(tokenAddress);
  await verifier.waitForDeployment();
  const verifierAddress = await verifier.getAddress();
  console.log("  X402PaymentVerifier:", verifierAddress);

  // Verify
  const trustedToken = await verifier.trustedToken();
  console.log("\n--- Verification ---");
  console.log("trustedToken():", trustedToken);
  console.log("Match:", trustedToken.toLowerCase() === tokenAddress.toLowerCase());

  const underlying = await token.underlying();
  console.log("underlying():", underlying);
  console.log("Match:", underlying.toLowerCase() === MOCK_USDC.toLowerCase());

  console.log("\n--- V4.3 Deployment Summary ---");
  console.log(`MockUSDC:            ${MOCK_USDC}`);
  console.log(`ConfidentialUSDC:    ${tokenAddress}`);
  console.log(`X402PaymentVerifier: ${verifierAddress}`);
  console.log(`Treasury:            ${deployerAddress}`);
}

main().catch(console.error);
