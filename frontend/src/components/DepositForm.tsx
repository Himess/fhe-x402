import React, { useState } from "react";

interface Props {
  onWrap: (amount: string) => Promise<void>;
}

const styles: Record<string, React.CSSProperties> = {
  label: { fontSize: 16, fontWeight: 600, marginBottom: 12 },
  row: { display: "flex", gap: 8 },
  input: {
    flex: 1,
    background: "#1a1a1a",
    border: "1px solid #333",
    borderRadius: 8,
    padding: "10px 14px",
    color: "#e0e0e0",
    fontSize: 14,
  },
  btn: {
    background: "#2e7d32",
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "10px 20px",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 600,
  },
  btnDisabled: {
    background: "#444",
    color: "#888",
    border: "none",
    borderRadius: 8,
    padding: "10px 20px",
    cursor: "not-allowed",
    fontSize: 14,
    fontWeight: 600,
  },
  note: { fontSize: 12, color: "#666", marginTop: 8 },
  error: { color: "#ff6b6b", fontSize: 12, marginTop: 4 },
};

export default function WrapForm({ onWrap }: Props) {
  const [amount, setAmount] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleWrap = async () => {
    const num = parseFloat(amount);
    if (isNaN(num) || num <= 0) {
      setError("Amount must be a positive number");
      return;
    }
    if (num < 0.02) {
      setError("Minimum wrap is 0.02 USDC (fee: 0.01 USDC)");
      return;
    }
    setError("");
    setLoading(true);
    try {
      await onWrap(amount);
      setAmount("");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div style={styles.label}>Wrap USDC to cUSDC</div>
      <div style={styles.row}>
        <input
          style={styles.input}
          placeholder="Amount (e.g. 10)"
          type="number"
          step="0.01"
          min="0.02"
          value={amount}
          onChange={(e) => { setAmount(e.target.value); setError(""); }}
          disabled={loading}
        />
        <button
          style={loading ? styles.btnDisabled : styles.btn}
          onClick={handleWrap}
          disabled={loading}
        >
          {loading ? "Wrapping..." : "Wrap"}
        </button>
      </div>
      {error && <div style={styles.error}>{error}</div>}
      <div style={styles.note}>Converts public USDC to encrypted cUSDC. Fee: max(0.1%, 0.01 USDC).</div>
    </div>
  );
}
