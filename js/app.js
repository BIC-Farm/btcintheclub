import { api, ApiError } from "./api.js";
import * as fmt from "./format.js";
import { diceRollsToMnemonic, ROLLS_REQUIRED, looksNonRandom } from "./bip39.js";
import { squarify, computeAreas, feeRateColor, FEE_COLOR_BUCKETS, COINBASE_COLOR } from "./treemap.js";
import {
  getWatchlist,
  isWatched,
  addToWatchlist,
  removeFromWatchlist,
  isXpubWatched,
  addXpubToWatchlist,
  removeXpubFromWatchlist,
  updateXpubDiscovery,
  getLastSeen,
  setLastSeen,
} from "./watchlist.js";
import { validateAddress, chunkAddress } from "./addresscheck.js";
import { verifyBlock } from "./blockverify.js";
import { parseExtendedKey, discoverAddresses } from "./bip32.js";

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
    <a class="btn" href="#/mining">⛏️ Vai al Mining</a>
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
      case "mining":
        return await renderMining();
      case "blockclock":
        return await renderBlockClockPage();
      case "novita":
        return renderChangelog();
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

const TX_VSIZE_ESTIMATE = 140; // vB: stima tipica per una transazione semplice (1 input, 2 output, SegWit)

function feeSpeedRowsHtml(fees, eurRate) {
  const tiers = [
    { label: "🚀 Veloce (prossimo blocco)", rate: fees.fastestFee, eta: "circa 10 minuti" },
    { label: "🙂 Normale", rate: fees.halfHourFee, eta: "circa 30 minuti" },
    { label: "🐢 Economica", rate: fees.economyFee, eta: "da qualche ora, nessuna garanzia" },
  ];
  return tiers
    .map((t) => {
      const sats = Math.round(t.rate * TX_VSIZE_ESTIMATE);
      const fiat = fmt.formatFiat(sats, eurRate);
      return `
        <div style="padding:0.5rem 0; border-top:1px solid var(--hairline);">
          <div class="row-top" style="font-weight:600;">
            <span>${t.label}</span>
            <span>${fmt.formatSats(sats)}${fiat ? ` · ~${fiat}` : ""}</span>
          </div>
          <div class="row-bottom"><span class="muted">${t.eta}</span><span class="muted">${t.rate} sat/vB</span></div>
        </div>`;
    })
    .join("");
}

