// ============================================================================
// FHE x402 — Pendex-inspired Design Tokens
// ============================================================================

import React from "react";

// ── Colors ──────────────────────────────────────────────────────────────────

export const C = {
  gold: "#2DD4BF",
  goldDark: "#14B8A6",
  goldFaint: "rgba(45,212,191,0.08)",
  goldBorder: "rgba(45,212,191,0.2)",
  bg: "#0A0A0B",
  card: "#141414",
  cardHover: "#1a1a1a",
  border: "#2a2a2a",
  textPrimary: "#FFFFFF",
  textSecondary: "#A0A0A0",
  textMuted: "#6B7280",
  success: "#10B981",
  successFaint: "rgba(16,185,129,0.15)",
  danger: "#EF4444",
  dangerFaint: "rgba(239,68,68,0.15)",
  warning: "#F59E0B",
  warningFaint: "rgba(245,158,11,0.15)",
  info: "#3B82F6",
  infoFaint: "rgba(59,130,246,0.15)",
} as const;

// ── Fonts ───────────────────────────────────────────────────────────────────

export const FONT_MONO = "'JetBrains Mono', monospace";

// ── Shared Styles ───────────────────────────────────────────────────────────

export const card: React.CSSProperties = {
  background: C.card,
  borderRadius: 12,
  padding: 20,
  marginBottom: 12,
  border: `1px solid ${C.border}`,
};

export const cardTitle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 700,
  color: C.textPrimary,
  marginBottom: 14,
  textTransform: "uppercase" as const,
  letterSpacing: 0.5,
};

export const inputStyle: React.CSSProperties = {
  width: "100%",
  background: C.bg,
  border: `1px solid ${C.border}`,
  borderRadius: 8,
  padding: "10px 12px",
  color: C.textPrimary,
  fontSize: 13,
  outline: "none",
  boxSizing: "border-box" as const,
  fontFamily: "inherit",
  transition: "border-color 0.2s, box-shadow 0.2s",
};

export const inputLabel: React.CSSProperties = {
  color: C.textMuted,
  fontSize: 10,
  fontWeight: 600,
  display: "block",
  marginBottom: 4,
  textTransform: "uppercase" as const,
  letterSpacing: 0.5,
};

export const hint: React.CSSProperties = {
  color: C.textMuted,
  fontSize: 11,
  margin: "0 0 14px 0",
  lineHeight: 1.5,
};

export const btnPrimary: React.CSSProperties = {
  background: `linear-gradient(135deg, ${C.gold}, ${C.goldDark})`,
  color: C.bg,
  border: "none",
  borderRadius: 8,
  padding: "10px 20px",
  fontWeight: 700,
  cursor: "pointer",
  fontSize: 12,
  boxShadow: "0 0 15px rgba(45,212,191,0.2)",
};

export const btnSuccess: React.CSSProperties = {
  background: C.success,
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 20px",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: 12,
  boxShadow: "0 0 12px rgba(16,185,129,0.2)",
};

export const btnDanger: React.CSSProperties = {
  background: C.danger,
  color: "#fff",
  border: "none",
  borderRadius: 8,
  padding: "10px 20px",
  fontWeight: 600,
  cursor: "pointer",
  fontSize: 12,
};

export const btnOutline: React.CSSProperties = {
  background: "transparent",
  color: C.gold,
  border: `1px solid ${C.gold}`,
  borderRadius: 8,
  padding: "8px 16px",
  cursor: "pointer",
  fontSize: 11,
  fontWeight: 600,
  width: "100%",
};

export const mono: React.CSSProperties = {
  fontFamily: FONT_MONO,
};

export const link: React.CSSProperties = {
  color: C.gold,
  textDecoration: "none",
  fontSize: 11,
  fontFamily: FONT_MONO,
};

export const row: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "8px 0",
  borderBottom: `1px solid ${C.bg}`,
};

export const labelStyle: React.CSSProperties = {
  color: C.textMuted,
  fontSize: 12,
};

export const valueStyle: React.CSSProperties = {
  color: C.textSecondary,
  fontSize: 12,
  fontFamily: FONT_MONO,
};
