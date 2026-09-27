// Precisely characterize skin artifacts: for vertices that are geometrically skin
// (hand/face/shoulder/chest), compute local skin median lightness per UV island,
// then report the distribution of outlier texels (dark specks, bright blotches, red patches).
const fs = require('fs');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { PNG } = require('pngjs');
function decodePNG(buf) { return PNG.sync.read(Buffer.from(buf)); }
function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2; let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s, l];
}

(async () => {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read('docs/assets/eris-figure-v5.glb');
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const tex = decodePNG(prim.getMaterial().getBaseColorTexture().getImage());
  const W = tex.width, H = tex.height;
  const pos = prim.getAttribute('POSITION').getArray();
  const uv = prim.getAttribute('TEXCOORD_0').getArray();
  const nV = pos.length / 3;

  const sample = (u, t) => {
    u -= Math.floor(u); t -= Math.floor(t);
    const i = (Math.min(H - 1, Math.floor(t * H)) * W + Math.min(W - 1, Math.floor(u * W))) * 4;
    return [tex.data[i], tex.data[i + 1], tex.data[i + 2]];
  };

  // Build per-texel aggregation of vertices (which texels are used by skin-ish geometry)
  // First pass: identify skin vertices by base HSL (loose skin).
  const isSkinBase = (r, g, b) => { const [h, s, l] = hsl(r, g, b); return h >= 8 && h <= 50 && s > 0.05 && s <= 0.62 && l > 0.32; };

  // For each skin-base vertex, record its texel. Then compute median lightness per texel neighborhood.
  const lSum = new Float64Array(W * H);
  const lCnt = new Float64Array(W * H);
  for (let v = 0; v < nV; v++) {
    const [r, g, b] = sample(uv[v * 2], uv[v * 2 + 1]);
    if (!isSkinBase(r, g, b)) continue;
    let u = uv[v * 2], t = uv[v * 2 + 1];
    u -= Math.floor(u); t -= Math.floor(t);
    const px = Math.min(W - 1, Math.floor(u * W));
    const py = Math.min(H - 1, Math.floor(t * H));
    const [h, s, l] = hsl(r, g, b);
    lSum[py * W + px] += l; lCnt[py * W + px]++;
  }

  // local median via sorted 3x3 over lCnt>0 texels
  const med = new Float32Array(W * H).fill(NaN);
  const win = new Float32Array(9);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x;
    if (!lCnt[p]) continue;
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
      const q = yy * W + xx;
      if (lCnt[q]) win[n++] = lSum[q] / lCnt[q];
    }
    if (n >= 3) { win.subarray(0, n).sort(); med[p] = win[n >> 1]; }
  }

  // now flag outliers
  let dark = 0, bright = 0, red = 0, clean = 0;
  const darkH = [], darkL = [], brightL = [], redS = [];
  for (let v = 0; v < nV; v++) {
    const [r, g, b] = sample(uv[v * 2], uv[v * 2 + 1]);
    if (!isSkinBase(r, g, b)) continue;
    let u = uv[v * 2], t = uv[v * 2 + 1];
    u -= Math.floor(u); t -= Math.floor(t);
    const px = Math.min(W - 1, Math.floor(u * W));
    const py = Math.min(H - 1, Math.floor(t * H));
    const m = med[py * W + px];
    if (Number.isNaN(m)) { clean++; continue; }
    const [h, s, l] = hsl(r, g, b);
    if (m - l > 0.14) { dark++; darkL.push(l); }
    else if (l - m > 0.16) { bright++; brightL.push(l); }
    else if (s > 0.5 && (h < 22 || h > 340) && l > 0.15) { red++; redS.push(s); }
    else clean++;
  }
  console.log(`skin-base verts: dark=${dark} bright=${bright} red=${red} clean=${clean}`);
  const rng = a => a.length ? `[${Math.min(...a).toFixed(2)}..${Math.max(...a).toFixed(2)}]` : 'n/a';
  console.log(`  dark L range ${rng(darkL)}, bright L range ${rng(brightL)}, red S range ${rng(redS)}`);
})().catch(e => { console.error(e); process.exit(1); });
