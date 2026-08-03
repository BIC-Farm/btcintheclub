const KEY = "bic-watchlist";

function read() {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
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

export function getWatchlist() {
  return read();
}

export function isWatched(address) {
  return read().includes(address);
}

export function addToWatchlist(address) {
  const list = read();
  if (!list.includes(address)) {
    list.push(address);
    write(list);
  }
}

export function removeFromWatchlist(address) {
  write(read().filter((a) => a !== address));
}
