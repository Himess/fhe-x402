/**
 * ANSI color helpers for terminal output.
 * Used by demo scripts and CLI tools for pretty-printing.
 *
 * Usage:
 *   import { colors, banner, step, info, txBox, separator } from "./colors.js";
 *   banner("My Demo");
 *   step(1, "Doing something");
 *   info("Label", "value");
 *   txBox("0xabc...def", 42000n);
 */

// ============================================================================
// Raw ANSI codes
// ============================================================================

export const colors = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
} as const;

// ============================================================================
// Pretty-print helpers
// ============================================================================

/** Print a bordered banner */
export function banner(text: string): void {
  const line = "\u2550".repeat(60);
  console.log(`\n${colors.cyan}\u2554${line}\u2557${colors.reset}`);
  console.log(
    `${colors.cyan}\u2551${colors.reset} ${colors.bold}${text.padEnd(58)}${colors.reset} ${colors.cyan}\u2551${colors.reset}`
  );
  console.log(`${colors.cyan}\u255A${line}\u255D${colors.reset}\n`);
}

/** Print a numbered step */
export function step(n: number, text: string): void {
  console.log(`${colors.bold}${colors.blue}[Step ${n}]${colors.reset} ${text}`);
}

/** Print a label: value pair */
export function info(label: string, value: string): void {
  console.log(`  ${colors.dim}${label}:${colors.reset} ${colors.green}${value}${colors.reset}`);
}

/** Print a transaction box with hash and gas */
export function txBox(hash: string, gas: bigint): void {
  const shortHash = `${hash.slice(0, 22)}...${hash.slice(-8)}`;
  console.log(
    `  ${colors.yellow}\u250C\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2510${colors.reset}`
  );
  console.log(
    `  ${colors.yellow}\u2502${colors.reset} TX: ${colors.cyan}${shortHash}${colors.reset}${" ".repeat(Math.max(0, 20 - shortHash.length + 33))}${colors.yellow}\u2502${colors.reset}`
  );
  console.log(
    `  ${colors.yellow}\u2502${colors.reset} Gas: ${colors.green}${gas.toString().padEnd(46)}${colors.reset}${colors.yellow}\u2502${colors.reset}`
  );
  console.log(
    `  ${colors.yellow}\u2514\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2518${colors.reset}`
  );
}

/** Print a horizontal separator */
export function separator(): void {
  console.log(`${colors.dim}${"\u2500".repeat(62)}${colors.reset}`);
}

/** Print a success message */
export function success(text: string): void {
  console.log(`  ${colors.green}\u2714${colors.reset} ${text}`);
}

/** Print an error message */
export function error(text: string): void {
  console.log(`  ${colors.red}\u2718${colors.reset} ${text}`);
}

/** Print a warning message */
export function warn(text: string): void {
  console.log(`  ${colors.yellow}\u26A0${colors.reset} ${text}`);
}
