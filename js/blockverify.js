function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  return bytes;
}

function bytesToHex(bytes) {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function reversed(bytes) {
  return new Uint8Array(bytes).reverse();
}

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

async function doubleSha256(bytes) {
  return sha256(await sha256(bytes));
}

function writeUInt32LE(value) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value >>> 0, true);
  return bytes;
}

function concatBytes(...arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

/** Ricalcola la merkle root da un elenco ordinato di txid (formato display, big-endian). Ritorna i byte in ordine interno (little-endian). */
async function computeMerkleRootInternal(txidsDisplayOrder) {
  if (txidsDisplayOrder.length === 0) return null;
  let level = txidsDisplayOrder.map((txid) => reversed(hexToBytes(txid)));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : level[i]; // il Bitcoin protocol duplica l'ultimo nodo se il livello ha un numero dispari di elementi
      next.push(await doubleSha256(concatBytes(left, right)));
    }
    level = next;
  }
  return level[0];
}

async function computeBlockHash(block, merkleRootInternal) {
  const prevHash = block.previousblockhash
    ? reversed(hexToBytes(block.previousblockhash))
    : new Uint8Array(32); // il blocco Genesis non ha un blocco precedente: 32 byte a zero
  const header = concatBytes(
    writeUInt32LE(block.version),
    prevHash,
    merkleRootInternal,
    writeUInt32LE(block.timestamp),
    writeUInt32LE(block.bits),
    writeUInt32LE(block.nonce)
  );
  const hash = await doubleSha256(header);
  return bytesToHex(reversed(hash));
}

/**
 * Verifica un blocco interamente nel browser, senza fidarsi della parola di nessun servizio esterno:
 * 1) ricalcola la merkle root dalle transazioni e la confronta con quella dichiarata dal blocco;
 * 2) ricostruisce l'header (usando la merkle root dichiarata) e verifica che il suo doppio SHA-256
 *    corrisponda davvero all'hash/id del blocco — cioè che la proof-of-work sia autentica.
 * I due controlli sono indipendenti, così un eventuale mismatch della merkle root non "nasconde"
 * l'esito del controllo sulla proof-of-work.
 */
export async function verifyBlock(block, txids) {
  const merkleRootInternal = await computeMerkleRootInternal(txids);
  const computedMerkleRoot = merkleRootInternal ? bytesToHex(reversed(merkleRootInternal)) : null;
  const merkleRootMatches = computedMerkleRoot !== null && computedMerkleRoot === block.merkle_root;

  const declaredMerkleRootInternal = reversed(hexToBytes(block.merkle_root));
  const computedHash = await computeBlockHash(block, declaredMerkleRootInternal);
  const hashMatches = computedHash === block.id;

  return { computedHash, hashMatches, computedMerkleRoot, merkleRootMatches };
}
