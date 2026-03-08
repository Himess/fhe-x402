import type { DeployFunction } from "hardhat-deploy/types";
import type { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  // On testnet, deploy MockUSDC first. On mainnet, use real USDC.
  const isTestnet = hre.network.name === "hardhat" || hre.network.name === "sepolia";

  let usdcAddress: string;

  if (isTestnet) {
    console.log("Deploying MockUSDC...");
    const mockUsdc = await deploy("MockUSDC", {
      from: deployer,
      args: [],
      log: true,
    });
    usdcAddress = mockUsdc.address;
    console.log(`MockUSDC deployed at: ${usdcAddress}`);

    // Mint test USDC to deployer
    const MockUSDC = await hre.ethers.getContractAt("MockUSDC", usdcAddress);
    const mintTx = await MockUSDC.mint(deployer, 1_000_000_000_000n); // 1M USDC (6 decimals)
    await mintTx.wait();
    console.log(`Minted 1,000,000 USDC to deployer: ${deployer}`);
  } else {
    // Mainnet USDC address would go here
    throw new Error("Set mainnet USDC address before deploying to mainnet");
  }

  // Deploy ConfidentialPaymentPool
  console.log("Deploying ConfidentialPaymentPool...");
  const pool = await deploy("ConfidentialPaymentPool", {
    from: deployer,
    args: [usdcAddress, deployer], // treasury = deployer for now
    log: true,
  });
  console.log(`ConfidentialPaymentPool deployed at: ${pool.address}`);

  // Approve pool to spend deployer's USDC
  const MockUSDC = await hre.ethers.getContractAt("MockUSDC", usdcAddress);
  const approveTx = await MockUSDC.approve(pool.address, 1_000_000_000_000n);
  await approveTx.wait();
  console.log("Approved pool to spend deployer's USDC");
};

func.tags = ["ConfidentialPaymentPool"];
export default func;
