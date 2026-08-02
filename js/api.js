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
};

export { ApiError };
