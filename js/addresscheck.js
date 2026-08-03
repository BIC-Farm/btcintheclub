const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const BECH32_CONST = 1;
const BECH32M_CONST = 0x2bc830a3;

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return new Uint8Array(digest);
}

function base58Decode(str) {
  let num = 0n;
  for (const ch of str) {
    const idx = BASE58_ALPHABET.indexOf(ch);
    if (idx === -1) return null;
    num = num * 58n + BigInt(idx);
  }
  let hex = num.toString(16);
  if (hex.length % 2) hex = "0" + hex;
  const bytes = hex === "0" ? [] : hex.match(/.{2}/g).map((b) => parseInt(b, 16));
  let leadingZeros = 0;
  for (const ch of str) {
    if (ch === "1") leadingZeros++;
    else break;
  }
  return new Uint8Array([...new Array(leadingZeros).fill(0), ...bytes]);
}

function polymod(values) {
  const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) {
      if ((b >> i) & 1) chk ^= GEN[i];
    }
  }
  return chk >>> 0;
}

function hrpExpand(hrp) {
  const ret = [];
  for (const c of hrp) ret.push(c.charCodeAt(0) >> 5);
  ret.push(0);
  for (const c of hrp) ret.push(c.charCodeAt(0) & 31);
  return ret;
}

function bech32Decode(addr) {
  const lower = addr.toLowerCase();
  const upper = addr.toUpperCase();
  if (addr !== lower && addr !== upper) return null; // maiuscole e minuscole miste non ammesse
  const s = lower;
  const pos = s.lastIndexOf("1");
  if (pos < 1 || pos + 7 > s.length) return null;
  const hrp = s.slice(0, pos);
  const dataPart = s.slice(pos + 1);
  const data = [];
  for (const c of dataPart) {
    const d = BECH32_CHARSET.indexOf(c);
    if (d === -1) return null;
    data.push(d);
  }
  const combined = hrpExpand(hrp).concat(data);
  const pm = polymod(combined);
  let variant = null;
  if (pm === BECH32_CONST) variant = "bech32";
  else if (pm === BECH32M_CONST) variant = "bech32m";
  else return null;
  return { hrp, data: data.slice(0, -6), variant };
}

/** Raggruppa l'indirizzo in blocchi di 4 caratteri (come un IBAN) per un confronto manuale più facile. */
export function chunkAddress(address) {
  return address.match(/.{1,4}/g)?.join(" ") ?? address;
}

/** Verifica il checksum di un indirizzo Bitcoin (base58check o bech32/bech32m), senza contattare nessun servizio esterno. */
export async function validateAddress(rawAddress) {
  const address = rawAddress.trim();
  if (!address) return { valid: false, type: null, reason: "Incolla un indirizzo da verificare." };

  if (/^(bc1|tb1|bcrt1)/i.test(address)) {
    const decoded = bech32Decode(address);
    if (!decoded) {
      return { valid: false, type: "SegWit", reason: "Checksum non valido: uno o più caratteri sono probabilmente sbagliati o mancanti." };
    }
    const witnessVersion = decoded.data[0];
    const expectedVariant = witnessVersion === 0 ? "bech32" : "bech32m";
    if (decoded.variant !== expectedVariant) {
      return { valid: false, type: "SegWit", reason: "Il checksum non è coerente con la versione dell'indirizzo: probabile errore di trascrizione." };
    }
    const type = witnessVersion === 0 ? "SegWit nativo (v0)" : witnessVersion === 1 ? "Taproot (v1)" : `SegWit v${witnessVersion}`;
    return { valid: true, type, reason: "Checksum bech32 corretto." };
  }

  if (/^[123mn]/.test(address)) {
    const bytes = base58Decode(address);
    if (!bytes || bytes.length < 5) {
      return { valid: false, type: "legacy", reason: "Formato base58 non valido: caratteri non ammessi o indirizzo troppo corto." };
    }
    const payload = bytes.slice(0, -4);
    const checksum = bytes.slice(-4);
    const hash1 = await sha256(payload);
    const hash2 = await sha256(hash1);
    const computed = hash2.slice(0, 4);
    const matches = computed.every((b, i) => b === checksum[i]);
    if (!matches) {
      return { valid: false, type: "legacy", reason: "Checksum non valido: uno o più caratteri sono probabilmente sbagliati o mancanti." };
    }
    const versionByte = payload[0];
    const type = versionByte === 0x00 ? "Legacy (P2PKH)" : versionByte === 0x05 ? "P2SH" : "Base58 valido, rete non standard";
    return { valid: true, type, reason: "Checksum base58 corretto." };
  }

  return { valid: false, type: null, reason: "Formato non riconosciuto: non sembra un indirizzo Bitcoin (legacy, P2SH o SegWit/Taproot)." };
}
