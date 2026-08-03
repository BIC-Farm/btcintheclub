const SATS_PER_BTC = 100_000_000;
const UNIT_KEY = "bic-unit";

function readStoredUnit() {
  try {
    return localStorage.getItem(UNIT_KEY);
  } catch {
    return null;
  }
}

function writeStoredUnit(u) {
  try {
    localStorage.setItem(UNIT_KEY, u);
  } catch {
    // localStorage non disponibile (es. modalità privata): la preferenza resta solo per la sessione corrente.
  }
}

let unit = readStoredUnit() === "sats" ? "sats" : "btc";

export function getUnit() {
  return unit;
}

export function setUnit(u) {
  unit = u === "sats" ? "sats" : "btc";
  writeStoredUnit(unit);
}

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

function formatBtcAmount(sats, { sign = false } = {}) {
  const prefix = sign && sats > 0 ? "+" : "";
  return `${prefix}${satsToBtc(sats)} BTC`;
}

export function formatSats(sats, { sign = false } = {}) {
  const prefix = sign && sats > 0 ? "+" : "";
  return `${prefix}${Number(sats).toLocaleString("it-IT")} sat`;
}

/** Formatta nell'unità attualmente selezionata dall'utente (BTC o sats). */
export function formatBtc(sats, opts = {}) {
  return unit === "sats" ? formatSats(sats, opts) : formatBtcAmount(sats, opts);
}

/** Formatta nell'unità "opposta" a quella corrente, utile per mostrare un valore secondario. */
export function formatAlt(sats, opts = {}) {
  return unit === "sats" ? formatBtcAmount(sats, opts) : formatSats(sats, opts);
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

/** Solo la data, senza orario: utile per stime future incerte, dove un orario preciso darebbe una falsa sensazione di esattezza. */
export function formatDateOnly(unixSeconds) {
  return new Date(unixSeconds * 1000).toLocaleDateString("it-IT", { dateStyle: "medium" });
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

const HASHRATE_UNITS = [
  { unit: "H/s", factor: 1 },
  { unit: "KH/s", factor: 1e3 },
  { unit: "MH/s", factor: 1e6 },
  { unit: "GH/s", factor: 1e9 },
  { unit: "TH/s", factor: 1e12 },
  { unit: "PH/s", factor: 1e15 },
  { unit: "EH/s", factor: 1e18 },
  { unit: "ZH/s", factor: 1e21 },
];

export function formatHashrate(hashesPerSecond) {
  if (!Number.isFinite(hashesPerSecond) || hashesPerSecond <= 0) return "—";
  let chosen = HASHRATE_UNITS[0];
  for (const u of HASHRATE_UNITS) {
    if (hashesPerSecond >= u.factor) chosen = u;
  }
  const value = hashesPerSecond / chosen.factor;
  const decimals = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${value.toFixed(decimals)} ${chosen.unit}`;
}
