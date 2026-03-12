import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying ACP with account:", deployer.address);

  const USDC_ADDRESS = "0xc89e913676B034f8b38E49f7508803d1cDEC9F4f"; // MockUSDC on Sepolia

  const ACP = await ethers.getContractFactory("AgenticCommerceProtocol");
  const acp = await ACP.deploy(USDC_ADDRESS, deployer.address);
  await acp.waitForDeployment();

  const address = await acp.getAddress();
  console.log(`\nAgenticCommerceProtocol deployed at: ${address}`);
  console.log(`Payment Token (USDC): ${USDC_ADDRESS}`);
  console.log(`Treasury: ${deployer.address}`);

  // Verify on Etherscan
  console.log("\nVerifying on Etherscan...");
  try {
    await (globalThis as any).hre.run("verify:verify", {
      address,
      constructorArguments: [USDC_ADDRESS, deployer.address],
    });
    console.log("Verified!");
  } catch (e: any) {
    console.log("Verification:", e.message?.includes("Already Verified") ? "Already verified" : e.message);
  }
}

main().catch(console.error);
