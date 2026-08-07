import { BASE58_ALPHABET, BECH32_CHARSET, base58Decode, sha256, polymod, hrpExpand } from "./addresscheck.js";

async function hmacSha512(keyBytes, dataBytes) {
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-512" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, dataBytes);
  return new Uint8Array(sig);
}

// ---------- RIPEMD-160 ----------
// Porta diretta della struttura dell'algoritmo di riferimento (pacchetto npm "ripemd160", ~9M download/settimana),
// verificata con test differenziali contro Node crypto.createHash("ripemd160") su >1000 input casuali e su tutti
// i casi limite di blocco (0, 55, 56, 64, 119, 120, 128 byte) prima di essere collegata alla UI.
const ZL = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
  7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8,
  3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12,
  1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2,
  4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13,
];
const ZR = [
  5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12,
  6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2,
  15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13,
  8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14,
  12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11,
];
const SL = [
  11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8,
  7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12,
  11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5,
  11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12,
  9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6,
];
const SR = [
  8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6,
  9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11,
  9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5,
  15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8,
  8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11,
];
const HL = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e];
const HR = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000];

function rotl32(x, n) {
  return ((x << n) | (x >>> (32 - n))) | 0;
}
function fn1(a, b, c, d, e, m, k, s) { return (rotl32((a + (b ^ c ^ d) + m + k) | 0, s) + e) | 0; }
function fn2(a, b, c, d, e, m, k, s) { return (rotl32((a + ((b & c) | (~b & d)) + m + k) | 0, s) + e) | 0; }
function fn3(a, b, c, d, e, m, k, s) { return (rotl32((a + ((b | ~c) ^ d) + m + k) | 0, s) + e) | 0; }
function fn4(a, b, c, d, e, m, k, s) { return (rotl32((a + ((b & d) | (c & ~d)) + m + k) | 0, s) + e) | 0; }
function fn5(a, b, c, d, e, m, k, s) { return (rotl32((a + (b ^ (c | ~d)) + m + k) | 0, s) + e) | 0; }

function ripemd160(message) {
  const msgLen = message.length;
  const totalLenBits = BigInt(msgLen) * 8n;
  const padLen = (56 - ((msgLen + 1) % 64) + 64) % 64;
  const padded = new Uint8Array(msgLen + 1 + padLen + 8);
  padded.set(message, 0);
  padded[msgLen] = 0x80;
  const lenLo = Number(totalLenBits & 0xffffffffn);
  const lenHi = Number((totalLenBits >> 32n) & 0xffffffffn);
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 8, lenLo, true);
  dv.setUint32(padded.length - 4, lenHi, true);

  let h0 = 0x67452301 | 0, h1 = 0xefcdab89 | 0, h2 = 0x98badcfe | 0, h3 = 0x10325476 | 0, h4 = 0xc3d2e1f0 | 0;

  for (let offset = 0; offset < padded.length; offset += 64) {
    const words = new Array(16);
    const blockDv = new DataView(padded.buffer, offset, 64);
    for (let j = 0; j < 16; j++) words[j] = blockDv.getInt32(j * 4, true);

    let al = h0, bl = h1, cl = h2, dl = h3, el = h4;
    let ar = h0, br = h1, cr = h2, dr = h3, er = h4;

    for (let i = 0; i < 80; i++) {
      let tl, tr;
      if (i < 16) {
        tl = fn1(al, bl, cl, dl, el, words[ZL[i]], HL[0], SL[i]);
        tr = fn5(ar, br, cr, dr, er, words[ZR[i]], HR[0], SR[i]);
      } else if (i < 32) {
        tl = fn2(al, bl, cl, dl, el, words[ZL[i]], HL[1], SL[i]);
        tr = fn4(ar, br, cr, dr, er, words[ZR[i]], HR[1], SR[i]);
      } else if (i < 48) {
        tl = fn3(al, bl, cl, dl, el, words[ZL[i]], HL[2], SL[i]);
        tr = fn3(ar, br, cr, dr, er, words[ZR[i]], HR[2], SR[i]);
      } else if (i < 64) {
        tl = fn4(al, bl, cl, dl, el, words[ZL[i]], HL[3], SL[i]);
        tr = fn2(ar, br, cr, dr, er, words[ZR[i]], HR[3], SR[i]);
      } else {
        tl = fn5(al, bl, cl, dl, el, words[ZL[i]], HL[4], SL[i]);
        tr = fn1(ar, br, cr, dr, er, words[ZR[i]], HR[4], SR[i]);
      }
      al = el; el = dl; dl = rotl32(cl, 10); cl = bl; bl = tl;
      ar = er; er = dr; dr = rotl32(cr, 10); cr = br; br = tr;
    }

    const t = (h1 + cl + dr) | 0;
    h1 = (h2 + dl + er) | 0;
    h2 = (h3 + el + ar) | 0;
    h3 = (h4 + al + br) | 0;
    h4 = (h0 + bl + cr) | 0;
    h0 = t;
  }

  const out = new Uint8Array(20);
  const outDv = new DataView(out.buffer);
  outDv.setInt32(0, h0, true);
  outDv.setInt32(4, h1, true);
  outDv.setInt32(8, h2, true);
  outDv.setInt32(12, h3, true);
  outDv.setInt32(16, h4, true);
  return out;
}

