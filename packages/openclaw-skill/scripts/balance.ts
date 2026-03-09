import { getContracts, ok, fail, formatUSDC } from "./_wallet.js";

export async function run(): Promise<string> {
  try {
    const { usdc, signer } = await getContracts();
    const address = await signer.getAddress();

    const publicBalance: bigint = await usdc.balanceOf(address);

    return ok({
      action: "balance",
      walletAddress: address,
      publicBalance: publicBalance.toString(),
      publicBalanceUSDC: formatUSDC(publicBalance),
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(`Balance check failed: ${msg}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("balance.ts")) {
  run().then(console.log);
}
