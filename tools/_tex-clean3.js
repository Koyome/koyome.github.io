// v8 texture surgery on v5:
//  A. zone rasterization (eye/skin/fabric/leather per face -> texel zone grid)
//  B. fabric cleanup: red/dark stains -> diffusion inpaint from clean fabric (protect crisp dark seam lines)
//  C. skin cleanup: dark specks -> inpaint from clean skin (protect eye region)
//  D. eye enhancement: contrast/saturation/catchlight boost + unsharp on face skin
// Output: tools/_analysis/v8-clean.glb
const fs = require('fs');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { PNG } = require('pngjs');

const SRC = 'docs/assets/eris-figure-v5.glb';
const OUT = 'tools/_analysis/v8-clean3.glb';

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
const Z = { NONE: 0, SKIN: 1, FABRIC: 2, LEATHER: 3, EYE: 4 };

(async () => {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(SRC);
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const mat = prim.getMaterial();
  const tex = decodePNG(mat.getBaseColorTexture().getImage());
  const W = tex.width, H = tex.height;
  const pos = prim.getAttribute('POSITION').getArray();
  const uv = prim.getAttribute('TEXCOORD_0').getArray();
  const idx = prim.getIndices().getArray();
  const nF = idx.length / 3;

  const texHSL = (x, y) => {
    const i = (y * W + x) * 4;
    return hsl(tex.data[i], tex.data[i + 1], tex.data[i + 2]);
  };
  const sampleRGB = (u, t) => {
    u -= Math.floor(u); t -= Math.floor(t);
    const i = (Math.min(H - 1, Math.floor(t * H)) * W + Math.min(W - 1, Math.floor(u * W))) * 4;
    return [tex.data[i], tex.data[i + 1], tex.data[i + 2]];
  };

  // ---- A. eye z window (same heuristic as materials pass)
  const darkZ = [];
  for (let f = 0; f < nF; f += 2) {
    const v = idx[f * 3];
    const z = pos[v * 3 + 2];
    if (z > -0.87 || z < -1.10) continue;
    const [r, g, b] = sampleRGB(uv[v * 2], uv[v * 2 + 1]);
    const [h, s, l] = hsl(r, g, b);
    if (l < 0.32 && r >= b && (h < 40 || h > 330)) darkZ.push(z);
  }
  darkZ.sort((a, b) => a - b);
  const medZ = darkZ.length ? darkZ[Math.floor(darkZ.length / 2)] : -0.98;
  const EYE_Z0 = medZ - 0.022, EYE_Z1 = medZ + 0.022;
  console.log('eye z window:', EYE_Z0.toFixed(3), '..', EYE_Z1.toFixed(3));

  // ---- B. classify faces + rasterize zones
  const zone = new Uint8Array(W * H);
  const faceHead = new Uint8Array(W * H); // head-band texels (for face unsharp)
  const px = new Float64Array(3), py = new Float64Array(3);
  let nRaster = 0;
  for (let f = 0; f < nF; f++) {
    const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2];
    const cu = (uv[a * 2] + uv[b * 2] + uv[c * 2]) / 3;
    const ct = (uv[a * 2 + 1] + uv[b * 2 + 1] + uv[c * 2 + 1]) / 3;
    const cz = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3;
    const [r, g, bl] = sampleRGB(cu, ct);
    const [h, s, l] = hsl(r, g, bl);
    let zid;
    if (cz < -0.87 && cz > -1.10 && l < 0.32 && r >= bl && (h < 40 || h > 330) && cz > EYE_Z0 && cz < EYE_Z1) zid = Z.EYE;
    else if (h >= 10 && h <= 45 && s > 0.06 && s <= 0.55 && l > 0.45) zid = Z.SKIN;
    else if (l > 0.58 && s < 0.38) zid = Z.FABRIC;
    else if (l <= 0.58) zid = Z.LEATHER;
    else zid = Z.FABRIC;
    const isHead = cz < -0.87 ? 1 : 0;
    for (let k = 0; k < 3; k++) {
      const v = idx[f * 3 + k];
      let u = uv[v * 2], t = uv[v * 2 + 1];
      u -= Math.floor(u); t -= Math.floor(t);
      px[k] = u * W; py[k] = t * H;
    }
    if (Math.max(px[0], px[1], px[2]) - Math.min(px[0], px[1], px[2]) > W / 2) continue;
    if (Math.max(py[0], py[1], py[2]) - Math.min(py[0], py[1], py[2]) > H / 2) continue;
    const minX = Math.max(0, Math.floor(Math.min(px[0], px[1], px[2])));
    const maxX = Math.min(W - 1, Math.ceil(Math.max(px[0], px[1], px[2])));
    const minY = Math.max(0, Math.floor(Math.min(py[0], py[1], py[2])));
    const maxY = Math.min(H - 1, Math.ceil(Math.max(py[0], py[1], py[2])));
    const d = (py[1] - py[2]) * (px[0] - px[2]) + (px[2] - px[1]) * (py[0] - py[2]);
    if (Math.abs(d) < 1e-9) continue;
    nRaster++;
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const w0 = ((py[1] - py[2]) * (x - px[2]) + (px[2] - px[1]) * (y - py[2])) / d;
      const w1 = ((py[2] - py[0]) * (x - px[2]) + (px[0] - px[2]) * (y - py[2])) / d;
      if (w0 < -0.05 || w1 < -0.05 || 1 - w0 - w1 < -0.05) continue;
      const p = y * W + x;
      zone[p] = zid;
      if (isHead) faceHead[p] = 1;
    }
  }
  console.log('rasterized faces:', nRaster);

  // protect eyes: dilate eye zone by 6px
  const eyeProt = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (zone[i] === Z.EYE) eyeProt[i] = 1;
  for (let pass = 0; pass < 6; pass++) {
    const src = Uint8Array.from(eyeProt);
    for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
      const p = y * W + x;
      if (src[p]) continue;
      if (src[p - 1] || src[p + 1] || src[p - W] || src[p + W]) eyeProt[p] = 1;
    }
  }

  // ---- C. cleanup helpers
  const data = tex.data;
  const cleanRules = {
    [Z.FABRIC]: (h, s, l) => l > 0.58 && s < 0.36,
    [Z.SKIN]: (h, s, l) => l > 0.52 && s < 0.5 && !(l < 0.3),
  };
  const isLinePixel = (h, s, l) => l < 0.30 && s < 0.25; // crisp dark seam lines on fabric

  function inpaintZone(zid, protectMask) {
    const isCleanZ = cleanRules[zid];
    // state: 0=not zone, 1=clean, 2=dirty, 3=protected
    const state = new Uint8Array(W * H);
    let dirtyCount = 0;
    for (let p = 0; p < W * H; p++) {
      if (zone[p] !== zid) continue;
      const i = p * 4;
      const [h, s, l] = hsl(data[i], data[i + 1], data[i + 2]);
      if (protectMask && protectMask[p]) { state[p] = 3; continue; }
      if (zid === Z.FABRIC && isLinePixel(h, s, l)) { state[p] = 3; continue; }
      if (isCleanZ(h, s, l)) state[p] = 1;
      else { state[p] = 2; dirtyCount++; }
    }
    console.log(`zone ${zid}: dirty texels=${dirtyCount}`);
    // diffusion inpaint: dirty texel <- avg of clean/fixed neighbors (9x9), iterate
    let dirtyList = [];
    for (let p = 0; p < W * H; p++) if (state[p] === 2) dirtyList.push(p);
    for (let iter = 0; iter < 30 && dirtyList.length; iter++) {
      const still = [];
      let fixed = 0;
      for (const p of dirtyList) {
        const x = p % W, y = (p / W) | 0;
        let r = 0, g = 0, b = 0, n = 0;
        const R = 4;
        const x0 = Math.max(0, x - R), x1 = Math.min(W - 1, x + R);
        const y0 = Math.max(0, y - R), y1 = Math.min(H - 1, y + R);
        for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) {
          const q = yy * W + xx;
          if (state[q] !== 1 && state[q] !== 3) continue;
          const i = q * 4;
          r += data[i]; g += data[i + 1]; b += data[i + 2]; n++;
        }
        if (n >= 3) {
          const i = p * 4;
          data[i] = r / n; data[i + 1] = g / n; data[i + 2] = b / n;
          state[p] = 1; fixed++;
        } else still.push(p);
      }
      console.log(`  iter ${iter}: fixed ${fixed} left ${still.length}`);
      if (!fixed) break;
      dirtyList = still;
    }
    console.log(`zone ${zid}: remaining dirty=${dirtyList.length}`);
    return dirtyCount - dirtyList.length;
  }

  inpaintZone(Z.FABRIC, null);

  // ---- C3. skin: true 4-neighbor diffusion inpaint (Telea-style), per-region threshold
  // face (head band): only true specks l<0.30 (preserve soft shading); body: l<0.42
  {
    const state = new Uint8Array(W * H); // 0 n/a 1 clean 2 dirty 3 protected
    let dirty = 0;
    for (let p = 0; p < W * H; p++) {
      if (zone[p] !== Z.SKIN) continue;
      if (eyeProt[p]) { state[p] = 3; continue; }
      const i = p * 4;
      const [h, s, l] = hsl(data[i], data[i + 1], data[i + 2]);
      const th = faceHead[p] ? 0.30 : 0.42;
      if (l < th) { state[p] = 2; dirty++; }
      else state[p] = 1;
    }
    console.log('skin dirty candidates:', dirty);
    let dirtyList = [];
    for (let p = 0; p < W * H; p++) if (state[p] === 2) dirtyList.push(p);
    for (let iter = 0; iter < 2000 && dirtyList.length; iter++) {
      const still = [];
      for (const p of dirtyList) {
        const x = p % W, y = (p / W) | 0;
        let r = 0, g = 0, b = 0, n = 0;
        if (x > 0 && state[p - 1] === 1) { const i = (p - 1) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
        if (x < W - 1 && state[p + 1] === 1) { const i = (p + 1) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
        if (y > 0 && state[p - W] === 1) { const i = (p - W) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
        if (y < H - 1 && state[p + W] === 1) { const i = (p + W) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; n++; }
        if (n) {
          const i = p * 4;
          data[i] = r / n; data[i + 1] = g / n; data[i + 2] = b / n;
          state[p] = 1;
        } else still.push(p);
      }
      if (iter % 100 === 0 || still.length === dirtyList.length) console.log(`  iter ${iter}: left ${still.length}`);
      if (still.length === dirtyList.length) break; // no progress
      dirtyList = still;
    }
    console.log('skin diffusion done, remaining:', dirtyList.length);
  }

  // ---- D. eye enhancement + face unsharp
  // eye: contrast + saturation + catchlight
  let eyeN = 0;
  for (let p = 0; p < W * H; p++) {
    if (zone[p] !== Z.EYE) continue;
    const i = p * 4;
    let [h, s, l] = hsl(data[i], data[i + 1], data[i + 2]);
    s = Math.min(1, s * 1.18 + 0.02);
    l = l < 0.5 ? l * 0.92 : Math.min(1, l * 1.08); // deepen darks, brighten lights
    if (l > 0.85) l = Math.min(1, l * 1.12);        // catchlight pop
    // hsl -> rgb
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const hp = h / 60, x2 = c * (1 - Math.abs((hp % 2) - 1));
    let r1, g1, b1;
    if (hp < 1) [r1, g1, b1] = [c, x2, 0];
    else if (hp < 2) [r1, g1, b1] = [x2, c, 0];
    else if (hp < 3) [r1, g1, b1] = [0, c, x2];
    else if (hp < 4) [r1, g1, b1] = [0, x2, c];
    else if (hp < 5) [r1, g1, b1] = [x2, 0, c];
    else [r1, g1, b1] = [c, 0, x2];
    const m = l - c / 2;
    data[i] = Math.round((r1 + m) * 255);
    data[i + 1] = Math.round((g1 + m) * 255);
    data[i + 2] = Math.round((b1 + m) * 255);
    eyeN++;
  }
  console.log('eye texels enhanced:', eyeN);

  // face unsharp (only head-band skin texels): sharpen via neighbor delta
  const src = Buffer.from(data);
  let sharpN = 0;
  const AMT = 0.25;
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const p = y * W + x;
    if (zone[p] !== Z.SKIN || !faceHead[p] || eyeProt[p]) continue;
    const i = p * 4;
    for (let k = 0; k < 3; k++) {
      const avg = (src[i - 4 + k] + src[i + 4 + k] + src[i - W * 4 + k] + src[i + W * 4 + k]) / 4;
      let v = src[i + k] + AMT * (src[i + k] - avg);
      data[i + k] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    sharpN++;
  }
  console.log('face texels sharpened:', sharpN);

  const outPNG = PNG.sync.write(tex);
  mat.getBaseColorTexture().setImage(new Uint8Array(outPNG.buffer, outPNG.byteOffset, outPNG.byteLength));
  await io.write(OUT, doc);
  console.log('wrote', OUT, (fs.statSync(OUT).size / 1048576).toFixed(1) + 'MB');
})().catch(e => { console.error(e); process.exit(1); });
