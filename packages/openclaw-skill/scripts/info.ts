import { getContracts, getTokenAddress, getVerifierAddress, ok, fail } from "./_wallet.js";

export async function run(): Promise<string> {
  try {
    const { signer, provider } = await getContracts();
    const address = await signer.getAddress();
    const ethBalance = await provider.getBalance(address);

    return ok({
      action: "info",
      network: "Ethereum Sepolia",
      tokenAddress: getTokenAddress(),
      verifierAddress: getVerifierAddress(),
      walletAddress: address,
      ethBalance: ethBalance.toString(),
      scheme: "fhe-confidential-v1",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(`Info failed: ${msg}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("info.ts")) {
  run().then(console.log);
}
