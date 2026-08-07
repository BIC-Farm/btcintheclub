const KEY = "bic-watchlist";

/** Normalizza una voce: le vecchie liste salvavano solo stringhe-indirizzo, ora ogni voce è un oggetto tipizzato. */
function normalize(entry) {
  if (typeof entry === "string") return { type: "address", address: entry };
  return entry;
}

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list.map(normalize).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function write(list) {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // localStorage non disponibile (es. modalità privata): la watchlist resta solo per la sessione corrente.
  }
}

/** Tutte le voci salvate (indirizzi singoli e chiavi estese xpub/ypub/zpub). */
export function getWatchlist() {
  return read();
}

export function isWatched(address) {
  return read().some((e) => e.type === "address" && e.address === address);
}

export function addToWatchlist(address) {
  const list = read();
  if (!list.some((e) => e.type === "address" && e.address === address)) {
    list.push({ type: "address", address, addedAt: Date.now() });
    write(list);
  }
}

export function removeFromWatchlist(address) {
  write(read().filter((e) => !(e.type === "address" && e.address === address)));
}

export function isXpubWatched(key) {
  return read().some((e) => e.type === "xpub" && e.key === key);
}

/**
 * Aggiunge una chiave estesa (xpub/ypub/zpub) alla watchlist, con gli indirizzi già scoperti in fase
 * di prima scansione (vedi discoverAddresses in bip32.js), per poterli ricontrollare senza rifare
 * da zero la scansione a ogni visita.
 */
export function addXpubToWatchlist(key, keyType, addressType, discovery, label) {
  const list = read();
  if (list.some((e) => e.type === "xpub" && e.key === key)) return;
  list.push({
    type: "xpub",
    key,
    keyType,
    addressType,
    label: label || "",
    addedAt: Date.now(),
    discoveredAddresses: discovery.addresses.map((a) => ({ address: a.address, chain: a.chain, index: a.index })),
    maxUsedReceive: discovery.maxUsedReceive,
    maxUsedChange: discovery.maxUsedChange,
  });
  write(list);
}

export function removeXpubFromWatchlist(key) {
  write(read().filter((e) => !(e.type === "xpub" && e.key === key)));
}

/** Aggiorna la cache di indirizzi scoperti per una chiave estesa già salvata (dopo una nuova scansione incrementale). */
export function updateXpubDiscovery(key, discovery) {
  const list = read();
  const entry = list.find((e) => e.type === "xpub" && e.key === key);
  if (!entry) return;
  const existing = new Map(entry.discoveredAddresses.map((a) => [`${a.chain}/${a.index}`, a]));
  for (const a of discovery.addresses) existing.set(`${a.chain}/${a.index}`, { address: a.address, chain: a.chain, index: a.index });
  entry.discoveredAddresses = [...existing.values()];
  entry.maxUsedReceive = Math.max(entry.maxUsedReceive, discovery.maxUsedReceive);
  entry.maxUsedChange = Math.max(entry.maxUsedChange, discovery.maxUsedChange);
  write(list);
}

/** Legge/aggiorna l'ultimo saldo e numero di transazioni visti per una voce, per il badge "novità". */
export function getLastSeen(entryId) {
  const list = read();
  const entry = list.find((e) => (e.type === "address" ? e.address : e.key) === entryId);
  return entry?.lastSeen ?? null;
}

export function setLastSeen(entryId, { balance, txCount }) {
  const list = read();
  const entry = list.find((e) => (e.type === "address" ? e.address : e.key) === entryId);
  if (!entry) return;
  entry.lastSeen = { balance, txCount };
  write(list);
}
