import React, { useEffect, useState } from "react";
import { Contract, JsonRpcSigner } from "ethers";

interface Props {
  address: string;
  signer: JsonRpcSigner;
  usdcAddress: string;
  tokenAddress: string;
}

const USDC_ABI = ["function balanceOf(address) view returns (uint256)"];
const TOKEN_ABI = [
  "function confidentialBalanceOf(address) view returns (bytes32)",
  "function paused() view returns (bool)",
  "function accumulatedFees() view returns (uint256)",
];

const styles: Record<string, React.CSSProperties> = {
  label: { fontSize: 16, fontWeight: 600, marginBottom: 12 },
  row: { display: "flex", justifyContent: "space-between", marginBottom: 8, fontSize: 14 },
  value: { color: "#7b68ee", fontFamily: "monospace" },
  refresh: {
    background: "transparent",
    border: "1px solid #333",
    color: "#888",
    borderRadius: 6,
    padding: "6px 16px",
    cursor: "pointer",
    fontSize: 12,
    marginTop: 8,
  },
};

export default function BalanceDisplay({ address, signer, usdcAddress, tokenAddress }: Props) {
  const [usdcBalance, setUsdcBalance] = useState<string>("...");
  const [hasBalance, setHasBalance] = useState<boolean | null>(null);
  const [isPaused, setIsPaused] = useState<boolean | null>(null);
  const [fees, setFees] = useState<string>("...");

  const refresh = async () => {
    try {
      const usdc = new Contract(usdcAddress, USDC_ABI, signer);
      const token = new Contract(tokenAddress, TOKEN_ABI, signer);
      const bal: bigint = await usdc.balanceOf(address);
      setUsdcBalance((Number(bal) / 1_000_000).toFixed(2));
      const encBal: string = await token.confidentialBalanceOf(address);
      const { ethers } = await import("ethers");
      setHasBalance(encBal !== ethers.ZeroHash);
      const paused = await token.paused();
      setIsPaused(paused);
      const accFees: bigint = await token.accumulatedFees();
      setFees((Number(accFees) / 1_000_000).toFixed(2));
    } catch {
      setUsdcBalance("Error");
    }
  };

  useEffect(() => { refresh(); }, [address]);

  return (
    <div>
      <div style={styles.label}>Balance</div>
      <div style={styles.row}>
        <span>Public USDC</span>
        <span style={styles.value}>{usdcBalance} USDC</span>
      </div>
      <div style={styles.row}>
        <span>cUSDC Balance</span>
        <span style={styles.value}>{hasBalance === null ? "..." : hasBalance ? "Encrypted (active)" : "Empty"}</span>
      </div>
      <div style={styles.row}>
        <span>Contract Paused</span>
        <span style={{
          ...styles.value,
          color: isPaused === null ? "#7b68ee" : isPaused ? "#ff6b6b" : "#6bff6b",
        }}>
          {isPaused === null ? "..." : isPaused ? "Yes" : "No"}
        </span>
      </div>
      <div style={styles.row}>
        <span>Accumulated Fees</span>
        <span style={styles.value}>{fees} USDC</span>
      </div>
      <button style={styles.refresh} onClick={refresh}>Refresh</button>
    </div>
  );
}
