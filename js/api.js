const BASE_URL = "https://mempool.space/api";

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

async function fetchJson(path) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`);
  } catch {
    throw new ApiError(
      "Impossibile contattare il servizio dati. Controlla la connessione e riprova.",
      0
    );
  }
  if (!res.ok) {
    throw new ApiError(
      res.status === 404 ? "Nessun risultato trovato." : `Errore del servizio dati (${res.status}).`,
      res.status
    );
  }
  return res.json();
}

async function fetchText(path) {
  let res;
  try {
    res = await fetch(`${BASE_URL}${path}`);
  } catch {
    throw new ApiError(
      "Impossibile contattare il servizio dati. Controlla la connessione e riprova.",
      0
    );
  }
  if (!res.ok) {
    throw new ApiError(
      res.status === 404 ? "Nessun risultato trovato." : `Errore del servizio dati (${res.status}).`,
      res.status
    );
  }
  return (await res.text()).trim();
}

const CROSSCHECK_BASE_URL = "https://blockstream.info/api";

async function fetchJsonFrom(url) {
  let res;
  try {
    res = await fetch(url);
  } catch {
    throw new ApiError("Impossibile contattare la fonte di verifica.", 0);
  }
  if (!res.ok) {
    throw new ApiError(`Errore della fonte di verifica (${res.status}).`, res.status);
  }
  return res.json();
}

export const api = {
  getTipHeight: () => fetchText("/blocks/tip/height").then(Number),
  getTipHash: () => fetchText("/blocks/tip/hash"),
  getRecentBlocks: (startHeight) =>
    fetchJson(startHeight != null ? `/blocks/${startHeight}` : "/blocks"),
  getBlock: (hash) => fetchJson(`/block/${hash}`),
  getBlockHeightHash: (height) => fetchText(`/block-height/${height}`),
  getBlockTxs: (hash, startIndex = 0) => fetchJson(`/block/${hash}/txs/${startIndex}`),
  getBlockSummary: (hash) => fetchJson(`/v1/block/${hash}/summary`),
  getTx: (txid) => fetchJson(`/tx/${txid}`),
  getAddress: (address) => fetchJson(`/address/${address}`),
  getAddressTxs: (address) => fetchJson(`/address/${address}/txs`),
  getAddressTxsChain: (address, lastTxid) =>
    fetchJson(`/address/${address}/txs/chain/${lastTxid}`),
  getMempool: () => fetchJson("/mempool"),
  getFeeEstimates: () => fetchJson("/v1/fees/recommended"),
  getDifficultyAdjustment: () => fetchJson("/v1/difficulty-adjustment"),
  getMiningHashrate: (period = "3d") => fetchJson(`/v1/mining/hashrate/${period}`),
  getMiningPools: (period = "1w") => fetchJson(`/v1/mining/pools/${period}`),
  getMiningFeeRates: (period = "1w") => fetchJson(`/v1/mining/blocks/fee-rates/${period}`),
  getPrices: () => fetchJson("/v1/prices"),
  crossCheckBlock: (hash) => fetchJsonFrom(`${CROSSCHECK_BASE_URL}/block/${hash}`),
  crossCheckTx: (txid) => fetchJsonFrom(`${CROSSCHECK_BASE_URL}/tx/${txid}`),
};

export { ApiError };
