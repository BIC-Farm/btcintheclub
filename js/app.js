import { api, ApiError } from "./api.js";
import * as fmt from "./format.js";
import { diceRollsToMnemonic, ROLLS_REQUIRED, looksNonRandom } from "./bip39.js";
import { squarify, computeAreas, feeRateColor, FEE_COLOR_BUCKETS, COINBASE_COLOR } from "./treemap.js";

const app = document.getElementById("app");
const searchForm = document.getElementById("search-form");
const searchInput = document.getElementById("search-input");
const unitToggle = document.getElementById("unit-toggle");

function setContent(html) {
  app.innerHTML = html;
  app.classList.remove("fade-in");
  void app.offsetWidth;
  app.classList.add("fade-in");
  window.scrollTo(0, 0);
}

function copyButtonHtml(text) {
  return `<button type="button" class="copy-btn" data-copy="${fmt.escapeHtml(text)}" title="Copia negli appunti" aria-label="Copia negli appunti">📋</button>`;
}

function hashWithCopyHtml(text, extraClass = "mono small") {
  return `<span class="hash-with-copy"><span class="${extraClass}" style="word-break:break-all;">${fmt.escapeHtml(text)}</span>${copyButtonHtml(text)}</span>`;
}

function termLink(label, slug) {
  return `<a class="term-link" href="#/glossario/${slug}" title="Non sai cosa significa? Vai al glossario">${fmt.escapeHtml(label)}</a>`;
}

function confermeLabel(n) {
  return n === 1 ? "conferma" : "conferme";
}

app.addEventListener("click", async (e) => {
  const btn = e.target.closest(".copy-btn");
  if (!btn) return;
  e.preventDefault();
  try {
    await navigator.clipboard.writeText(btn.dataset.copy);
    const original = btn.textContent;
    btn.textContent = "✅";
    btn.classList.add("copied");
    setTimeout(() => {
      btn.textContent = original;
      btn.classList.remove("copied");
    }, 1200);
  } catch {
    // Clipboard API non disponibile: nessuna azione critica da recuperare.
  }
});

function renderLoading(msg = "Caricamento…") {
  setContent(`<div class="loading"><div class="spinner"></div><div>${fmt.escapeHtml(msg)}</div></div>`);
}

function renderError(msg, extraHtml = "") {
  setContent(`
    <div class="error-box"><strong>Ops!</strong> ${fmt.escapeHtml(msg)}</div>
    <p><a href="#/">← Torna alla home</a></p>
    ${extraHtml}
  `);
}

const SEARCH_HELP_HTML = `
  <div class="nav-buttons">
    <a class="btn" href="#/glossario">📖 Vai al glossario</a>
    <a class="btn" href="#/guide">🧭 Sfoglia le guide</a>
  </div>
`;

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

let viewCleanup = null;

/** Le viste che registrano listener globali (es. online/offline) passano qui una funzione di rimozione. */
function setViewCleanup(fn) {
  viewCleanup = fn;
}

async function router() {
  if (viewCleanup) {
    viewCleanup();
    viewCleanup = null;
  }
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
        return renderGlossary(parts[1]);
      case "guide":
        return parts[1] ? renderGuide(parts[1]) : renderGuideIndex();
      case "blocchi":
        return await renderAllBlocks();
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

function blockRowHtml(b, revealIndex) {
  const animated = typeof revealIndex === "number";
  const cls = animated ? " block-reveal" : "";
  const style = animated ? ` style="animation-delay:${Math.min(revealIndex * 0.06, 1)}s"` : "";
  return `
    <li>
      <a class="row-link${cls}" href="#/block/${b.height}"${style}>
        <div class="row-top">
          <span>📦 Blocco #${fmt.formatNumber(b.height)}</span>
          <span class="row-value muted">${fmt.formatTimeAgo(b.timestamp)}</span>
        </div>
        <div class="row-bottom">
          <span class="mono">${fmt.shortHash(b.id)}</span>
          <span>${fmt.formatNumber(b.tx_count)} tx · ${fmt.formatBytes(b.size)}</span>
        </div>
      </a>
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
      <span class="intro-icon">👋</span>
      <div>
        <h1>Benvenuto nel Block Explorer di Bitcoin in the Club</h1>
        <p>
          Un block explorer ti permette di "guardare dentro" la blockchain di Bitcoin: puoi controllare
          blocchi, transazioni e indirizzi in tempo reale, in modo semplice e trasparente. Non serve essere
          esperti: cerca qualcosa nella barra qui sopra, oppure esplora gli ultimi blocchi qui sotto. Se un
          termine non ti è chiaro, dai un'occhiata al <a href="#/glossario">glossario</a>.
        </p>
      </div>
    </div>

    <div class="card block-clock-card" id="block-clock-card">
      <div class="block-clock">
        <div class="block-clock-ping" id="block-clock-ping"></div>
        <svg class="block-clock-ring" viewBox="0 0 120 120" aria-hidden="true">
          <circle class="block-clock-track" cx="60" cy="60" r="52"></circle>
          <circle class="block-clock-progress" id="block-clock-progress" cx="60" cy="60" r="52"
            stroke-dasharray="${2 * Math.PI * 52}" stroke-dashoffset="${2 * Math.PI * 52}"></circle>
          <circle class="block-clock-dot" id="block-clock-dot" cx="112" cy="60" r="4"></circle>
        </svg>
        <div class="block-clock-center">
          <div class="block-clock-height" id="block-clock-height">#${fmt.formatNumber(blocks[0]?.height ?? tipHeight)}</div>
          <div class="block-clock-elapsed" id="block-clock-elapsed">00:00</div>
        </div>
      </div>
      <div class="block-clock-info">
        <p class="block-clock-title">⏱️ Block Clock <a class="help-icon" href="#/glossario/tempoblocco" title="I tempi tra un blocco e l'altro variano molto per pura casualità: è normale. Clicca per saperne di più.">?</a></p>
        <p class="small muted" id="block-clock-note">Tempo trascorso dall'ultimo blocco trovato.</p>
      </div>
    </div>

    <a class="feature-card" href="#/guide/dadi-seed">
      <span class="feature-icon">🎲</span>
      <div class="feature-body">
        <div class="feature-title">Genera una seed con i dadi <span class="feature-badge">Interattivo</span></div>
        <div class="feature-desc">Prova con mano come dei tiri di dado fisico diventano una mnemonic BIP39 — demo didattica, si sblocca solo offline.</div>
      </div>
      <span class="feature-arrow">→</span>
    </a>

    <div class="stat-grid">
      <div class="stat-card">
        <span class="stat-icon">⏳</span>
        <div>
          <div class="label">Transazioni in attesa <a class="help-icon" href="#/glossario/mempool" title="Sono le transazioni nella mempool, in attesa di essere incluse in un blocco. Clicca per saperne di più.">?</a></div>
          <div class="value">${fmt.formatNumber(mempool.count)}</div>
          <div class="sub">${fmt.formatBytes(mempool.vsize)} di dati</div>
        </div>
      </div>
      <div class="stat-card">
        <span class="stat-icon">💸</span>
        <div>
          <div class="label">Fee consigliata <a class="help-icon" href="#/glossario/fee" title="Quanto pagare per byte (sat/vB) per far confermare una transazione più o meno velocemente. Clicca per saperne di più.">?</a></div>
          <div class="value">${fees.halfHourFee} sat/vB</div>
          <div class="sub">veloce: ${fees.fastestFee} · economica: ${fees.economyFee}</div>
        </div>
      </div>
    </div>

    <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; flex-wrap:wrap;">
      <h2 class="section-title" style="margin-top:0;">Ultimi blocchi minati</h2>
      <button class="btn" id="home-refresh">↻ Aggiorna</button>
    </div>
    <ul class="block-list">${blocks.slice(0, 6).map((b) => blockRowHtml(b)).join("")}</ul>
    <div class="nav-buttons" style="justify-content:center;">
      <a class="btn btn-primary" href="#/blocchi">📦 Vedi tutti i blocchi →</a>
    </div>
  `);

  document.getElementById("home-refresh").addEventListener("click", () => {
    if (parseHash().length === 0) router();
  });

  if (blocks[0]) startBlockClock(blocks[0].height, blocks[0].timestamp);
}