/** Media della fee-rate mediana (avgFee_50) rilevata sui blocchi di un periodo, dai dati /v1/mining/blocks/fee-rates. */
function averageFeeRateFromHistory(data) {
  if (!Array.isArray(data) || data.length === 0) return null;
  const values = data.map((d) => d.avgFee_50).filter((v) => Number.isFinite(v));
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Confronta la fee "normale" raccomandata adesso con la media pagata dai blocchi recenti, per capire se conviene aspettare. */
function feeHistoryComparisonHtml(currentRate, avgFeeRate24h, avgFeeRate1w) {
  const baseline = avgFeeRate1w ?? avgFeeRate24h;
  if (!Number.isFinite(currentRate) || !Number.isFinite(baseline) || baseline <= 0) return "";
  const ratio = currentRate / baseline;
  let level = "";
  let icon = "➡️";
  let verdict = "È in linea con la media recente.";
  if (ratio <= 0.75) {
    level = "good";
    icon = "📉";
    verdict = "È più bassa della media recente: se non hai fretta, potrebbe essere un buon momento per inviare una transazione.";
  } else if (ratio >= 1.3) {
    level = "bad";
    icon = "📈";
    verdict = "È più alta della media recente: se la transazione non è urgente, potresti risparmiare aspettando che la rete si scarichi.";
  }
  const rows = [
    { label: "Adesso (fee normale)", value: currentRate },
    { label: "Media ultime 24 ore", value: avgFeeRate24h },
    { label: "Media ultima settimana", value: avgFeeRate1w },
  ]
    .filter((r) => Number.isFinite(r.value))
    .map(
      (r) => `
        <div class="row-top" style="padding:0.25rem 0;">
          <span class="muted">${r.label}</span>
          <span>${r.value.toFixed(1)} sat/vB</span>
        </div>`
    )
    .join("");
  return `
    <div class="tip-card ${level}" id="fee-history-card">
      <div class="tip-title">${icon} La fee di adesso rispetto agli ultimi giorni</div>
      <p>${verdict}</p>
      ${rows}
    </div>`;
}

function addressBalanceTxCount(info) {
  const funded = info.chain_stats.funded_txo_sum + info.mempool_stats.funded_txo_sum;
  const spent = info.chain_stats.spent_txo_sum + info.mempool_stats.spent_txo_sum;
  const txCount = info.chain_stats.tx_count + info.mempool_stats.tx_count;
  return { balance: funded - spent, txCount };
}

/** Badge "novità" se saldo o numero di transazioni sono cambiati dall'ultima visita; aggiorna subito il valore memorizzato. */
function noveltyBadgeHtml(entryId, balance, txCount) {
  const prev = getLastSeen(entryId);
  setLastSeen(entryId, { balance, txCount });
  if (!prev || (prev.balance === balance && prev.txCount === txCount)) return "";
  const diff = balance - prev.balance;
  const diffLabel = diff !== 0 ? ` ${fmt.formatBtc(diff, { sign: true })}` : "";
  return `<span class="badge confirmed" title="Qualcosa è cambiato da quando hai controllato l'ultima volta">● Novità${diffLabel}</span>`;
}

function watchlistAddressRowHtml({ address, info }, eurRate) {
  if (!info) {
    return `<li><a class="row-link" href="#/address/${address}"><div class="row-top"><span class="mono">${fmt.shortAddress(address)}</span><span class="muted small">dati non disponibili</span></div></a></li>`;
  }
  const { balance, txCount } = addressBalanceTxCount(info);
  const fiat = fmt.formatFiat(balance, eurRate);
  const badge = noveltyBadgeHtml(address, balance, txCount);
  return `
    <li>
      <a class="row-link" href="#/address/${address}">
        <div class="row-top">
          <span class="mono">${fmt.shortAddress(address)}</span>
          <span class="row-value">${fmt.formatBtc(balance)}</span>
        </div>
        <div class="row-bottom"><span class="muted">${fiat ? `~${fiat}` : ""}</span>${badge}</div>
      </a>
    </li>`;
}

function xpubShortLabel(entry) {
  return entry.label || `${entry.keyType} ${entry.key.slice(0, 8)}…${entry.key.slice(-6)}`;
}

function watchlistXpubPlaceholderHtml(entry, domId) {
  return `
    <li class="row-link" id="${domId}">
      <div class="row-top">
        <span>🔑 ${fmt.escapeHtml(xpubShortLabel(entry))}</span>
        <span class="muted small">scansione…</span>
      </div>
      <div class="row-bottom"><span class="muted">Controllo gli indirizzi derivati, un attimo…</span></div>
    </li>`;
}

function watchlistXpubRowHtml(entry, addresses, eurRate) {
  const totalBalance = addresses.reduce((s, a) => s + a.balance, 0);
  const totalTxCount = addresses.reduce((s, a) => s + (a.txCount || 0), 0);
  const fiat = fmt.formatFiat(totalBalance, eurRate);
  const badge = noveltyBadgeHtml(entry.key, totalBalance, totalTxCount);
  const usedCount = addresses.filter((a) => a.txCount > 0).length;
  const detailRows = addresses
    .filter((a) => a.txCount > 0)
    .sort((a, b) => b.balance - a.balance)
    .map(
      (a) => `
      <li class="io-row">
        <span class="addr"><a href="#/address/${a.address}">${fmt.shortAddress(a.address)}</a> <span class="small muted">(${a.chain === 0 ? "ricezione" : "resto"} #${a.index})</span></span>
        <span class="amt">${fmt.formatBtc(a.balance)}</span>
      </li>`
    )
    .join("");
  return `
    <li class="row-link" style="cursor:default;">
      <div class="row-top">
        <span>🔑 ${fmt.escapeHtml(xpubShortLabel(entry))}</span>
        <span class="row-value">${fmt.formatBtc(totalBalance)}</span>
      </div>
      <div class="row-bottom">
        <span class="muted">${usedCount} ${usedCount === 1 ? "indirizzo usato" : "indirizzi usati"}${fiat ? ` · ~${fiat}` : ""}</span>
        ${badge}
      </div>
      ${
        usedCount > 0
          ? `<details class="tech-details" style="margin-top:0.6rem;"><summary>Vedi gli indirizzi</summary><ul class="io-list" style="margin-top:0.5rem;">${detailRows}</ul></details>`
          : ""
      }
      <div class="nav-buttons" style="margin:0.6rem 0 0;">
        <button type="button" class="btn" data-remove-xpub="${fmt.escapeHtml(entry.key)}">Rimuovi dalla watchlist</button>
      </div>
    </li>`;
}

function watchlistAddFormHtml() {
  return `
    <div class="card" style="margin-top:0.75rem;">
      <form id="watchlist-add-form" style="display:flex; gap:0.5rem; flex-wrap:wrap; align-items:center;">
        <input type="text" id="watchlist-add-input" class="mono" style="flex:1; min-width:220px; padding:0.5rem 0.7rem; border-radius:var(--pill); border:1px solid var(--border); background:var(--card-bg-hover); color:var(--ink);"
          placeholder="Indirizzo, oppure xpub/ypub/zpub per tracciare tutti i suoi indirizzi" autocomplete="off" />
        <button type="submit" class="btn btn-primary" id="watchlist-add-btn">+ Aggiungi</button>
      </form>
      <p class="small muted" style="margin:0.5rem 0 0;">
        Una ${termLink("chiave xpub/ypub/zpub", "xpub")} è la chiave <strong>pubblica</strong> del tuo wallet:
        permette di trovare tutti gli indirizzi da lei derivati con un saldo, ma non permette mai di spendere
        fondi. Non incollare mai qui una chiave che inizia con xprv/yprv/zprv: quella è privata.
      </p>
      <div id="watchlist-add-status"></div>
    </div>`;
}

function watchlistSectionHtml(addressResults, xpubEntries, eurRate) {
  const hasEntries = addressResults.length > 0 || xpubEntries.length > 0;
  const addressItems = addressResults.map((r) => watchlistAddressRowHtml(r, eurRate)).join("");
  const addressSubtotal = addressResults.reduce((s, { info }) => s + (info ? addressBalanceTxCount(info).balance : 0), 0);
  const xpubPlaceholders = xpubEntries.map((e, i) => watchlistXpubPlaceholderHtml(e, `xpub-watch-${i}`)).join("");
  return `
    <h2 class="section-title">⭐ I tuoi indirizzi salvati</h2>
    ${
      hasEntries
        ? `<p class="small muted" id="watchlist-total">Totale: ${fmt.formatBtc(addressSubtotal)}${xpubEntries.length ? " (+ scansione xpub in corso…)" : ""}</p>
           <ul class="block-list" id="watchlist-list">${addressItems}${xpubPlaceholders}</ul>`
        : `<p class="small muted">Non hai ancora salvato nessun indirizzo. Aggiungine uno qui sotto, oppure usa la stellina ★ nella pagina di un indirizzo.</p>`
    }
    ${watchlistAddFormHtml()}
  `;
}

async function renderHome() {
  renderLoading("Carico gli ultimi dati dalla blockchain…");
  const watchlistEntries = getWatchlist();
  const addressEntries = watchlistEntries.filter((e) => e.type === "address");
  const xpubEntries = watchlistEntries.filter((e) => e.type === "xpub");
  const [tipHeight, blocks, mempool, fees, pricesResult, addressResults, feeRates24h, feeRates1w] = await Promise.all([
    api.getTipHeight(),
    api.getRecentBlocks(),
    api.getMempool(),
    api.getFeeEstimates(),
    api.getPrices().catch(() => null),
    Promise.all(
      addressEntries.map((e) =>
        api
          .getAddress(e.address)
          .then((info) => ({ address: e.address, info }))
          .catch(() => ({ address: e.address, info: null }))
      )
    ),
    api.getMiningFeeRates("24h").catch(() => null),
    api.getMiningFeeRates("1w").catch(() => null),
  ]);
  const eurRate = pricesResult?.EUR ?? null;
  const avgFeeRate24h = averageFeeRateFromHistory(feeRates24h);
  const avgFeeRate1w = averageFeeRateFromHistory(feeRates1w);

  setContent(`
    <div class="intro-box">
      <span class="intro-icon">👋</span>
      <div>
        <h1>Benvenuto nel Block Explorer di Bitcoin in the Club</h1>
        <p>
          Un block explorer ti permette di "guardare dentro" la blockchain di Bitcoin: puoi controllare
          blocchi, transazioni e indirizzi in tempo reale, in modo semplice e trasparente. Non serve essere
          esperti: cerca qualcosa nella barra qui sopra, oppure esplora gli ultimi blocchi qui sotto. Se un
          termine non ti è chiaro, dai un'occhiata al <a href="#/glossario">glossario</a>. Hai appena
          comprato i tuoi primi bitcoin? Parti dalla guida
          <a href="#/guide/primi-passi">🚀 primi passi</a>.
        </p>
      </div>
    </div>

    ${watchlistSectionHtml(addressResults, xpubEntries, eurRate)}

    <h2 class="section-title" style="margin-top:0;">Stato della rete adesso</h2>
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
        <p class="small" style="margin-top:0.4rem;"><a class="term-link" href="#/blockclock">⛶ Modalità schermo intero →</a></p>
      </div>
    </div>

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

    <div class="card">
      <div class="tip-title">🧮 Quanto costa inviare bitcoin adesso?</div>
      <p class="small muted" style="margin:0.35rem 0 0;">
        Stima per una transazione semplice (circa ${TX_VSIZE_ESTIMATE} vB: 1 input, 2 output). Una tua
        transazione reale può costare di più o di meno a seconda di quanti input/output usa.
      </p>
      ${feeSpeedRowsHtml(fees, eurRate)}
      ${eurRate ? "" : `<p class="small muted" style="margin:0.5rem 0 0;">Cambio EUR non disponibile al momento: mostro solo l'importo in sat.</p>`}
    </div>

    ${feeHistoryComparisonHtml(fees.halfHourFee, avgFeeRate24h, avgFeeRate1w)}

    <div style="display:flex; align-items:center; justify-content:space-between; gap:0.5rem; flex-wrap:wrap;">
      <h2 class="section-title" style="margin-top:0;">Ultimi blocchi minati</h2>
      <button class="btn" id="home-refresh">↻ Aggiorna</button>
    </div>
    <ul class="block-list">${blocks.slice(0, 6).map((b) => blockRowHtml(b)).join("")}</ul>
    <div class="nav-buttons" style="justify-content:center;">
      <a class="btn btn-primary" href="#/blocchi">📦 Vedi tutti i blocchi →</a>
      <a class="btn" href="#/mining">⛏️ Scopri il mining →</a>
    </div>

    <a class="feature-card" href="#/guide/dadi-seed">
      <span class="feature-icon">🎲</span>
      <div class="feature-body">
        <div class="feature-title">Genera una seed con i dadi <span class="feature-badge">Interattivo</span></div>
        <div class="feature-desc">Prova con mano come dei tiri di dado fisico diventano una mnemonic BIP39 — demo didattica, si sblocca solo offline.</div>
      </div>
      <span class="feature-arrow">→</span>
    </a>
  `);

  document.getElementById("home-refresh").addEventListener("click", () => {
    if (parseHash().length === 0) router();
  });

  wireWatchlistAddForm();
  wireWatchlistXpubScans(xpubEntries, eurRate, addressSubtotalFromResults(addressResults));

  if (blocks[0]) startBlockClock(blocks[0].height, blocks[0].timestamp);
}

function addressSubtotalFromResults(addressResults) {
  return addressResults.reduce((s, { info }) => s + (info ? addressBalanceTxCount(info).balance : 0), 0);
}

/** Interroga l'API per un indirizzo derivato durante la scansione di una chiave estesa (nessuna chiamata avviene in bip32.js). */
async function checkAddressForDiscovery(address) {
  try {
    const info = await api.getAddress(address);
    const { balance, txCount } = addressBalanceTxCount(info);
    return { used: txCount > 0, balance, txCount };
  } catch {
    return { used: false, balance: 0, txCount: 0 };
  }
}

async function wireWatchlistXpubScans(xpubEntries, eurRate, addressSubtotal) {
  if (xpubEntries.length === 0) return;
  let runningTotal = addressSubtotal;
  let remaining = xpubEntries.length;

  const updateTotal = () => {
    const totalEl = document.getElementById("watchlist-total");
    if (!totalEl) return;
    totalEl.textContent = `Totale: ${fmt.formatBtc(runningTotal)}${remaining > 0 ? ` (+ scansione in corso per ${remaining} ${remaining === 1 ? "chiave" : "chiavi"}…)` : ""}`;
  };

  await Promise.all(
    xpubEntries.map(async (entry, i) => {
      const rowEl = document.getElementById(`xpub-watch-${i}`);
      try {
        const parsed = await parseExtendedKey(entry.key);
        if (!parsed.valid) throw new Error(parsed.reason);

        // 1) ricontrolla il saldo degli indirizzi già noti da scansioni precedenti
        const knownResults = await Promise.all(
          entry.discoveredAddresses.map(async (a) => {
            const info = await checkAddressForDiscovery(a.address);
            return { address: a.address, chain: a.chain, index: a.index, balance: info.balance, txCount: info.txCount };
          })
        );

        // 2) scansione incrementale: solo gli indici mai controllati prima, per non rifare da zero ogni volta
        const scan = await discoverAddresses(parsed, checkAddressForDiscovery, {
          startReceive: entry.maxUsedReceive + 1,
          startChange: entry.maxUsedChange + 1,
        });
        if (scan.addresses.length > 0) updateXpubDiscovery(entry.key, scan);

        const newResults = scan.addresses.map((a) => ({ address: a.address, chain: a.chain, index: a.index, balance: a.balance, txCount: a.txCount ?? 1 }));
        const combined = [...knownResults, ...newResults];

        runningTotal += combined.reduce((s, a) => s + a.balance, 0);
        remaining--;
        if (rowEl) rowEl.outerHTML = watchlistXpubRowHtml(entry, combined, eurRate);
        updateTotal();
      } catch {
        remaining--;
        if (rowEl) {
          rowEl.innerHTML = `
            <div class="row-top"><span>🔑 ${fmt.escapeHtml(xpubShortLabel(entry))}</span></div>
            <div class="row-bottom"><span class="muted">Impossibile controllare questa chiave adesso.</span></div>`;
        }
        updateTotal();
      }
    })
  );
}

function wireWatchlistAddForm() {
  const form = document.getElementById("watchlist-add-form");
  if (!form) return;
  const input = document.getElementById("watchlist-add-input");
  const btn = document.getElementById("watchlist-add-btn");
  const status = document.getElementById("watchlist-add-status");

  document.getElementById("watchlist-list")?.addEventListener("click", (e) => {
    const removeBtn = e.target.closest("button[data-remove-xpub]");
    if (!removeBtn) return;
    removeXpubFromWatchlist(removeBtn.dataset.removeXpub);
    router();
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    btn.disabled = true;
    status.innerHTML = "";

    const addressResult = await validateAddress(value);
    if (addressResult.valid) {
      if (isWatched(value)) {
        status.innerHTML = `<p class="small muted" style="margin-top:0.5rem;">Questo indirizzo è già nella tua watchlist.</p>`;
      } else {
        addToWatchlist(value);
        router();
        return;
      }
      btn.disabled = false;
      return;
    }

    const parsed = await parseExtendedKey(value);
    if (parsed.valid) {
      if (isXpubWatched(value)) {
        status.innerHTML = `<p class="small muted" style="margin-top:0.5rem;">Questa chiave è già nella tua watchlist.</p>`;
        btn.disabled = false;
        return;
      }
      btn.textContent = "Scansione…";
      let scanned = 0;
      try {
        const discovery = await discoverAddresses(parsed, checkAddressForDiscovery, {
          onProgress: () => {
            scanned++;
            status.innerHTML = `<p class="small muted" style="margin-top:0.5rem;">🔍 Controllo indirizzo ${scanned}… (gli indirizzi già usati restano, mi fermo dopo 20 non usati di fila su ciascuna catena)</p>`;
          },
        });
        addXpubToWatchlist(value, parsed.type, parsed.addressType, discovery);
        router();
        return;
      } catch {
        status.innerHTML = `<p class="small muted" style="margin-top:0.5rem;">Non sono riuscito a completare la scansione. Riprova.</p>`;
        btn.disabled = false;
        btn.textContent = "+ Aggiungi";
      }
      return;
    }

    const looksLikeExtendedKey = /^(xpub|ypub|zpub|xprv|yprv|zprv)/.test(value);
    const message = looksLikeExtendedKey ? parsed.reason : "Non sembra un indirizzo Bitcoin valido né una chiave xpub/ypub/zpub. Controlla di averlo copiato per intero.";
    status.innerHTML = `<p class="small muted" style="margin-top:0.5rem;">${fmt.escapeHtml(message)}</p>`;
    btn.disabled = false;
  });
}

const BLOCK_CLOCK_AVG_SECONDS = 600;

function describeBlockClockElapsed(elapsed) {
  if (elapsed < 300) return "Ultimo blocco trovato da poco.";
  if (elapsed <= BLOCK_CLOCK_AVG_SECONDS) return "Il prossimo blocco potrebbe arrivare a breve.";
  return "Il prossimo blocco può arrivare da un momento all'altro — i tempi variano molto, è normale.";
}

function startBlockClock(initialHeight, initialTimestamp, idPrefix = "block-clock") {
  const circumference = 2 * Math.PI * 52;
  let height = initialHeight;
  let blockTime = initialTimestamp;
  let celebrateUntil = 0;

  const card = document.getElementById(`${idPrefix}-card`);
  const ring = document.getElementById(`${idPrefix}-progress`);
  const dot = document.getElementById(`${idPrefix}-dot`);
  const ping = document.getElementById(`${idPrefix}-ping`);
  const heightEl = document.getElementById(`${idPrefix}-height`);
  const elapsedEl = document.getElementById(`${idPrefix}-elapsed`);
  const noteEl = document.getElementById(`${idPrefix}-note`);
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
    document.body.classList.remove("kiosk-mode");
  });
}

async function renderBlockClockPage() {
  renderLoading("Carico il Block Clock…");
  const tipHeight = await api.getTipHeight();
  const hash = await api.getBlockHeightHash(tipHeight);
  const block = await api.getBlock(hash);

  document.body.classList.add("kiosk-mode");

  setContent(`
    <div class="blockclock-page">
      <div class="blockclock-page-controls">
        <a class="btn" href="#/">← Home</a>
        <button type="button" class="btn" id="bc-fullscreen-btn">⛶ Schermo intero</button>
      </div>
      <div class="blockclock-page-center">
        <div class="block-clock-card" id="bc-page-card">
          <div class="block-clock block-clock-xl">
            <div class="block-clock-ping" id="bc-page-ping"></div>
            <svg class="block-clock-ring" viewBox="0 0 120 120" aria-hidden="true">
              <circle class="block-clock-track" cx="60" cy="60" r="52"></circle>
              <circle class="block-clock-progress" id="bc-page-progress" cx="60" cy="60" r="52"
                stroke-dasharray="${2 * Math.PI * 52}" stroke-dashoffset="${2 * Math.PI * 52}"></circle>
              <circle class="block-clock-dot" id="bc-page-dot" cx="112" cy="60" r="4"></circle>
            </svg>
            <div class="block-clock-center">
              <div class="block-clock-height" id="bc-page-height">#${fmt.formatNumber(block.height)}</div>
              <div class="block-clock-elapsed" id="bc-page-elapsed">00:00</div>
            </div>
          </div>
        </div>
        <p class="small muted" id="bc-page-note" style="max-width:32rem;">Tempo trascorso dall'ultimo blocco trovato.</p>
        <p class="small muted" style="max-width:32rem;">
          Pensato per restare aperto su uno schermo, come display sempre acceso: si aggiorna da solo, non
          serve mai ricaricare la pagina. Premi "Schermo intero" per nascondere anche la barra del browser.
        </p>
      </div>
    </div>
  `);

  const fsBtn = document.getElementById("bc-fullscreen-btn");
  fsBtn.addEventListener("click", () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.();
    }
  });

  startBlockClock(block.height, block.timestamp, "bc-page");
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

// ---------- Mining ----------

const HALVING_INTERVAL = 210000;
const INITIAL_SUBSIDY_SATS = 50 * 100_000_000;

function halvingInfo(height) {
  const epoch = Math.floor(height / HALVING_INTERVAL);
  const currentRewardSats = Math.floor(INITIAL_SUBSIDY_SATS / 2 ** epoch);
  const nextRewardSats = Math.floor(currentRewardSats / 2);
  const blocksIntoEpoch = height % HALVING_INTERVAL;
  const remainingBlocks = HALVING_INTERVAL - blocksIntoEpoch;
  const progressPct = (blocksIntoEpoch / HALVING_INTERVAL) * 100;
  const estDate = new Date(Date.now() + remainingBlocks * 600 * 1000);
  return { currentRewardSats, nextRewardSats, remainingBlocks, progressPct, estDate };
}

function formatDurationMs(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "a breve";
  const totalHours = Math.round(ms / 3600000);
  const days = Math.floor(totalHours / 24);
  const hours = totalHours % 24;
  if (days === 0) return `circa ${hours} ${hours === 1 ? "ora" : "ore"}`;
  return `circa ${days} ${days === 1 ? "giorno" : "giorni"} e ${hours} ${hours === 1 ? "ora" : "ore"}`;
}

function miningCardShellHtml(id, extraStyle = "") {
  return `<div class="card" id="${id}"${extraStyle ? ` style="${extraStyle}"` : ""}><div class="loading"><div class="spinner"></div></div></div>`;
}

function miningErrorHtml(id, msg) {
  return `
    <div class="empty-state">${fmt.escapeHtml(msg)}</div>
    <div class="nav-buttons" style="justify-content:center;">
      <button type="button" class="btn" data-retry="${id}">Riprova</button>
    </div>`;
}

async function loadMiningCard(id, fetchFn, bodyFn, errorMsg) {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
  try {
    const data = await fetchFn();
    const html = bodyFn(data);
    if (!el.isConnected) return; // l'utente ha già cambiato pagina
    if (html == null) throw new Error("dati mining non validi");
    el.innerHTML = html;
  } catch {
    if (el.isConnected) el.innerHTML = miningErrorHtml(id, errorMsg);
  }
}

function difficultyBodyHtml(d) {
  if (!d || typeof d.progressPercent !== "number") return null;
  const pct = Math.min(100, Math.max(0, d.progressPercent));
  const change = typeof d.difficultyChange === "number" ? d.difficultyChange : null;
  const changeLabel =
    change === null ? "" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}% rispetto ad ora`;
  const changeColor = change !== null && change < 0 ? "var(--red)" : "var(--green)";
  return `
    <div class="tip-title">🎯 Prossimo aggiustamento della ${termLink("difficoltà", "difficolta")}</div>
    <div class="dice-progress">
      <div class="dice-progress-bar"><div class="dice-progress-fill" style="width:${pct}%"></div></div>
      <span class="small muted">${pct.toFixed(1)}%</span>
    </div>
    <p class="small muted" style="margin:0.5rem 0 0;">
      ${changeLabel ? `Variazione stimata: <strong style="color:${changeColor};">${fmt.escapeHtml(changeLabel)}</strong> (più difficoltà = mining più costoso = rete più sicura). ` : ""}
      ${typeof d.remainingBlocks === "number" ? `Mancano ${fmt.formatNumber(d.remainingBlocks)} blocchi` : ""}
      ${typeof d.remainingTime === "number" ? ` (${formatDurationMs(d.remainingTime)}).` : "."}
      ${typeof d.estimatedRetargetDate === "number" ? `Stima (data indicativa, non un orario preciso): ${fmt.escapeHtml(fmt.formatDateOnly(d.estimatedRetargetDate / 1000))}.` : ""}
    </p>`;
}

const HASHRATE_PERIODS = [
  { key: "1m", label: "1 mese" },
  { key: "3m", label: "3 mesi" },
  { key: "1y", label: "1 anno" },
  { key: "3y", label: "3 anni" },
];
const HASHRATE_CHART_W = 600;
const HASHRATE_CHART_H = 160;

function chartScales(points, width, height, padY = 0.08) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanY = maxY - minY || maxY || 1;
  const yLo = minY - spanY * padY;
  const yHi = maxY + spanY * padY;
  const scaleX = (x) => ((x - minX) / (maxX - minX || 1)) * width;
  const scaleY = (y) => height - ((y - yLo) / (yHi - yLo || 1)) * height;
  return { minY, maxY, scaleX, scaleY };
}

function lineChartSvgHtml(wrapId, points, width = HASHRATE_CHART_W, height = HASHRATE_CHART_H) {
  if (!Array.isArray(points) || points.length < 2) {
    return `<p class="small muted" style="margin-top:0.75rem;">Dati storici insufficienti per il grafico in questo periodo.</p>`;
  }
  const { minY, maxY, scaleX, scaleY } = chartScales(points, width, height);
  const linePts = points.map((p) => `${scaleX(p.x).toFixed(1)},${scaleY(p.y).toFixed(1)}`).join(" ");
  const areaPts = `0,${height} ${linePts} ${width},${height}`;
  return `
    <div class="chart-wrap" id="${wrapId}" data-width="${width}" data-height="${height}">
      <div class="chart-axis-label chart-axis-max">${fmt.escapeHtml(fmt.formatHashrate(maxY))}</div>
      <div class="chart-axis-label chart-axis-min">${fmt.escapeHtml(fmt.formatHashrate(minY))}</div>
      <svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">
        <polygon class="chart-area" points="${areaPts}"></polygon>
        <polyline class="chart-line" points="${linePts}"></polyline>
        <line class="chart-guide" x1="0" y1="0" x2="0" y2="${height}"></line>
        <circle class="chart-dot" r="4" cx="0" cy="0"></circle>
      </svg>
      <div class="chart-tooltip"></div>
    </div>`;
}

function wireLineChartHover(wrapId, points, { formatX, formatY } = {}) {
  const wrap = document.getElementById(wrapId);
  if (!wrap || !Array.isArray(points) || points.length < 2) return;
  const svg = wrap.querySelector(".chart-svg");
  const guide = wrap.querySelector(".chart-guide");
  const dot = wrap.querySelector(".chart-dot");
  const tooltip = wrap.querySelector(".chart-tooltip");
  if (!svg || !guide || !dot || !tooltip) return;
  const width = Number(wrap.dataset.width);
  const height = Number(wrap.dataset.height);
  const { scaleX, scaleY } = chartScales(points, width, height);

  function showAt(clientX) {
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const relX = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    const idx = Math.round(relX * (points.length - 1));
    const p = points[idx];
    if (!p) return;
    const x = scaleX(p.x);
    const y = scaleY(p.y);
    guide.setAttribute("x1", String(x));
    guide.setAttribute("x2", String(x));
    guide.style.opacity = "1";
    dot.setAttribute("cx", String(x));
    dot.setAttribute("cy", String(y));
    dot.style.opacity = "1";
    tooltip.innerHTML = `<strong>${fmt.escapeHtml(formatY ? formatY(p.y) : String(p.y))}</strong><br><span class="muted">${fmt.escapeHtml(formatX ? formatX(p.x) : String(p.x))}</span>`;
    tooltip.style.left = `${Math.min(88, Math.max(2, (x / width) * 100))}%`;
    tooltip.style.opacity = "1";
  }
  function hide() {
    guide.style.opacity = "0";
    dot.style.opacity = "0";
    tooltip.style.opacity = "0";
  }
  svg.addEventListener("pointerdown", (e) => showAt(e.clientX));
  svg.addEventListener("pointermove", (e) => showAt(e.clientX));
  svg.addEventListener("pointerleave", hide);
  svg.addEventListener("pointerup", hide);
}

function hashrateBodyHtml(h, activePeriod) {
  if (!h || !Number.isFinite(h.currentHashrate)) return null;
  const points = Array.isArray(h.hashrates) ? h.hashrates.map((d) => ({ x: d.timestamp, y: d.avgHashrate })) : [];
  const periodButtons = HASHRATE_PERIODS.map(
    (p) => `<button type="button" class="unit-btn${p.key === activePeriod ? " active" : ""}" data-period="${p.key}">${fmt.escapeHtml(p.label)}</button>`
  ).join("");
  return `
    <div class="row-top" style="align-items:flex-start; flex-wrap:wrap;">
      <div>
        <div class="tip-title">⚡ Potenza di calcolo della rete (${termLink("hashrate", "hashrate")})</div>
        <div class="block-clock-height" style="font-size:1.8rem;">${fmt.escapeHtml(fmt.formatHashrate(h.currentHashrate))}</div>
      </div>
      <div class="unit-toggle" id="hashrate-period-toggle" role="group" aria-label="Periodo del grafico">${periodButtons}</div>
    </div>
    ${lineChartSvgHtml("hashrate-chart-wrap", points)}
    <p class="small muted" style="margin:0.5rem 0 0;">
      Somma stimata della potenza di calcolo di tutti i miner del mondo, nel periodo scelto sopra (passa
      il mouse o il dito sul grafico per i dettagli). Più è alta, più costa (in elettricità e hardware)
      provare a riorganizzare blocchi recenti o censurare transazioni — un attacco che comunque non
      permetterebbe a nessuno di rubare fondi da wallet altrui o creare bitcoin dal nulla.
    </p>`;
}

function halvingBodyHtml(height) {
  const { currentRewardSats, nextRewardSats, remainingBlocks, progressPct, estDate } = halvingInfo(height);
  return `
    <div class="tip-title">✂️ Countdown al prossimo ${termLink("halving", "halving")}</div>
    <div class="dice-progress">
      <div class="dice-progress-bar"><div class="dice-progress-fill" style="width:${progressPct}%"></div></div>
      <span class="small muted">${progressPct.toFixed(1)}%</span>
    </div>
    <p class="small muted" style="margin:0.5rem 0 0;">
      Ricompensa attuale per blocco: <strong>${fmt.escapeHtml(fmt.formatBtc(currentRewardSats))}</strong>. Tra
      <strong>${fmt.formatNumber(remainingBlocks)} blocchi</strong> (stima: ${fmt.escapeHtml(estDate.toLocaleDateString("it-IT", { year: "numeric", month: "long" }))})
      scenderà a <strong>${fmt.escapeHtml(fmt.formatBtc(nextRewardSats))}</strong> per blocco. Questo dimezzamento
      periodico è ciò che rende bitcoin scarso: l'emissione di nuove monete rallenta fino a fermarsi al
      limite fisso di 21 milioni.
    </p>`;
}

const POOL_TOP_N = 15;
const POOL_PERIODS = [
  { key: "24h", label: "24h" },
  { key: "3d", label: "3 giorni" },
  { key: "1w", label: "1 settimana" },
  { key: "1m", label: "1 mese" },
];
const POOL_COLORS = [
  "#f7931a", "#3b82f6", "#22c55e", "#a855f7", "#ef4444",
  "#14b8a6", "#eab308", "#ec4899", "#6366f1", "#f97316",
  "#10b981", "#8b5cf6", "#f43f5e", "#0ea5e9", "#84cc16",
];

function normalizeMiningPools(raw) {
  const list = Array.isArray(raw) ? raw : Array.isArray(raw?.pools) ? raw.pools : [];
  const total = typeof raw?.blockCount === "number" ? raw.blockCount : list.reduce((s, p) => s + (p.blockCount ?? p.count ?? 0), 0);
  const sorted = list
    .map((p) => ({
      name: p.name || p.poolName || "Sconosciuto",
      blocks: p.blockCount ?? p.count ?? 0,
      avgMatchRate: typeof p.avgMatchRate === "number" ? p.avgMatchRate : null,
    }))
    .filter((p) => p.blocks > 0)
    .sort((a, b) => b.blocks - a.blocks);
  const top = sorted.slice(0, POOL_TOP_N).map((p) => ({ ...p, pct: total > 0 ? (p.blocks / total) * 100 : 0 }));
  const shownBlocks = top.reduce((s, p) => s + p.blocks, 0);
  const otherPct = total > 0 ? Math.max(0, ((total - shownBlocks) / total) * 100) : 0;
  return { top, otherPct };
}

function poolStackBarHtml(top, otherPct) {
  const segments = top
    .map(
      (p, i) =>
        `<span style="width:${p.pct}%; background:${POOL_COLORS[i % POOL_COLORS.length]};" title="${fmt.escapeHtml(p.name)}: ${p.pct.toFixed(1)}%"></span>`
    )
    .join("");
  const otherSeg =
    otherPct > 0.5 ? `<span style="width:${otherPct}%; background:var(--hairline);" title="Altri pool minori: ${otherPct.toFixed(1)}%"></span>` : "";
  return `<div class="stack-bar">${segments}${otherSeg}</div>`;
}

const POOL_PERIOD_LABELS = { "24h": "nelle ultime 24 ore", "3d": "negli ultimi 3 giorni", "1w": "nell'ultima settimana", "1m": "nell'ultimo mese" };

function poolsBodyHtml(raw, activePeriod) {
  const { top, otherPct } = normalizeMiningPools(raw);
  if (top.length === 0) return null;
  const periodButtons = POOL_PERIODS.map(
    (p) => `<button type="button" class="unit-btn${p.key === activePeriod ? " active" : ""}" data-pool-period="${p.key}">${fmt.escapeHtml(p.label)}</button>`
  ).join("");
  const rows = otherPct > 0.5 ? [...top, { name: "Altri pool minori / non identificati", blocks: null, pct: otherPct, muted: true }] : top;
  return `
    <div class="row-top" style="align-items:flex-start; flex-wrap:wrap;">
      <div class="tip-title" style="margin-bottom:0;">🤝 ${termLink("Pool di mining", "poolmining")} più attivi</div>
      <div class="unit-toggle" id="pools-period-toggle" role="group" aria-label="Periodo dei pool">${periodButtons}</div>
    </div>
    ${poolStackBarHtml(top, otherPct)}
    <div style="display:flex; flex-direction:column; gap:0.55rem; margin-top:0.9rem;">
      ${rows
        .map(
          (p, i) => `
        <div${p.muted ? ` class="muted"` : ""}>
          <div class="row-top" style="font-weight:600; font-size:0.85rem; gap:0.5rem;">
            <span>${
              p.muted ? "" : `<span class="legend-swatch" style="background:${POOL_COLORS[i % POOL_COLORS.length]}; margin-right:0.4rem;"></span>`
            }${fmt.escapeHtml(p.name)}${
              typeof p.avgMatchRate === "number"
                ? ` <span class="small muted" title="Stima di quanto il template dei blocchi trovati da questo pool segue l'ordine di fee ottimale: non è una misura di sicurezza né di affidabilità del pool.">· ${p.avgMatchRate.toFixed(1)}% efficienza fee</span>`
                : ""
            }</span>
            <span class="muted">${p.pct.toFixed(1)}%${typeof p.blocks === "number" ? ` (${fmt.formatNumber(p.blocks)} blocchi)` : ""}</span>
          </div>
          <div class="dice-progress-bar"><div class="dice-progress-fill" style="width:${p.pct}%; background:${p.muted ? "var(--ink-soft)" : POOL_COLORS[i % POOL_COLORS.length]};"></div></div>
        </div>`
        )
        .join("")}
    </div>
    <p class="small muted" style="margin:0.75rem 0 0;">
      La quota riflette quali miner condividono la potenza con quel pool ${fmt.escapeHtml(POOL_PERIOD_LABELS[activePeriod] ?? "nel periodo scelto sopra")}: un
      miner può cambiare pool in pochi minuti, quindi non è una proprietà fissa. I nomi sono
      un'etichetta rilevata da mempool.space (tag nella coinbase o indirizzo di payout noto), non un
      dato verificabile crittograficamente. In ogni caso, nessun pool — per quanto grande — può da solo
      cambiare le regole del protocollo: quelle le fanno rispettare i full node, non i miner.
    </p>`;
}

async function renderMining() {
  renderLoading("Carico i dati sul mining…");
  const tipHeight = await api.getTipHeight();

  setContent(`
    <div class="breadcrumb"><a href="#/">Home</a> / Mining</div>
    <h1>⛏️ Mining: come nascono i nuovi blocchi</h1>
    <p class="muted">
      I miner sono i computer che tengono viva la rete Bitcoin: elaborano i blocchi e competono tra
      loro cercando un ${termLink("nonce", "nonce")} valido, ricevendo in cambio nuovi bitcoin (la
      transazione ${termLink("coinbase", "coinbase")}) più le fee delle transazioni incluse. Ecco lo
      stato della rete in tempo reale.
    </p>
    <div class="glossary-grid" id="mining-grid">
      ${miningCardShellHtml("mining-hashrate", "grid-column:1 / -1;")}
      <div class="card" id="mining-halving">${halvingBodyHtml(tipHeight)}</div>
      ${miningCardShellHtml("mining-difficulty")}
      ${miningCardShellHtml("mining-pools", "grid-column:1 / -1;")}
    </div>
  `);

  const grid = document.getElementById("mining-grid");
  let lastHeight = tipHeight;
  let hashratePeriod = "3m";
  let poolsPeriod = "1w";

  async function pollTipHeight() {
    try {
      const tip = await api.getTipHeight();
      if (tip > lastHeight) {
        lastHeight = tip;
        const halvingEl = document.getElementById("mining-halving");
        if (halvingEl) halvingEl.innerHTML = halvingBodyHtml(lastHeight);
      }
    } catch {
      // Errore di rete silenzioso: si riprova al prossimo giro senza interrompere il countdown.
    }
  }

  const pollTimer = setInterval(pollTipHeight, 30000);
  setViewCleanup(() => clearInterval(pollTimer));

  async function loadHashrateCard(period) {
    hashratePeriod = period;
    const el = document.getElementById("mining-hashrate");
    if (!el) return;
    el.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
    try {
      const h = await api.getMiningHashrate(period);
      if (!el.isConnected) return;
      const html = hashrateBodyHtml(h, period);
      if (html == null) throw new Error("dati hashrate non validi");
      el.innerHTML = html;
      const points = Array.isArray(h.hashrates) ? h.hashrates.map((d) => ({ x: d.timestamp, y: d.avgHashrate })) : [];
      wireLineChartHover("hashrate-chart-wrap", points, {
        formatY: (v) => fmt.formatHashrate(v),
        formatX: (t) => fmt.formatDateOnly(t),
      });
      document.getElementById("hashrate-period-toggle")?.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-period]");
        if (btn) loadHashrateCard(btn.dataset.period);
      });
    } catch {
      if (el.isConnected) el.innerHTML = miningErrorHtml("mining-hashrate", "Dati sull'hashrate non disponibili al momento.");
    }
  }

  async function loadPoolsCard(period) {
    poolsPeriod = period;
    const el = document.getElementById("mining-pools");
    if (!el) return;
    el.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;
    try {
      const raw = await api.getMiningPools(period);
      if (!el.isConnected) return;
      const html = poolsBodyHtml(raw, period);
      if (html == null) throw new Error("dati pool non validi");
      el.innerHTML = html;
      document.getElementById("pools-period-toggle")?.addEventListener("click", (e) => {
        const btn = e.target.closest("button[data-pool-period]");
        if (btn) loadPoolsCard(btn.dataset.poolPeriod);
      });
    } catch {
      if (el.isConnected) el.innerHTML = miningErrorHtml("mining-pools", "Dati sui pool di mining non disponibili al momento.");
    }
  }

  function loadAll() {
    loadHashrateCard(hashratePeriod);
    loadMiningCard("mining-difficulty", () => api.getDifficultyAdjustment(), difficultyBodyHtml, "Dati sulla difficoltà non disponibili al momento.");
    loadPoolsCard(poolsPeriod);
  }

  grid.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-retry]");
    if (!btn) return;
    const id = btn.dataset.retry;
    if (id === "mining-hashrate") loadHashrateCard(hashratePeriod);
    if (id === "mining-difficulty") loadMiningCard(id, () => api.getDifficultyAdjustment(), difficultyBodyHtml, "Dati sulla difficoltà non disponibili al momento.");
    if (id === "mining-pools") loadPoolsCard(poolsPeriod);
  });

  loadAll();
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

    <h2 class="section-title">🔐 Verifica tu stesso questo blocco</h2>
    <p class="small muted">
      Non fidarti della nostra parola: il tuo browser può ricalcolare da solo se questo blocco è
      valido, usando solo i dati già scaricati e la funzione crittografica SHA-256 nativa del
      browser — senza inviare nulla a nessun server. È il principio "don't trust, verify" alla base
      di Bitcoin.
    </p>
    <div class="card">
      <button type="button" class="btn btn-primary" id="verify-block-btn">🔐 Verifica ora</button>
      <div id="verify-block-result"></div>
    </div>

    <div class="card" style="margin-top:0.6rem;">
      <div class="tip-title small muted" style="margin-bottom:0.5rem;">🔀 Confronto con una seconda fonte indipendente</div>
      <button type="button" class="btn" id="crosscheck-block-btn">Confronta con blockstream.info</button>
      <div id="crosscheck-block-result"></div>
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

  document.getElementById("verify-block-btn").addEventListener("click", () => verifyBlockClientSide(hash, block));
  document.getElementById("crosscheck-block-btn").addEventListener("click", () => crossCheckBlockClientSide(hash, block));
}

