import { api, ApiError } from "./api.js";
import * as fmt from "./format.js";

const app = document.getElementById("app");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");

function setContent(html) {
  app.innerHTML = html;
  window.scrollTo(0, 0);
}

function renderLoading(msg = "Caricamento…") {
  setContent(`<div class="loading"><div class="spinner"></div><div>${fmt.escapeHtml(msg)}</div></div>`);
}

function renderError(msg) {
  setContent(`
    <div class="error-box"><strong>Ops!</strong> ${fmt.escapeHtml(msg)}</div>
    <p><a href="#/">← Torna alla home</a></p>
  `);
}

function renderNotFound() {
  setContent(`
    <div class="error-box">Pagina non trovata.</div>
    <p><a href="#/">← Torna alla home</a></p>
  `);
}

function handleError(err) {
  console.error(err);
  const msg = err instanceof ApiError ? err.message : "Si è verificato un errore imprevisto.";
  renderError(msg);
}

function parseHash() {
  const hash = location.hash.replace(/^#\/?/, "");
  return hash.split("/").filter(Boolean).map(decodeURIComponent);
}

async function router() {
  const parts = parseHash();
  try {
    if (parts.length === 0) return await renderHome();
    switch (parts[0]) {
      case "block":
        return await renderBlock(parts[1]);
      case "tx":
        return await renderTx(parts[1]);
      case "address":
        return await renderAddress(parts[1]);
      case "glossario":
        return renderGlossary();
      case "search":
        return await renderSearch(parts[1]);
      default:
        return renderNotFound();
    }
  } catch (err) {
    handleError(err);
  }
}

// ---------- Home ----------

function blockRowHtml(b) {
  return `
    <li class="block-row">
      <a class="height" href="#/block/${b.height}">#${fmt.formatNumber(b.height)}</a>
      <span class="mono small muted">${fmt.shortHash(b.id)}</span>
      <span class="small muted">${fmt.formatTimeAgo(b.timestamp)}</span>
      <span class="small">${fmt.formatNumber(b.tx_count)} tx</span>
      <span class="small muted">${fmt.formatBytes(b.size)}</span>
    </li>`;
}

async function renderHome() {
  renderLoading("Carico gli ultimi dati dalla blockchain…");
  const [tipHeight, blocks, mempool, fees] = await Promise.all([
    api.getTipHeight(),
    api.getRecentBlocks(),
    api.getMempool(),
    api.getFeeEstimates(),
  ]);

  setContent(`
    <div class="intro-box">
      <h1>Benvenuto nel Block Explorer di Bitcoin in the Club</h1>
      <p>
        Un block explorer ti permette di "guardare dentro" la blockchain di Bitcoin: puoi controllare
        blocchi, transazioni e indirizzi in tempo reale, in modo semplice e trasparente. Non serve essere
        esperti: cerca qualcosa nella barra qui sopra, oppure esplora gli ultimi blocchi qui sotto. Se un
        termine non ti è chiaro, dai un'occhiata al <a href="#/glossario">glossario</a>.
      </p>
    </div>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="label">Ultimo blocco <span class="help-icon" title="L'altezza indica quanti blocchi sono stati minati dall'inizio di Bitcoin, nel 2009.">?</span></div>
        <div class="value">#${fmt.formatNumber(tipHeight)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Transazioni in attesa <span class="help-icon" title="Sono le transazioni nella mempool, in attesa di essere incluse in un blocco.">?</span></div>
        <div class="value">${fmt.formatNumber(mempool.count)}</div>
        <div class="sub">${fmt.formatBytes(mempool.vsize)} di dati</div>
      </div>
      <div class="stat-card">
        <div class="label">Fee consigliata <span class="help-icon" title="Quanto pagare per byte (sat/vB) per far confermare una transazione più o meno velocemente.">?</span></div>
        <div class="value">${fees.halfHourFee} sat/vB</div>
        <div class="sub">veloce: ${fees.fastestFee} · economica: ${fees.economyFee}</div>
      </div>
    </div>

    <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem;">
      <h2 class="section-title">Ultimi blocchi minati</h2>
      <button class="btn" id="home-refresh">↻ Aggiorna</button>
    </div>
    <ul class="block-list">${blocks.slice(0, 10).map(blockRowHtml).join("")}</ul>
  `);

  document.getElementById("home-refresh").addEventListener("click", () => {
    if (parseHash().length === 0) renderHome().catch(handleError);
  });
}

// ---------- Search resolution ----------

async function renderSearch(rawQuery) {
  const query = (rawQuery || "").trim();
  if (!query) return renderHome();
  renderLoading(`Ricerca di "${query}"…`);

  if (/^\d+$/.test(query)) {
    location.hash = `#/block/${query}`;
    return;
  }

  if (/^[0-9a-fA-F]{64}$/.test(query)) {
    try {
      await api.getBlock(query);
      location.hash = `#/block/${query}`;
      return;
    } catch {
      // not a block hash, try as transaction id
    }
    try {
      await api.getTx(query);
      location.hash = `#/tx/${query}`;
      return;
    } catch {
      // not a transaction either
    }
    return renderError(`Nessun blocco o transazione trovato con l'hash "${fmt.shortHash(query)}".`);
  }

  try {
    await api.getAddress(query);
    location.hash = `#/address/${query}`;
  } catch {
    renderError(
      `Nessun risultato trovato per "${query}". Verifica di aver digitato correttamente un'altezza blocco, un hash oppure un indirizzo Bitcoin.`
    );
  }
}

// ---------- Block ----------

function txRowHtml(tx) {
  const isCoinbase = Boolean(tx.vin?.[0]?.is_coinbase);
  const totalOut = tx.vout.reduce((s, o) => s + o.value, 0);
  return `
    <li class="tx-row">
      <a class="mono small" href="#/tx/${tx.txid}">${fmt.shortHash(tx.txid)}</a>
      <span class="small muted">${isCoinbase ? "Coinbase (ricompensa)" : `${tx.vin.length} input → ${tx.vout.length} output`}</span>
      <span class="small">${fmt.formatBtc(totalOut)}</span>
      ${!isCoinbase ? `<span class="small muted">fee: ${fmt.formatSats(tx.fee)}</span>` : ""}
    </li>`;
}

async function renderBlock(param) {
  if (!param) return renderNotFound();
  renderLoading("Carico i dettagli del blocco…");

  const hash = /^\d+$/.test(param) ? await api.getBlockHeightHash(Number(param)) : param;
  const [block, tipHeight] = await Promise.all([api.getBlock(hash), api.getTipHeight()]);
  const confirmations = tipHeight - block.height + 1;

  let nextHash = null;
  if (block.height < tipHeight) {
    try {
      nextHash = await api.getBlockHeightHash(block.height + 1);
    } catch {
      nextHash = null;
    }
  }

  const page = 0;
  const txs = await api.getBlockTxs(hash, page * 25);

  setContent(`
    <div class="breadcrumb"><a href="#/">Home</a> / Blocco #${fmt.formatNumber(block.height)}</div>
    <h1>Blocco #${fmt.formatNumber(block.height)}</h1>
    <p class="muted">
      Minato ${fmt.formatTimeAgo(block.timestamp)} (${fmt.formatDate(block.timestamp)})
      · <span class="badge confirmed">${fmt.formatNumber(confirmations)} conferme</span>
    </p>

    <div class="nav-buttons">
      ${block.previousblockhash ? `<a class="btn" href="#/block/${block.previousblockhash}">← Blocco precedente</a>` : "<span></span>"}
      ${nextHash ? `<a class="btn" href="#/block/${nextHash}">Blocco successivo →</a>` : "<span></span>"}
    </div>

    <div class="card">
      <div class="info-grid">
        <div class="item"><div class="k">Hash del blocco</div><div class="v mono small">${block.id}</div></div>
        <div class="item"><div class="k">Numero di transazioni</div><div class="v">${fmt.formatNumber(block.tx_count)}</div></div>
        <div class="item"><div class="k">Dimensione</div><div class="v">${fmt.formatBytes(block.size)}</div></div>
      </div>
      <details class="tech-details">
        <summary>Dettagli tecnici avanzati</summary>
        <div class="info-grid">
          <div class="item"><div class="k">Peso (weight)</div><div class="v">${fmt.formatNumber(block.weight)} WU</div></div>
          <div class="item"><div class="k">Versione</div><div class="v">${block.version}</div></div>
          <div class="item"><div class="k">Bits</div><div class="v">${block.bits}</div></div>
          <div class="item"><div class="k">Nonce</div><div class="v">${block.nonce}</div></div>
          <div class="item"><div class="k">Difficoltà</div><div class="v">${fmt.formatNumber(Math.round(block.difficulty))}</div></div>
          <div class="item"><div class="k">Merkle root</div><div class="v mono small">${block.merkle_root}</div></div>
        </div>
      </details>
    </div>

    <h2 class="section-title">Transazioni in questo blocco</h2>
    <ul class="tx-list" id="block-tx-list">${txs.map(txRowHtml).join("")}</ul>
    <div class="pagination">
      <button class="btn" id="block-tx-prev" ${page === 0 ? "disabled" : ""}>← Precedenti</button>
      <span class="small muted" id="block-tx-page-label">Transazioni ${page * 25 + 1}–${Math.min(page * 25 + 25, block.tx_count)} di ${fmt.formatNumber(block.tx_count)}</span>
      <button class="btn" id="block-tx-next" ${page * 25 + 25 >= block.tx_count ? "disabled" : ""}>Successive →</button>
    </div>
  `);

  wireBlockTxPagination(hash, block.tx_count, page);
}

function wireBlockTxPagination(hash, txCount, page) {
  document.getElementById("block-tx-prev").onclick = () => renderBlockTxPage(hash, txCount, page - 1);
  document.getElementById("block-tx-next").onclick = () => renderBlockTxPage(hash, txCount, page + 1);
}

async function renderBlockTxPage(hash, txCount, page) {
  const listEl = document.getElementById("block-tx-list");
  const labelEl = document.getElementById("block-tx-page-label");
  const prevBtn = document.getElementById("block-tx-prev");
  const nextBtn = document.getElementById("block-tx-next");
  listEl.innerHTML = `<li class="loading"><div class="spinner"></div></li>`;
  prevBtn.disabled = true;
  nextBtn.disabled = true;
  try {
    const txs = await api.getBlockTxs(hash, page * 25);
    listEl.innerHTML = txs.map(txRowHtml).join("");
    labelEl.textContent = `Transazioni ${page * 25 + 1}–${Math.min(page * 25 + 25, txCount)} di ${fmt.formatNumber(txCount)}`;
    prevBtn.disabled = page === 0;
    nextBtn.disabled = page * 25 + 25 >= txCount;
    wireBlockTxPagination(hash, txCount, page);
  } catch {
    listEl.innerHTML = `<li class="error-box">Impossibile caricare le transazioni. Riprova.</li>`;
    prevBtn.disabled = page === 0;
    nextBtn.disabled = false;
    wireBlockTxPagination(hash, txCount, page);
  }
}

// ---------- Transaction ----------

async function renderTx(txid) {
  if (!txid) return renderNotFound();
  renderLoading("Carico i dettagli della transazione…");
  const tx = await api.getTx(txid);
  const confirmed = tx.status.confirmed;

  let confirmations = 0;
  if (confirmed) {
    const tipHeight = await api.getTipHeight();
    confirmations = tipHeight - tx.status.block_height + 1;
  }

  const isCoinbase = Boolean(tx.vin?.[0]?.is_coinbase);
  const totalIn = isCoinbase ? null : tx.vin.reduce((s, i) => s + (i.prevout?.value || 0), 0);
  const totalOut = tx.vout.reduce((s, o) => s + o.value, 0);
  const vsize = Math.ceil(tx.weight / 4);
  const feeRate = isCoinbase ? null : (tx.fee / vsize).toFixed(1);

  const inputsHtml = isCoinbase
    ? `<li class="io-row"><span class="addr muted">Nuove monete create (ricompensa blocco)</span></li>`
    : tx.vin
        .map(
          (vin) => `
      <li class="io-row">
        <span class="addr">${
          vin.prevout?.scriptpubkey_address
            ? `<a href="#/address/${vin.prevout.scriptpubkey_address}">${fmt.shortAddress(vin.prevout.scriptpubkey_address)}</a>`
            : "Script complesso"
        }</span>
        <span class="amt">${vin.prevout ? fmt.formatBtc(vin.prevout.value) : "-"}</span>
      </li>`
        )
        .join("");

  const outputsHtml = tx.vout
    .map((vout) => {
      if (vout.scriptpubkey_type === "op_return") {
        return `<li class="io-row"><span class="addr muted">Dati OP_RETURN (nessun trasferimento)</span><span class="amt">0 BTC</span></li>`;
      }
      return `
      <li class="io-row">
        <span class="addr">${
          vout.scriptpubkey_address
            ? `<a href="#/address/${vout.scriptpubkey_address}">${fmt.shortAddress(vout.scriptpubkey_address)}</a>`
            : "Script complesso"
        }</span>
        <span class="amt">${fmt.formatBtc(vout.value)}</span>
      </li>`;
    })
    .join("");

  setContent(`
    <div class="breadcrumb"><a href="#/">Home</a> / Transazione</div>
    <h1>Transazione</h1>
    <p class="mono small" style="word-break:break-all;">${tx.txid}</p>
    <p>
      ${
        confirmed
          ? `<span class="badge confirmed">✔ Confermata — ${fmt.formatNumber(confirmations)} conferme</span> <a class="small" href="#/block/${tx.status.block_height}">nel blocco #${fmt.formatNumber(tx.status.block_height)}</a>`
          : `<span class="badge pending">⏳ In attesa in mempool</span>`
      }
    </p>

    <div class="card">
      <p><strong>In parole semplici:</strong>
        ${
          isCoinbase
            ? `Questa è una transazione speciale: il miner ha creato ${fmt.formatBtc(totalOut)} come ricompensa per aver minato il blocco.`
            : `Sono stati inviati in totale ${fmt.formatBtc(totalOut)}, prelevando ${fmt.formatBtc(totalIn)} dagli indirizzi mittenti. La differenza, ${fmt.formatBtc(tx.fee)}, è la commissione (fee) pagata ai miner (circa ${feeRate} sat/vB).`
        }
      </p>
      <div class="io-columns">
        <div>
          <h3 class="small muted">Da (input)</h3>
          <ul class="io-list">${inputsHtml}</ul>
        </div>
        <div>
          <h3 class="small muted">A (output)</h3>
          <ul class="io-list">${outputsHtml}</ul>
        </div>
      </div>
      <details class="tech-details">
        <summary>Dettagli tecnici avanzati</summary>
        <div class="info-grid">
          <div class="item"><div class="k">Dimensione</div><div class="v">${fmt.formatBytes(tx.size)}</div></div>
          <div class="item"><div class="k">Peso (weight)</div><div class="v">${fmt.formatNumber(tx.weight)} WU</div></div>
          <div class="item"><div class="k">vSize</div><div class="v">${fmt.formatNumber(vsize)} vB</div></div>
          <div class="item"><div class="k">Versione</div><div class="v">${tx.version}</div></div>
          <div class="item"><div class="k">Locktime</div><div class="v">${tx.locktime}</div></div>
          ${!isCoinbase ? `<div class="item"><div class="k">Fee totale</div><div class="v">${fmt.formatBtc(tx.fee)} (${fmt.formatSats(tx.fee)})</div></div>` : ""}
        </div>
      </details>
    </div>
  `);
}

// ---------- Address ----------

function addrTxListHtml(txs, address) {
  return txs
    .map((tx) => {
      const received = tx.vout
        .filter((o) => o.scriptpubkey_address === address)
        .reduce((s, o) => s + o.value, 0);
      const sent = (tx.vin || [])
        .filter((i) => i.prevout?.scriptpubkey_address === address)
        .reduce((s, i) => s + i.prevout.value, 0);
      const net = received - sent;
      const confirmed = tx.status.confirmed;
      return `
      <li class="tx-row">
        <a class="mono small" href="#/tx/${tx.txid}">${fmt.shortHash(tx.txid)}</a>
        <span class="small">${confirmed ? `<span class="badge confirmed">confermata</span>` : `<span class="badge pending">in attesa</span>`}</span>
        <span class="small muted">${confirmed ? fmt.formatTimeAgo(tx.status.block_time) : "mempool"}</span>
        <span class="amount ${net >= 0 ? "positive" : "negative"}">${fmt.formatBtc(net, { sign: true })}</span>
      </li>`;
    })
    .join("");
}

async function renderAddress(address) {
  if (!address) return renderNotFound();
  renderLoading("Carico i dettagli dell'indirizzo…");
  const info = await api.getAddress(address);
  const txs = await api.getAddressTxs(address);

  const funded = info.chain_stats.funded_txo_sum + info.mempool_stats.funded_txo_sum;
  const spent = info.chain_stats.spent_txo_sum + info.mempool_stats.spent_txo_sum;
  const balance = funded - spent;
  const txCount = info.chain_stats.tx_count + info.mempool_stats.tx_count;

  setContent(`
    <div class="breadcrumb"><a href="#/">Home</a> / Indirizzo</div>
    <h1>Indirizzo</h1>
    <p class="mono small" style="word-break:break-all;">${fmt.escapeHtml(address)}</p>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="label">Saldo attuale</div>
        <div class="value">${fmt.formatBtc(balance)}</div>
        <div class="sub">${fmt.formatSats(balance)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Ricevuto in totale</div>
        <div class="value">${fmt.formatBtc(funded)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Transazioni</div>
        <div class="value">${fmt.formatNumber(txCount)}</div>
      </div>
    </div>

    <h2 class="section-title">Cronologia transazioni</h2>
    ${
      txs.length === 0
        ? `<div class="empty-state">Nessuna transazione trovata per questo indirizzo.</div>`
        : `<ul class="tx-list" id="addr-tx-list">${addrTxListHtml(txs, address)}</ul>
           ${txs.length >= 25 ? `<div class="pagination"><button class="btn" id="addr-load-more">Carica altre</button></div>` : ""}`
    }
  `);

  if (txs.length >= 25) {
    let lastTxid = txs[txs.length - 1].txid;
    document.getElementById("addr-load-more").addEventListener("click", async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = "Carico…";
      try {
        const more = await api.getAddressTxsChain(address, lastTxid);
        if (more.length === 0) {
          btn.remove();
          return;
        }
        document.getElementById("addr-tx-list").insertAdjacentHTML("beforeend", addrTxListHtml(more, address));
        lastTxid = more[more.length - 1].txid;
        btn.disabled = false;
        btn.textContent = "Carica altre";
        if (more.length < 25) btn.remove();
      } catch {
        btn.disabled = false;
        btn.textContent = "Riprova";
      }
    });
  }
}

// ---------- Glossary ----------

function renderGlossary() {
  setContent(`
    <div class="breadcrumb"><a href="#/">Home</a> / Glossario</div>
    <h1>Glossario per principianti</h1>
    <p class="muted">Le parole chiave di Bitcoin, spiegate in modo semplice.</p>
    <dl class="glossary card">
      <dt>Blocco</dt>
      <dd>Un "pacchetto" di transazioni verificate e aggiunte in modo permanente alla blockchain, un po' come una pagina di un grande registro contabile pubblico.</dd>

      <dt>Altezza del blocco</dt>
      <dd>La posizione di un blocco nella catena, contando da 0 (il primo blocco, minato nel 2009).</dd>

      <dt>Transazione</dt>
      <dd>Un trasferimento di bitcoin da uno o più indirizzi mittenti a uno o più indirizzi destinatari.</dd>

      <dt>Conferma</dt>
      <dd>Ogni volta che viene minato un nuovo blocco sopra quello che contiene la tua transazione, il numero di conferme aumenta di 1. Più conferme ha una transazione, più è considerata sicura e irreversibile.</dd>

      <dt>Mempool</dt>
      <dd>La "sala d'attesa" dove le transazioni restano in attesa di essere incluse in un blocco.</dd>

      <dt>Fee (commissione)</dt>
      <dd>Quanto si paga ai miner per includere una transazione in un blocco, misurata in satoshi per byte virtuale (sat/vB). Più alta è la fee, più velocemente viene confermata la transazione.</dd>

      <dt>Hash</dt>
      <dd>Un'impronta digitale univoca, generata matematicamente, che identifica in modo certo un blocco o una transazione.</dd>

      <dt>Indirizzo</dt>
      <dd>Una sequenza di caratteri simile a un IBAN, usata per ricevere bitcoin.</dd>

      <dt>UTXO</dt>
      <dd>Unspent Transaction Output: una porzione di bitcoin non ancora spesa, un po' come una banconota nel portafoglio in attesa di essere usata.</dd>

      <dt>Satoshi (sat)</dt>
      <dd>La più piccola unità di bitcoin: 1 BTC = 100.000.000 satoshi.</dd>

      <dt>Coinbase</dt>
      <dd>La transazione speciale, presente in ogni blocco, con cui viene creata la ricompensa per il miner che ha trovato il blocco.</dd>

      <dt>OP_RETURN</dt>
      <dd>Un tipo speciale di output usato per scrivere piccoli dati sulla blockchain, senza trasferire bitcoin.</dd>
    </dl>
  `);
}

// ---------- Wiring ----------

searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return;
  location.hash = `#/search/${encodeURIComponent(q)}`;
});

window.addEventListener("hashchange", router);
router();