const BLOCK_CLOCK_AVG_SECONDS = 600;

function describeBlockClockElapsed(elapsed) {
  if (elapsed < 300) return "Ultimo blocco trovato da poco.";
  if (elapsed <= BLOCK_CLOCK_AVG_SECONDS) return "Il prossimo blocco potrebbe arrivare a breve.";
  return "Il prossimo blocco può arrivare da un momento all'altro — i tempi variano molto, è normale.";
}

function startBlockClock(initialHeight, initialTimestamp) {
  const circumference = 2 * Math.PI * 52;
  let height = initialHeight;
  let blockTime = initialTimestamp;
  let celebrateUntil = 0;

  const card = document.getElementById("block-clock-card");
  const ring = document.getElementById("block-clock-progress");
  const dot = document.getElementById("block-clock-dot");
  const ping = document.getElementById("block-clock-ping");
  const heightEl = document.getElementById("block-clock-height");
  const elapsedEl = document.getElementById("block-clock-elapsed");
  const noteEl = document.getElementById("block-clock-note");
  if (!card || !ring || !dot || !ping || !heightEl || !elapsedEl || !noteEl) return;

  function tick() {
    const elapsed = Math.max(0, Math.floor(Date.now() / 1000 - blockTime));
    const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
    const ss = String(elapsed % 60).padStart(2, "0");
    elapsedEl.textContent = `${mm}:${ss}`;
    if (Date.now() > celebrateUntil) {
      noteEl.textContent = describeBlockClockElapsed(elapsed);
    }

    const progress = Math.min(elapsed / BLOCK_CLOCK_AVG_SECONDS, 1);
    ring.style.strokeDashoffset = String(circumference * (1 - progress));
    ring.classList.toggle("overdue", elapsed > BLOCK_CLOCK_AVG_SECONDS);

    const angle = progress * 2 * Math.PI;
    dot.setAttribute("cx", String(60 + 52 * Math.cos(angle)));
    dot.setAttribute("cy", String(60 + 52 * Math.sin(angle)));
    dot.style.opacity = progress > 0 && progress < 1 ? "1" : "0";
  }

  tick();
  const tickTimer = setInterval(tick, 1000);

  async function poll() {
    try {
      const tip = await api.getTipHeight();
      if (tip > height) {
        const newHash = await api.getBlockHeightHash(tip);
        const newBlock = await api.getBlock(newHash);
        height = tip;
        blockTime = newBlock.timestamp;
        heightEl.textContent = `#${fmt.formatNumber(height)}`;
        celebrateUntil = Date.now() + 3000;
        noteEl.textContent = "🎉 Nuovo blocco trovato proprio ora!";
        tick();

        heightEl.classList.remove("pop");
        void heightEl.offsetWidth;
        heightEl.classList.add("pop");

        ping.classList.remove("active");
        void ping.offsetWidth;
        ping.classList.add("active");

        card.classList.add("block-found");
        setTimeout(() => card.classList.remove("block-found"), 2500);
      }
    } catch {
      // Errore di rete silenzioso: si riprova al prossimo giro senza interrompere l'orologio.
    }
  }

  const pollTimer = setInterval(poll, 20000);

  setViewCleanup(() => {
    clearInterval(tickTimer);
    clearInterval(pollTimer);
  });
}

// ---------- Blocchi (elenco completo) ----------

async function renderAllBlocks() {
  renderLoading("Carico gli ultimi blocchi…");
  const blocks = await api.getRecentBlocks();
  setContent(`
    <div class="breadcrumb"><a href="#/">Home</a> / Tutti i blocchi</div>
    <h1>📦 Tutti i blocchi</h1>
    <p class="muted">
      Ogni blocco minato, dal più recente al più vecchio. Scorri e premi "Carica altri blocchi" per
      andare indietro nel tempo — ogni riga che compare è un nuovo pezzo di storia della blockchain.
    </p>
    <ul class="block-list" id="all-blocks-list">${blocks.map((b, i) => blockRowHtml(b, i)).join("")}</ul>
    <div class="nav-buttons" style="justify-content:center;">
      <button class="btn btn-primary" id="all-blocks-more">Carica altri blocchi ↓</button>
    </div>
  `);
  wireAllBlocksLoadMore(blocks[blocks.length - 1]?.height);
}