const BLOCK_CROSSCHECK_FIELDS = [
  { key: "id", label: "Hash del blocco" },
  { key: "merkle_root", label: "Merkle root" },
  { key: "nonce", label: "Nonce" },
  { key: "bits", label: "Bits" },
  { key: "timestamp", label: "Timestamp" },
  { key: "height", label: "Altezza" },
  { key: "tx_count", label: "Numero di transazioni" },
  { key: "previousblockhash", label: "Blocco precedente" },
];

async function crossCheckClientSide(btnId, resultId, fetchOther, mine, fields, sourceLabel) {
  const btn = document.getElementById(btnId);
  const resultEl = document.getElementById(resultId);
  if (!btn || !resultEl) return;
  btn.disabled = true;
  btn.textContent = "Confronto…";
  resultEl.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

  try {
    const other = await fetchOther();
    const rows = fields
      .map((f) => {
        const match = String(mine[f.key]) === String(other[f.key]);
        return `<div class="row-top" style="font-size:0.85rem;"><span>${match ? "✅" : "❌"} ${fmt.escapeHtml(f.label)}</span></div>`;
      })
      .join("");
    const allMatch = fields.every((f) => String(mine[f.key]) === String(other[f.key]));
    resultEl.innerHTML = `
      <div class="tip-card ${allMatch ? "good" : "bad"}" style="margin-top:1rem;">
        <div class="tip-title">${allMatch ? "✅ Le due fonti concordano" : "⚠️ Differenze trovate"}</div>
        <p class="small muted">mempool.space vs ${fmt.escapeHtml(sourceLabel)}, campo per campo:</p>
        ${rows}
      </div>`;
    btn.disabled = false;
    btn.textContent = `Confronta con ${sourceLabel}`;
  } catch {
    resultEl.innerHTML = `<div class="empty-state" style="margin-top:1rem;">Non sono riuscito a contattare ${fmt.escapeHtml(sourceLabel)}. Riprova.</div>`;
    btn.disabled = false;
    btn.textContent = "Riprova";
  }
}

function crossCheckBlockClientSide(hash, block) {
  return crossCheckClientSide(
    "crosscheck-block-btn",
    "crosscheck-block-result",
    () => api.crossCheckBlock(hash),
    block,
    BLOCK_CROSSCHECK_FIELDS,
    "blockstream.info"
  );
}

