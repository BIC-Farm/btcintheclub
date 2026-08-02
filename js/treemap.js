/**
 * Squarified treemap (Bruls, Huizing, van Wijk 1999): dispone un elenco di
 * elementi con area nota in righe che riempiono un rettangolo, minimizzando
 * il rapporto larghezza/altezza di ciascun elemento per restare "quadrati".
 */
export function squarify(items, x, y, w, h) {
  const rects = [];
  let remaining = items.filter((it) => it.area > 0);
  let rx = x;
  let ry = y;
  let rw = w;
  let rh = h;

  while (remaining.length > 0) {
    const side = Math.min(rw, rh);
    let row = [remaining[0]];
    let rowSum = remaining[0].area;
    let bestRatio = worstRatio(row, side, rowSum);
    let i = 1;
    while (i < remaining.length) {
      const nextSum = rowSum + remaining[i].area;
      const nextRow = row.concat(remaining[i]);
      const nextRatio = worstRatio(nextRow, side, nextSum);
      if (nextRatio <= bestRatio) {
        row = nextRow;
        rowSum = nextSum;
        bestRatio = nextRatio;
        i += 1;
      } else {
        break;
      }
    }

    const thickness = rowSum / side;
    if (rw <= rh) {
      let offset = rx;
      for (const it of row) {
        const itemW = (it.area / rowSum) * rw;
        rects.push({ x: offset, y: ry, w: itemW, h: thickness, data: it.data });
        offset += itemW;
      }
      ry += thickness;
      rh -= thickness;
    } else {
      let offset = ry;
      for (const it of row) {
        const itemH = (it.area / rowSum) * rh;
        rects.push({ x: rx, y: offset, w: thickness, h: itemH, data: it.data });
        offset += itemH;
      }
      rx += thickness;
      rw -= thickness;
    }

    remaining = remaining.slice(row.length);
  }

  return rects;
}

function worstRatio(row, side, sum) {
  let max = -Infinity;
  let min = Infinity;
  for (const it of row) {
    if (it.area > max) max = it.area;
    if (it.area < min) min = it.area;
  }
  const s2 = side * side;
  const sum2 = sum * sum;
  return Math.max((s2 * max) / sum2, sum2 / (s2 * min));
}

/** Scala un elenco di grandezze (es. vsize) in aree che sommano a W*H. */
export function computeAreas(sizes, W, H) {
  const total = sizes.reduce((a, b) => a + b, 0);
  if (total <= 0) return sizes.map(() => 0);
  const scale = (W * H) / total;
  return sizes.map((s) => s * scale);
}

export const FEE_COLOR_BUCKETS = [
  { max: 2, color: "#6b7fd7", label: "< 2 sat/vB" },
  { max: 5, color: "#4ea8de", label: "2–5 sat/vB" },
  { max: 15, color: "#52b788", label: "5–15 sat/vB" },
  { max: 40, color: "#e9c46a", label: "15–40 sat/vB" },
  { max: 100, color: "#f4a261", label: "40–100 sat/vB" },
  { max: Infinity, color: "#e63946", label: "> 100 sat/vB" },
];

export const COINBASE_COLOR = "#9b5de5";

export function feeRateColor(satPerVb) {
  for (const bucket of FEE_COLOR_BUCKETS) {
    if (satPerVb <= bucket.max) return bucket.color;
  }
  return FEE_COLOR_BUCKETS[FEE_COLOR_BUCKETS.length - 1].color;
}