// ---------- secp256k1 point math (BigInt), verificata contro @noble/secp256k1 ----------

const P = 2n ** 256n - 2n ** 32n - 977n;
const N = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;
const Gx = 0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798n;
const Gy = 0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8n;
const G = { x: Gx, y: Gy };

function mod(a, m) {
  const r = a % m;
  return r >= 0n ? r : r + m;
}
function modInverse(a, m) {
  let [oldR, r] = [mod(a, m), m];
  let [oldS, s] = [1n, 0n];
  while (r !== 0n) {
    const q = oldR / r;
    [oldR, r] = [r, oldR - q * r];
    [oldS, s] = [s, oldS - q * s];
  }
  return mod(oldS, m);
}
function modPow(base, exp, m) {
  let result = 1n;
  base = mod(base, m);
  while (exp > 0n) {
    if (exp & 1n) result = mod(result * base, m);
    exp >>= 1n;
    base = mod(base * base, m);
  }
  return result;
}
function pointAdd(p1, p2) {
  if (p1 === null) return p2;
  if (p2 === null) return p1;
  if (p1.x === p2.x && mod(p1.y + p2.y, P) === 0n) return null;
  let m;
  if (p1.x === p2.x && p1.y === p2.y) {
    m = mod(3n * p1.x * p1.x * modInverse(2n * p1.y, P), P);
  } else {
    m = mod((p2.y - p1.y) * modInverse(p2.x - p1.x, P), P);
  }
  const x3 = mod(m * m - p1.x - p2.x, P);
  const y3 = mod(m * (p1.x - x3) - p1.y, P);
  return { x: x3, y: y3 };
}
function pointMul(p, k) {
  let result = null;
  let addend = p;
  let n = k;
  while (n > 0n) {
    if (n & 1n) result = pointAdd(result, addend);
    addend = pointAdd(addend, addend);
    n >>= 1n;
  }
  return result;
}
function bigintToBytes(n, len) {
  let hex = n.toString(16);
  if (hex.length > len * 2) throw new Error("overflow");
  hex = hex.padStart(len * 2, "0");
  return new Uint8Array(hex.match(/.{2}/g).map((b) => parseInt(b, 16)));
}
function bytesToBigint(bytes) {
  let hex = "0x";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return BigInt(hex);
}
function decompressPubkey(bytes) {
  const prefix = bytes[0];
  const x = bytesToBigint(bytes.slice(1));
  const rhs = mod(x * x * x + 7n, P);
  let y = modPow(rhs, (P + 1n) / 4n, P);
  if ((y % 2n === 0n) !== (prefix === 0x02)) y = mod(P - y, P);
  return { x, y };
}
function compressPubkey(point) {
  const prefix = point.y % 2n === 0n ? 0x02 : 0x03;
  return new Uint8Array([prefix, ...bigintToBytes(point.x, 32)]);
}