async function verifyBlockClientSide(hash, block) {
  const btn = document.getElementById("verify-block-btn");
  const resultEl = document.getElementById("verify-block-result");
  if (!btn || !resultEl) return;
  btn.disabled = true;
  btn.textContent = "Verifico…";
  resultEl.innerHTML = `<div class="loading"><div class="spinner"></div><div>Scarico le transazioni e calcolo SHA-256 nel browser…</div></div>`;

  try {
    const summary = await api.getBlockSummary(hash);
    const txids = summary.map((tx) => tx.txid);
    const result = await verifyBlock(block, txids);

    resultEl.innerHTML = `
      <div class="tip-card ${result.merkleRootMatches ? "good" : "bad"}" style="margin-top:1rem;">
        <div class="tip-title">${result.merkleRootMatches ? "✅" : "❌"} ${termLink("Merkle root", "merkleroot")}</div>
        <p>Ricalcolata dalle ${fmt.formatNumber(txids.length)} transazioni appena scaricate: ${
      result.merkleRootMatches ? "corrisponde esattamente" : "NON corrisponde"
    } a quella dichiarata dal blocco.</p>
      </div>
      <div class="tip-card ${result.hashMatches ? "good" : "bad"}" style="margin-top:0.6rem;">
        <div class="tip-title">${result.hashMatches ? "✅" : "❌"} Proof-of-work</div>
        <p>Ricostruendo l'header (${termLink("nonce", "nonce")}, ${termLink("bits", "bits")}, timestamp, merkle root) e calcolando il doppio SHA-256, il tuo browser ha ottenuto:</p>
        <p class="mono small" style="word-break:break-all;">${fmt.escapeHtml(result.computedHash)}</p>
        <p>${
          result.hashMatches
            ? "Corrisponde esattamente all'hash del blocco: la proof-of-work è autentica, verificata dal tuo browser."
            : "NON corrisponde all'hash dichiarato — qualcosa non torna."
        }</p>
      </div>`;
    btn.textContent = "🔐 Verifica ora";
    btn.disabled = false;
  } catch {
    resultEl.innerHTML = `<div class="empty-state" style="margin-top:1rem;">Non sono riuscito a scaricare le transazioni per la verifica. Riprova.</div>`;
    btn.textContent = "Riprova";
    btn.disabled = false;
  }
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

function txStatusLineHtml(tx, confirmations) {
  return tx.status.confirmed
    ? `<span class="badge confirmed">✔ Confermata — ${fmt.formatNumber(confirmations)} ${termLink(confermeLabel(confirmations), "conferma")}</span> <a class="small" href="#/block/${tx.status.block_height}">nel blocco #${fmt.formatNumber(tx.status.block_height)}</a>`
    : `<span class="badge pending">⏳ In attesa in ${termLink("mempool", "mempool")}</span>`;
}

function txFeeDiagnosisHtml(txFeeRate, fees) {
  if (!fees || !Number.isFinite(txFeeRate)) return "";
  const rate = txFeeRate.toFixed(1);
  let level = "";
  let icon = "🐢";
  let message;
  if (txFeeRate >= fees.fastestFee) {
    level = "good";
    icon = "🚀";
    message = `La tua fee (${rate} sat/vB) è alta rispetto a quelle consigliate ora (veloce: ${fees.fastestFee} sat/vB): dovrebbe confermarsi nel giro del prossimo blocco.`;
  } else if (txFeeRate >= fees.halfHourFee) {
    level = "good";
    icon = "🙂";
    message = `La tua fee (${rate} sat/vB) è in linea con la fascia "normale" di questo momento (${fees.halfHourFee} sat/vB): la conferma dovrebbe arrivare entro circa mezz'ora.`;
  } else if (txFeeRate >= fees.economyFee) {
    message = `La tua fee (${rate} sat/vB) è più bassa di quelle consigliate ora (economica: ${fees.economyFee} sat/vB): potrebbe volerci più tempo del solito, da qualche ora in su.`;
  } else {
    level = "bad";
    icon = "⚠️";
    message = `La tua fee (${rate} sat/vB) è sotto anche quella più economica consigliata ora (${fees.economyFee} sat/vB): se la rete è congestionata la transazione può restare in attesa a lungo, anche giorni — ma resta valida e prima o poi verrà inclusa. Se il tuo wallet lo supporta, puoi provare ${termLink("RBF", "rbf")} (sostituirla con una fee più alta) o ${termLink("CPFP", "cpfp")} (una seconda transazione che "spinge" la prima).`;
  }
  return `
    <div class="tip-card ${level}" id="tx-fee-diagnosis-card" style="margin-top:0.75rem;">
      <div class="tip-title">${icon} Quanto potrei dover aspettare?</div>
      <p>${message}</p>
      <p class="small muted" style="margin-top:0.4rem;">Confronto con le fee consigliate in questo momento: si aggiorna insieme allo stato della transazione, perché la congestione della rete cambia nel tempo.</p>
    </div>`;
}

function startTxTracker(txid, txFeeRate) {
  const statusEl = document.getElementById("tx-status-line");
  const diagnosisEl = document.getElementById("tx-fee-diagnosis");
  if (!statusEl) return;

  async function poll() {
    try {
      const tx = await api.getTx(txid);
      let confirmations = 0;
      if (tx.status.confirmed) {
        const tipHeight = await api.getTipHeight();
        confirmations = tipHeight - tx.status.block_height + 1;
      }
      if (document.getElementById("tx-status-line")) {
        statusEl.innerHTML = txStatusLineHtml(tx, confirmations);
      }
      if (diagnosisEl) {
        if (tx.status.confirmed) {
          diagnosisEl.innerHTML = "";
        } else {
          try {
            const fees = await api.getFeeEstimates();
            if (document.getElementById("tx-fee-diagnosis")) {
              diagnosisEl.innerHTML = txFeeDiagnosisHtml(txFeeRate, fees);
            }
          } catch {
            // Fee non disponibili in questo giro: lascia la diagnosi precedente invariata.
          }
        }
      }
    } catch {
      // Errore di rete silenzioso: si riprova al prossimo giro senza interrompere il tracker.
    }
  }

  const timer = setInterval(poll, 15000);
  setViewCleanup(() => clearInterval(timer));
}

async function renderTx(txid) {
  if (!txid) return renderNotFound();
  renderLoading("Carico i dettagli della transazione…");
  const [tx, pricesResult, feesResult] = await Promise.all([
    api.getTx(txid),
    api.getPrices().catch(() => null),
    api.getFeeEstimates().catch(() => null),
  ]);
  const eurRate = pricesResult?.EUR ?? null;
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
  const feeRateNum = isCoinbase ? null : tx.fee / vsize;
  const feeRate = isCoinbase ? null : feeRateNum.toFixed(1);

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
    <p id="tx-status-line">${txStatusLineHtml(tx, confirmations)}</p>
    <div id="tx-fee-diagnosis">${!confirmed ? txFeeDiagnosisHtml(feeRateNum, feesResult) : ""}</div>

    <div class="card">
      <p><strong>In parole semplici:</strong>
        ${
          isCoinbase
            ? `Questa è una transazione speciale: il miner ha creato ${fmt.formatBtc(totalOut)}${fmt.formatFiat(totalOut, eurRate) ? ` (~${fmt.formatFiat(totalOut, eurRate)})` : ""} come ricompensa per aver minato il blocco.`
            : `Sono stati inviati in totale ${fmt.formatBtc(totalOut)}${fmt.formatFiat(totalOut, eurRate) ? ` (~${fmt.formatFiat(totalOut, eurRate)})` : ""}, prelevando ${fmt.formatBtc(totalIn)} dagli indirizzi mittenti. La differenza, ${fmt.formatBtc(tx.fee)}, è la ${termLink("commissione (fee)", "fee")} pagata ai miner (circa ${feeRate} sat/vB).`
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

    <div class="card">
      <div class="tip-title small muted" style="margin-bottom:0.5rem;">🔀 Confronto con una seconda fonte indipendente</div>
      <button type="button" class="btn" id="crosscheck-tx-btn">Confronta con blockstream.info</button>
      <div id="crosscheck-tx-result"></div>
    </div>
  `);

  document.getElementById("crosscheck-tx-btn").addEventListener("click", () => crossCheckTxClientSide(tx.txid, tx));
  startTxTracker(tx.txid, feeRateNum);
}

const TX_CROSSCHECK_FIELDS = [
  { key: "txid", label: "Txid" },
  { key: "fee", label: "Fee totale (sat)" },
  { key: "weight", label: "Peso (weight)" },
  { key: "size", label: "Dimensione" },
  { key: "confirmed", label: "Confermata" },
  { key: "block_height", label: "Altezza del blocco" },
];

function flattenTxForCrosscheck(tx) {
  return {
    txid: tx.txid,
    fee: tx.fee,
    weight: tx.weight,
    size: tx.size,
    confirmed: tx.status?.confirmed,
    block_height: tx.status?.block_height,
  };
}

function crossCheckTxClientSide(txid, tx) {
  return crossCheckClientSide(
    "crosscheck-tx-btn",
    "crosscheck-tx-result",
    async () => flattenTxForCrosscheck(await api.crossCheckTx(txid)),
    flattenTxForCrosscheck(tx),
    TX_CROSSCHECK_FIELDS,
    "blockstream.info"
  );
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
  const [info, txs, pricesResult] = await Promise.all([
    api.getAddress(address),
    api.getAddressTxs(address),
    api.getPrices().catch(() => null),
  ]);
  const eurRate = pricesResult?.EUR ?? null;

  const funded = info.chain_stats.funded_txo_sum + info.mempool_stats.funded_txo_sum;
  const spent = info.chain_stats.spent_txo_sum + info.mempool_stats.spent_txo_sum;
  const balance = funded - spent;
  const txCount = info.chain_stats.tx_count + info.mempool_stats.tx_count;
  const balanceFiat = fmt.formatFiat(balance, eurRate);

  const watched = isWatched(address);

  setContent(`
    <div class="breadcrumb"><a href="#/">Home</a> / Indirizzo</div>
    <h1>Indirizzo</h1>
    <p style="display:flex; align-items:center; gap:0.5rem; flex-wrap:wrap;">
      ${hashWithCopyHtml(address)}
      <button type="button" class="btn" id="watch-toggle" data-address="${fmt.escapeHtml(address)}">
        ${watched ? "★ Salvato — rimuovi" : "☆ Salva questo indirizzo"}
      </button>
    </p>

    <div class="stat-grid">
      <div class="stat-card">
        <div class="label">Saldo attuale <a class="help-icon" href="#/glossario/utxo" title="Il saldo è la somma degli UTXO non spesi ricevuti da questo indirizzo. Clicca per saperne di più.">?</a></div>
        <div class="value">${fmt.formatBtc(balance)}</div>
        <div class="sub">${fmt.formatAlt(balance)}${balanceFiat ? ` · ~${balanceFiat}` : ""}</div>
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

  document.getElementById("watch-toggle").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    if (isWatched(address)) {
      removeFromWatchlist(address);
      btn.textContent = "☆ Salva questo indirizzo";
    } else {
      addToWatchlist(address);
      btn.textContent = "★ Salvato — rimuovi";
    }
  });
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
  { slug: "hashrate", icon: "⚡", term: "Hashrate", desc: "La potenza di calcolo complessiva dedicata dai miner di tutto il mondo a cercare nuovi blocchi, misurata in hash al secondo. Oggi la rete Bitcoin supera i 600 EH/s: centinaia di miliardi di miliardi di hash al secondo. Più è alto, più la rete è sicura e costosa da attaccare." },
  { slug: "halving", icon: "✂️", term: "Halving", desc: "Un evento programmato che ogni 210.000 blocchi (circa 4 anni) dimezza la ricompensa in bitcoin che i miner ricevono per ogni blocco trovato. Regola l'emissione di nuovi bitcoin fino al limite di 21 milioni." },
  { slug: "poolmining", icon: "🤝", term: "Pool di mining", desc: "Un gruppo di miner che unisce la propria potenza di calcolo e divide la ricompensa in proporzione al contributo di ciascuno, per avere entrate più regolari invece di dipendere dalla fortuna di trovare un blocco da soli." },
  { slug: "segwit", icon: "🧩", term: "SegWit", desc: "Un aggiornamento del 2017 che separa (\"segregated witness\") le firme dal resto della transazione, riducendo lo spazio occupato nel blocco (fee più basse) e correggendo un bug che permetteva di modificare il txid. Gli indirizzi SegWit iniziano con \"3\" o \"bc1q\"." },
  { slug: "taproot", icon: "🌿", term: "Taproot", desc: "Un aggiornamento del 2021 che rende le transazioni più semplici (multisig e condizioni complesse), più economiche e più private, perché sulla blockchain una spesa normale e una condizione avanzata appaiono identiche. Gli indirizzi Taproot iniziano con \"bc1p\"." },
  { slug: "psbt", icon: "📋", term: "PSBT", desc: "Partially Signed Bitcoin Transaction: un formato standard per costruire e firmare una transazione in più passaggi separati (es. su un hardware wallet offline), utile soprattutto per i wallet multisig." },
  { slug: "multisig", icon: "🔏", term: "Multisig", desc: "Un wallet che richiede le firme di più chiavi private (es. 2 su 3) per spendere i fondi, invece di una sola: nessuna singola chiave rubata o persa basta a compromettere i fondi." },
  { slug: "lightning", icon: "⚡", term: "Lightning Network", desc: "Una rete costruita \"sopra\" Bitcoin per fare pagamenti istantanei ed economici tramite canali privati tra due parti, che si aggiornano fuori dalla blockchain principale e vi si riconciliano solo all'apertura e alla chiusura del canale." },

  // Rete e protocollo
  { slug: "blockchain", icon: "⛓️", term: "Blockchain", desc: "La catena di tutti i blocchi, dal primo (2009) all'ultimo minato: un registro pubblico e condiviso che chiunque può scaricare e verificare da solo, senza fidarsi di un'autorità centrale." },
  { slug: "nodo", icon: "🖥️", term: "Nodo (nodo completo)", desc: "Un computer che scarica e verifica da solo l'intera blockchain, applicando le regole del protocollo indipendentemente da chiunque altro. Farne girare uno è il modo più sicuro per usare Bitcoin senza fidarsi della parola di terzi.", guide: "gestisci-nodo" },
  { slug: "nodopruned", icon: "🌾", term: "Nodo pruned", desc: "Un nodo completo che, dopo aver verificato ogni blocco, cancella i dati più vecchi che non servono più per continuare a validare la rete, occupando molto meno spazio su disco.", guide: "gestisci-nodo" },
  { slug: "consenso", icon: "🤝", term: "Regole di consenso", desc: "L'insieme delle regole (formato delle transazioni, limite di 21 milioni, validità della proof-of-work, ecc.) che ogni nodo controlla in modo indipendente: se un blocco le viola, viene rifiutato, chiunque l'abbia minato." },
  { slug: "pow", icon: "⛏️", term: "Proof of Work (PoW)", desc: "La \"prova di lavoro\" che dimostra che un miner ha speso energia reale per trovare un blocco valido, rendendo costosissimo falsificare la blockchain o riscrivere la sua storia." },
  { slug: "miner", icon: "⚙️", term: "Miner (minatore)", desc: "Chi partecipa al mining: mette a disposizione potenza di calcolo per cercare blocchi validi, in cambio della ricompensa di blocco e delle fee delle transazioni incluse." },
  { slug: "asic", icon: "🔩", term: "ASIC", desc: "Un chip costruito esclusivamente per calcolare hash SHA-256 il più velocemente possibile: è l'hardware usato oggi da tutti i miner seri, molto più efficiente di una normale scheda video." },
  { slug: "genesisblock", icon: "🌅", term: "Genesis block", desc: "Il primissimo blocco della blockchain, minato da Satoshi Nakamoto il 3 gennaio 2009. Contiene, incorporato nei suoi dati, il titolo di un articolo di giornale di quel giorno, a prova della data." },
  { slug: "timestamp", icon: "🕰️", term: "Timestamp", desc: "La marca temporale che il miner inserisce nell'intestazione di un blocco al momento di crearlo: indica approssimativamente quando il blocco è stato trovato." },
  { slug: "retep2p", icon: "🌐", term: "Rete peer-to-peer (P2P)", desc: "Bitcoin non ha un server centrale: migliaia di nodi in tutto il mondo si scambiano blocchi e transazioni direttamente tra loro, ciascuno alla pari (\"peer\") con tutti gli altri." },
  { slug: "softfork", icon: "🔧", term: "Soft fork", desc: "Un aggiornamento delle regole che le rende più restrittive in modo retrocompatibile: i nodi non aggiornati continuano a considerare valida la catena, anche se non ne colgono tutte le nuove regole. SegWit e Taproot sono stati introdotti così." },
  { slug: "hardfork", icon: "🔨", term: "Hard fork", desc: "Un cambiamento delle regole non retrocompatibile: i nodi non aggiornati rifiutano i nuovi blocchi, e la rete può dividersi in due catene separate se non c'è consenso unanime ad aggiornarsi." },
  { slug: "reorg", icon: "🔀", term: "Riorganizzazione (reorg)", desc: "Quando la rete scarta temporaneamente uno o più blocchi recenti in favore di una catena alternativa più \"pesante\" trovata da altri miner. Di solito riguarda solo l'ultimo blocco ed è normale; oltre le poche conferme diventa quasi impossibile." },
  { slug: "orphanblock", icon: "🍂", term: "Blocco orfano", desc: "Un blocco valido, minato correttamente, ma che alla fine non fa parte della catena più lunga perché un altro blocco alla stessa altezza è stato accettato dalla rete al suo posto." },
  { slug: "blockreward", icon: "🎁", term: "Ricompensa di blocco (block reward)", desc: "I nuovi bitcoin che il protocollo assegna al miner che trova un blocco, tramite la transazione coinbase. Si dimezza a ogni halving, fino ad azzerarsi quando saranno stati emessi tutti i 21 milioni di bitcoin." },
  { slug: "supply21m", icon: "🔒", term: "Limite di 21 milioni", desc: "Il numero massimo di bitcoin che potranno mai esistere, fissato nel protocollo fin dall'inizio. Nessuna autorità può crearne di più: è una delle proprietà che rendono bitcoin una moneta a offerta scarsa e prevedibile." },
  { slug: "dust", icon: "✨", term: "Dust (polvere)", desc: "Un importo così piccolo che la fee necessaria per spenderlo in futuro costerebbe più dell'importo stesso: molti wallet segnalano o ignorano automaticamente questi UTXO \"di polvere\"." },
  { slug: "rbf", icon: "🔁", term: "RBF (Replace-By-Fee)", desc: "Una funzione che permette di sostituire una transazione ancora in mempool con una identica ma con fee più alta, per farla confermare più velocemente se la prima resta bloccata troppo a lungo." },
  { slug: "cpfp", icon: "👶", term: "CPFP (Child Pays For Parent)", desc: "Una tecnica per sbloccare una transazione con fee troppo bassa creandone una seconda, collegata alla prima, con una fee abbastanza alta da rendere conveniente per i miner confermarle entrambe insieme." },
  { slug: "doublespend", icon: "⚠️", term: "Doppia spesa (double spend)", desc: "Il tentativo di spendere due volte lo stesso bitcoin. È esattamente il problema che la blockchain e la proof-of-work risolvono: una volta confermata con abbastanza conferme, una transazione è considerata definitiva." },
  { slug: "attacco51", icon: "🛡️", term: "Attacco del 51%", desc: "Uno scenario teorico in cui un singolo soggetto controllasse più della metà dell'hashrate della rete, potendo così riscrivere gli ultimi blocchi. Sulla rete Bitcoin il costo in energia e hardware necessario lo rende oggi economicamente impraticabile." },
  { slug: "sybil", icon: "👥", term: "Attacco Sybil", desc: "Un tentativo di influenzare la rete creando molti nodi o identità false. Bitcoin lo rende inutile: ogni nodo verifica le regole da solo, quindi contano le regole applicate, non quanti nodi le ripetono." },
  { slug: "spv", icon: "📡", term: "SPV (nodo leggero)", desc: "Simplified Payment Verification: un modo per un wallet di controllare le proprie transazioni senza scaricare l'intera blockchain, appoggiandosi ai dati di altri nodi. Più comodo, ma richiede di fidarsi in parte di chi fornisce quei dati." },

  // Crittografia, chiavi e indirizzi
  { slug: "script", icon: "📜", term: "Bitcoin Script", desc: "Il linguaggio con cui sono scritte le condizioni per spendere un output: dalla semplice firma di una chiave privata a condizioni più complesse come multisig o timelock." },
  { slug: "p2pkh", icon: "1️⃣", term: "P2PKH", desc: "Il formato di indirizzo Bitcoin più vecchio, che inizia con \"1\": paga a un hash della chiave pubblica del destinatario. Funziona ancora, ma è meno efficiente dei formati SegWit e Taproot più recenti." },
  { slug: "p2sh", icon: "3️⃣", term: "P2SH", desc: "Un formato di indirizzo che inizia con \"3\": paga a uno script più complesso (es. multisig, o un indirizzo SegWit \"avvolto\" in modo compatibile con i wallet più vecchi)." },
  { slug: "p2wpkh", icon: "🧩", term: "P2WPKH", desc: "Il formato SegWit nativo per un singolo proprietario, dietro agli indirizzi che iniziano con \"bc1q\": più economico da spendere di un P2PKH tradizionale." },
  { slug: "p2tr", icon: "🌿", term: "P2TR (Taproot)", desc: "Il formato di indirizzo introdotto con Taproot, che inizia con \"bc1p\": rende una spesa semplice e una condizione complessa (es. multisig) indistinguibili sulla blockchain." },
  { slug: "bech32", icon: "🔤", term: "Bech32 / Bech32m", desc: "La codifica usata dagli indirizzi SegWit (\"bc1q…\", standard Bech32) e Taproot (\"bc1p…\", variante Bech32m): include un checksum che rileva quasi ogni errore di battitura, segnalandolo prima di inviare fondi a un indirizzo sbagliato." },
  { slug: "base58", icon: "🔡", term: "Base58Check", desc: "La codifica usata dagli indirizzi più vecchi (che iniziano con \"1\" o \"3\"): esclude lettere e numeri facili da confondere (0, O, I, l) e include un checksum di controllo." },
  { slug: "checksumaddr", icon: "✅", term: "Checksum di un indirizzo", desc: "Alcuni caratteri finali dell'indirizzo, calcolati matematicamente dal resto: permettono di accorgersi quasi sempre se è stato trascritto male, prima ancora di provare a inviare fondi.", guide: "verifica-indirizzo" },
  { slug: "hdwallet", icon: "🌳", term: "Wallet HD (gerarchico deterministico)", desc: "Un wallet che genera tutte le sue chiavi (e quindi tutti i suoi indirizzi) a partire da un'unica seed, seguendo uno standard (BIP32): basta la seed per ricreare l'intero wallet, anche su un altro dispositivo." },
  { slug: "derivationpath", icon: "🗺️", term: "Percorso di derivazione", desc: "La \"strada\" numerica che un wallet HD segue a partire dalla seed per generare ciascun indirizzo specifico: usare lo stesso percorso su un altro wallet permette di ritrovare gli stessi fondi." },
  { slug: "xpub", icon: "🔓", term: "Chiave pubblica estesa (xpub/ypub/zpub)", desc: "Una chiave che permette di generare e osservare tutti gli indirizzi futuri di un wallet HD senza poter spendere i fondi: utile per un wallet watch-only, ma va condivisa con cautela perché rivela l'intera cronologia del wallet. \"xpub\", \"ypub\" e \"zpub\" indicano lo stesso concetto per formati di indirizzo diversi (legacy, SegWit annidato, SegWit nativo): in questo block explorer puoi incollarne una nella watchlist per tracciare automaticamente tutti gli indirizzi da lei derivati con un saldo, tutto calcolato nel tuo browser." },
  { slug: "bip", icon: "📄", term: "BIP (Bitcoin Improvement Proposal)", desc: "Un documento pubblico che propone uno standard o un cambiamento per Bitcoin (es. BIP39 per le seed phrase, BIP32 per i wallet HD): chiunque può proporne uno, ma diventa parte della rete solo se i nodi lo adottano volontariamente." },
  { slug: "airgapped", icon: "🔌", term: "Air-gapped", desc: "Un dispositivo tenuto permanentemente scollegato da internet e da altri computer, che scambia dati solo tramite QR code o schede SD: riduce drasticamente la superficie di attacco per le chiavi private." },
  { slug: "coldstorage", icon: "🧊", term: "Cold storage", desc: "Custodire le chiavi private su un dispositivo mai connesso a internet (es. un hardware wallet): l'approccio più sicuro per conservare somme importanti nel lungo periodo.", guide: "primo-wallet" },
  { slug: "hotwallet", icon: "🔥", term: "Hot wallet", desc: "Un wallet installato su un dispositivo connesso a internet (telefono, computer): comodo per l'uso quotidiano, ma più esposto di un cold storage a malware o accessi non autorizzati.", guide: "primo-wallet" },
  { slug: "watchonly", icon: "👁️", term: "Wallet watch-only", desc: "Un wallet configurato con la sola chiave pubblica (o xpub), che può mostrare saldo e cronologia ma non può firmare transazioni: utile per controllare i fondi custoditi altrove, ad esempio su un hardware wallet." },
  { slug: "passphrase25", icon: "🔑", term: "Passphrase (25ª parola)", desc: "Una parola o frase aggiuntiva, scelta da te, che si somma alla seed phrase per generare un wallet diverso. Protegge anche se qualcuno trova la seed scritta su carta, ma se la dimentichi i fondi diventano irrecuperabili." },
  { slug: "vanityaddress", icon: "🎀", term: "Vanity address", desc: "Un indirizzo generato appositamente perché contenga una sequenza di caratteri scelta (es. che inizi con un nome): non più sicuro di un indirizzo normale, richiede solo più tempo di calcolo per trovarlo." },
  { slug: "changeaddress", icon: "♻️", term: "Indirizzo di resto (change)", desc: "Poiché un UTXO va speso per intero, se l'importo da inviare è inferiore, la differenza torna al mittente come nuovo UTXO su un indirizzo di resto, di solito generato automaticamente dal wallet." },
  { slug: "riusoindirizzi", icon: "🔄", term: "Riuso degli indirizzi", desc: "Usare più volte lo stesso indirizzo per ricevere fondi: comodo, ma rende molto più facile per chiunque osservi la blockchain collegare tutte le tue transazioni tra loro. La maggior parte dei wallet genera un indirizzo nuovo a ogni ricezione.", guide: "privacy-bitcoin" },

  // Privacy e sicurezza
  { slug: "coinjoin", icon: "🌀", term: "CoinJoin", desc: "Una tecnica in cui più persone combinano le proprie transazioni in una sola, mescolando i loro fondi: rende più difficile per un osservatore esterno capire chi ha pagato chi." },
  { slug: "chainanalysis", icon: "🔍", term: "Analisi della blockchain (chain analysis)", desc: "Il lavoro di aziende specializzate nel collegare indirizzi e transazioni pubbliche per risalire all'identità di chi le controlla, spesso incrociando i dati con exchange che richiedono KYC.", guide: "privacy-bitcoin" },
  { slug: "kyc", icon: "🪪", term: "KYC (Know Your Customer)", desc: "Le verifiche d'identità richieste dagli exchange regolamentati prima di comprare o vendere bitcoin: una volta completate, collegano la tua identità reale agli indirizzi che usi con quell'exchange." },
  { slug: "custodial", icon: "🏦", term: "Custodial", desc: "Un servizio (tipicamente un exchange) che tiene le chiavi private al posto tuo: comodo per iniziare, ma finché i fondi restano lì non sono davvero sotto il tuo controllo esclusivo.", guide: "controllo-fondi" },
  { slug: "noncustodial", icon: "🔐", term: "Non-custodial", desc: "Un wallet in cui solo tu conosci la seed e le chiavi private: nessun altro può muovere i fondi senza il tuo consenso, ma la responsabilità della custodia ricade interamente su di te.", guide: "controllo-fondi" },
  { slug: "notyourkeys", icon: "🗝️", term: "\"Not your keys, not your coins\"", desc: "Il principio riassuntivo della differenza tra custodial e non-custodial: se non controlli tu le chiavi private, in pratica stai solo fidandoti che chi le controlla ti restituisca i fondi quando li chiedi.", guide: "controllo-fondi" },
  { slug: "simswap", icon: "📱", term: "SIM swap", desc: "Una truffa in cui il numero di telefono della vittima viene trasferito su una SIM controllata dall'attaccante, spesso per intercettare codici di verifica e accedere a exchange o wallet custodial.", guide: "truffe-comuni" },
  { slug: "clipboardhijack", icon: "📋", term: "Dirottamento degli appunti", desc: "Un malware che, quando copi un indirizzo Bitcoin per incollarlo, lo sostituisce di nascosto con un indirizzo dell'attaccante. Controllare sempre i primi e gli ultimi caratteri prima di inviare riduce il rischio.", guide: "truffe-comuni" },
  { slug: "dustingattack", icon: "🌫️", term: "Dusting attack", desc: "L'invio di piccolissimi importi (dust) a molti indirizzi, nel tentativo di collegarli tra loro se il destinatario li spende insieme in una transazione successiva: una tecnica di deanonimizzazione." },

  // Lightning Network e layer 2
  { slug: "layer2", icon: "🏗️", term: "Layer 2", desc: "Un sistema costruito \"sopra\" la blockchain di Bitcoin (come la Lightning Network) per rendere i pagamenti più veloci ed economici, riconciliandosi con la blockchain principale solo occasionalmente." },
  { slug: "canalelightning", icon: "🌩️", term: "Canale Lightning", desc: "Un accordo tra due nodi Lightning, aperto con una transazione on-chain, all'interno del quale possono scambiarsi molti pagamenti istantanei senza toccare la blockchain fino alla chiusura del canale." },
  { slug: "capacitacanale", icon: "📶", term: "Capacità del canale", desc: "L'importo totale di bitcoin bloccato in un canale Lightning quando viene aperto: limita quanto si può inviare o ricevere attraverso quel canale in un dato momento." },
  { slug: "fatturalightning", icon: "🧾", term: "Fattura Lightning (invoice)", desc: "Una richiesta di pagamento Lightning, generata dal destinatario, che include importo, destinazione e una scadenza: il mittente la scansiona o incolla nel proprio wallet per pagare istantaneamente." },
  { slug: "nodolightning", icon: "🔗", term: "Nodo Lightning", desc: "Un nodo Bitcoin che partecipa anche alla rete Lightning, aprendo e gestendo canali di pagamento con altri nodi." },
  { slug: "submarineswap", icon: "🤿", term: "Submarine swap", desc: "Una tecnica che permette di scambiare fondi on-chain con fondi Lightning (o viceversa) senza bisogno di fidarsi di un intermediario, usata da alcuni wallet per gestire Lightning in automatico." },
  { slug: "atomicswap", icon: "🔄", term: "Atomic swap", desc: "Uno scambio diretto tra due parti che, grazie a un accorgimento crittografico, o va a buon fine per entrambe o non avviene affatto: nessuna delle due può ricevere senza consegnare a sua volta." },

  // Crittografia di base e cultura Bitcoin
  { slug: "schnorr", icon: "✒️", term: "Firma Schnorr", desc: "Lo schema di firma introdotto con Taproot: più efficiente ed elegante di quello precedente, permette anche di combinare più firme multisig in una sola, indistinguibile da una firma singola." },
  { slug: "ecdsa", icon: "📐", term: "ECDSA", desc: "Lo schema di firma digitale usato da Bitcoin fin dall'inizio, basato sulla crittografia a curve ellittiche: dimostra di possedere una chiave privata senza mai rivelarla." },
  { slug: "chiavepubblica", icon: "🔓", term: "Chiave pubblica", desc: "Il numero derivato matematicamente dalla chiave privata (in un solo verso, impossibile da invertire): da essa si ricava l'indirizzo, e permette a chiunque di verificare una firma senza conoscere la chiave privata." },
  { slug: "firmadigitale", icon: "✍️", term: "Firma digitale", desc: "La prova matematica, generata con la chiave privata, che autorizza la spesa di un UTXO: dimostra il possesso della chiave senza mai esporla, ed è unica per ogni transazione." },
  { slug: "sha256", icon: "#️⃣", term: "SHA-256", desc: "La funzione crittografica di hashing usata da Bitcoin per il mining e per calcolare gli identificativi di blocchi e transazioni: stesso input produce sempre lo stesso output, ma è impossibile risalire all'input partendo dall'output." },
  { slug: "ripemd160", icon: "🧬", term: "RIPEMD-160", desc: "Una seconda funzione di hashing, applicata dopo SHA-256, usata per accorciare la chiave pubblica negli indirizzi legacy e SegWit, rendendoli più corti da scrivere e condividere." },
  { slug: "whitepaper", icon: "📃", term: "Whitepaper di Bitcoin", desc: "Il documento di 9 pagine pubblicato da Satoshi Nakamoto nell'ottobre 2008, intitolato \"Bitcoin: A Peer-to-Peer Electronic Cash System\", che descrive per primo il funzionamento di Bitcoin." },
  { slug: "satoshinakamoto", icon: "👤", term: "Satoshi Nakamoto", desc: "Lo pseudonimo di chi (una persona o un gruppo) ha ideato Bitcoin, pubblicato il whitepaper nel 2008 e minato il genesis block nel 2009, per poi sparire dai contatti pubblici nel 2011. La sua identità reale non è mai stata confermata." },
  { slug: "decentralizzazione", icon: "🕸️", term: "Decentralizzazione", desc: "Il fatto che nessun singolo soggetto controlli Bitcoin: migliaia di nodi e miner indipendenti, sparsi in tutto il mondo, devono trovarsi d'accordo sulle stesse regole perché la rete funzioni." },
  { slug: "censura", icon: "🚫", term: "Resistenza alla censura", desc: "La proprietà per cui è estremamente difficile impedire a una transazione valida di essere confermata, perché basta un solo miner disposto a includerla tra le migliaia sparsi nel mondo." },
  { slug: "soundmoney", icon: "🪙", term: "Sound money (moneta sana)", desc: "Un'espressione che indica una moneta con offerta prevedibile e non manipolabile da un'autorità centrale: i sostenitori di Bitcoin lo considerano tale grazie al limite fisso di 21 milioni di unità." },
  { slug: "scarsitadigitale", icon: "💎", term: "Scarsità digitale", desc: "La proprietà, resa possibile per la prima volta da Bitcoin, di avere un bene puramente digitale che non può essere copiato o creato a piacere: l'offerta è fissata dal protocollo, non da chi lo emette." },
  { slug: "storeofvalue", icon: "🏛️", term: "Riserva di valore (store of value)", desc: "La funzione di conservare potere d'acquisto nel tempo. Alcuni considerano bitcoin adatto a questo scopo proprio per la sua offerta fissa, anche se nel breve periodo il suo prezzo resta molto volatile." },
  { slug: "dca", icon: "📈", term: "DCA (Dollar Cost Averaging)", desc: "Una strategia che consiste nel comprare bitcoin a intervalli regolari (es. ogni settimana) con un importo fisso, invece di provare a indovinare il momento \"giusto\": riduce l'impatto della volatilità di breve periodo." },
  { slug: "selfcustody", icon: "🛡️", term: "Self-custody (autocustodia)", desc: "Tenere le proprie chiavi private in un wallet non-custodial, senza dipendere da un intermediario per accedere ai propri fondi.", guide: "controllo-fondi" },
  { slug: "sovranitafinanziaria", icon: "👑", term: "Sovranità finanziaria", desc: "La capacità di gestire i propri fondi senza bisogno del permesso di banche, exchange o governi: è l'obiettivo finale a cui puntano l'autocustodia e il gestire un proprio nodo." },
  { slug: "hodl", icon: "💪", term: "HODL", desc: "Un termine nato da un errore di battitura di \"hold\" (tenere) in un forum nel 2013, oggi usato nella community per indicare la scelta di conservare i propri bitcoin a lungo termine invece di venderli per il panico o la speculazione di breve periodo." },
  { slug: "fud", icon: "😨", term: "FUD", desc: "Fear, Uncertainty and Doubt: paura, incertezza e dubbio. Indica notizie o commenti, spesso esagerati o infondati, diffusi per spaventare gli investitori e spingerli a vendere." },
  { slug: "testnet", icon: "🧪", term: "Testnet", desc: "Una versione parallela della rete Bitcoin, con le stesse regole ma bitcoin senza alcun valore reale, usata da sviluppatori e wallet per fare prove senza rischiare fondi veri." },
  { slug: "mainnet", icon: "🌍", term: "Mainnet", desc: "La rete Bitcoin \"vera\", quella con valore economico reale, in contrapposizione alla testnet usata solo per test e sviluppo. Tutto quello che vedi in questo block explorer riguarda la mainnet." },
  { slug: "blockexplorer", icon: "🧭", term: "Block explorer", desc: "Uno strumento (come questo sito) che permette di consultare blocchi, transazioni e indirizzi della blockchain in modo leggibile, senza dover far girare un proprio nodo. Comodo, ma per definizione ti fai dire i dati da chi gestisce quel servizio." },
  { slug: "ordinals", icon: "🖼️", term: "Ordinals / inscriptions", desc: "Una tecnica che permette di associare dati arbitrari (immagini, testo) a un singolo satoshi, sfruttando lo spazio disponibile nelle transazioni SegWit e Taproot. È un uso della blockchain estraneo al suo scopo originale di sistema di pagamento, e resta un argomento dibattuto nella community." },
];

