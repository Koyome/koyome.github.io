// v8 (v5-based) material pass: build a NEW MetallicRoughness texture with zone-based
// roughness (v5 has only baseColor, no MR/normal). Roughness: eye 0.14 / skin 0.55 /
// leather 0.50 / fabric 0.84. metallic = 0 everywhere (kill plastic look).
const fs = require('fs');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { PNG } = require('pngjs');

const SRC = process.argv[2] || 'tools/_analysis/v8-clean4.glb';
const OUT = process.argv[3] || 'tools/_analysis/v8-material.glb';

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
const ROUGH = { [Z.SKIN]: 0.55, [Z.FABRIC]: 0.84, [Z.LEATHER]: 0.50, [Z.EYE]: 0.14, [Z.NONE]: 0.68 };

(async () => {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(SRC);
  const root = doc.getRoot();
  const prim = root.listMeshes()[0].listPrimitives()[0];
  const mat = prim.getMaterial();

  const base = decodePNG(mat.getBaseColorTexture().getImage());
  const W = base.width, H = base.height;
  const pos = prim.getAttribute('POSITION').getArray();
  const uv = prim.getAttribute('TEXCOORD_0').getArray();
  const idx = prim.getIndices().getArray();
  const nF = idx.length / 3;

  const sampleBase = (u, t) => {
    u -= Math.floor(u); t -= Math.floor(t);
    const i = (Math.min(H - 1, Math.floor(t * H)) * W + Math.min(W - 1, Math.floor(u * W))) * 4;
    return [base.data[i], base.data[i + 1], base.data[i + 2]];
  };

  // eye z window
  const darkZ = [];
  for (let f = 0; f < nF; f += 2) {
    const v = idx[f * 3];
    const z = pos[v * 3 + 2];
    if (z > -0.87 || z < -1.10) continue;
    const [r, g, b] = sampleBase(uv[v * 2], uv[v * 2 + 1]);
    const [h, s, l] = hsl(r, g, b);
    if (l < 0.32 && r >= b && (h < 40 || h > 330)) darkZ.push(z);
  }
  darkZ.sort((a, b) => a - b);
  const medZ = darkZ.length ? darkZ[Math.floor(darkZ.length / 2)] : -0.98;
  const EYE_Z0 = medZ - 0.022, EYE_Z1 = medZ + 0.022;
  console.log('eye z window:', EYE_Z0.toFixed(3), '..', EYE_Z1.toFixed(3));

  // classify faces
  const faceZone = new Uint8Array(nF);
  const zoneCount = {};
  for (let f = 0; f < nF; f++) {
    const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2];
    const cu = (uv[a * 2] + uv[b * 2] + uv[c * 2]) / 3;
    const ct = (uv[a * 2 + 1] + uv[b * 2 + 1] + uv[c * 2 + 1]) / 3;
    const cz = (pos[a * 3 + 2] + pos[b * 3 + 2] + pos[c * 3 + 2]) / 3;
    const [r, g, bl] = sampleBase(cu, ct);
    const [h, s, l] = hsl(r, g, bl);
    let z;
    if (cz < -0.87 && cz > -1.10 && l < 0.32 && r >= bl && (h < 40 || h > 330) && cz > EYE_Z0 && cz < EYE_Z1) z = Z.EYE;
    else if (h >= 10 && h <= 45 && s > 0.06 && s <= 0.55 && l > 0.45) z = Z.SKIN;
    else if (l > 0.58 && s < 0.38) z = Z.FABRIC;
    else if (l <= 0.58) z = Z.LEATHER;
    else z = Z.FABRIC;
    faceZone[f] = z;
    zoneCount[z] = (zoneCount[z] || 0) + 1;
  }
  console.log('face zones:', zoneCount);

  // rasterize zone into texture
  const zoneTex = new Uint8Array(W * H);
  const px = new Float64Array(3), py = new Float64Array(3);
  for (let f = 0; f < nF; f++) {
    const zid = faceZone[f];
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
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++) {
      const w0 = ((py[1] - py[2]) * (x - px[2]) + (px[2] - px[1]) * (y - py[2])) / d;
      const w1 = ((py[2] - py[0]) * (x - px[2]) + (px[0] - px[2]) * (y - py[2])) / d;
      const w2 = 1 - w0 - w1;
      if (w0 < -0.05 || w1 < -0.05 || w2 < -0.05) continue;
      zoneTex[y * W + x] = zid;
    }
  }
  let painted = 0; for (let i = 0; i < zoneTex.length; i++) if (zoneTex[i]) painted++;
  console.log('zone texels painted:', (100 * painted / (W * H)).toFixed(1) + '%');

  // build MR texture: R=occlusion(255) G=roughness B=metallic(0) A=255
  const mr = new PNG({ width: W, height: H });
  for (let i = 0; i < W * H; i++) {
    const zid = zoneTex[i];
    const g = zid ? ROUGH[zid] : ROUGH[Z.NONE];
    const o = i * 4;
    mr.data[o] = 255;
    mr.data[o + 1] = Math.round(g * 255);
    mr.data[o + 2] = 0;
    mr.data[o + 3] = 255;
  }

  // attach MR texture to material
  const mrPNG = PNG.sync.write(mr);
  const texObj = doc.createTexture('MR')
    .setImage(new Uint8Array(mrPNG.buffer, mrPNG.byteOffset, mrPNG.byteLength))
    .setMimeType('image/png');
  mat.setMetallicRoughnessTexture(texObj);
  mat.setMetallicFactor(0);
  mat.setRoughnessFactor(1);

  await io.write(OUT, doc);
  console.log('wrote', OUT, (fs.statSync(OUT).size / 1048576).toFixed(1) + 'MB');
})().catch(e => { console.error(e); process.exit(1); });
