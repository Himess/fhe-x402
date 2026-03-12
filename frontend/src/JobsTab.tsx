import React, { useState, useEffect, useCallback } from "react";
import { Contract, JsonRpcSigner, ethers } from "ethers";
import {
  ADDRESSES, ACP_ABI, USDC_ABI, parseUSDCAmount, formatUSDC, shortAddr,
  JOB_STATUS_LABELS, JOB_STATUS_COLORS, ZERO_ADDRESS,
} from "./config";
import { C, card, cardTitle, inputStyle, inputLabel, btnPrimary, btnSuccess, btnDanger, btnOutline, FONT_MONO } from "./theme";

interface Props {
  signer: JsonRpcSigner;
  address: string;
  onStatus: (msg: string, type: "info" | "error" | "success") => void;
  onTx: (action: string, txHash: string, amount?: string) => void;
}

interface Job {
  id: number; client: string; provider: string; evaluator: string;
  description: string; budget: bigint; expiredAt: bigint; status: number;
  hook: string; deliverable: string;
}

export default function JobsTab({ signer, address, onStatus, onTx }: Props) {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [selectedJob, setSelectedJob] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [provider, setProvider] = useState("");
  const [evaluator, setEvaluator] = useState("");
  const [budget, setBudget] = useState("");
  const [description, setDescription] = useState("");
  const [expiryHours, setExpiryHours] = useState("24");
  const [deliverableInput, setDeliverableInput] = useState("");
  const [reasonInput, setReasonInput] = useState("");

  const acp = new Contract(ADDRESSES.ACP, ACP_ABI, signer);
  const usdc = new Contract(ADDRESSES.USDC, USDC_ABI, signer);

  const loadJobs = useCallback(async () => {
    setLoading(true);
    const loaded: Job[] = [];
    for (let id = 1; id <= 50; id++) {
      try {
        const j = await acp.getJob(id);
        if (j.client === ZERO_ADDRESS) break;
        loaded.push({
          id, client: j.client, provider: j.provider, evaluator: j.evaluator,
          description: j.description, budget: j.budget, expiredAt: j.expiredAt,
          status: Number(j.status), hook: j.hook, deliverable: j.deliverable,
        });
      } catch { break; }
    }
    setJobs(loaded);
    setLoading(false);
  }, [signer]);

  useEffect(() => { loadJobs(); }, [loadJobs]);

  const doAction = async (label: string, fn: () => Promise<any>) => {
    if (busy) return;
    setBusy(true);
    try {
      onStatus(`${label}...`, "info");
      const receipt = await fn();
      onStatus(`${label} complete`, "success");
      onTx(label, receipt.hash);
      await loadJobs();
      setSelectedJob(null);
    } catch (e: any) { onStatus(e.reason || e.message || `${label} failed`, "error"); }
    setBusy(false);
  };

  const createJob = async () => {
    if (!evaluator || !description || busy) return;
    setBusy(true);
    try {
      const expiry = Math.floor(Date.now() / 1000) + parseInt(expiryHours) * 3600;
      onStatus("Creating job...", "info");
      const tx = await acp.createJob(provider || ZERO_ADDRESS, evaluator, expiry, description, ZERO_ADDRESS);
      const receipt = await tx.wait();
      const iface = new ethers.Interface(ACP_ABI);
      let jobId = "?";
      for (const log of receipt.logs) {
        try { const p = iface.parseLog({ topics: log.topics as string[], data: log.data }); if (p?.name === "JobCreated") { jobId = p.args[0].toString(); break; } } catch { continue; }
      }
      if (budget) { onStatus(`Job #${jobId} created. Setting budget...`, "info"); await (await acp.setBudget(jobId, parseUSDCAmount(budget))).wait(); }
      onStatus(`Job #${jobId} created!`, "success");
      onTx("Create Job", receipt.hash);
      setShowCreate(false); setProvider(""); setEvaluator(""); setBudget(""); setDescription("");
      await loadJobs();
    } catch (e: any) { onStatus(e.reason || e.message || "Create failed", "error"); }
    setBusy(false);
  };

  const addr = address.toLowerCase();
  const canFund = (j: Job) => j.client.toLowerCase() === addr && j.status === 0 && j.budget > 0n;
  const canSubmit = (j: Job) => j.provider.toLowerCase() === addr && j.status === 1;
  const canComplete = (j: Job) => j.evaluator.toLowerCase() === addr && j.status === 2;
  const canReject = (j: Job) => {
    const isC = j.client.toLowerCase() === addr, isE = j.evaluator.toLowerCase() === addr;
    return (isC && (j.status === 0 || j.status === 1)) || (isE && (j.status === 1 || j.status === 2));
  };
  const canRefund = (j: Job) => j.client.toLowerCase() === addr && (j.status === 1 || j.status === 2) && Number(j.expiredAt) < Date.now() / 1000;

  return (
    <div>
      {/* Header */}
      <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={cardTitle}>Agent Job Marketplace</div>
          <p style={{ color: C.textMuted, fontSize: 11, margin: 0 }}>ERC-8183 — Create jobs, escrow funds, submit work, get paid. 1% platform fee.</p>
        </div>
        <button onClick={() => setShowCreate(!showCreate)} style={showCreate ? { ...btnDanger, fontSize: 11, padding: "8px 14px" } : { ...btnPrimary, fontSize: 11, padding: "8px 14px" }}>
          {showCreate ? "Cancel" : "+ New Job"}
        </button>
      </div>

      {/* Create */}
      {showCreate && (
        <div style={card}>
          <div style={cardTitle}>Create New Job</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div><label style={inputLabel}>Provider (optional)</label><input placeholder="0x..." value={provider} onChange={(e) => setProvider(e.target.value)} style={inputStyle} /></div>
            <div><label style={inputLabel}>Evaluator *</label><input placeholder="0x..." value={evaluator} onChange={(e) => setEvaluator(e.target.value)} style={inputStyle} /></div>
            <div><label style={inputLabel}>Budget (USDC)</label><input placeholder="10.00" value={budget} onChange={(e) => setBudget(e.target.value)} style={inputStyle} /></div>
            <div><label style={inputLabel}>Expiry (hours)</label><input type="number" value={expiryHours} onChange={(e) => setExpiryHours(e.target.value)} style={inputStyle} min={1} /></div>
          </div>
          <div style={{ marginTop: 10 }}><label style={inputLabel}>Description *</label><input placeholder="Write a data analysis script..." value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} /></div>
          <button onClick={createJob} disabled={busy || !evaluator || !description} style={{ ...btnSuccess, marginTop: 14, width: "100%" }}>
            {busy ? "Creating..." : "Create Job"}
          </button>
        </div>
      )}

      {/* Jobs */}
      {loading ? (
        <div style={{ ...card, textAlign: "center" as const, color: C.textMuted }}>Loading jobs...</div>
      ) : jobs.length === 0 ? (
        <div style={{ ...card, textAlign: "center" as const, color: C.textMuted }}>No jobs yet. Create one to get started!</div>
      ) : (
        jobs.map((job) => {
          const open = selectedJob === job.id;
          return (
            <div key={job.id} style={{ ...card, cursor: "pointer", borderColor: open ? C.gold : C.border, transition: "border-color 0.2s" }} onClick={() => setSelectedJob(open ? null : job.id)}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ color: C.gold, fontWeight: 700, fontSize: 13, fontFamily: FONT_MONO }}>#{job.id}</span>
                  <span style={{ background: JOB_STATUS_COLORS[job.status] + "20", color: JOB_STATUS_COLORS[job.status], padding: "2px 10px", borderRadius: 20, fontSize: 10, fontWeight: 600 }}>
                    {JOB_STATUS_LABELS[job.status]}
                  </span>
                </div>
                <span style={{ color: "#fff", fontWeight: 600, fontSize: 14, fontFamily: FONT_MONO }}>
                  {job.budget > 0n ? `$${formatUSDC(job.budget)}` : "—"}
                </span>
              </div>
              <div style={{ color: C.textSecondary, fontSize: 12, marginTop: 8 }}>{job.description}</div>
              <div style={{ display: "flex", gap: 16, marginTop: 6, fontSize: 10, color: C.textMuted, fontFamily: FONT_MONO }}>
                <span>Client: {shortAddr(job.client)}</span>
                <span>Provider: {job.provider === ZERO_ADDRESS ? "TBD" : shortAddr(job.provider)}</span>
                <span>Eval: {shortAddr(job.evaluator)}</span>
              </div>
              {job.budget > 0n && (
                <div style={{ fontSize: 10, color: C.textMuted, marginTop: 3 }}>
                  Fee: ${formatUSDC((job.budget * 100n) / 10000n)} (1%) | Payout: ${formatUSDC(job.budget - (job.budget * 100n) / 10000n)}
                </div>
              )}
              {open && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
                  {canFund(job) && <button onClick={(e) => { e.stopPropagation(); doAction("Fund Job", async () => { await (await usdc.approve(ADDRESSES.ACP, job.budget)).wait(); return (await acp.fund(job.id, job.budget)).wait(); }); }} disabled={busy} style={{ ...btnSuccess, marginRight: 8, fontSize: 11 }}>{busy ? "..." : `Fund $${formatUSDC(job.budget)}`}</button>}
                  {canSubmit(job) && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <input placeholder="Deliverable (IPFS CID / description)" value={deliverableInput} onChange={(e) => setDeliverableInput(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} />
                      <button onClick={() => doAction("Submit", async () => (await acp.submit(job.id, ethers.keccak256(ethers.toUtf8Bytes(deliverableInput)))).wait())} disabled={busy || !deliverableInput} style={{ ...btnPrimary, fontSize: 11 }}>{busy ? "..." : "Submit Deliverable"}</button>
                    </div>
                  )}
                  {canComplete(job) && (
                    <div onClick={(e) => e.stopPropagation()}>
                      <input placeholder="Reason (optional)" value={reasonInput} onChange={(e) => setReasonInput(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} />
                      <button onClick={() => doAction("Complete Job", async () => (await acp.complete(job.id, ethers.keccak256(ethers.toUtf8Bytes(reasonInput || "Approved")))).wait())} disabled={busy} style={{ ...btnSuccess, fontSize: 11 }}>{busy ? "..." : "Approve & Pay"}</button>
                    </div>
                  )}
                  {canReject(job) && (
                    <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 8 }}>
                      <input placeholder="Rejection reason" value={reasonInput} onChange={(e) => setReasonInput(e.target.value)} style={{ ...inputStyle, marginBottom: 8 }} />
                      <button onClick={() => doAction("Reject", async () => (await acp.reject(job.id, ethers.keccak256(ethers.toUtf8Bytes(reasonInput || "Rejected")))).wait())} disabled={busy} style={{ ...btnDanger, fontSize: 11, padding: "8px 14px" }}>{busy ? "..." : "Reject"}</button>
                    </div>
                  )}
                  {canRefund(job) && <button onClick={(e) => { e.stopPropagation(); doAction("Refund", async () => (await acp.claimRefund(job.id)).wait()); }} disabled={busy} style={{ ...btnDanger, fontSize: 11, padding: "8px 14px", marginTop: 8 }}>{busy ? "..." : "Claim Refund"}</button>}
                  {!canFund(job) && !canSubmit(job) && !canComplete(job) && !canReject(job) && !canRefund(job) && (
                    <div style={{ color: C.textMuted, fontSize: 11 }}>No actions available for your address.</div>
                  )}
                  <div style={{ marginTop: 10, fontSize: 10, color: C.textMuted, fontFamily: FONT_MONO }}>
                    Expires: {new Date(Number(job.expiredAt) * 1000).toLocaleString()}
                    {job.deliverable && job.deliverable !== "0x" + "00".repeat(32) && <span> | Deliverable: {job.deliverable.slice(0, 18)}...</span>}
                  </div>
                </div>
              )}
            </div>
          );
        })
      )}
      <button onClick={loadJobs} style={btnOutline} disabled={loading}>{loading ? "Loading..." : "Refresh Jobs"}</button>
    </div>
  );
}