function renderGlossary(slug) {
  setContent(`
    <div class="breadcrumb"><a href="#/">Home</a> / Glossario</div>
    <h1>Glossario per principianti</h1>
    <p class="muted">Le parole chiave di Bitcoin, spiegate in modo semplice. Sei arrivato qui cliccando un termine? Lo trovi evidenziato qui sotto.</p>
    <div class="search-input-wrap glossary-search-wrap">
      <span class="icon">🔍</span>
      <input type="search" id="glossary-search" placeholder="Cerca un termine (es. fee, seed, taproot)…" autocomplete="off">
    </div>
    <p class="small muted" id="glossary-count">${GLOSSARY_TERMS.length} termini</p>
    <div class="glossary-grid" id="glossary-grid">
      ${GLOSSARY_TERMS.map(
        (t) => `
        <div class="glossary-card" id="term-${t.slug}" data-search="${fmt.escapeHtml(`${t.term} ${t.desc}`.toLowerCase())}">
          <div class="term"><span class="icon">${t.icon}</span> ${fmt.escapeHtml(t.term)}</div>
          <p>${fmt.escapeHtml(t.desc)}</p>
          ${t.guide ? `<p><a class="term-link" href="#/guide/${t.guide}">📖 Leggi la guida completa</a></p>` : ""}
        </div>`
      ).join("")}
    </div>
    <div class="empty-state" id="glossary-empty" style="display:none;">Nessun termine trovato. Prova con un'altra parola.</div>
  `);

  wireGlossarySearch();

  if (slug) {
    const target = document.getElementById(`term-${slug}`);
    if (target) {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
      target.classList.add("highlight");
    }
  }
}

