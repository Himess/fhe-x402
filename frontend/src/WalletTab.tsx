import React, { useState, useEffect, useCallback } from "react";
import { Contract, JsonRpcSigner } from "ethers";
import { ADDRESSES, TOKEN_ABI, USDC_ABI, parseUSDCAmount, formatUSDC, ZERO_HANDLE, etherscanTx } from "./config";
import { C, card, cardTitle, inputStyle, hint, btnSuccess, btnDanger, btnOutline, row, labelStyle, valueStyle, link, FONT_MONO } from "./theme";

interface TxRecord { action: string; txHash: string; amount?: string; timestamp: number; }

interface Props {
  signer: JsonRpcSigner;
  address: string;
  onStatus: (msg: string, type: "info" | "error" | "success") => void;
  onTx: (action: string, txHash: string, amount?: string) => void;
  fhevm: any;
  txHistory: TxRecord[];
}

export default function WalletTab({ signer, address, onStatus, onTx, fhevm, txHistory }: Props) {
  const [usdcBalance, setUsdcBalance] = useState("...");
  const [encBalance, setEncBalance] = useState("...");
  const [encHandle, setEncHandle] = useState("");
  const [fees, setFees] = useState("...");
  const [paused, setPaused] = useState(false);
  const [wrapAmount, setWrapAmount] = useState("");
  const [unwrapAmount, setUnwrapAmount] = useState("");
  const [loading, setLoading] = useState(false);

  const token = new Contract(ADDRESSES.TOKEN, TOKEN_ABI, signer);
  const usdc = new Contract(ADDRESSES.USDC, USDC_ABI, signer);

  const refresh = useCallback(async () => {
    try {
      const [bal, handle, accFees, isPaused] = await Promise.all([
        usdc.balanceOf(address),
        token.confidentialBalanceOf(address),
        token.accumulatedFees(),
        token.paused(),
      ]);
      setUsdcBalance(formatUSDC(bal));
      const isZero = handle === ZERO_HANDLE || handle === "0x";
      setEncBalance(isZero ? "Empty" : "Active");
      setEncHandle(isZero ? "" : handle);
      setFees(formatUSDC(accFees));
      setPaused(isPaused);
    } catch (e: any) {
      console.error("Balance refresh:", e);
    }
  }, [address, signer]);

  useEffect(() => { refresh(); }, [refresh]);

  const walletTxs = txHistory.filter((tx) => ["Wrap", "Unwrap"].includes(tx.action));

  const onWrap = async () => {
    if (!wrapAmount || loading) return;
    setLoading(true);
    try {
      const raw = parseUSDCAmount(wrapAmount);
      if (raw < 20_000n) { onStatus("Min wrap: 0.02 USDC (0.01 fee + 0.01 min)", "error"); setLoading(false); return; }
      onStatus("Approving USDC...", "info");
      await (await usdc.approve(ADDRESSES.TOKEN, raw)).wait();
      onStatus("Wrapping USDC → cUSDC (encrypting on-chain)...", "info");
      const receipt = await (await token.wrap(address, raw)).wait();
      onStatus(`Wrapped ${wrapAmount} USDC → cUSDC`, "success");
      onTx("Wrap", receipt.hash, wrapAmount);
      setWrapAmount("");
      await refresh();
    } catch (e: any) { onStatus(e.reason || e.message || "Wrap failed", "error"); }
    setLoading(false);
  };

  const onUnwrap = async () => {
    if (!unwrapAmount || loading || !fhevm) return;
    setLoading(true);
    try {
      const raw = parseUSDCAmount(unwrapAmount);
      onStatus("Encrypting unwrap amount...", "info");
      const input = fhevm.createEncryptedInput(ADDRESSES.TOKEN, address);
      input.add64(raw);
      const encrypted = await input.encrypt();
      onStatus("Submitting unwrap request...", "info");
      const receipt = await (await token.unwrap(address, address, encrypted.handles[0], encrypted.inputProof)).wait();
      onStatus(`Unwrap requested: ${unwrapAmount} cUSDC. Awaiting KMS finalization.`, "success");
      onTx("Unwrap", receipt.hash, unwrapAmount);
      setUnwrapAmount("");
      await refresh();
    } catch (e: any) { onStatus(e.reason || e.message || "Unwrap failed", "error"); }
    setLoading(false);
  };

  return (
    <div>
      {/* Balances */}
      <div style={card}>
        <div style={cardTitle}>Balances</div>
        <div style={row}>
          <span style={labelStyle}>USDC (Public)</span>
          <span style={{ ...valueStyle, color: "#fff", fontSize: 16, fontWeight: 600 }}>${usdcBalance}</span>
        </div>
        <div style={row}>
          <span style={labelStyle}>cUSDC (Encrypted)</span>
          <span style={{ ...valueStyle, color: encBalance === "Active" ? C.success : C.textMuted }}>
            {encBalance === "Active" ? "Active" : "Empty"}
          </span>
        </div>
        {encHandle && (
          <div style={{ padding: "6px 0", fontSize: 10, fontFamily: FONT_MONO, color: C.textMuted, wordBreak: "break-all" as const }}>
            Handle: {encHandle.slice(0, 22)}...
          </div>
        )}
        <div style={row}>
          <span style={labelStyle}>Protocol Fees</span>
          <span style={valueStyle}>${fees}</span>
        </div>
        <div style={{ ...row, borderBottom: "none" }}>
          <span style={labelStyle}>Contract Paused</span>
          <span style={{ ...valueStyle, color: paused ? C.danger : C.success }}>{paused ? "Yes" : "No"}</span>
        </div>
        <button onClick={refresh} style={{ ...btnOutline, marginTop: 12 }}>Refresh Balances</button>
      </div>

      {/* Wrap */}
      <div style={card}>
        <div style={cardTitle}>Wrap USDC → cUSDC</div>
        <p style={hint}>Converts public USDC to FHE-encrypted cUSDC. Fee: 0.1% (min 0.01 USDC).</p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text" placeholder="Amount (e.g. 10.00)" value={wrapAmount}
            onChange={(e) => setWrapAmount(e.target.value)} style={inputStyle} disabled={loading}
          />
          <button onClick={onWrap} disabled={loading || !wrapAmount} style={{ ...btnSuccess, whiteSpace: "nowrap" as const }}>
            {loading ? "..." : "Wrap"}
          </button>
        </div>
      </div>

      {/* Unwrap */}
      <div style={card}>
        <div style={cardTitle}>Unwrap cUSDC → USDC</div>
        <p style={hint}>Decrypts cUSDC back to public USDC. Requires async KMS finalization.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text" placeholder="Amount (e.g. 5.00)" value={unwrapAmount}
            onChange={(e) => setUnwrapAmount(e.target.value)} style={inputStyle} disabled={loading}
          />
          <button onClick={onUnwrap} disabled={loading || !unwrapAmount || !fhevm} style={{ ...btnDanger, whiteSpace: "nowrap" as const }}>
            {loading ? "..." : "Unwrap"}
          </button>
        </div>
      </div>

      {/* Wallet Activity */}
      {walletTxs.length > 0 && (
        <div style={card}>
          <div style={cardTitle}>Wallet Activity</div>
          {walletTxs.map((tx, i) => (
            <div key={i} style={activityRow}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{
                  width: 28, height: 28, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0,
                  background: tx.action === "Wrap" ? C.successFaint : tx.action === "Unwrap" ? C.dangerFaint : C.infoFaint,
                  color: tx.action === "Wrap" ? C.success : tx.action === "Unwrap" ? C.danger : C.info,
                  border: `1px solid ${tx.action === "Wrap" ? C.success + "30" : tx.action === "Unwrap" ? C.danger + "30" : C.info + "30"}`,
                }}>
                  {tx.action === "Wrap" ? "\u2193" : tx.action === "Unwrap" ? "\u2191" : "\u2194"}
                </span>
                <div>
                  <div style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{tx.action}</div>
                  <div style={{ color: C.textMuted, fontSize: 10 }}>{new Date(tx.timestamp).toLocaleTimeString()}</div>
                </div>
              </div>
              <div style={{ textAlign: "right" as const }}>
                {tx.amount && <div style={{ color: "#fff", fontSize: 13, fontWeight: 600, fontFamily: FONT_MONO }}>{tx.amount} USDC</div>}
                <a href={etherscanTx(tx.txHash)} target="_blank" rel="noopener noreferrer" style={{ ...link, fontSize: 10 }}>
                  {tx.txHash.slice(0, 10)}...{tx.txHash.slice(-4)}
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const activityRow: React.CSSProperties = {
  display: "flex", justifyContent: "space-between", alignItems: "center",
  padding: "10px 0", borderBottom: `1px solid ${C.bg}`,
};
