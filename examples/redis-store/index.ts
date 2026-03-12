/**
 * Production Redis Store Example
 *
 * Shows how to use RedisNonceStore and RedisBatchCreditStore
 * for production paywall deployments that survive server restarts.
 *
 * Requires: redis running on localhost:6379
 * Usage: npx tsx examples/redis-store/index.ts
 */
import express from "express";
import { fhePaywall, fheBatchPaywall, RedisNonceStore, RedisBatchCreditStore } from "marc-protocol-sdk";

const app = express();
const PORT = 3001;

// Production-ready Redis stores
const nonceStore = new RedisNonceStore("redis://localhost:6379", {
  prefix: "marc:nonce:",
  ttlSeconds: 86_400, // 24h
});

const batchCreditStore = new RedisBatchCreditStore("redis://localhost:6379", {
  prefix: "marc:batch:",
  ttlSeconds: 604_800, // 7 days
});

const paywallConfig = {
  price: "100000", // 0.10 USDC
  asset: "USDC",
  tokenAddress: "0xE944754aa70d4924dc5d8E57774CDf21Df5e592D",
  verifierAddress: "0x4503A7aee235aBD10e6064BBa8E14235fdF041f4",
  recipientAddress: process.env.RECIPIENT_ADDRESS || "0xYourAddress",
  rpcUrl: "https://ethereum-sepolia-rpc.publicnode.com",
};

// Single-request paywall with Redis nonce store
app.use("/api/single", fhePaywall({ ...paywallConfig, nonceStore }));

app.get("/api/single", (req, res) => {
  res.json({ data: "Single payment content", paidBy: req.paymentInfo?.from });
});

// Batch paywall with Redis batch credit store
app.use("/api/batch", fheBatchPaywall({ ...paywallConfig, nonceStore, batchCreditStore }));

app.get("/api/batch", (req, res) => {
  res.json({ data: "Batch payment content", paidBy: req.paymentInfo?.from });
});

app.listen(PORT, () => {
  console.log(`Production server on http://localhost:${PORT}`);
  console.log(`  Single: GET /api/single (Redis nonce store)`);
  console.log(`  Batch:  GET /api/batch  (Redis batch credits)`);
});
