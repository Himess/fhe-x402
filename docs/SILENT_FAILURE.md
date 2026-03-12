# FHE Silent Failure Pattern

## What Is It?

In Zama's fhEVM, operations on encrypted values cannot revert on insufficient balance.
When a `confidentialTransfer` is called with an encrypted amount exceeding the sender's
encrypted balance, the FHE VM executes `FHE.select()` — transferring **0** instead of
reverting. The transaction succeeds on-chain but no tokens actually move.

This is fundamentally different from standard ERC-20 where `transfer()` reverts on
insufficient balance.

## Why Does It Happen?

FHE computations cannot branch on encrypted values without decrypting them. The fhEVM
uses `FHE.select(condition, valueIfTrue, valueIfFalse)` which always executes both paths
and selects the result — no revert is possible because the contract never learns the
plaintext balance.

## Impact on x402

For x402 payments, silent failure means:
- A server receives a valid `txHash` and `ConfidentialTransfer` event
- The event logs show a transfer happened
- But the actual encrypted amount transferred may be 0
- The server delivers content thinking it was paid, but received nothing

## MARC Protocol Mitigation

### 1. Silent Failure Guard (SDK)

The `silentFailureGuard` in `marc-protocol-sdk` uses a balance-handle heuristic:

```typescript
import { silentFailureGuard } from "marc-protocol-sdk";

const result = await silentFailureGuard({
  tokenAddress,
  senderAddress,
  provider,
  txHash,
  blockNumber,
});

if (!result.likelySuccessful) {
  console.warn("Transfer may have silently failed:", result.reason);
}
```

**How it works:**
- Reads `confidentialBalanceOf(sender)` before and after the transfer block
- If the encrypted handle is unchanged, the balance didn't change → likely silent failure
- This is a heuristic (handles can collide), not cryptographic proof

### 2. MinPrice Parameter

The `recordPayment(server, nonce, minPrice)` call on the verifier records the
expected minimum price. While this doesn't prevent silent failure at the token level,
it creates an on-chain record of the expected payment amount for dispute resolution.

### 3. Batch Credit Pre-verification

For batch payments, the initial batch registration verifies on-chain events.
Subsequent requests consume pre-verified credits without re-checking, reducing
exposure to silent failure on follow-up requests.

## Recommendations

1. **Always use `silentFailureGuard`** in production middleware
2. **Set reasonable `maxPayment`** on the client to avoid accidental overspend
3. **Monitor balance handles** — unchanged handles after transfer = red flag
4. **Use batch payments** for repeated access — one verification, many requests
5. **Wait for Zama's decryption callbacks** (future) for cryptographic verification

## Further Reading

- [Zama fhEVM docs — Encrypted operations](https://docs.zama.ai/fhevm)
- MARC Protocol LIGHTPAPER.md — Section on privacy trade-offs
- SDK source: `sdk/src/silentFailureGuard.ts`
