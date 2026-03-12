# ERC-7984 Design — Confidential Token Wrapper

## Overview

ERC-7984 (Confidential ERC-20 Wrapper) is the token standard used by MARC Protocol's
ConfidentialUSDC contract. It wraps a standard ERC-20 (USDC) into an FHE-encrypted
token where balances and transfer amounts are encrypted using Zama's fhEVM.

## Architecture

```
┌──────────────┐    wrap()     ┌──────────────────┐
│              │ ──────────▶  │                  │
│  USDC        │              │  ConfidentialUSDC │
│  (ERC-20)    │  ◀────────── │  (ERC-7984)       │
│              │   unwrap()   │                  │
└──────────────┘              └──────────────────┘
    Public                        Encrypted
    Balances                      Balances
```

## Key Operations

### wrap(to, amount)
- Takes plaintext USDC from sender
- Credits encrypted cUSDC to recipient
- Fee: 0.1% (min 0.01 USDC), deducted before encryption
- USDC is held by the contract as backing

### unwrap(from, to, encryptedAmount, inputProof)
- Burns encrypted cUSDC from sender
- Queues a decryption request to Zama's KMS
- Once decrypted, `finalizeUnwrap` releases plaintext USDC
- Fee: 0.1% (min 0.01 USDC) on the decrypted amount

### confidentialTransfer(to, encryptedAmount, inputProof)
- Transfers encrypted cUSDC between addresses
- **Fee-free** — no fee on agent-to-agent transfers
- Uses FHE.select for balance check (see SILENT_FAILURE.md)
- Input proof is bound to (contractAddress, msg.sender)

### setOperator(operator, until) — ERC-7984
- Grants an address permission to transfer on behalf of holder
- Used to authorize the verifier for single-TX flow
- `until` parameter: Unix timestamp expiry (uint48)

## Fee Model

| Operation | Fee | Minimum |
|-----------|-----|---------|
| wrap (USDC → cUSDC) | 0.1% (10 bps) | 0.01 USDC |
| unwrap (cUSDC → USDC) | 0.1% (10 bps) | 0.01 USDC |
| confidentialTransfer | Free | — |

Fees are calculated in plaintext (before encryption for wrap, after decryption for unwrap).
This is intentional — FHE.mul() on encrypted fee percentages would be expensive and
introduce additional silent failure vectors.

Accumulated fees are stored in `accumulatedFees` and can be swept by the treasury.

## Why Not FHE Fee Calculation?

Computing fees on encrypted values would require:
1. `FHE.mul(encryptedAmount, feeRate)` — expensive (~500K gas)
2. `FHE.select(fee < minFee, minFee, fee)` — additional FHE op
3. `FHE.sub(encryptedAmount, calculatedFee)` — net amount

Total: ~1.5M gas for fee calculation alone vs ~0 gas for plaintext math on wrap/unwrap.
Since wrap and unwrap already handle plaintext amounts (USDC in/out), fees are naturally
calculated in plaintext.

## Input Proof Binding

FHE input proofs are cryptographically bound to:
- **Contract address** — the token contract that will use the encrypted value
- **msg.sender** — the address that created the encrypted input

This means:
- Encrypted inputs created for address A cannot be used by address B
- Cross-contract forwarding breaks proof binding (verifier ≠ token)
- This is why MARC uses a 2-TX flow (transfer + recordPayment) instead of single-TX

## Contract Addresses (Sepolia)

| Contract | Address |
|----------|---------|
| MockUSDC | `0xc89e913676B034f8b38E49f7508803d1cDEC9F4f` |
| ConfidentialUSDC | `0xE944754aa70d4924dc5d8E57774CDf21Df5e592D` |
| X402PaymentVerifier | `0x4503A7aee235aBD10e6064BBa8E14235fdF041f4` |

## Further Reading

- [ERC-7984 Draft](https://eips.ethereum.org/EIPS/eip-7984)
- [Zama fhEVM — Encrypted ERC-20](https://docs.zama.ai/fhevm)
- MARC Protocol LIGHTPAPER.md
- docs/SILENT_FAILURE.md — Silent failure pattern explanation
