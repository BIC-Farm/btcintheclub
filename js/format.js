const SATS_PER_BTC = 100_000_000;

export function escapeHtml(str) {
  return String(str)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function satsToBtc(sats) {
  return (sats / SATS_PER_BTC).toFixed(8);
}

export function formatBtc(sats, { sign = false } = {}) {
  const prefix = sign && sats > 0 ? "+" : "";
  return `${prefix}${satsToBtc(sats)} BTC`;
}

export function formatSats(sats) {
  return `${Number(sats).toLocaleString("it-IT")} sat`;
}

export function formatNumber(n) {
  return Number(n).toLocaleString("it-IT");
}

export function formatBytes(bytes) {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(1)} kB`;
  return `${(bytes / 1_000_000).toFixed(2)} MB`;
}

export function formatDate(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleString("it-IT", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export function formatTimeAgo(unixSeconds) {
  const diffMs = Date.now() - unixSeconds * 1000;
  const diffSec = Math.round(diffMs / 1000);
  const units = [
    ["anno", "anni", 31536000],
    ["mese", "mesi", 2592000],
    ["giorno", "giorni", 86400],
    ["ora", "ore", 3600],
    ["minuto", "minuti", 60],
  ];
  if (diffSec < 30) return "pochi secondi fa";
  for (const [singular, plural, secs] of units) {
    const value = Math.floor(diffSec / secs);
    if (value >= 1) {
      return `circa ${value} ${value > 1 ? plural : singular} fa`;
    }
  }
  return "pochi secondi fa";
}

export function shortHash(hash, len = 10) {
  if (!hash || hash.length <= len * 2 + 1) return hash;
  return `${hash.slice(0, len)}…${hash.slice(-len)}`;
}

export function shortAddress(addr, len = 8) {
  return shortHash(addr, len);
}