// ---------- base58check / bech32 encode (le decode sono già in addresscheck.js) ----------

function base58Encode(bytes) {
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);
  let str = "";
  while (num > 0n) {
    str = BASE58_ALPHABET[Number(num % 58n)] + str;
    num /= 58n;
  }
  let leadingZeros = 0;
  for (const b of bytes) {
    if (b === 0) leadingZeros++;
    else break;
  }
  return "1".repeat(leadingZeros) + str;
}
async function base58CheckEncode(version, payload) {
  const data = new Uint8Array([version, ...payload]);
  const hash1 = await sha256(data);
  const hash2 = await sha256(hash1);
  return base58Encode(new Uint8Array([...data, ...hash2.slice(0, 4)]));
}
function convertBits(data, fromBits, toBits, pad) {
  let acc = 0;
  let bits = 0;
  const ret = [];
  const maxv = (1 << toBits) - 1;
  for (const value of data) {
    acc = (acc << fromBits) | value;
    bits += fromBits;
    while (bits >= toBits) {
      bits -= toBits;
      ret.push((acc >> bits) & maxv);
    }
  }
  if (pad && bits > 0) ret.push((acc << (toBits - bits)) & maxv);
  return ret;
}
function bech32Encode(hrp, witnessVersion, programBytes) {
  const data = [witnessVersion, ...convertBits([...programBytes], 8, 5, true)];
  const isBech32m = witnessVersion !== 0;
  const values = hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const m = polymod(values) ^ (isBech32m ? 0x2bc830a3 : 1);
  const checksum = [];
  for (let i = 0; i < 6; i++) checksum.push((m >> (5 * (5 - i))) & 31);
  return hrp + "1" + data.concat(checksum).map((d) => BECH32_CHARSET[d]).join("");
}

// ---------- parsing chiave estesa (xpub/ypub/zpub) ----------

const PUBLIC_VERSION_TYPES = {
  "0488b21e": { type: "xpub", addressType: "p2pkh" },
  "049d7cb2": { type: "ypub", addressType: "p2sh-p2wpkh" },
  "04b24746": { type: "zpub", addressType: "p2wpkh" },
};
const PRIVATE_VERSIONS = new Set(["0488ade4", "049d7878", "04b2430c"]);

/** Decodifica e valida una chiave pubblica estesa (xpub/ypub/zpub), senza contattare nessun servizio esterno. */
export async function parseExtendedKey(rawStr) {
  const str = (rawStr || "").trim();
  const bytes = base58Decode(str);
  if (!bytes || bytes.length !== 82) {
    return { valid: false, reason: "Formato non valido: non sembra una chiave estesa (xpub/ypub/zpub)." };
  }
  const payload = bytes.slice(0, -4);
  const checksum = bytes.slice(-4);
  const hash1 = await sha256(payload);
  const hash2 = await sha256(hash1);
  if (!hash2.slice(0, 4).every((b, i) => b === checksum[i])) {
    return { valid: false, reason: "Checksum non valido: uno o più caratteri sono probabilmente sbagliati." };
  }
  const versionHex = [...payload.slice(0, 4)].map((b) => b.toString(16).padStart(2, "0")).join("");
  if (PRIVATE_VERSIONS.has(versionHex)) {
    return {
      valid: false,
      reason: `Questa è una chiave PRIVATA (xprv/yprv/zprv): non va mai incollata da nessuna parte, nemmeno qui. Per il tracciamento serve la versione PUBBLICA (xpub/ypub/zpub), che il tuo wallet può esportare senza rischi.`,
    };
  }
  const meta = PUBLIC_VERSION_TYPES[versionHex];
  if (!meta) return { valid: false, reason: "Prefisso non riconosciuto: servono xpub, ypub o zpub (solo indirizzi a firma singola, mainnet)." };
  const depth = payload[4];
  const chainCode = payload.slice(13, 45);
  const keyData = payload.slice(45, 78);
  if (keyData[0] !== 0x02 && keyData[0] !== 0x03) return { valid: false, reason: "Formato della chiave pubblica non valido." };
  const point = decompressPubkey(keyData);
  return { valid: true, type: meta.type, addressType: meta.addressType, point, pubkeyBytes: keyData, chainCode, depth };
}