function wireGlossarySearch() {
  const input = document.getElementById("glossary-search");
  const grid = document.getElementById("glossary-grid");
  const empty = document.getElementById("glossary-empty");
  const countEl = document.getElementById("glossary-count");
  if (!input || !grid || !empty || !countEl) return;
  const cards = Array.from(grid.children);

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    let visible = 0;
    cards.forEach((card) => {
      const match = !q || card.dataset.search.includes(q);
      card.style.display = match ? "" : "none";
      if (match) visible++;
    });
    empty.style.display = visible === 0 ? "" : "none";
    countEl.textContent = q ? `${visible} di ${GLOSSARY_TERMS.length} termini` : `${GLOSSARY_TERMS.length} termini`;
  });
}

// ---------- Guide ----------

const GUIDES = [
  {
    slug: "primi-passi",
    icon: "🚀",
    title: "Primi passi con Bitcoin: la tua roadmap",
    summary: "Hai appena comprato i tuoi primi bitcoin? Ecco cosa fare, in ordine, per proteggerli senza fretta.",
    startHere: true,
    body: () => `
      <div class="intro-box">
        <span class="intro-icon">🗺️</span>
        <div>
          <h1 style="font-size:1.2rem; margin-bottom:0.4rem;">Da dove comincio?</h1>
          <p>
            Non serve imparare tutto subito. Questa è una traccia consigliata, un passo alla volta: ogni
            passo rimanda alla guida completa quando vuoi approfondire. Vai al tuo ritmo, e torna qui ogni
            volta che ti serve orientarti di nuovo.
          </p>
        </div>
      </div>

      <div class="card">
        <div class="tip-title">1️⃣ Capisci dove sono i tuoi bitcoin adesso</div>
        <p>
          Se li hai comprati su un exchange, per ora sono in ${termLink("custodia", "custodial")} altrui: è
          l'exchange, non tu, a tenere le ${termLink("chiavi private", "chiaveprivata")}. Va benissimo per
          iniziare, ma finché restano lì dipendi dal fatto che l'exchange te li restituisca quando li chiedi.
          Capire questa differenza è il primo passo prima di qualunque altra decisione.
        </p>
        <p><a class="term-link" href="#/guide/controllo-fondi">📖 Custodial o non-custodial: chi controlla davvero i tuoi bitcoin</a></p>
      </div>

      <div class="card">
        <div class="tip-title">2️⃣ Scegli il tuo primo wallet</div>
        <p>
          Quando sei pronto a portare i fondi sotto il tuo controllo, ti serve un
          ${termLink("wallet", "wallet")} non-custodial: un'app per il telefono va bene per iniziare con
          piccole somme, un ${termLink("hardware wallet", "hardwarewallet")} è consigliato appena l'importo
          cresce. Non c'è fretta: puoi lasciare i fondi sull'exchange finché non hai scelto con calma.
        </p>
        <p><a class="term-link" href="#/guide/scegli-wallet">📖 Scegli il tuo portafoglio (strumento interattivo)</a></p>
        <p><a class="term-link" href="#/guide/primo-wallet">📖 Come scegliere il tuo primo wallet</a></p>
      </div>

      <div class="card">
        <div class="tip-title">3️⃣ Genera e proteggi la seed phrase</div>
        <p>
          Il tuo nuovo wallet ti mostrerà una ${termLink("seed phrase", "seed")} di 12 o 24 parole: è l'unica
          copia di backup di tutti i tuoi fondi futuri. Va trascritta su carta (mai in digitale) e conservata
          con cura, prima ancora di ricevere il primo satoshi.
        </p>
        <p><a class="term-link" href="#/guide/seed-sicura">📖 Come proteggere la tua seed phrase</a></p>
      </div>

      <div class="card">
        <div class="tip-title">4️⃣ Fai il tuo primo trasferimento con calma</div>
        <p>
          Per il primo trasferimento dall'exchange al tuo wallet, invia un importo piccolo di prova prima di
          spostare tutto: se qualcosa non torna, avrai rischiato poco. Controlla sempre l'indirizzo prima di
          confermare, e non farti prendere dal panico se la transazione resta qualche minuto in
          ${termLink("attesa", "mempool")}: è normale, e la puoi seguire in tempo reale proprio in questo
          block explorer.
        </p>
        <p><a class="term-link" href="#/guide/verifica-indirizzo">📖 Verifica un indirizzo prima di inviare (strumento)</a></p>
        <p><a class="term-link" href="#/guide/fee-e-conferme">📖 Capire fee e conferme</a></p>
      </div>

      <div class="card">
        <div class="tip-title">5️⃣ Impara a riconoscere le truffe più comuni</div>
        <p>
          Chi ha bitcoin diventa un bersaglio: falso supporto tecnico, siti clone, messaggi che promettono
          guadagni facili. Nessun servizio legittimo ti chiederà mai la tua seed phrase.
        </p>
        <p><a class="term-link" href="#/guide/truffe-comuni">📖 Riconoscere le truffe Bitcoin più comuni</a></p>
      </div>

      <div class="card">
        <div class="tip-title">6️⃣ Quando ti senti pronto: privacy e sovranità</div>
        <p>
          Non è un passo urgente, ma quando ti senti a tuo agio con le basi vale la pena scoprire come restare
          più privato usando Bitcoin, e cosa significa verificare da solo le regole della rete con un tuo
          nodo, invece di fidarti sempre di un servizio esterno come questo stesso block explorer.
        </p>
        <p><a class="term-link" href="#/guide/privacy-bitcoin">📖 Privacy su Bitcoin: pubblica, non anonima</a></p>
        <p><a class="term-link" href="#/guide/gestisci-nodo">📖 Gestisci il tuo nodo</a></p>
      </div>

      <div class="nav-buttons" style="justify-content:center;">
        <a class="btn btn-primary" href="#/guide">📚 Vedi tutte le guide →</a>
        <a class="btn" href="#/glossario">📖 Vai al glossario →</a>
      </div>
    `,
  },
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
        <a class="btn btn-primary" href="#/guide/scegli-wallet">🧭 Scegli il tuo portafoglio (strumento interattivo) →</a>
      </div>
      <div class="nav-buttons">
        <a class="btn" href="#/guide/seed-sicura">Guida alla seed sicura →</a>
        <a class="btn" href="#/guide/controllo-fondi">Custodial vs non-custodial →</a>
      </div>
    `,
  },
  {
    slug: "scegli-wallet",
    icon: "🧭",
    title: "Scegli il tuo portafoglio",
    summary: "Rispondi a tre domande semplici e filtra un elenco curato di wallet non-custodial affidabili, adatto a chi inizia.",
    interactive: true,
    featured: true,
    component: "wallet-chooser",
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
        <a class="btn btn-primary" href="#/guide/verifica-indirizzo">🔍 Verifica un indirizzo (strumento) →</a>
      </div>
    `,
  },
  {
    slug: "verifica-indirizzo",
    icon: "🔍",
    title: "Verifica un indirizzo prima di inviare",
    summary: "Controlla il checksum di un indirizzo (legacy, P2SH, SegWit o Taproot) prima di incollarlo in un pagamento.",
    interactive: true,
    featured: true,
    component: "address-checker",
  },
  {
    slug: "viaggio-transazione",
    icon: "🧭",
    title: "Il viaggio di una transazione",
    summary: "Segui passo passo cosa succede da quando premi \"invia\" a quando i bitcoin sono al sicuro nella blockchain, con dati reali della rete in questo momento.",
    interactive: true,
    featured: true,
    component: "tx-journey",
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
        <a class="btn" href="#/guide/viaggio-transazione">🧭 Segui il viaggio di una transazione →</a>
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
  {
    slug: "gestisci-nodo",
    icon: "🖥️",
    title: "Gestisci il tuo nodo",
    summary: "Il passo successivo a un wallet non-custodial: verificare le regole di Bitcoin da solo, senza fidarti di nessun altro.",
    body: () => `
      <div class="card">
        <p>
          Un ${termLink("wallet", "wallet")} non-custodial ti dà il controllo delle chiavi, ma per sapere
          "qual è davvero lo stato della blockchain" quasi tutti i wallet si appoggiano al server di
          qualcun altro — esattamente come fa questo stesso block explorer con mempool.space (lo trovi
          scritto in fondo a ogni pagina). Il passo successivo, per chi vuole la sovranità completa, è far
          girare un proprio <strong>nodo Bitcoin</strong>: un programma che scarica e verifica da solo
          l'intera blockchain, applicando le regole del protocollo senza fidarsi della parola di nessuno —
          "don't trust, verify".
        </p>
      </div>

      <h2 class="section-title">Cosa cambia avendo un tuo nodo</h2>
      <div class="glossary-grid">
        <div class="tip-card good">
          <div class="tip-title">✅ Verifichi tu le regole</div>
          <p>Il tuo nodo controlla ogni blocco e transazione secondo le regole di consenso: nessuno può
          convincerti che una transazione non valida o una regola diversa siano accettabili.</p>
        </div>
        <div class="tip-card good">
          <div class="tip-title">🔒 Privacy migliore</div>
          <p>Collegando il tuo wallet al tuo nodo, eviti di rivelare i tuoi indirizzi e saldi al server di
          terzi (come fa invece di default la maggior parte dei wallet).</p>
        </div>
        <div class="tip-card">
          <div class="tip-title">💻 Serve hardware dedicato</div>
          <p>Un nodo completo scarica l'intera blockchain (centinaia di GB) e resta acceso: la soluzione
          più comune è un piccolo computer dedicato (es. Raspberry Pi) sempre connesso.</p>
        </div>
      </div>

      <h2 class="section-title">Da dove iniziare</h2>
      <div class="glossary-grid">
        <div class="tip-card">
          <div class="tip-title">📦 Bitcoin Core</div>
          <p>Il software di riferimento, mantenuto dalla community open source: la base su cui è costruita
          quasi ogni altra implementazione di nodo.</p>
        </div>
        <div class="tip-card">
          <div class="tip-title">🧰 Distribuzioni "pronte all'uso"</div>
          <p>Progetti come Umbrel, myNode o RaspiBlitz confezionano Bitcoin Core con un'interfaccia grafica
          semplice, pensata per chi non vuole usare la riga di comando.</p>
        </div>
      </div>

      <div class="warning-box" style="margin-top:1rem;">
        <p style="margin:0;">
          <strong>Non è un passo obbligato:</strong> un wallet non-custodial resta comunque tuo (le chiavi
          sono tue), anche se ti appoggi al nodo di qualcun altro per leggere la blockchain. Far girare un
          proprio nodo è il livello successivo per chi vuole verificare tutto da sé, non un requisito per
          usare Bitcoin in sicurezza.
        </p>
      </div>

      <div class="nav-buttons">
        <a class="btn" href="#/guide/controllo-fondi">Custodial vs non-custodial →</a>
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
            <div class="row-top"><span>${g.icon} ${fmt.escapeHtml(g.title)}</span>${g.startHere ? `<span class="feature-badge">🚀 Inizia qui</span>` : g.featured ? `<span class="feature-badge">Interattivo</span>` : ""}</div>
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
  if (guide.component === "wallet-chooser") return renderWalletChooser(guide);
  if (guide.component === "address-checker") return renderAddressChecker(guide);
  if (guide.component === "tx-journey") return renderTxJourney(guide);
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

// ---------- Scegli il tuo portafoglio ----------

const WALLETS = [
  {
    name: "BlueWallet",
    icon: "📱",
    platform: "mobile",
    use: ["quotidiano"],
    level: "semplice",
    tags: ["Lightning", "Open source"],
    desc: "Wallet mobile pensato per l'uso di tutti i giorni, con supporto Lightning per pagamenti istantanei ed economici. Interfaccia curata, adatta a chi inizia.",
  },
  {
    name: "Muun",
    icon: "📱",
    platform: "mobile",
    use: ["quotidiano"],
    level: "semplice",
    tags: ["Lightning"],
    desc: "Wallet mobile non-custodial che gestisce Lightning in automatico, senza dover capire i dettagli tecnici dei canali.",
  },
  {
    name: "Phoenix",
    icon: "📱",
    platform: "mobile",
    use: ["quotidiano"],
    level: "semplice",
    tags: ["Lightning", "Open source"],
    desc: "Wallet mobile centrato su Lightning: pagamenti veloci ed economici, con la gestione dei canali semplificata al massimo.",
  },
  {
    name: "Electrum",
    icon: "💻",
    platform: "desktop",
    use: ["quotidiano", "risparmio"],
    level: "intermedio",
    tags: ["Open source", "Supporta hardware wallet"],
    desc: "Uno dei wallet desktop più longevi e affidabili di Bitcoin: leggero, veloce, con opzioni avanzate per chi vuole approfondire.",
  },
  {
    name: "Sparrow Wallet",
    icon: "💻",
    platform: "desktop",
    use: ["risparmio"],
    level: "intermedio",
    tags: ["Open source", "Supporta hardware wallet", "Privacy"],
    desc: "Wallet desktop pensato per usare al meglio un hardware wallet e tenere sotto controllo la privacy delle tue transazioni.",
  },
  {
    name: "Trezor",
    icon: "🔐",
    platform: "hardware",
    use: ["risparmio"],
    level: "semplice",
    tags: ["Open source"],
    desc: "Uno dei primi hardware wallet in assoluto: le chiavi restano sempre offline, e ogni operazione va verificata sullo schermo del dispositivo.",
  },
  {
    name: "Ledger",
    icon: "🔐",
    platform: "hardware",
    use: ["risparmio"],
    level: "semplice",
    tags: [],
    desc: "Hardware wallet molto diffuso, con un'app companion che semplifica la gestione dei fondi mantenendo le chiavi sempre sul dispositivo.",
  },
  {
    name: "BitBox02",
    icon: "🔐",
    platform: "hardware",
    use: ["risparmio"],
    level: "semplice",
    tags: ["Open source", "Versione bitcoin-only disponibile"],
    desc: "Hardware wallet svizzero, compatto, con una versione dedicata esclusivamente a Bitcoin per chi non vuole gestire altro.",
  },
  {
    name: "Coldcard",
    icon: "🔐",
    platform: "hardware",
    use: ["risparmio"],
    level: "avanzato",
    tags: ["Open source", "Bitcoin-only", "Air-gapped"],
    desc: "Hardware wallet bitcoin-only pensato per la massima sicurezza: può restare sempre scollegato da internet (air-gapped).",
  },
];

const WALLET_FILTERS = [
  {
    key: "platform",
    label: "Dove vuoi usarlo?",
    options: [
      { value: "all", label: "Tutti" },
      { value: "mobile", label: "📱 Sul telefono" },
      { value: "desktop", label: "💻 Sul computer" },
      { value: "hardware", label: "🔐 Dispositivo fisico dedicato" },
    ],
  },
  {
    key: "use",
    label: "Per cosa lo userai principalmente?",
    options: [
      { value: "all", label: "Tutti" },
      { value: "quotidiano", label: "🌱 Piccole somme quotidiane" },
      { value: "risparmio", label: "🏦 Risparmio a lungo termine" },
    ],
  },
  {
    key: "level",
    label: "Quanto vuoi che sia semplice?",
    options: [
      { value: "all", label: "Tutti" },
      { value: "semplice", label: "🟢 Il più semplice possibile" },
      { value: "intermedio", label: "🔵 Va bene qualche opzione in più" },
      { value: "avanzato", label: "🟣 Sono già a mio agio con la tecnologia" },
    ],
  },
];

// ---------- Il viaggio di una transazione ----------

function txJourneyFeeVerdictHtml(rate, fees) {
  if (!fees) return `<p class="small muted">Dati sulle fee non disponibili in questo momento.</p>`;
  let icon = "🐢";
  let level = "";
  let msg;
  if (rate >= fees.fastestFee) {
    icon = "🚀";
    level = "good";
    msg = `Verresti scelto/a già nel prossimo blocco: è una fee alta rispetto a quelle consigliate ora (veloce: ${fees.fastestFee} sat/vB).`;
  } else if (rate >= fees.halfHourFee) {
    icon = "🙂";
    level = "good";
    msg = `In linea con la fascia "normale" di adesso (${fees.halfHourFee} sat/vB): conferma probabile entro circa mezz'ora.`;
  } else if (rate >= fees.economyFee) {
    msg = `Fee bassa: potrebbero volerci diverse ore prima che un miner la scelga (economica: ${fees.economyFee} sat/vB).`;
  } else {
    icon = "⚠️";
    level = "bad";
    msg = `Sotto anche la fee più economica consigliata ora (${fees.economyFee} sat/vB): con questa fee potresti restare in attesa a lungo, se la rete è congestionata.`;
  }
  return `
    <div class="tip-card ${level}" style="margin-top:0.6rem;">
      <div class="tip-title">${icon} Con questa fee, adesso...</div>
      <p style="margin:0;">${msg}</p>
    </div>`;
}