function wireAllBlocksLoadMore(oldestHeight) {
  const btn = document.getElementById("all-blocks-more");
  const list = document.getElementById("all-blocks-list");
  if (!btn || !list) return;
  let nextHeight = oldestHeight;

  btn.addEventListener("click", async () => {
    if (nextHeight == null || nextHeight <= 0) {
      btn.remove();
      return;
    }
    btn.disabled = true;
    btn.textContent = "Carico…";
    try {
      const startHeight = nextHeight - 1;
      if (startHeight < 0) {
        btn.remove();
        return;
      }
      const more = await api.getRecentBlocks(startHeight);
      list.insertAdjacentHTML(
        "beforeend",
        more.map((b, i) => blockRowHtml(b, i)).join("")
      );
      nextHeight = more[more.length - 1]?.height;
      btn.disabled = false;
      btn.textContent = "Carica altri blocchi ↓";
      if (nextHeight === 0 || more.length === 0) btn.remove();
    } catch {
      btn.disabled = false;
      btn.textContent = "Riprova";
    }
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
    return renderError(`Nessun blocco o transazione trovato con l'hash "${fmt.shortHash(query)}".`, SEARCH_HELP_HTML);
  }

  try {
    await api.getAddress(query);
    location.hash = `#/address/${query}`;
  } catch {
    renderError(
      `Nessun risultato trovato per "${query}". Verifica di aver digitato correttamente un'altezza blocco, un hash oppure un indirizzo Bitcoin. Se invece cercavi una spiegazione, prova qui sotto.`,
      SEARCH_HELP_HTML
    );
  }
}

// ---------- Block ----------

function txRowHtml(tx) {
  const isCoinbase = Boolean(tx.vin?.[0]?.is_coinbase);
  const totalOut = tx.vout.reduce((s, o) => s + o.value, 0);
  return `
    <li>
      <a class="row-link" href="#/tx/${tx.txid}">
        <div class="row-top">
          <span class="mono">${fmt.shortHash(tx.txid)}</span>
          <span class="row-value">${fmt.formatBtc(totalOut)}</span>
        </div>
        <div class="row-bottom">
          <span>${isCoinbase ? "⛏️ Coinbase (ricompensa)" : `${tx.vin.length} input → ${tx.vout.length} output`}</span>
          ${!isCoinbase ? `<span>fee: ${fmt.formatSats(tx.fee)}</span>` : ""}
        </div>
      </a>
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
      · <span class="badge confirmed">${fmt.formatNumber(confirmations)} ${termLink(confermeLabel(confirmations), "conferma")}</span>
    </p>

    <div class="nav-buttons">
      ${block.previousblockhash ? `<a class="btn" href="#/block/${block.previousblockhash}">← Blocco precedente</a>` : "<span></span>"}
      ${nextHash ? `<a class="btn" href="#/block/${nextHash}">Blocco successivo →</a>` : "<span></span>"}
    </div>

    <div class="card">
      <div class="info-grid">
        <div class="item"><div class="k">${termLink("Hash del blocco", "hash")}</div><div class="v">${hashWithCopyHtml(block.id)}</div></div>
        <div class="item"><div class="k">Numero di ${termLink("transazioni", "transazione")}</div><div class="v">${fmt.formatNumber(block.tx_count)}</div></div>
        <div class="item"><div class="k">Dimensione</div><div class="v">${fmt.formatBytes(block.size)}</div></div>
      </div>
      <details class="tech-details">
        <summary>Dettagli tecnici avanzati</summary>
        <div class="info-grid">
          <div class="item"><div class="k">${termLink("Peso (weight)", "peso")}</div><div class="v">${fmt.formatNumber(block.weight)} WU</div></div>
          <div class="item"><div class="k">${termLink("Versione", "versione")}</div><div class="v">${block.version}</div></div>
          <div class="item"><div class="k">${termLink("Bits", "bits")}</div><div class="v">${block.bits}</div></div>
          <div class="item"><div class="k">${termLink("Nonce", "nonce")}</div><div class="v">${block.nonce}</div></div>
          <div class="item"><div class="k">${termLink("Difficoltà", "difficolta")}</div><div class="v">${fmt.formatNumber(Math.round(block.difficulty))}</div></div>
          <div class="item"><div class="k">${termLink("Merkle root", "merkleroot")}</div><div class="v mono small">${block.merkle_root}</div></div>
        </div>
      </details>
    </div>

    <h2 class="section-title">🧩 Composizione del blocco</h2>
    <p class="small muted">
      Ogni rettangolo è una ${termLink("transazione", "transazione")} vera, scaricata in questo momento
      dalla rete: l'area è proporzionale al suo ${termLink("peso", "peso")}, il colore alla fee pagata.
      Passa il mouse per i dettagli, clicca per aprirla.
    </p>
    <div class="card">
      <div class="treemap-wrap" id="block-treemap-wrap">
        <div class="loading"><div class="spinner"></div><div>Carico la composizione del blocco…</div></div>
      </div>
      <div class="treemap-legend" id="block-treemap-legend"></div>
    </div>

    <h2 class="section-title">Transazioni in questo blocco</h2>
    <p class="small muted">Ogni riga è una ${termLink("transazione", "transazione")}: mostra gli ${termLink("input", "input")} e gli ${termLink("output", "output")} coinvolti, più la ${termLink("fee", "fee")} pagata ai miner.</p>
    <ul class="tx-list" id="block-tx-list">${txs.map(txRowHtml).join("")}</ul>
    <div class="pagination">
      <button class="btn" id="block-tx-prev" ${page === 0 ? "disabled" : ""}>← Precedenti</button>
      <span class="small muted" id="block-tx-page-label">Transazioni ${page * 25 + 1}–${Math.min(page * 25 + 25, block.tx_count)} di ${fmt.formatNumber(block.tx_count)}</span>
      <button class="btn" id="block-tx-next" ${page * 25 + 25 >= block.tx_count ? "disabled" : ""}>Successive →</button>
    </div>
  `);

  wireBlockTxPagination(hash, block.tx_count, page);
  loadBlockTreemap(hash);
}

