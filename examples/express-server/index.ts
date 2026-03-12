/**
 * Express Server with FHE Paywall Example
 *
 * Creates an Express server with x402 FHE paywall on /api/premium.
 * Agents must pay 0.10 USDC (encrypted) to access.
 *
 * Usage: npx tsx examples/express-server/index.ts
 */
import express from "express";
import { fhePaywall } from "marc-protocol-sdk";

const app = express();
const PORT = 3000;

// Paywall: 0.10 USDC per request
app.use(
  "/api/premium",
  fhePaywall({
    price: "100000", // 0.10 USDC (6 decimals)
    asset: "USDC",
    tokenAddress: "0xE944754aa70d4924dc5d8E57774CDf21Df5e592D",
    verifierAddress: "0x4503A7aee235aBD10e6064BBa8E14235fdF041f4",
    recipientAddress: process.env.RECIPIENT_ADDRESS || "0xYourAddress",
    rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
    chainId: 11155111,
  })
);

// Protected endpoint
app.get("/api/premium", (req, res) => {
  res.json({
    data: "Premium content - you paid with encrypted USDC!",
    paidBy: req.paymentInfo?.from,
    amount: req.paymentInfo?.amount,
    txHash: req.paymentInfo?.txHash,
  });
});

// Free endpoint
app.get("/api/free", (_req, res) => {
  res.json({ data: "This is free content" });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`  Free:    GET /api/free`);
  console.log(`  Premium: GET /api/premium (0.10 USDC, FHE encrypted)`);
});
