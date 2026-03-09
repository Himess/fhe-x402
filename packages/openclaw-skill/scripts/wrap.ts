import { getContracts, getTokenAddress, ok, fail, parseAmount, parseCliArgs } from "./_wallet.js";

export async function run(args: Record<string, string>): Promise<string> {
  try {
    const amountStr = args.amount;
    if (!amountStr) {
      return fail("--amount is required");
    }

    let rawAmount: bigint;
    try {
      rawAmount = parseAmount(amountStr);
    } catch {
      return fail("Invalid amount. Must be a positive number.");
    }

    const { token, usdc, signer } = await getContracts();
    const signerAddress = await signer.getAddress();
    const tokenAddress = getTokenAddress();

    // Approve USDC spend to token contract
    const approveTx = await usdc.approve(tokenAddress, rawAmount);
    await approveTx.wait();

    // Wrap USDC -> cUSDC (plaintext, no FHE encryption needed)
    const tx = await token.wrap(signerAddress, rawAmount);
    const receipt = await tx.wait();

    return ok({
      action: "wrap",
      amount: amountStr,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return fail(`Wrap failed: ${msg}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("wrap.ts")) {
  const args = parseCliArgs(process.argv.slice(2));
  run(args).then(console.log);
}