async function renderTxJourney(guide) {
  renderLoading("Preparo il percorso interattivo…");
  const [mempool, fees, blocks] = await Promise.all([
    api.getMempool().catch(() => null),
    api.getFeeEstimates().catch(() => null),
    api.getRecentBlocks().catch(() => null),
  ]);
  const latestBlock = blocks?.[0] ?? null;

  let step = 0;
  let chosenRate = fees ? fees.halfHourFee : 12;
  const sliderMax = Math.max(50, fees ? fees.fastestFee * 2 : 50);

  const STEPS = [
    {
      icon: "📝",
      title: "Crei la transazione",
      body: () => `
        <p>
          Quando premi "invia" nel tuo ${termLink("wallet", "wallet")}, lui prepara la transazione per te:
          sceglie quali ${termLink("UTXO", "utxo")} spendere, chi riceve i fondi, quanto, e firma tutto con
          la tua ${termLink("chiave privata", "chiaveprivata")} — l'unica prova che quei bitcoin sono
          davvero tuoi. Scegli anche una <strong>fee</strong>, in sat/vB: più alta è, più i
          ${termLink("miner", "miner")} saranno motivati a includerla presto.
        </p>
        <p class="small muted" style="margin-top:0.5rem;">
          Nessuna transazione viene creata davvero qui: è solo una spiegazione di cosa succede dietro le quinte.
        </p>`,
    },
    {
      icon: "📡",
      title: "Si diffonde nella mempool",
      body: () => `
        <p>
          La transazione firmata viene inviata a un nodo Bitcoin, che la controlla — è valida? le firme sono
          corrette? gli UTXO non sono già stati spesi? — e poi la inoltra ai nodi vicini. In pochi secondi si
          diffonde su migliaia di nodi in tutto il mondo, ognuno dei quali la tiene in attesa nella propria
          ${termLink("mempool", "mempool")} finché non finisce in un blocco.
        </p>
        ${
          mempool
            ? `<div class="stat-grid" style="margin-top:0.75rem;">
                <div class="stat-card">
                  <span class="stat-icon">⏳</span>
                  <div>
                    <div class="label">In attesa proprio ora</div>
                    <div class="value">${fmt.formatNumber(mempool.count)}</div>
                    <div class="sub">transazioni nella mempool, in questo momento</div>
                  </div>
                </div>
              </div>`
            : ""
        }`,
    },
    {
      icon: "⛏️",
      title: "Un miner ti sceglie in base alla fee",
      body: () => `
        <p>
          I miner assemblano i blocchi scegliendo, tra tutte le transazioni in mempool, quelle che pagano di
          più per byte: vogliono massimizzare le fee raccolte. Prova tu: scegli una fee e scopri in che
          fascia finiresti, con i dati reali di questo momento.
        </p>
        <div class="tx-journey-slider-row">
          <input type="range" min="1" max="${sliderMax}" step="1" value="${chosenRate}" id="tx-journey-fee-slider" aria-label="Scegli una fee in sat/vB" />
          <div class="tx-journey-slider-value">La tua fee: <strong id="tx-journey-fee-value">${chosenRate}</strong> sat/vB</div>
        </div>
        <div id="tx-journey-fee-result">${txJourneyFeeVerdictHtml(chosenRate, fees)}</div>`,
    },
    {
      icon: "📦",
      title: "Finisce in un blocco",
      body: () => `
        <p>
          In ${termLink("media ogni 10 minuti", "tempoblocco")} circa, un miner nel mondo trova un nuovo
          ${termLink("blocco", "blocco")} valido e lo trasmette a tutta la rete. Il blocco contiene la tua
          transazione insieme a molte altre, impacchettate insieme.
        </p>
        ${
          latestBlock
            ? `<a class="row-link" href="#/block/${latestBlock.height}" style="margin-top:0.75rem;">
                <div class="row-top">
                  <span>📦 L'ultimo blocco trovato in questo momento</span>
                  <span class="row-value muted">#${fmt.formatNumber(latestBlock.height)} →</span>
                </div>
                <div class="row-bottom">
                  <span class="muted">${fmt.formatNumber(latestBlock.tx_count)} transazioni incluse</span>
                  <span class="muted">${fmt.formatTimeAgo(latestBlock.timestamp)}</span>
                </div>
              </a>`
            : ""
        }`,
    },
    {
      icon: "✔️",
      title: "Si conferma nella catena",
      body: () => `
        <p>
          Ogni nuovo blocco che si aggiunge sopra il tuo è una ${termLink("conferma", "conferma")} in più: la
          probabilità che la transazione venga "ribaltata" scende drasticamente a ogni conferma. Per piccoli
          importi spesso basta 1 conferma; per somme importanti molti aspettano 6 conferme (circa un'ora)
          prima di considerare il pagamento definitivo.
        </p>
        <p>
          Ora che sai come funziona, prova a cercare una ${termLink("transazione", "transazione")} vera nella
          barra di ricerca in alto, oppure guarda gli ultimi blocchi in home per vederne uno appena trovato.
        </p>
        <div class="nav-buttons">
          <a class="btn" href="#/glossario/fee">Vai al glossario delle fee →</a>
          <a class="btn btn-primary" href="#/">🏠 Torna alla home →</a>
        </div>`,
    },
  ];

  setContent(`
    <div class="breadcrumb"><a href="#/">Home</a> / <a href="#/guide">Guide</a> / ${fmt.escapeHtml(guide.title)}</div>
    <h1>${guide.icon} ${fmt.escapeHtml(guide.title)}</h1>
    <div class="intro-box">
      <span class="intro-icon">🧭</span>
      <div>
        <p style="margin:0;">
          Segui i 5 passi qui sotto per capire cosa succede davvero da quando premi "invia" a quando i tuoi
          bitcoin sono al sicuro nella blockchain. Dove possibile uso dati reali della rete in questo
          momento, per rendere il percorso concreto e non solo teorico.
        </p>
      </div>
    </div>
    <div id="tx-journey-app"></div>
  `);

  const journeyApp = document.getElementById("tx-journey-app");

  function dotsHtml() {
    return STEPS.map(
      (s, i) => `
      <button type="button" class="tx-journey-dot ${i === step ? "active" : ""} ${i < step ? "done" : ""}"
        data-action="goto" data-step="${i}" aria-label="Passo ${i + 1}: ${fmt.escapeHtml(s.title)}" title="${fmt.escapeHtml(s.title)}">
        ${i < step ? "✔" : i + 1}
      </button>`
    ).join("");
  }

  function render() {
    const s = STEPS[step];
    journeyApp.innerHTML = `
      <div class="tx-journey-progress">${dotsHtml()}</div>
      <div class="card tx-journey-step">
        <div class="tip-title">${s.icon} Passo ${step + 1} di ${STEPS.length}: ${fmt.escapeHtml(s.title)}</div>
        ${s.body()}
      </div>
      <div class="nav-buttons" style="justify-content:space-between;">
        <button type="button" class="btn" data-action="prev" ${step === 0 ? "disabled" : ""}>← Indietro</button>
        ${step < STEPS.length - 1 ? `<button type="button" class="btn btn-primary" data-action="next">Avanti →</button>` : ""}
      </div>
    `;
    const slider = document.getElementById("tx-journey-fee-slider");
    slider?.addEventListener("input", (e) => {
      chosenRate = Number(e.target.value);
      document.getElementById("tx-journey-fee-value").textContent = chosenRate;
      document.getElementById("tx-journey-fee-result").innerHTML = txJourneyFeeVerdictHtml(chosenRate, fees);
    });
  }

  journeyApp.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    if (btn.dataset.action === "next" && step < STEPS.length - 1) step++;
    else if (btn.dataset.action === "prev" && step > 0) step--;
    else if (btn.dataset.action === "goto") step = Number(btn.dataset.step);
    render();
  });

  render();
}

