import type { Request, Response, NextFunction, RequestHandler } from "express";
import { Contract, JsonRpcProvider, ethers } from "ethers";
import type {
  FhePaymentRequirements,
  FhePaymentPayload,
  FhePaymentRequired,
  FhePaywallConfig,
  PaymentInfo,
} from "./types.js";
import { FHE_SCHEME } from "./types.js";

// ============================================================================
// Rate limiter
// ============================================================================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore: Map<string, RateLimitEntry> = new Map();
let lastCleanup = Date.now();
const MAX_RATE_LIMIT_ENTRIES = 10_000;

function checkRateLimit(ip: string, maxRequests: number = 60, windowMs: number = 60000): boolean {
  const now = Date.now();
  if (now - lastCleanup > windowMs) {
    for (const [key, entry] of rateLimitStore) {
      if (now > entry.resetAt) rateLimitStore.delete(key);
    }
    lastCleanup = now;
  }
  if (rateLimitStore.size >= MAX_RATE_LIMIT_ENTRIES) {
    const toDelete: string[] = [];
    for (const [key, entry] of rateLimitStore) {
      if (now > entry.resetAt) toDelete.push(key);
    }
    for (const key of toDelete) rateLimitStore.delete(key);
    if (rateLimitStore.size >= MAX_RATE_LIMIT_ENTRIES) return false;
  }
  const entry = rateLimitStore.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitStore.set(ip, { count: 1, resetAt: now + windowMs });
    return true;
  }
  entry.count++;
  return entry.count <= maxRequests;
}

// ============================================================================
// Nonce tracking
// ============================================================================

const usedNonces = new Set<string>();
const MAX_NONCE_ENTRIES = 100_000;

function trackNonce(nonce: string): boolean {
  if (usedNonces.has(nonce)) return false;
  if (usedNonces.size >= MAX_NONCE_ENTRIES) {
    // Evict oldest (set iteration order = insertion order)
    const first = usedNonces.values().next().value;
    if (first) usedNonces.delete(first);
  }
  usedNonces.add(nonce);
  return true;
}

// ============================================================================
// Express global augmentation
// ============================================================================

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      paymentInfo?: PaymentInfo;
    }
  }
}

// ============================================================================
// Middleware
// ============================================================================

const POOL_EVENT_ABI = [
  "event PaymentExecuted(address indexed from, address indexed to, uint64 minPrice, bytes32 nonce)",
];

/**
 * Express middleware that puts an FHE x402 paywall on a route.
 *
 * No Payment header → 402 with requirements.
 * Has Payment header → decode, verify PaymentExecuted event on-chain, call next().
 */
export function fhePaywall(config: FhePaywallConfig): RequestHandler {
  if (!ethers.isAddress(config.poolAddress)) {
    throw new Error(`Invalid pool address: ${config.poolAddress}`);
  }
  if (!ethers.isAddress(config.recipientAddress)) {
    throw new Error(`Invalid recipient address: ${config.recipientAddress}`);
  }

  const network = `eip155:11155111`; // Ethereum Sepolia
  const maxTimeout = config.maxTimeoutSeconds ?? 300;
  const maxRate = config.maxRateLimit ?? 60;
  const rateWindow = config.rateLimitWindowMs ?? 60000;
  const provider = new JsonRpcProvider(config.rpcUrl);

  return async (req: Request, res: Response, next: NextFunction) => {
    // Rate limiting — use socket address to prevent X-Forwarded-For spoofing
    const clientIp = req.socket?.remoteAddress ?? "unknown";
    if (!checkRateLimit(clientIp, maxRate, rateWindow)) {
      res.status(429).json({ error: "Too many requests" });
      return;
    }

    const paymentHeader = req.headers["payment"] as string | undefined;

    // ===== No Payment header → return 402 =====
    if (!paymentHeader) {
      const requestUrl = `${req.protocol}://${req.get("host") ?? "localhost"}${req.originalUrl}`;

      const requirements: FhePaymentRequirements = {
        scheme: FHE_SCHEME,
        network,
        chainId: 11155111,
        price: String(config.price),
        asset: config.asset,
        poolAddress: config.poolAddress,
        recipientAddress: config.recipientAddress,
        maxTimeoutSeconds: maxTimeout,
      };

      const body: FhePaymentRequired = {
        x402Version: 1,
        accepts: [requirements],
        resource: {
          url: requestUrl,
          method: req.method,
        },
      };

      res.status(402).json(body);
      return;
    }

    // ===== Decode Payment header =====
    const MAX_PAYLOAD_SIZE = 100 * 1024;
    if (paymentHeader.length > MAX_PAYLOAD_SIZE) {
      res.status(400).json({ error: "Payment header too large" });
      return;
    }

    let payload: FhePaymentPayload;
    try {
      const json = Buffer.from(paymentHeader, "base64").toString("utf-8");
      payload = JSON.parse(json) as FhePaymentPayload;
    } catch {
      res.status(400).json({ error: "Invalid Payment header encoding" });
      return;
    }

    // Validate structure
    if (payload.scheme !== FHE_SCHEME) {
      res.status(400).json({ error: "Unsupported payment scheme" });
      return;
    }
    if (!payload.txHash || !payload.nonce || !payload.from) {
      res.status(400).json({ error: "Missing required payment fields" });
      return;
    }

    // Nonce replay prevention
    if (!trackNonce(payload.nonce)) {
      res.status(400).json({ error: "Nonce already used" });
      return;
    }

    // ===== Verify on-chain event =====
    try {
      const receipt = await provider.getTransactionReceipt(payload.txHash);
      if (!receipt || receipt.status === 0) {
        res.status(400).json({ error: "Transaction failed or not found" });
        return;
      }

      // Parse PaymentExecuted events from the receipt
      const iface = new ethers.Interface(POOL_EVENT_ABI);
      let verified = false;

      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== config.poolAddress.toLowerCase()) continue;
        try {
          const parsed = iface.parseLog({ topics: log.topics as string[], data: log.data });
          if (
            parsed?.name === "PaymentExecuted" &&
            parsed.args[0].toLowerCase() === payload.from.toLowerCase() &&
            parsed.args[1].toLowerCase() === config.recipientAddress.toLowerCase() &&
            BigInt(parsed.args[2]) <= BigInt(config.price) &&
            parsed.args[3] === payload.nonce
          ) {
            verified = true;
            break;
          }
        } catch {
          continue;
        }
      }

      if (!verified) {
        res.status(400).json({ error: "Payment event not found or mismatched" });
        return;
      }

      // Attach payment info
      req.paymentInfo = {
        from: payload.from,
        amount: String(config.price),
        asset: config.asset,
        recipient: config.recipientAddress,
        txHash: payload.txHash,
        nonce: payload.nonce,
        blockNumber: receipt.blockNumber,
      };

      res.setHeader("X-Payment-TxHash", payload.txHash);
      next();
    } catch (err) {
      console.error("[fhe-x402] Verification failed:", err instanceof Error ? err.message : err);
      res.status(500).json({ error: "Payment verification failed" });
    }
  };
}
