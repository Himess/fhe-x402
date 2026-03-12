import React, { useState, useEffect, useCallback } from "react";
import { Contract, JsonRpcSigner } from "ethers";
import {
  ADDRESSES, TOKEN_ABI, USDC_ABI, ACP_ABI, formatUSDC, shortAddr,
  etherscanTx, etherscanAddr, JOB_STATUS_LABELS, JOB_STATUS_COLORS, ZERO_ADDRESS,
} from "./config";
import { C, card, cardTitle, link, btnOutline, FONT_MONO } from "./theme";

interface TxRecord { action: string; txHash: string; amount?: string; timestamp: number; }

interface Props {
  signer: JsonRpcSigner;
  address: string;
  txHistory: TxRecord[];
}

export default function DashboardTab({ signer, address, txHistory }: Props) {
  const [protocolFees, setProtocolFees] = useState("...");
  const [treasuryBalance, setTreasuryBalance] = useState("...");
  const [totalJobs, setTotalJobs] = useState(0);
  const [jobsByStatus, setJobsByStatus] = useState<number[]>([0, 0, 0, 0, 0, 0]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const token = new Contract(ADDRESSES.TOKEN, TOKEN_ABI, signer);
      const usdc = new Contract(ADDRESSES.USDC, USDC_ABI, signer);
      const acp = new Contract(ADDRESSES.ACP, ACP_ABI, signer);
      const [fees, tBal] = await Promise.all([token.accumulatedFees(), usdc.balanceOf(ADDRESSES.TREASURY)]);
      setProtocolFees(formatUSDC(fees));
      setTreasuryBalance(formatUSDC(tBal));
      const counts = [0, 0, 0, 0, 0, 0];
      let total = 0;
      for (let id = 1; id <= 50; id++) {
        try { const j = await acp.getJob(id); if (j.client === ZERO_ADDRESS) break; total++; counts[Number(j.status)]++; } catch { break; }
      }
      setTotalJobs(total);
      setJobsByStatus(counts);
    } catch (e) { console.error("Dashboard:", e); }
    setLoading(false);
  }, [signer]);

  useEffect(() => { refresh(); }, [refresh]);

  return (
    <div>
      {/* Stats */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
        {[
          { label: "Protocol Fees", value: `$${protocolFees}`, sub: "0.1% on wrap/unwrap" },
          { label: "Treasury Balance", value: `$${treasuryBalance}`, sub: shortAddr(ADDRESSES.TREASURY) },
          { label: "Total Jobs", value: loading ? "..." : String(totalJobs), sub: "ERC-8183 marketplace" },
          { label: "Session TXs", value: String(txHistory.length), sub: "This session" },
        ].map((s, i) => (
          <div key={i} style={statCard}>
            <div style={{ color: C.textMuted, fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, letterSpacing: 0.5 }}>{s.label}</div>
            <div style={{ color: "#fff", fontSize: 22, fontWeight: 700, fontFamily: FONT_MONO, marginTop: 4 }}>{s.value}</div>
            <div style={{ color: C.textMuted, fontSize: 10, marginTop: 4 }}>{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Job Distribution */}
      {totalJobs > 0 && (
        <div style={card}>
          <div style={cardTitle}>Job Status</div>
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" as const }}>
            {JOB_STATUS_LABELS.map((l, i) => jobsByStatus[i] > 0 ? (
              <span key={i} style={{ background: JOB_STATUS_COLORS[i] + "18", color: JOB_STATUS_COLORS[i], padding: "4px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>
                {l}: {jobsByStatus[i]}
              </span>
            ) : null)}
          </div>
        </div>
      )}

      {/* Contracts */}
      <div style={card}>
        <div style={cardTitle}>Deployed Contracts</div>
        {[
          { name: "ConfidentialUSDC", addr: ADDRESSES.TOKEN, tag: "ERC-7984" },
          { name: "X402PaymentVerifier", addr: ADDRESSES.VERIFIER, tag: "Nonce Registry" },
          { name: "AgenticCommerce", addr: ADDRESSES.ACP, tag: "ERC-8183" },
          { name: "AgentIdentity", addr: ADDRESSES.IDENTITY, tag: "ERC-8004" },
          { name: "AgentReputation", addr: ADDRESSES.REPUTATION, tag: "ERC-8004" },
          { name: "MockUSDC", addr: ADDRESSES.USDC, tag: "6 decimals" },
        ].map((c, i) => (
          <div key={i} style={contractRow}>
            <div>
              <span style={{ color: "#fff", fontSize: 12, fontWeight: 600 }}>{c.name}</span>
              <span style={{ color: C.textMuted, fontSize: 10, marginLeft: 8 }}>{c.tag}</span>
            </div>
            <a href={etherscanAddr(c.addr)} target="_blank" rel="noopener noreferrer" style={link}>{shortAddr(c.addr)}</a>
          </div>
        ))}
      </div>

      {/* Features */}
      <div style={card}>
        <div style={cardTitle}>Protocol Features</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          {[
            { name: "FHE Encryption", desc: "Amounts encrypted via Zama fhEVM", color: C.gold },
            { name: "x402 Payments", desc: "HTTP 402 payment protocol", color: C.info },
            { name: "Fee-Free Transfers", desc: "No fee on confidentialTransfer", color: C.success },
            { name: "Job Escrow", desc: "1% fee, trustless evaluator", color: C.warning },
            { name: "Batch Payments", desc: "Prepay N requests in one TX", color: "#E67E22" },
            { name: "Silent Failure Guard", desc: "FHE zero-transfer detection", color: C.danger },
          ].map((f, i) => (
            <div key={i} style={featureCard}>
              <div style={{ color: f.color, fontSize: 11, fontWeight: 700, marginBottom: 3 }}>{f.name}</div>
              <div style={{ color: C.textMuted, fontSize: 10 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* TX History */}
      {txHistory.length > 0 && (
        <div style={card}>
          <div style={cardTitle}>Transaction History</div>
          {txHistory.map((tx, i) => (
            <div key={i} style={txRow}>
              <div>
                <span style={{ color: C.gold, fontWeight: 600, fontSize: 12 }}>{tx.action}</span>
                {tx.amount && <span style={{ color: C.textSecondary, fontSize: 11 }}> — {tx.amount} USDC</span>}
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <a href={etherscanTx(tx.txHash)} target="_blank" rel="noopener noreferrer" style={{ ...link, fontSize: 10 }}>
                  {tx.txHash.slice(0, 10)}...{tx.txHash.slice(-6)}
                </a>
                <span style={{ color: C.textMuted, fontSize: 10 }}>{new Date(tx.timestamp).toLocaleTimeString()}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      <button onClick={refresh} style={btnOutline} disabled={loading}>{loading ? "Loading..." : "Refresh Dashboard"}</button>
    </div>
  );
}

const statCard: React.CSSProperties = { background: C.card, borderRadius: 12, padding: 18, border: `1px solid ${C.border}`, textAlign: "center" as const };
const contractRow: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: `1px solid ${C.bg}` };
const featureCard: React.CSSProperties = { background: C.bg, borderRadius: 8, padding: 10, border: `1px solid ${C.border}` };
const txRow: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: `1px solid ${C.bg}` };
