import React, { useState, useEffect, useCallback } from "react";
import { Contract, JsonRpcSigner, ethers } from "ethers";
import {
  ADDRESSES, IDENTITY_ABI, REPUTATION_ABI, shortAddr, etherscanAddr, etherscanTx, ZERO_ADDRESS,
} from "./config";
import { C, card, cardTitle, inputStyle, inputLabel, hint, btnPrimary, btnSuccess, btnOutline, link, FONT_MONO } from "./theme";

interface Props {
  signer: JsonRpcSigner;
  address: string;
  onStatus: (msg: string, type: "info" | "error" | "success") => void;
  onTx: (action: string, txHash: string, amount?: string) => void;
}

interface AgentInfo {
  id: number;
  uri: string;
  owner: string;
  wallet: string;
  parsed?: Record<string, unknown>;
  totalFeedback: number;
  averageScore: number;
}

export default function AgentsTab({ signer, address, onStatus, onTx }: Props) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [myAgentId, setMyAgentId] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showRegister, setShowRegister] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<number | null>(null);

  // Register form
  const [regName, setRegName] = useState("");
  const [regServices, setRegServices] = useState("data-analysis, code-review");
  const [regDescription, setRegDescription] = useState("");

  // Feedback form
  const [fbScore, setFbScore] = useState("85");
  const [fbTags, setFbTags] = useState("reliable, fast");

  const identity = new Contract(ADDRESSES.IDENTITY, IDENTITY_ABI, signer);
  const reputation = new Contract(ADDRESSES.REPUTATION, REPUTATION_ABI, signer);

  const loadAgents = useCallback(async () => {
    setLoading(true);
    try {
      const nextId = Number(await identity.nextAgentId());
      const loaded: AgentInfo[] = [];
      for (let id = 1; id < nextId; id++) {
        try {
          const [uri, owner, wallet] = await identity.getAgent(id);
          const [totalFeedback, averageScore] = await reputation.getSummary(id);
          let parsed: Record<string, unknown> | undefined;
          try { parsed = JSON.parse(uri); } catch { /* not JSON */ }
          loaded.push({
            id, uri, owner, wallet, parsed,
            totalFeedback: Number(totalFeedback),
            averageScore: Number(averageScore),
          });
        } catch { break; }
      }
      setAgents(loaded);

      // Check if current user has an agent
      const myId = Number(await identity.agentOf(address));
      setMyAgentId(myId);
    } catch (e) { console.error("Agents load:", e); }
    setLoading(false);
  }, [signer, address]);

  useEffect(() => { loadAgents(); }, [loadAgents]);

  const registerAgent = async () => {
    if (!regName || busy) return;
    setBusy(true);
    try {
      const agentURI = JSON.stringify({
        name: regName,
        description: regDescription || `${regName} AI agent`,
        services: regServices.split(",").map((s) => s.trim()).filter(Boolean),
        x402Support: true,
        scheme: "fhe-confidential-v1",
        paymentMethod: {
          scheme: "fhe-confidential-v1",
          network: "eip155:11155111",
          token: "USDC",
          tokenAddress: ADDRESSES.TOKEN,
          verifier: ADDRESSES.VERIFIER,
          privacyLevel: "encrypted-balances",
        },
        registrations: [{ standard: "ERC-8004", network: "eip155:11155111" }],
      });
      onStatus("Registering agent on-chain...", "info");
      const tx = await identity.register(agentURI);
      const receipt = await tx.wait();

      // Parse AgentRegistered event
      const iface = new ethers.Interface(IDENTITY_ABI);
      let agentId = "?";
      for (const log of receipt.logs) {
        try {
          const p = iface.parseLog({ topics: log.topics as string[], data: log.data });
          if (p?.name === "AgentRegistered") { agentId = p.args[0].toString(); break; }
        } catch { continue; }
      }

      onStatus(`Agent #${agentId} registered!`, "success");
      onTx("Register Agent", receipt.hash);
      setShowRegister(false);
      setRegName("");
      setRegDescription("");
      await loadAgents();
    } catch (e: any) { onStatus(e.reason || e.message || "Registration failed", "error"); }
    setBusy(false);
  };

  const giveFeedback = async (agentId: number) => {
    if (busy) return;
    setBusy(true);
    try {
      const score = Math.min(255, Math.max(0, parseInt(fbScore) || 85));
      const tags = fbTags.split(",").map((t) => ethers.encodeBytes32String(t.trim().slice(0, 31))).filter(Boolean);
      const proof = ethers.toUtf8Bytes(JSON.stringify({
        type: "fhe-x402-nonce",
        nonce: ethers.hexlify(ethers.randomBytes(32)),
        tokenAddress: ADDRESSES.TOKEN,
        network: "eip155:11155111",
        timestamp: Date.now(),
      }));
      onStatus("Submitting feedback...", "info");
      const tx = await reputation.giveFeedback(agentId, score, tags, proof);
      const receipt = await tx.wait();
      onStatus(`Feedback submitted for Agent #${agentId}!`, "success");
      onTx("Give Feedback", receipt.hash);
      setSelectedAgent(null);
      await loadAgents();
    } catch (e: any) { onStatus(e.reason || e.message || "Feedback failed", "error"); }
    setBusy(false);
  };

  return (
    <div>
      {/* Header */}
      <div style={{ ...card, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={cardTitle}>Agent Identity Registry</div>
          <p style={{ color: C.textMuted, fontSize: 11, margin: 0 }}>
            ERC-8004 — Register AI agents, build on-chain reputation, declare payment capabilities.
          </p>
        </div>
        <button
          onClick={() => setShowRegister(!showRegister)}
          style={showRegister
            ? { ...btnOutline, fontSize: 11, padding: "8px 14px", borderColor: C.danger, color: C.danger }
            : { ...btnPrimary, fontSize: 11, padding: "8px 14px" }
          }
        >
          {showRegister ? "Cancel" : myAgentId > 0 ? `My Agent: #${myAgentId}` : "+ Register Agent"}
        </button>
      </div>

      {/* Register */}
      {showRegister && (
        <div style={card}>
          <div style={cardTitle}>Register New Agent</div>
          <p style={hint}>Creates an on-chain identity with ERC-8004 + FHE x402 payment method declaration.</p>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label style={inputLabel}>Agent Name *</label>
              <input placeholder="DataAnalyst-v1" value={regName} onChange={(e) => setRegName(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <label style={inputLabel}>Services (comma-sep)</label>
              <input value={regServices} onChange={(e) => setRegServices(e.target.value)} style={inputStyle} />
            </div>
          </div>
          <div style={{ marginTop: 10 }}>
            <label style={inputLabel}>Description</label>
            <input placeholder="AI agent specialized in..." value={regDescription} onChange={(e) => setRegDescription(e.target.value)} style={inputStyle} />
          </div>
          <button onClick={registerAgent} disabled={busy || !regName} style={{ ...btnSuccess, marginTop: 14, width: "100%" }}>
            {busy ? "Registering..." : "Register Agent On-Chain"}
          </button>
        </div>
      )}

      {/* Agent List */}
      {loading ? (
        <div style={{ ...card, textAlign: "center" as const, color: C.textMuted }}>Loading agents...</div>
      ) : agents.length === 0 ? (
        <div style={{ ...card, textAlign: "center" as const, color: C.textMuted }}>No agents registered yet. Be the first!</div>
      ) : (
        agents.map((agent) => {
          const open = selectedAgent === agent.id;
          const isOwner = agent.owner.toLowerCase() === address.toLowerCase();
          const name = agent.parsed?.name as string || `Agent #${agent.id}`;
          const services = (agent.parsed?.services as string[]) || [];
          const desc = agent.parsed?.description as string || "";
          const scheme = agent.parsed?.scheme as string || "";

          return (
            <div
              key={agent.id}
              style={{ ...card, cursor: "pointer", borderColor: open ? C.gold : isOwner ? C.success + "40" : C.border, transition: "border-color 0.2s" }}
              onClick={() => setSelectedAgent(open ? null : agent.id)}
            >
              {/* Agent Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={agentBadge}>#{agent.id}</span>
                  <span style={{ color: "#fff", fontSize: 14, fontWeight: 700 }}>{name}</span>
                  {isOwner && <span style={ownerBadge}>YOU</span>}
                  {scheme && <span style={schemeBadge}>{scheme}</span>}
                </div>
                <div style={{ textAlign: "right" as const }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    <span style={{ color: C.gold, fontSize: 16, fontWeight: 700, fontFamily: FONT_MONO }}>
                      {agent.averageScore > 0 ? agent.averageScore : "—"}
                    </span>
                    <span style={{ color: C.textMuted, fontSize: 10 }}>/255</span>
                  </div>
                  <div style={{ color: C.textMuted, fontSize: 10 }}>{agent.totalFeedback} reviews</div>
                </div>
              </div>

              {/* Description */}
              {desc && <div style={{ color: C.textSecondary, fontSize: 12, marginTop: 8 }}>{desc}</div>}

              {/* Services */}
              {services.length > 0 && (
                <div style={{ display: "flex", gap: 4, marginTop: 8, flexWrap: "wrap" as const }}>
                  {services.map((s, i) => (
                    <span key={i} style={serviceBadge}>{s}</span>
                  ))}
                </div>
              )}

              {/* Addresses */}
              <div style={{ display: "flex", gap: 16, marginTop: 8, fontSize: 10, color: C.textMuted, fontFamily: FONT_MONO }}>
                <span>Owner: {shortAddr(agent.owner)}</span>
                <span>Wallet: {shortAddr(agent.wallet)}</span>
              </div>

              {/* Expanded */}
              {open && (
                <div style={{ marginTop: 14, paddingTop: 14, borderTop: `1px solid ${C.border}` }}>
                  {/* Registration JSON */}
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ color: C.textMuted, fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, marginBottom: 6 }}>Agent URI (on-chain)</div>
                    <pre style={jsonPre}>
                      {agent.parsed ? JSON.stringify(agent.parsed, null, 2) : agent.uri}
                    </pre>
                  </div>

                  {/* Etherscan */}
                  <div style={{ marginBottom: 12 }}>
                    <a href={etherscanAddr(agent.wallet)} target="_blank" rel="noopener noreferrer" style={link}>
                      View on Etherscan
                    </a>
                  </div>

                  {/* Give Feedback */}
                  {!isOwner && (
                    <div onClick={(e) => e.stopPropagation()} style={{ background: C.bg, borderRadius: 8, padding: 12, border: `1px solid ${C.border}` }}>
                      <div style={{ color: C.textMuted, fontSize: 10, fontWeight: 600, textTransform: "uppercase" as const, marginBottom: 8 }}>Give Feedback</div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <div style={{ width: 80 }}>
                          <label style={inputLabel}>Score (0-255)</label>
                          <input type="number" value={fbScore} onChange={(e) => setFbScore(e.target.value)} style={inputStyle} min={0} max={255} />
                        </div>
                        <div style={{ flex: 1 }}>
                          <label style={inputLabel}>Tags</label>
                          <input value={fbTags} onChange={(e) => setFbTags(e.target.value)} style={inputStyle} placeholder="reliable, fast" />
                        </div>
                      </div>
                      <button
                        onClick={() => giveFeedback(agent.id)}
                        disabled={busy}
                        style={{ ...btnPrimary, marginTop: 8, fontSize: 11, width: "100%" }}
                      >
                        {busy ? "Submitting..." : "Submit Feedback"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })
      )}

      <button onClick={loadAgents} style={btnOutline} disabled={loading}>
        {loading ? "Loading..." : "Refresh Agents"}
      </button>
    </div>
  );
}

const agentBadge: React.CSSProperties = {
  color: C.gold, fontWeight: 700, fontSize: 13, fontFamily: FONT_MONO,
};
const ownerBadge: React.CSSProperties = {
  background: C.successFaint, color: C.success, padding: "2px 8px",
  borderRadius: 20, fontSize: 9, fontWeight: 700,
};
const schemeBadge: React.CSSProperties = {
  background: C.infoFaint, color: C.info, padding: "2px 8px",
  borderRadius: 20, fontSize: 9, fontWeight: 600,
};
const serviceBadge: React.CSSProperties = {
  background: C.bg, color: C.textMuted, padding: "3px 10px",
  borderRadius: 20, fontSize: 10, border: `1px solid ${C.border}`,
};
const jsonPre: React.CSSProperties = {
  background: C.bg, borderRadius: 8, padding: 12, fontSize: 10,
  fontFamily: FONT_MONO, color: C.textSecondary, overflow: "auto",
  maxHeight: 200, border: `1px solid ${C.border}`, margin: 0,
  whiteSpace: "pre-wrap" as const, wordBreak: "break-all" as const,
};