async function loadBlockTreemap(hash) {
  const wrap = document.getElementById("block-treemap-wrap");
  const legend = document.getElementById("block-treemap-legend");
  if (!wrap) return;

  try {
    const summary = await api.getBlockSummary(hash);
    if (!wrap.isConnected) return; // l'utente ha già cambiato pagina

    if (summary.length === 0) {
      wrap.innerHTML = `<div class="empty-state">Nessuna transazione da mostrare.</div>`;
      return;
    }

    const W = 1000;
    const H = 560;
    const sizes = summary.map((tx) => Math.max(tx.vsize || 1, 1));
    const areas = computeAreas(sizes, W, H);
    const items = areas.map((area, i) => ({ area, data: { tx: summary[i], isCoinbase: i === 0 } }));
    const rects = squarify(items, 0, 0, W, H);

    wrap.innerHTML = rects
      .map((r) => {
        const { tx, isCoinbase } = r.data;
        const feeRate = tx.vsize > 0 ? tx.fee / tx.vsize : 0;
        const color = isCoinbase ? COINBASE_COLOR : feeRateColor(feeRate);
        const title = isCoinbase
          ? "⛏️ Coinbase — ricompensa del blocco"
          : `${fmt.shortHash(tx.txid, 8)} · ${fmt.formatNumber(tx.vsize)} vB · ${fmt.formatSats(tx.fee)} · ${feeRate.toFixed(1)} sat/vB`;
        return `<a class="treemap-rect" href="#/tx/${tx.txid}" title="${fmt.escapeHtml(title)}" style="left:${(r.x / W) * 100}%; top:${(r.y / H) * 100}%; width:${(r.w / W) * 100}%; height:${(r.h / H) * 100}%; background:${color};"></a>`;
      })
      .join("");

    legend.innerHTML =
      FEE_COLOR_BUCKETS.map(
        (b) => `<span class="legend-item"><span class="legend-swatch" style="background:${b.color}"></span>${b.label}</span>`
      ).join("") +
      `<span class="legend-item"><span class="legend-swatch" style="background:${COINBASE_COLOR}"></span>⛏️ Coinbase</span>`;
  } catch {
    if (wrap.isConnected) {
      wrap.innerHTML = `<div class="empty-state">Impossibile caricare la composizione del blocco.</div>`;
    }
  }
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
        return `<li class="io-row"><span class="addr muted">Dati ${termLink("OP_RETURN", "opreturn")} (nessun trasferimento)</span><span class="amt">0 BTC</span></li>`;
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
    <p>${hashWithCopyHtml(tx.txid)}</p>
    <p>
      ${
        confirmed
          ? `<span class="badge confirmed">✔ Confermata — ${fmt.formatNumber(confirmations)} ${termLink(confermeLabel(confirmations), "conferma")}</span> <a class="small" href="#/block/${tx.status.block_height}">nel blocco #${fmt.formatNumber(tx.status.block_height)}</a>`
          : `<span class="badge pending">⏳ In attesa in ${termLink("mempool", "mempool")}</span>`
      }
    </p>

    <div class="card">
      <p><strong>In parole semplici:</strong>
        ${
          isCoinbase
            ? `Questa è una transazione speciale: il miner ha creato ${fmt.formatBtc(totalOut)} come ricompensa per aver minato il blocco.`
            : `Sono stati inviati in totale ${fmt.formatBtc(totalOut)}, prelevando ${fmt.formatBtc(totalIn)} dagli indirizzi mittenti. La differenza, ${fmt.formatBtc(tx.fee)}, è la ${termLink("commissione (fee)", "fee")} pagata ai miner (circa ${feeRate} sat/vB).`
        }
      </p>
      <div class="io-columns">
        <div>
          <h3 class="small muted">Da (${termLink("input", "input")})</h3>
          <ul class="io-list">${inputsHtml}</ul>
        </div>
        <div>
          <h3 class="small muted">A (${termLink("output", "output")})</h3>
          <ul class="io-list">${outputsHtml}</ul>
        </div>
      </div>
      <details class="tech-details">
        <summary>Dettagli tecnici avanzati</summary>
        <div class="info-grid">
          <div class="item"><div class="k">Dimensione</div><div class="v">${fmt.formatBytes(tx.size)}</div></div>
          <div class="item"><div class="k">${termLink("Peso (weight)", "peso")}</div><div class="v">${fmt.formatNumber(tx.weight)} WU</div></div>
          <div class="item"><div class="k">${termLink("vSize", "peso")}</div><div class="v">${fmt.formatNumber(vsize)} vB</div></div>
          <div class="item"><div class="k">${termLink("Versione", "versione")}</div><div class="v">${tx.version}</div></div>
          <div class="item"><div class="k">${termLink("Locktime", "locktime")}</div><div class="v">${tx.locktime}</div></div>
          ${!isCoinbase ? `<div class="item"><div class="k">${termLink("Fee totale", "fee")}</div><div class="v">${fmt.formatBtc(tx.fee)} (${fmt.formatAlt(tx.fee)})</div></div>` : ""}
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
      <li>
        <a class="row-link" href="#/tx/${tx.txid}">
          <div class="row-top">
            <span class="mono">${fmt.shortHash(tx.txid)}</span>
            <span class="row-value amount ${net >= 0 ? "positive" : "negative"}">${fmt.formatBtc(net, { sign: true })}</span>
          </div>
          <div class="row-bottom">
            ${confirmed ? `<span class="badge confirmed">✔ confermata</span>` : `<span class="badge pending">⏳ in attesa</span>`}
            <span>${confirmed ? fmt.formatTimeAgo(tx.status.block_time) : "in mempool"}</span>
          </div>
        </a>
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
    <p>${hashWithCopyHtml(address)}</p>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="label">Saldo attuale <a class="help-icon" href="#/glossario/utxo" title="Il saldo è la somma degli UTXO non spesi ricevuti da questo indirizzo. Clicca per saperne di più.">?</a></div>
        <div class="value">${fmt.formatBtc(balance)}</div>
        <div class="sub">${fmt.formatAlt(balance)}</div>
      </div>
      <div class="stat-card">
        <div class="label">Ricevuto in totale</div>
        <div class="value">${fmt.formatBtc(funded)}</div>
      </div>
      <div class="stat-card">
        <div class="label">${termLink("Transazioni", "transazione")}</div>
        <div class="value">${fmt.formatNumber(txCount)}</div>
      </div>
    </div>

    <h2 class="section-title">Cronologia transazioni</h2>
    ${
      txs.length === 0
        ? `<div class="empty-state">Nessuna transazione trovata per questo indirizzo.</div>`
        : `<p class="small muted">✔ ${termLink("Confermata", "conferma")} = già inclusa in un blocco · ⏳ in attesa = ancora in ${termLink("mempool", "mempool")}.</p>
           <ul class="tx-list" id="addr-tx-list">${addrTxListHtml(txs, address)}</ul>
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

const GLOSSARY_TERMS = [
  { slug: "blocco", icon: "📦", term: "Blocco", desc: `Un "pacchetto" di transazioni verificate e aggiunte in modo permanente alla blockchain, un po' come una pagina di un grande registro contabile pubblico.` },
  { slug: "altezza", icon: "📏", term: "Altezza del blocco", desc: "La posizione di un blocco nella catena, contando da 0 (il primo blocco, minato nel 2009)." },
  { slug: "transazione", icon: "🔄", term: "Transazione", desc: "Un trasferimento di bitcoin da uno o più indirizzi mittenti a uno o più indirizzi destinatari." },
  { slug: "conferma", icon: "✔️", term: "Conferma", desc: "Ogni volta che viene minato un nuovo blocco sopra quello che contiene la tua transazione, il numero di conferme aumenta di 1. Più conferme ha una transazione, più è considerata sicura e irreversibile." },
  { slug: "mempool", icon: "⏳", term: "Mempool", desc: `La "sala d'attesa" dove le transazioni restano in attesa di essere incluse in un blocco.` },
  { slug: "fee", icon: "💸", term: "Fee (commissione)", desc: "Quanto si paga ai miner per includere una transazione in un blocco, misurata in satoshi per byte virtuale (sat/vB). Più alta è la fee, più velocemente viene confermata la transazione." },
  { slug: "hash", icon: "🔑", term: "Hash", desc: "Un'impronta digitale univoca, generata matematicamente, che identifica in modo certo un blocco o una transazione." },
  { slug: "indirizzo", icon: "🏷️", term: "Indirizzo", desc: "Una sequenza di caratteri simile a un IBAN, usata per ricevere bitcoin." },
  { slug: "utxo", icon: "🪙", term: "UTXO", desc: "Unspent Transaction Output: una porzione di bitcoin non ancora spesa, un po' come una banconota nel portafoglio in attesa di essere usata." },
  { slug: "satoshi", icon: "⚡", term: "Satoshi (sat)", desc: "La più piccola unità di bitcoin: 1 BTC = 100.000.000 satoshi." },
  { slug: "coinbase", icon: "⛏️", term: "Coinbase", desc: "La transazione speciale, presente in ogni blocco, con cui viene creata la ricompensa per il miner che ha trovato il blocco." },
  { slug: "opreturn", icon: "📝", term: "OP_RETURN", desc: "Un tipo speciale di output usato per scrivere piccoli dati sulla blockchain, senza trasferire bitcoin." },
  { slug: "input", icon: "⬇️", term: "Input", desc: `Ogni transazione preleva fondi da uno o più "input": UTXO precedenti che vengono spesi per finanziare il nuovo trasferimento.` },
  { slug: "output", icon: "⬆️", term: "Output", desc: `Ogni transazione crea uno o più "output": nuovi UTXO destinati agli indirizzi riceventi, incluso l'eventuale resto per il mittente.` },
  { slug: "peso", icon: "⚖️", term: "Peso (weight) e vSize", desc: "Misure della \"dimensione effettiva\" di una transazione o blocco, usate per calcolare le fee. Il peso si esprime in unità WU, il vSize (dimensione virtuale) in byte virtuali (vB) ed è pari a peso/4." },
  { slug: "nonce", icon: "🎲", term: "Nonce", desc: `Un numero che i miner cambiano continuamente cercando un hash del blocco valido: è il cuore del "mining".` },
  { slug: "difficolta", icon: "🎯", term: "Difficoltà", desc: "Un valore che regola quanto è difficile trovare un blocco valido, aggiustato periodicamente dalla rete per mantenere un blocco ogni circa 10 minuti." },
  { slug: "merkleroot", icon: "🌳", term: "Merkle root", desc: "Un'unica impronta digitale che riassume in modo sicuro tutte le transazioni di un blocco, permettendo di verificarle senza doverle scaricare tutte." },
  { slug: "bits", icon: "🔢", term: "Bits", desc: "Una rappresentazione compatta della difficoltà attuale della rete, memorizzata nell'intestazione del blocco." },
  { slug: "versione", icon: "🔖", term: "Versione", desc: "Indica quali regole del protocollo Bitcoin la transazione o il blocco seguono." },
  { slug: "locktime", icon: "⏱️", term: "Locktime", desc: "Un valore opzionale che impedisce a una transazione di essere inclusa in un blocco prima di un certo momento o di una certa altezza blocco." },
  { slug: "seed", icon: "🌱", term: "Seed phrase", desc: "Le 12 o 24 parole (frase di recupero) da cui vengono generate tutte le chiavi private del tuo wallet. Chi la conosce può spendere i tuoi bitcoin: va custodita con la massima cura e non condivisa mai con nessuno.", guide: "seed-sicura" },
  { slug: "chiaveprivata", icon: "🔐", term: "Chiave privata", desc: "Un numero segreto che dimostra matematicamente la proprietà di un indirizzo e permette di firmare le transazioni per spenderne i fondi. Va protetta come la seed da cui viene derivata." },
  { slug: "wallet", icon: "👛", term: "Wallet", desc: "Il \"portafoglio\": un programma o dispositivo che genera e custodisce le tue chiavi private e ti permette di firmare transazioni. Non contiene fisicamente i bitcoin, che restano sempre sulla blockchain." },
  { slug: "hardwarewallet", icon: "🔐", term: "Hardware wallet", desc: "Un piccolo dispositivo fisico dedicato a custodire le chiavi private offline, isolate dal computer e da internet. È lo strumento più sicuro per conservare somme importanti nel lungo periodo.", guide: "primo-wallet" },
  { slug: "phishing", icon: "🎣", term: "Phishing", desc: "Un tentativo di truffa che imita siti, email o messaggi legittimi (un wallet, un exchange, un finto supporto tecnico) per indurti a rivelare la seed, la password o l'accesso al tuo wallet.", guide: "truffe-comuni" },
  { slug: "tempoblocco", icon: "⏱️", term: "Tempo di blocco", desc: "In media viene trovato un nuovo blocco ogni 10 minuti circa, ma il tempo reale varia molto da blocco a blocco per pura casualità: attese di pochi secondi o di oltre un'ora sono entrambe normali. La difficoltà si aggiusta periodicamente per mantenere questa media nel lungo periodo." },
];

function renderGlossary(slug) {
  setContent(`
    <div class="breadcrumb"><a href="#/">Home</a> / Glossario</div>
    <h1>Glossario per principianti</h1>
    <p class="muted">Le parole chiave di Bitcoin, spiegate in modo semplice. Sei arrivato qui cliccando un termine? Lo trovi evidenziato qui sotto.</p>
    <div class="glossary-grid">
      ${GLOSSARY_TERMS.map(
        (t) => `
        <div class="glossary-card" id="term-${t.slug}">
          <div class="term"><span class="icon">${t.icon}</span> ${fmt.escapeHtml(t.term)}</div>
          <p>${fmt.escapeHtml(t.desc)}</p>
          ${t.guide ? `<p><a class="term-link" href="#/guide/${t.guide}">📖 Leggi la guida completa</a></p>` : ""}
        </div>`
      ).join("")}
    </div>
  `);

  if (slug) {
    const target = document.getElementById(`term-${slug}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("highlight");
    }
  }
}

// ---------- Guide ----------

const GUIDES = [
  {
    slug: "seed-sicura",
    icon: "🔐",
    title: "Come proteggere la tua seed phrase",
    summary: "La guida essenziale per custodire in sicurezza le parole segrete che proteggono i tuoi bitcoin.",
    body: () => `
      <div class="card">
        <p>
          La ${termLink("seed phrase", "seed")} (o frase di recupero) è una sequenza di 12 o 24 parole:
          è l'unica copia di backup del tuo ${termLink("wallet", "wallet")}, da cui vengono generate tutte
          le tue ${termLink("chiavi private", "chiaveprivata")}. Chi la conosce può spendere i tuoi bitcoin
          da qualsiasi parte del mondo, senza bisogno del tuo dispositivo. Per questo va trattata come il
          bene più prezioso che possiedi: proteggerla bene è probabilmente la competenza più importante da
          imparare quando si usa Bitcoin.
        </p>
      </div>

      <h2 class="section-title">✅ Le regole d'oro</h2>
      <div class="glossary-grid">
        <div class="tip-card good">
          <div class="tip-title">📝 Solo carta o metallo</div>
          <p>Trascrivi le parole a mano su carta, oppure incidile su una piastrina di metallo resistente al fuoco e all'acqua. Mai in forma digitale.</p>
        </div>
        <div class="tip-card good">
          <div class="tip-title">🙈 Nessuna copia digitale</div>
          <p>Non fotografarla, non scansionarla, non salvarla in note, email, cloud (Google Drive, iCloud) o password manager collegati a internet.</p>
        </div>
        <div class="tip-card good">
          <div class="tip-title">🗄️ Conservala al sicuro</div>
          <p>Una cassaforte, una cassetta di sicurezza o un nascondiglio che solo tu conosci. Valuta più copie in luoghi diversi contro incendi o furti.</p>
        </div>
        <div class="tip-card good">
          <div class="tip-title">✔️ Verifica subito il backup</div>
          <p>Molti wallet permettono di verificare la seed appena creata: fallo subito. Scoprire un errore di trascrizione dopo aver perso l'accesso è troppo tardi.</p>
        </div>
        <div class="tip-card good">
          <div class="tip-title">🤐 Zero condivisione, sempre</div>
          <p>Nessun exchange, wallet o servizio di supporto legittimo ti chiederà mai la seed. Chi te la chiede sta cercando di derubarti, punto.</p>
        </div>
        <div class="tip-card good">
          <div class="tip-title">👀 Occhio a chi ti guarda</div>
          <p>Scrivila e conservala senza che nessuno ti veda, anche in videochiamata o davanti a una telecamera.</p>
        </div>
      </div>

      <h2 class="section-title">🚫 Cosa non fare mai</h2>
      <div class="glossary-grid">
        <div class="tip-card bad">
          <div class="tip-title">📷 Non fotografarla</div>
          <p>Le foto finiscono spesso in backup cloud automatici che possono essere violati.</p>
        </div>
        <div class="tip-card bad">
          <div class="tip-title">⌨️ Non digitarla da nessuna parte</div>
          <p>Nessun sito o app legittima la richiede: se te la chiede, è quasi certamente un sito di phishing.</p>
        </div>
        <div class="tip-card bad">
          <div class="tip-title">🌐 Non usare generatori online</div>
          <p>Solo il tuo wallet, offline, deve generare la seed. Un generatore web può registrarla a tua insaputa.</p>
        </div>
        <div class="tip-card bad">
          <div class="tip-title">☎️ Non condividerla per "verifiche"</div>
          <p>È la truffa più comune: falso supporto tecnico su Telegram, Discord o email che chiede la seed per "risolvere un problema".</p>
        </div>
        <div class="tip-card bad">
          <div class="tip-title">📍 Non tenerla vicino al dispositivo</div>
          <p>Conservarla accanto all'hardware wallet o al PC vanifica la protezione in caso di furto in casa.</p>
        </div>
        <div class="tip-card bad">
          <div class="tip-title">🧠 Non fidarti solo della memoria</div>
          <p>La mente dimentica: senza un backup fisico verificato, un solo errore può costarti tutto.</p>
        </div>
      </div>

      <h2 class="section-title">⚠️ Truffe comuni da riconoscere</h2>
      <div class="warning-box">
        <ul style="margin:0; padding-left:1.2rem; display:flex; flex-direction:column; gap:0.6rem;">
          <li><strong>Falso supporto tecnico:</strong> ti contatta su social, Telegram o email fingendosi assistenza di un wallet o exchange e chiede la seed per "sbloccare" o "verificare" il tuo account.</li>
          <li><strong>Siti e app clone:</strong> copie quasi identiche di wallet famosi che rubano la seed appena viene inserita.</li>
          <li><strong>Estensioni del browser malevole:</strong> sostituiscono silenziosamente gli indirizzi copiati o chiedono accesso al wallet.</li>
          <li><strong>QR code sostituiti:</strong> in eventi o locali pubblici, adesivi con QR code falsi applicati sopra quelli reali, che portano a siti di phishing.</li>
          <li><strong>Regali o vincite improvvise:</strong> messaggi che promettono bitcoin gratuiti in cambio della tua seed "per sbloccarli".</li>
        </ul>
      </div>

      <h2 class="section-title">🆘 Pensi che la tua seed sia stata compromessa?</h2>
      <div class="danger-box">
        <p style="margin:0;">
          Non aspettare: crea un nuovo ${termLink("wallet", "wallet")} con una seed generata offline da un
          dispositivo pulito, e trasferisci subito tutti i fondi al nuovo indirizzo. Una seed compromessa
          resta a rischio per sempre, anche se il furto non è ancora avvenuto.
        </p>
      </div>
    `,
  },
  {
    slug: "dadi-seed",
    icon: "🎲",
    title: "Genera una seed con i dadi (demo didattica)",
    summary: "Prova con mano come dei tiri di dado fisico si trasformano in una mnemonic BIP39. Si sblocca solo offline.",
    interactive: true,
    featured: true,
  },
  {
    slug: "controllo-fondi",
    icon: "🔑",
    title: "Custodial o non-custodial: chi controlla davvero i tuoi bitcoin",
    summary: "La differenza più importante da capire prima di comprare il tuo primo bitcoin: chi ha in mano le chiavi private.",
    body: () => `
      <div class="card">
        <p>
          Quando compri bitcoin, la prima decisione — spesso presa senza saperlo — è dove finiscono a essere
          custoditi. Tutto dipende da chi controlla le ${termLink("chiavi private", "chiaveprivata")}: tu, o
          qualcun altro per te. Nella community Bitcoin questo principio si riassume in una frase:
          <strong>"not your keys, not your coins"</strong> — se non controlli le chiavi, non controlli davvero i fondi.
        </p>
      </div>

      <h2 class="section-title">Le due modalità</h2>
      <div class="glossary-grid">
        <div class="tip-card">
          <div class="tip-title">🏦 Custodial (es. un exchange)</div>
          <p>Comodo: nessuna seed da gestire, password recuperabile se la dimentichi. Ma i bitcoin restano
          nel controllo della piattaforma finché non li prelevi — se l'exchange fallisce, viene bloccato o
          subisce un attacco, potresti non riuscire a riprenderli.</p>
        </div>
        <div class="tip-card good">
          <div class="tip-title">👛 Non-custodial (${termLink("wallet", "wallet")} personale)</div>
          <p>Controllo totale: nessun intermediario può bloccarti o congelare i fondi. In cambio arriva la
          piena responsabilità — se perdi la ${termLink("seed phrase", "seed")} senza backup, i fondi sono
          persi per sempre, e nessuno può "recuperarti la password".</p>
        </div>
      </div>

      <div class="warning-box" style="margin-top:1rem;">
        <p style="margin:0;">
          <strong>Un consiglio pratico:</strong> per importi che vuoi davvero possedere nel lungo periodo,
          preleva su un wallet non-custodial appena puoi. Un exchange può avere senso per comprare o
          scambiare, ma non è pensato per la conservazione a lungo termine.
        </p>
      </div>

      <div class="nav-buttons">
        <a class="btn" href="#/guide/primo-wallet">Come scegliere il tuo primo wallet →</a>
        <a class="btn" href="#/guide/seed-sicura">Guida alla seed sicura →</a>
      </div>
    `,
  },
  {
    slug: "primo-wallet",
    icon: "👛",
    title: "Come scegliere il tuo primo wallet",
    summary: "Wallet software, hardware o custodial: quale scegliere in base a quanto vuoi tenere e per quanto tempo.",
    body: () => `
      <div class="card">
        <p>
          Un ${termLink("wallet", "wallet")} è il programma o dispositivo che genera e custodisce le tue
          ${termLink("chiavi private", "chiaveprivata")}. Non esiste "il migliore" in assoluto: la scelta
          giusta dipende da quanto vuoi tenere e per quanto tempo.
        </p>
      </div>

      <div class="glossary-grid">
        <div class="tip-card">
          <div class="tip-title">📱 Wallet mobile o desktop</div>
          <p>Un'app gratuita sul telefono o sul computer. Comoda per l'uso quotidiano e piccole somme, ma il
          dispositivo resta connesso a internet — adatta a un "portafoglio spiccioli", non a risparmi importanti.</p>
        </div>
        <div class="tip-card">
          <div class="tip-title">🔐 ${termLink("Hardware wallet", "hardwarewallet")}</div>
          <p>Un dispositivo fisico dedicato che tiene le chiavi sempre offline. Costa qualche decina di euro,
          ma è lo standard consigliato per somme importanti o per il risparmio a lungo termine.</p>
        </div>
        <div class="tip-card">
          <div class="tip-title">🏦 Exchange (custodial)</div>
          <p>Comodo per comprare e vendere, ma non è davvero "tuo" finché non lo prelevi su un wallet
          personale — vedi la guida su custodial e non-custodial.</p>
        </div>
      </div>

      <h2 class="section-title">Consigli pratici per iniziare</h2>
      <div class="glossary-grid">
        <div class="tip-card good">
          <div class="tip-title">🌱 Inizia in piccolo</div>
          <p>Fai pratica con una somma che puoi permetterti di perdere prima di trasferire cifre importanti.</p>
        </div>
        <div class="tip-card good">
          <div class="tip-title">👀 Verifica sempre sul dispositivo</div>
          <p>Con un hardware wallet, controlla l'indirizzo di ricezione sullo schermo del dispositivo stesso,
          non solo sul computer: un malware potrebbe alterare ciò che vedi a schermo.</p>
        </div>
        <div class="tip-card good">
          <div class="tip-title">⬇️ Scarica solo da fonti ufficiali</div>
          <p>Sito del produttore o store ufficiali. Mai da link ricevuti via email, social o messaggi privati.</p>
        </div>
        <div class="tip-card good">
          <div class="tip-title">🧪 Fai un prelievo di prova</div>
          <p>Prima di spostare somme importanti, invia una piccola cifra di test e verifica che arrivi correttamente.</p>
        </div>
      </div>

      <div class="nav-buttons">
        <a class="btn" href="#/guide/seed-sicura">Guida alla seed sicura →</a>
        <a class="btn" href="#/guide/controllo-fondi">Custodial vs non-custodial →</a>
      </div>
    `,
  },
  {
    slug: "truffe-comuni",
    icon: "🚨",
    title: "Riconoscere le truffe Bitcoin più comuni",
    summary: "I trucchi più diffusi per derubare chi è alle prime armi, e come proteggerti.",
    body: () => `
      <div class="card">
        <p>Bitcoin attira anche i truffatori. Conoscere gli schemi più comuni resta la difesa migliore.</p>
      </div>

      <div class="glossary-grid">
        <div class="tip-card bad">
          <div class="tip-title">🎁 Regali o raddoppi finti</div>
          <p>"Invia 1 BTC, ricevine 2 indietro": nessuna iniziativa vera funziona così. Mai, senza eccezioni.</p>
        </div>
        <div class="tip-card bad">
          <div class="tip-title">📈 Investimenti a rendimento garantito</div>
          <p>Promesse di guadagni fissi e sicuri sono il segno distintivo di uno schema Ponzi.</p>
        </div>
        <div class="tip-card bad">
          <div class="tip-title">☎️ Falso supporto tecnico (${termLink("phishing", "phishing")})</div>
          <p>Contatti non richiesti su social, Telegram o email che chiedono la seed o l'accesso remoto al dispositivo.</p>
        </div>
        <div class="tip-card bad">
          <div class="tip-title">💔 Truffe sentimentali</div>
          <p>Relazioni online che, con calma, portano a "investire" su piattaforme finte create apposta.</p>
        </div>
        <div class="tip-card bad">
          <div class="tip-title">🌐 Siti e app clone</div>
          <p>Copie quasi identiche di wallet o exchange famosi, pensate solo per rubare fondi o credenziali.</p>
        </div>
        <div class="tip-card bad">
          <div class="tip-title">⏰ Pressione e urgenza</div>
          <p>"Offerta valida solo oggi", "agisci subito o perdi tutto": una tattica classica per non farti riflettere.</p>
        </div>
      </div>

      <div class="danger-box" style="margin-top:1rem;">
        <p style="margin:0;">
          <strong>La regola d'oro:</strong> se qualcuno ti contatta per primo, ti promette guadagni garantiti,
          o ti chiede la seed o l'accesso al wallet, è quasi certamente una truffa. Fermati e verifica sempre
          da canali ufficiali. E anche nella vita reale: evita di rendere pubblico quanto possiedi.
        </p>
      </div>

      <div class="nav-buttons">
        <a class="btn" href="#/guide/seed-sicura">Guida alla seed sicura →</a>
      </div>
    `,
  },
  {
    slug: "fee-e-conferme",
    icon: "⏱️",
    title: "Capire fee e conferme",
    summary: "Come funzionano le commissioni di rete e perché a volte conviene avere un po' di pazienza.",
    body: () => `
      <div class="card">
        <p>
          Ogni ${termLink("transazione", "transazione")} compete per lo spazio limitato di ogni
          ${termLink("blocco", "blocco")}. Quando la rete è congestionata, chi paga una
          ${termLink("fee", "fee")} più alta viene incluso prima. Nella home di questo explorer trovi sempre
          le fee consigliate del momento, aggiornate in tempo reale.
        </p>
      </div>

      <div class="glossary-grid">
        <div class="tip-card">
          <div class="tip-title">🐢 Fee bassa = più lenta</div>
          <p>Va bene se non hai fretta: la transazione resta in ${termLink("mempool", "mempool")} finché non
          si libera spazio in un blocco.</p>
        </div>
        <div class="tip-card">
          <div class="tip-title">🐇 Fee alta = più veloce</div>
          <p>Consigliata se la transazione è urgente o se il destinatario richiede conferma rapida.</p>
        </div>
        <div class="tip-card">
          <div class="tip-title">✔️ Quante ${termLink("conferme", "conferma")} servono?</div>
          <p>Per piccoli importi spesso basta 1 conferma; per somme importanti conviene aspettarne di più
          (6 è uno standard comune) prima di considerare il pagamento definitivo.</p>
        </div>
        <div class="tip-card">
          <div class="tip-title">📊 La fee non dipende dall'importo</div>
          <p>Dipende dalla dimensione in byte della transazione (${termLink("peso", "peso")}), non da quanti
          bitcoin stai inviando: mandare 10€ o 10.000€ può costare la stessa fee.</p>
        </div>
      </div>

      <div class="nav-buttons">
        <a class="btn" href="#/glossario/fee">Vai al glossario →</a>
      </div>
    `,
  },
  {
    slug: "privacy-bitcoin",
    icon: "🕵️",
    title: "Privacy su Bitcoin: pubblica, non anonima",
    summary: "Cosa può scoprire chiunque guardando un block explorer come questo, e qualche accorgimento pratico.",
    body: () => `
      <div class="card">
        <p>
          C'è una certa ironia nell'usare un block explorer per capire la privacy: proprio perché puoi
          guardare qualunque indirizzo o transazione qui dentro, chiunque altro può fare lo stesso con i
          tuoi. Bitcoin è <strong>pseudonimo, non anonimo</strong>: gli indirizzi non hanno scritto sopra il
          tuo nome, ma se qualcuno li collega alla tua identità (li condividi pubblicamente, li usi su un
          exchange con verifica dell'identità, ecc.) può vedere tutta la loro cronologia.
        </p>
      </div>

      <div class="glossary-grid">
        <div class="tip-card">
          <div class="tip-title">🔄 Riuso degli indirizzi</div>
          <p>Usare sempre lo stesso ${termLink("indirizzo", "indirizzo")} rende più facile collegare tutte le
          tue transazioni tra loro. La maggior parte dei wallet ne genera uno nuovo a ogni ricezione:
          lascia che lo faccia in automatico.</p>
        </div>
        <div class="tip-card">
          <div class="tip-title">🔗 Analisi della blockchain</div>
          <p>Esistono aziende specializzate nel collegare indirizzi tra loro analizzando i pattern delle
          transazioni pubbliche.</p>
        </div>
        <div class="tip-card">
          <div class="tip-title">🤐 Non condividerli senza motivo</div>
          <p>Evita di postare i tuoi indirizzi su social o forum pubblici se non è strettamente necessario.</p>
        </div>
      </div>

      <div class="card" style="margin-top:1rem;">
        <p style="margin:0;" class="muted small">
          Per chi vuole approfondire esistono tecniche più avanzate (coinjoin, wallet orientati alla
          privacy): argomenti che vanno oltre questa guida introduttiva, ma buoni da conoscere man mano che
          ti fai più esperienza.
        </p>
      </div>
    `,
  },
];

function renderGuideIndex() {
  setContent(`
    <div class="breadcrumb"><a href="#/">Home</a> / Guide</div>
    <h1>Guide Bitcoin per principianti</h1>
    <p class="muted">Approfondimenti pratici per usare Bitcoin in sicurezza, un passo alla volta.</p>
    <ul class="block-list">
      ${GUIDES.map(
        (g) => `
        <li>
          <a class="row-link" href="#/guide/${g.slug}">
            <div class="row-top"><span>${g.icon} ${fmt.escapeHtml(g.title)}</span>${g.featured ? `<span class="feature-badge">Interattivo</span>` : ""}</div>
            <div class="row-bottom"><span>${fmt.escapeHtml(g.summary)}</span></div>
          </a>
        </li>`
      ).join("")}
    </ul>
  `);
}

function renderGuide(slug) {
  const guide = GUIDES.find((g) => g.slug === slug);
  if (!guide) return renderNotFound();
  if (guide.interactive) return renderDiceGenerator(guide);
  setContent(`
    <div class="breadcrumb"><a href="#/">Home</a> / <a href="#/guide">Guide</a> / ${fmt.escapeHtml(guide.title)}</div>
    <h1>${guide.icon} ${fmt.escapeHtml(guide.title)}</h1>
    ${guide.body()}
  `);
}

const DICE_FACES = ["⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

function renderDiceGenerator(guide) {
  let targetBits = 128;
  let rolls = [];
  let mnemonic = null;
  let generating = false;

  setContent(`
    <div class="breadcrumb"><a href="#/">Home</a> / <a href="#/guide">Guide</a> / ${fmt.escapeHtml(guide.title)}</div>
    <h1>${guide.icon} ${fmt.escapeHtml(guide.title)}</h1>
    <div class="intro-box">
      <span class="intro-icon">🎓</span>
      <div>
        <p style="margin:0;">
          Questo strumento serve a <strong>capire come funziona</strong> la generazione di una seed a partire
          da tiri di dado fisico, non a creare il portafoglio che userai davvero. Le parole non vengono mai
          salvate, inviate in rete o copiate: restano solo nella memoria di questa pagina finché non la
          ricarichi. Dettagli nella guida "${GUIDES.find((g) => g.slug === "seed-sicura")?.title || "Seed sicura"}".
        </p>
      </div>
    </div>
    <div id="dice-app"></div>
  `);

  const diceApp = document.getElementById("dice-app");

  function required() {
    return ROLLS_REQUIRED[targetBits];
  }

  function renderApp() {
    const online = navigator.onLine;
    let html;

    if (online) {
      html = `
        <div class="danger-box">
          <p style="margin:0 0 0.75rem;">
            <strong>🔌 Sei ancora online.</strong> Disconnetti la rete (Wi-Fi, dati mobili o modalità aereo)
            per continuare: è la stessa disciplina che consigliamo nella guida alla seed sicura, applicata
            qui in pratica.
          </p>
          <button type="button" class="btn btn-primary" data-action="recheck">Ho disconnesso, ricontrolla</button>
        </div>`;
    } else if (mnemonic) {
      html = `
        <div class="card">
          <p class="muted small">Le tue ${mnemonic.length} parole, nell'ordine generato:</p>
          <div class="glossary-grid" style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr));">
            ${mnemonic
              .map((w, i) => `<div class="tip-card"><div class="tip-title mono small">${i + 1}. ${fmt.escapeHtml(w)}</div></div>`)
              .join("")}
          </div>
        </div>
        <div class="danger-box" style="margin-top:1rem;">
          <p>
            <strong>Promemoria:</strong> questa resta una demo didattica. Se vuoi usarla per un wallet con
            fondi reali, verifica di essere su un dispositivo pulito e realmente offline, poi
            <strong>trascrivi subito le parole a mano</strong> su carta o metallo — di proposito non c'è un
            pulsante "copia": copiarle digitalmente vanificherebbe l'esercizio. Per un uso reale il metodo
            più sicuro resta generare la seed direttamente su un ${termLink("wallet", "wallet")} hardware dedicato.
          </p>
          <p style="margin:0.5rem 0 0;"><a class="term-link" href="#/glossario/seed">Rileggi cos'è una seed phrase →</a></p>
        </div>
        <div class="nav-buttons">
          <button type="button" class="btn" data-action="reset">🔄 Ricomincia</button>
          <a class="btn" href="#/guide">← Torna alle guide</a>
        </div>`;
    } else {
      const n = rolls.length;
      const need = required();
      const pct = Math.min(100, Math.round((n / need) * 100));
      const warn = looksNonRandom(rolls);
      const ready = n >= need;
      html = `
        <div class="card">
          <div class="unit-toggle" role="group" aria-label="Numero di parole" style="margin-bottom:1rem;">
            <button type="button" class="unit-btn ${targetBits === 128 ? "active" : ""}" data-action="words" data-bits="128" ${generating ? "disabled" : ""}>12 parole</button>
            <button type="button" class="unit-btn ${targetBits === 256 ? "active" : ""}" data-action="words" data-bits="256" ${generating ? "disabled" : ""}>24 parole</button>
          </div>
          <p>
            Tira un <strong>dado fisico a 6 facce</strong> — vero, in mano — e registra qui ogni risultato.
            Servono <strong>${need} tiri</strong> per un'entropia sufficiente. Non c'è un bottone che "tira per te":
            l'entropia deve venire dal dado reale, non dal computer.
          </p>
          <div class="dice-faces" role="group" aria-label="Inserisci il risultato del tiro">
            ${[1, 2, 3, 4, 5, 6]
              .map(
                (f) =>
                  `<button type="button" class="dice-face" data-action="roll" data-face="${f}" ${ready || generating ? "disabled" : ""} aria-label="Tiro: ${f}">${DICE_FACES[f - 1]}</button>`
              )
              .join("")}
          </div>
          <div class="dice-progress" aria-live="polite">
            <div class="dice-progress-bar"><div class="dice-progress-fill" style="width:${pct}%"></div></div>
            <span class="small muted">${n} / ${need} tiri</span>
          </div>
          ${warn ? `<p class="small" style="color:var(--yellow);">⚠️ Questi tiri sembrano poco casuali (una faccia ricorre troppo spesso). Se hai davvero usato un dado fisico va bene, altrimenti ricomincia con tiri reali.</p>` : ""}
          <div class="dice-history mono small muted">${rolls.map((r) => DICE_FACES[r - 1]).join(" ") || "Nessun tiro ancora registrato."}</div>
          <div class="nav-buttons">
            <button type="button" class="btn" data-action="undo" ${n === 0 || generating ? "disabled" : ""}>↩ Annulla ultimo</button>
            <button type="button" class="btn" data-action="reset" ${n === 0 || generating ? "disabled" : ""}>🔄 Ricomincia</button>
          </div>
          <button type="button" class="btn btn-primary" data-action="generate" style="margin-top:0.75rem; width:100%;" ${!ready || generating ? "disabled" : ""}>
            ${generating ? "Genero…" : ready ? "🎲 Genera la mnemonic" : `Servono altri ${need - n} tiri`}
          </button>
        </div>`;
    }

    diceApp.innerHTML = html;
  }

  async function handleClick(e) {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;

    if (action === "recheck") {
      renderApp();
    } else if (action === "roll") {
      if (rolls.length < required()) rolls.push(Number(btn.dataset.face));
      renderApp();
    } else if (action === "undo") {
      rolls.pop();
      renderApp();
    } else if (action === "reset") {
      rolls = [];
      mnemonic = null;
      renderApp();
    } else if (action === "words") {
      targetBits = Number(btn.dataset.bits);
      rolls = [];
      mnemonic = null;
      renderApp();
    } else if (action === "generate") {
      if (rolls.length < required() || navigator.onLine) return;
      generating = true;
      renderApp();
      try {
        mnemonic = await diceRollsToMnemonic(rolls.slice(0, required()), targetBits);
      } catch {
        mnemonic = null;
      }
      generating = false;
      renderApp();
    }
  }

  function handleConnectivityChange() {
    renderApp();
  }

  diceApp.addEventListener("click", handleClick);
  window.addEventListener("online", handleConnectivityChange);
  window.addEventListener("offline", handleConnectivityChange);
  setViewCleanup(() => {
    window.removeEventListener("online", handleConnectivityChange);
    window.removeEventListener("offline", handleConnectivityChange);
    rolls = [];
    mnemonic = null;
  });

  renderApp();
}

// ---------- Wiring ----------

searchForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const q = searchInput.value.trim();
  if (!q) return;
  location.hash = `#/search/${encodeURIComponent(q)}`;
});

function syncUnitToggle() {
  const current = fmt.getUnit();
  unitToggle.querySelectorAll(".unit-btn").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.unit === current);
  });
}

unitToggle.addEventListener("click", (e) => {
  const btn = e.target.closest(".unit-btn");
  if (!btn || btn.dataset.unit === fmt.getUnit()) return;
  fmt.setUnit(btn.dataset.unit);
  syncUnitToggle();
  router();
});

syncUnitToggle();
window.addEventListener("hashchange", router);
router();
