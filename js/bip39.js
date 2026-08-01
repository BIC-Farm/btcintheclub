import { BIP39_WORDLIST } from "./bip39-wordlist.js";

/**
 * Deriva byte di entropia da una sequenza di tiri di dado fisico (1-6),
 * passandoli attraverso SHA-256 (Web Crypto nativo). Usare l'hash invece di
 * troncare direttamente i tiri evita qualunque bias statistico introdotto
 * da conversioni base-6 -> base-2 non allineate a una potenza di due.
 */
async function rollsToEntropy(rolls, entropyBits) {
  const rollBytes = new Uint8Array(rolls);
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", rollBytes));
  return hash.slice(0, entropyBits / 8);
}

function bytesToBits(bytes) {
  let bits = "";
  for (const byte of bytes) bits += byte.toString(2).padStart(8, "0");
  return bits;
}

/** Implementazione standard BIP39: entropia + checksum (SHA-256) -> parole. */
async function entropyToMnemonic(entropyBytes) {
  const checksumBits = (entropyBytes.length * 8) / 32;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", entropyBytes));
  const bits = bytesToBits(entropyBytes) + bytesToBits(hash).slice(0, checksumBits);

  const words = [];
  for (let i = 0; i < bits.length; i += 11) {
    const index = parseInt(bits.slice(i, i + 11), 2);
    words.push(BIP39_WORDLIST[index]);
  }
  return words;
}

/**
 * @param {number[]} rolls tiri di un dado fisico a 6 facce, valori 1-6
 * @param {128|256} entropyBits 128 -> 12 parole, 256 -> 24 parole
 */
export async function diceRollsToMnemonic(rolls, entropyBits) {
  const entropy = await rollsToEntropy(rolls, entropyBits);
  return entropyToMnemonic(entropy);
}

export const ROLLS_REQUIRED = {
  128: 50, // 50 tiri ≈ 129 bit di entropia grezza, > 128 richiesti
  256: 100, // 100 tiri ≈ 258 bit di entropia grezza, > 256 richiesti
};

/** Controllo di buon senso: segnala sequenze poco plausibili per tiri fisici reali. */
export function looksNonRandom(rolls) {
  if (rolls.length < 10) return false;
  const counts = [0, 0, 0, 0, 0, 0];
  for (const r of rolls) counts[r - 1]++;
  const maxShare = Math.max(...counts) / rolls.length;
  return maxShare > 0.6;
}
