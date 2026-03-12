import { ethers } from "hardhat";

async function main() {
  const [deployer] = await ethers.getSigners();
  console.log("Deploying ERC-8004 registries with account:", deployer.address);

  // Deploy Identity Registry
  const Identity = await ethers.getContractFactory("AgentIdentityRegistry");
  const identity = await Identity.deploy();
  await identity.waitForDeployment();
  const identityAddr = await identity.getAddress();
  console.log(`\nAgentIdentityRegistry deployed at: ${identityAddr}`);

  // Deploy Reputation Registry
  const Reputation = await ethers.getContractFactory("AgentReputationRegistry");
  const reputation = await Reputation.deploy();
  await reputation.waitForDeployment();
  const reputationAddr = await reputation.getAddress();
  console.log(`AgentReputationRegistry deployed at: ${reputationAddr}`);

  // Verify on Etherscan
  console.log("\nVerifying on Etherscan...");
  for (const { addr, name } of [
    { addr: identityAddr, name: "AgentIdentityRegistry" },
    { addr: reputationAddr, name: "AgentReputationRegistry" },
  ]) {
    try {
      await (globalThis as any).hre.run("verify:verify", {
        address: addr,
        constructorArguments: [],
      });
      console.log(`${name}: Verified!`);
    } catch (e: any) {
      console.log(`${name}:`, e.message?.includes("Already Verified") ? "Already verified" : e.message);
    }
  }
}

main().catch(console.error);