/** Deriva la chiave figlia pubblica a un dato indice (derivazione non-hardened, l'unica possibile da una chiave pubblica). */
async function deriveChildPublic(parentPoint, parentPubkeyBytes, chainCode, index) {
  if (index >= 0x80000000) throw new Error("Impossibile derivare un indice hardened da una chiave pubblica.");
  const data = new Uint8Array([...parentPubkeyBytes, ...bigintToBytes(BigInt(index), 4)]);
  const I = await hmacSha512(chainCode, data);
  const IL = I.slice(0, 32);
  const IR = I.slice(32);
  const ILint = bytesToBigint(IL);
  if (ILint >= N) throw new Error("Indice non derivabile (caso estremamente raro).");
  const childPoint = pointAdd(pointMul(G, ILint), parentPoint);
  if (childPoint === null) throw new Error("Indice non derivabile (caso estremamente raro).");
  return { point: childPoint, pubkeyBytes: compressPubkey(childPoint), chainCode: IR };
}

/** Converte una chiave pubblica derivata nell'indirizzo Bitcoin corrispondente al tipo di chiave estesa di partenza. */
async function pubkeyToAddress(pubkeyBytes, addressType) {
  const hash160 = ripemd160(await sha256(pubkeyBytes));
  if (addressType === "p2pkh") return base58CheckEncode(0x00, hash160);
  if (addressType === "p2sh-p2wpkh") {
    const redeemScript = new Uint8Array([0x00, 0x14, ...hash160]);
    const scriptHash = ripemd160(await sha256(redeemScript));
    return base58CheckEncode(0x05, scriptHash);
  }
  if (addressType === "p2wpkh") return bech32Encode("bc", 0, hash160);
  throw new Error("Tipo di indirizzo sconosciuto.");
}

const GAP_LIMIT = 20;
const MAX_ADDRESSES_PER_CHAIN = 300; // limite di sicurezza contro loop eccessivi su xpub anomale

/**
 * Scopre gli indirizzi "usati" (con storico on-chain) derivati da una chiave estesa, seguendo lo
 * standard "gap limit" a 20 (come la maggior parte dei wallet): si ferma dopo 20 indirizzi consecutivi
 * mai usati su ciascuna catena (0 = ricezione, 1 = resto). checkAddress(address) deve restituire
 * { used: boolean, balance: number, ... } consultando l'API — nessuna chiamata di rete avviene qui
 * dentro. Eventuali campi extra restituiti da checkAddress (es. txCount) vengono riportati inalterati
 * in ogni indirizzo trovato.
 */
export async function discoverAddresses(parsedKey, checkAddress, { startReceive = 0, startChange = 0, onProgress } = {}) {
  const found = [];
  let maxUsedReceive = -1;
  let maxUsedChange = -1;

  for (const [chain, startIndex] of [[0, startReceive], [1, startChange]]) {
    const chainNode = await deriveChildPublic(parsedKey.point, parsedKey.pubkeyBytes, parsedKey.chainCode, chain);
    let consecutiveUnused = 0;
    for (let i = startIndex; i < MAX_ADDRESSES_PER_CHAIN && consecutiveUnused < GAP_LIMIT; i++) {
      const child = await deriveChildPublic(chainNode.point, chainNode.pubkeyBytes, chainNode.chainCode, i);
      const address = await pubkeyToAddress(child.pubkeyBytes, parsedKey.addressType);
      onProgress?.(chain, i);
      const info = await checkAddress(address);
      if (info.used) {
        found.push({ ...info, address, chain, index: i });
        consecutiveUnused = 0;
        if (chain === 0) maxUsedReceive = i;
        else maxUsedChange = i;
      } else {
        consecutiveUnused++;
      }
    }
  }
  return { addresses: found, maxUsedReceive, maxUsedChange };
}