function renderWalletChooser(guide) {
  const filters = { platform: "all", use: "all", level: "all" };

  setContent(`
    <div class="breadcrumb"><a href="#/">Home</a> / <a href="#/guide">Guide</a> / ${fmt.escapeHtml(guide.title)}</div>
    <h1>${guide.icon} ${fmt.escapeHtml(guide.title)}</h1>
    <div class="intro-box">
      <span class="intro-icon">🧭</span>
      <div>
        <p style="margin:0;">
          Non esiste "il wallet migliore" in assoluto: la scelta giusta dipende da come vuoi usarlo. Rispondi
          alle domande qui sotto per restringere l'elenco. Sono tutti wallet <strong>non-custodial</strong>
          (le chiavi restano sempre in mano tua — vedi la guida su
          ${termLink("custodial e non-custodial", "controllo-fondi")}) tra i più affidabili e conosciuti della
          community. Per l'elenco ufficiale aggiornato e i link di download verificati, vai su
          <a href="https://bitcoin.org/it/scegli-il-tuo-portafoglio" target="_blank" rel="noopener noreferrer">bitcoin.org →</a>
        </p>
      </div>
    </div>
    <div id="wallet-app"></div>
  `);

  const walletApp = document.getElementById("wallet-app");

  function matchesFilters(w) {
    if (filters.platform !== "all" && w.platform !== filters.platform) return false;
    if (filters.use !== "all" && !w.use.includes(filters.use)) return false;
    if (filters.level !== "all" && w.level !== filters.level) return false;
    return true;
  }

  function filtersHtml() {
    return WALLET_FILTERS.map(
      (group) => `
        <div class="wallet-filter-group">
          <div class="wallet-filter-label">${fmt.escapeHtml(group.label)}</div>
          <div class="unit-toggle" role="group" aria-label="${fmt.escapeHtml(group.label)}">
            ${group.options
              .map(
                (opt) =>
                  `<button type="button" class="unit-btn ${filters[group.key] === opt.value ? "active" : ""}" data-action="filter" data-group="${group.key}" data-value="${opt.value}">${opt.label}</button>`
              )
              .join("")}
          </div>
        </div>`
    ).join("");
  }

  function resultsHtml(results) {
    if (results.length === 0) {
      return `<div class="empty-state">Nessun wallet corrisponde a questi filtri. Prova ad allargare la selezione (es. "Tutti").</div>`;
    }
    return `
      <div class="glossary-grid">
        ${results
          .map(
            (w) => `
          <div class="tip-card wallet-card">
            <div class="tip-title">${w.icon} ${fmt.escapeHtml(w.name)}</div>
            <p>${fmt.escapeHtml(w.desc)}</p>
            ${
              w.tags.length
                ? `<div class="wallet-tags">${w.tags.map((t) => `<span class="wallet-tag">${fmt.escapeHtml(t)}</span>`).join("")}</div>`
                : ""
            }
          </div>`
          )
          .join("")}
      </div>`;
  }

  function render() {
    const results = WALLETS.filter(matchesFilters);
    walletApp.innerHTML = `
      <div class="card wallet-filters">${filtersHtml()}</div>
      <p class="small muted" style="margin:0.75rem 0;">${results.length} di ${WALLETS.length} wallet corrispondono ai filtri scelti.</p>
      ${resultsHtml(results)}
      <div class="danger-box" style="margin-top:1rem;">
        <p style="margin:0;">
          <strong>⚠️ Scarica sempre dal sito ufficiale o dagli store ufficiali</strong> (App Store, Google Play),
          mai da link ricevuti in messaggi, email o pubblicità: i siti clone che imitano wallet famosi sono una
          delle truffe più comuni (${termLink("phishing", "phishing")}). In caso di dubbio verifica il nome
          esatto sulla <a href="https://bitcoin.org/it/scegli-il-tuo-portafoglio" target="_blank" rel="noopener noreferrer">lista ufficiale di bitcoin.org</a>.
        </p>
      </div>
      <div class="nav-buttons">
        <a class="btn" href="#/guide/primo-wallet">← Consigli generali sul primo wallet</a>
        <a class="btn" href="#/guide/seed-sicura">Guida alla seed sicura →</a>
      </div>
    `;
  }

  walletApp.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action='filter']");
    if (!btn) return;
    filters[btn.dataset.group] = btn.dataset.value;
    render();
  });

  render();
}

// ---------- Verifica indirizzo ----------

function renderAddressChecker(guide) {
  setContent(`
    <div class="breadcrumb"><a href="#/">Home</a> / <a href="#/guide">Guide</a> / ${fmt.escapeHtml(guide.title)}</div>
    <h1>${guide.icon} ${fmt.escapeHtml(guide.title)}</h1>
    <div class="intro-box">
      <span class="intro-icon">🔍</span>
      <div>
        <p style="margin:0;">
          Incolla qui un indirizzo prima di usarlo per un pagamento: controlliamo che il suo
          <em>checksum</em> sia corretto, senza inviare nulla a nessun servizio esterno (il calcolo avviene
          nel tuo browser). Questo conferma che l'indirizzo è scritto/copiato correttamente — <strong>non</strong>
          garantisce che appartenga davvero alla persona o al servizio da cui pensi di averlo ricevuto: resta
          comunque valido il consiglio della guida "${termLink("Phishing", "phishing")}" di verificare sempre
          da un canale attendibile.
        </p>
      </div>
    </div>

    <div class="card">
      <label class="small muted" for="addr-check-input">Incolla l'indirizzo da controllare</label>
      <textarea id="addr-check-input" rows="2" class="mono" style="width:100%; margin-top:0.4rem; padding:0.6rem; border-radius:var(--radius-sm); border:1px solid var(--border); background:var(--card-bg); color:var(--ink); resize:vertical;" placeholder="bc1q… · bc1p… · 1… · 3…"></textarea>
      <button type="button" class="btn btn-primary" id="addr-check-btn" style="margin-top:0.6rem;">🔍 Verifica</button>
      <div id="addr-check-result" style="margin-top:1rem;"></div>
    </div>

    <div class="nav-buttons">
      <a class="btn" href="#/guide/truffe-comuni">← Truffe comuni</a>
      <a class="btn" href="#/guide/privacy-bitcoin">Privacy su Bitcoin →</a>
    </div>
  `);

  document.getElementById("addr-check-btn").addEventListener("click", async () => {
    const raw = document.getElementById("addr-check-input").value;
    const trimmed = raw.trim();
    const resultEl = document.getElementById("addr-check-result");
    resultEl.innerHTML = `<div class="loading"><div class="spinner"></div></div>`;

    const result = await validateAddress(trimmed);

    let historyHtml = "";
    if (result.valid) {
      try {
        const info = await api.getAddress(trimmed);
        const txCount = info.chain_stats.tx_count + info.mempool_stats.tx_count;
        historyHtml =
          txCount === 0
            ? `<p class="small muted" style="margin:0.6rem 0 0;">Nessuna transazione trovata: sembra un indirizzo mai usato prima.</p>`
            : `<p class="small muted" style="margin:0.6rem 0 0;">Ha già ${fmt.formatNumber(txCount)} transazioni. Se è un tuo indirizzo di ricezione, ricorda che riusarlo riduce la privacy (vedi la guida "Privacy su Bitcoin"). <a href="#/address/${encodeURIComponent(trimmed)}">Vedi il dettaglio →</a></p>`;
      } catch {
        // Il checksum resta valido anche se non riusciamo a recuperare la cronologia on-chain.
      }
    }

    resultEl.innerHTML = `
      <div class="tip-card ${result.valid ? "good" : "bad"}">
        <div class="tip-title">${result.valid ? "✅ Checksum valido" : "❌ Checksum NON valido"}${result.type ? ` — ${fmt.escapeHtml(result.type)}` : ""}</div>
        <p>${fmt.escapeHtml(result.reason)}</p>
        ${trimmed ? `<p class="mono small" style="word-break:break-all; margin:0.5rem 0 0;">${fmt.escapeHtml(chunkAddress(trimmed))}</p>` : ""}
      </div>
      ${historyHtml}
    `;
  });
}

// ---------- Novità (changelog) ----------

const CHANGELOG = [
  {
    version: "Guida interattiva: il viaggio di una transazione",
    date: "20 agosto 2026",
    items: [
      `Nuova guida interattiva "Il viaggio di una transazione": 5 passi da seguire, dalla creazione della transazione alla conferma nella blockchain, con dati reali della rete in questo momento.`,
      "Al passo del mining puoi scegliere tu una fee con uno slider e vedere subito, con i dati live, in che fascia finiresti e quanto potresti dover aspettare.",
    ],
  },
  {
    version: "Fee di oggi confrontata con la media recente",
    date: "20 agosto 2026",
    items: [
      `Nuova card in home "La fee di adesso rispetto agli ultimi giorni": confronta la fee "normale" raccomandata in questo momento con la media pagata dai blocchi nelle ultime 24 ore e nell'ultima settimana, per capire a colpo d'occhio se conviene aspettare prima di inviare una transazione non urgente.`,
    ],
  },
  {
    version: "Home page riorganizzata",
    date: "20 agosto 2026",
    items: [
      `Le sezioni della home sono state raggruppate in modo più logico: subito dopo la watchlist personale, tutti i widget di "stato della rete" (Block Clock, transazioni in attesa, fee consigliata, calcolatore costi) sono ora insieme senza interruzioni, seguiti dagli ultimi blocchi minati; la demo dei dadi per generare una seed si trova ora più in basso, come contenuto secondario.`,
    ],
  },
  {
    version: "Watchlist con chiavi xpub/ypub/zpub e badge novità",
    date: "8 agosto 2026",
    items: [
      `Ogni indirizzo salvato ricorda ora l'ultimo saldo visto: se qualcosa cambia dall'ultima visita, un badge "● Novità" lo segnala subito, con la differenza, senza dover riaprire ogni indirizzo per accorgersene.`,
      "La watchlist accetta ora anche una chiave pubblica estesa (xpub/ypub/zpub), non solo singoli indirizzi: viene decodificata interamente nel browser per scoprire e tracciare tutti gli indirizzi da lei derivati che hanno un saldo o una cronologia, con lo stesso criterio (\"gap limit\") usato dalla maggior parte dei wallet.",
      "Le chiavi private (xprv/yprv/zprv) vengono riconosciute e rifiutate esplicitamente, con un messaggio chiaro: non vanno mai incollate da nessuna parte.",
    ],
  },
  {
    version: "Diagnosi della fee per transazioni in attesa",
    date: "8 agosto 2026",
    items: [
      `Nella pagina di una transazione non ancora confermata, una nuova card "Quanto potrei dover aspettare?" confronta la fee pagata con quelle consigliate in questo momento e dà un giudizio pratico su quanto potrebbe volerci, con un rimando a RBF e CPFP se la fee è molto bassa.`,
      "Si aggiorna da sola insieme al tracker live esistente, perché la congestione della rete cambia nel tempo.",
    ],
  },
  {
    version: "Pool di mining più completi",
    date: "8 agosto 2026",
    items: [
      "La sezione pool di mining passa da 6 a 15 pool mostrati, con un selettore di periodo (24h / 3 giorni / 1 settimana / 1 mese) e una barra impilata colorata che mostra a colpo d'occhio la distribuzione tra pool.",
      "Quando disponibile, mostra anche l'efficienza media nella selezione delle fee per ciascun pool.",
    ],
  },
  {
    version: "Novità",
    date: "5 agosto 2026",
    items: [
      `Nuova sezione "Novità" (questa pagina!) per vedere cosa cambia a ogni aggiornamento del sito.`,
      "Grafico storico dell'hashrate nella pagina Mining, con periodi selezionabili (1 mese / 3 mesi / 1 anno / 3 anni) e dettagli al passaggio del mouse o del dito.",
      "Il Block Clock in home ora si può aprire a schermo intero (#/blockclock): pensato per restare acceso su un monitor dedicato, come display sempre visibile.",
      `Nuova guida "Primi passi con Bitcoin: la tua roadmap", per chi ha appena comprato i suoi primi bitcoin e non sa da dove cominciare.`,
    ],
  },
  {
    version: "Glossario esteso",
    date: "5 agosto 2026",
    items: [
      "Il glossario passa da circa 30 a 116 termini: rete e protocollo, indirizzi e chiavi, privacy e sicurezza, Lightning Network, crittografia di base e cultura Bitcoin.",
      "Aggiunta una barra di ricerca che filtra i termini in tempo reale mentre scrivi.",
    ],
  },
  {
    version: "Leggibilità dell'interfaccia",
    date: "5 agosto 2026",
    items: [
      `Corretta la spaziatura tra le sezioni di ogni pagina: alcuni blocchi (liste, card) restavano "schiacciati" contro il successivo.`,
    ],
  },
  {
    version: "10 nuove funzionalità dalla community",
    date: "3 agosto 2026",
    items: [
      "Tracker live delle conferme sulla pagina transazione, aggiornato ogni 15 secondi senza mai ricaricare.",
      "Importi anche in EUR (oltre a BTC/sats) su saldo indirizzo e importi transazione.",
      `Calcolatore "quanto costa inviare bitcoin adesso" in home, in sat e in euro.`,
      "Watchlist di indirizzi salvati in locale (nel browser), con saldo live in home.",
      "Strumento di verifica indirizzo (checksum base58check e bech32/bech32m calcolato nel browser) prima di inviare un pagamento.",
      "Verifica client-side del blocco: ricalcolo nel browser di merkle root e proof-of-work, senza fidarsi della parola del servizio dati.",
      "Confronto con una seconda fonte indipendente (blockstream.info) su blocco e transazione, campo per campo.",
      "Banner di trasparenza permanente sul fatto che il sito è client di un'unica fonte terza.",
      `Nuova guida "Gestisci il tuo nodo" e countdown live al prossimo halving nella pagina Mining.`,
      "Glossario ampliato con SegWit, Taproot, PSBT, Multisig e Lightning Network.",
    ],
  },
  {
    version: "Pagina Mining",
    date: "3 agosto 2026",
    items: [
      "Nuova pagina Mining (#/mining) con hashrate, countdown al prossimo aggiustamento della difficoltà e pool di mining più attivi, tutto in tempo reale.",
    ],
  },
  {
    version: "Lancio del block explorer",
    date: null,
    items: [
      "Ricerca unica per blocco, transazione o indirizzo.",
      "Home con ultimi blocchi minati, mempool e fee consigliate, e Block Clock live.",
      "Dettaglio blocco, transazione e indirizzo con spiegazioni in parole semplici.",
      "Composizione visiva del blocco: mappa a mosaico delle transazioni.",
      "Glossario e guide per chi inizia, toggle BTC/sats, tema chiaro/scuro automatico.",
    ],
  },
];

/** Raggruppa le voci di changelog per data (stessa data = stesso rilascio), preservando l'ordine di apparizione. */
function groupChangelogByDate(changelog) {
  const groups = [];
  const byKey = new Map();
  changelog.forEach((entry, i) => {
    const key = entry.date ?? `__nodate__${i}`;
    let group = byKey.get(key);
    if (!group) {
      group = { date: entry.date, entries: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.entries.push(entry);
  });
  return groups;
}

function changelogItemsHtml(items) {
  return `
    <ul style="margin:0.6rem 0 0; padding-left:1.2rem; display:flex; flex-direction:column; gap:0.4rem;">
      ${items.map((item) => `<li class="small">${fmt.escapeHtml(item)}</li>`).join("")}
    </ul>`;
}

function changelogGroupCardHtml(group, isNewest) {
  if (group.entries.length === 1) {
    const rel = group.entries[0];
    return `
      <div class="card">
        <div class="row-top" style="flex-wrap:wrap; gap:0.5rem;">
          <span class="tip-title" style="margin-bottom:0;">${isNewest ? "🆕 " : ""}${fmt.escapeHtml(rel.version)}</span>
          ${rel.date ? `<span class="small muted">${fmt.escapeHtml(rel.date)}</span>` : ""}
        </div>
        ${changelogItemsHtml(rel.items)}
      </div>`;
  }
  return `
    <div class="card">
      <div class="row-top" style="flex-wrap:wrap; gap:0.5rem;">
        <span class="tip-title" style="margin-bottom:0;">${isNewest ? "🆕 " : ""}Aggiornamento del ${fmt.escapeHtml(group.date)}</span>
      </div>
      <div class="changelog-group">
        ${group.entries
          .map(
            (rel) => `
          <div class="changelog-entry">
            <div class="changelog-entry-title">${fmt.escapeHtml(rel.version)}</div>
            ${changelogItemsHtml(rel.items)}
          </div>`
          )
          .join("")}
      </div>
    </div>`;
}

function renderChangelog() {
  const groups = groupChangelogByDate(CHANGELOG);
  setContent(`
    <div class="breadcrumb"><a href="#/">Home</a> / Novità</div>
    <h1>🆕 Novità</h1>
    <p class="muted">Cosa è cambiato nel block explorer, versione dopo versione.</p>
    <div style="display:flex; flex-direction:column; gap:1rem;">
      ${groups.map((group, i) => changelogGroupCardHtml(group, i === 0)).join("")}
    </div>
  `);
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
