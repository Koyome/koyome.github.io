// Analyze vertex colors sampled from baseColor texture; classify zones; dump UV masks + stats
const fs = require('fs');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { PNG } = require('pngjs');

const OUT = 'tools/_analysis';
fs.mkdirSync(OUT, { recursive: true });

function decodePNG(buf) { return PNG.sync.read(Buffer.from(buf)); }

function hsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  let h = 0, s = 0;
  if (mx !== mn) {
    const d = mx - mn;
    s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
    if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (mx === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  return [h * 360, s, l];
}

function classify(r, g, b) {
  const [h, s, l] = hsl(r, g, b);
  // red hair: hue near 0/360, decent saturation
  if (s > 0.35 && l > 0.12 && l < 0.75 && (h < 25 || h > 340)) return 'hair';
  // skin: low-mid sat warm, mid-high lightness
  if (h >= 10 && h <= 45 && s > 0.08 && s <= 0.55 && l > 0.45) return 'skin';
  // dark cloth
  if (l < 0.22) return 'dark';
  return 'other';
}

async function analyze(path, tag) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(path);
  const root = doc.getRoot();
  const prim = root.listMeshes()[0].listPrimitives()[0];
  const pos = prim.getAttribute('POSITION').getArray();
  const uv = prim.getAttribute('TEXCOORD_0').getArray();
  const nVerts = pos.length / 3;
  const mat = prim.getMaterial();
  const tex = decodePNG(mat.getBaseColorTexture().getImage());
  const W = tex.width, H = tex.height;

  const counts = { hair: 0, skin: 0, dark: 0, other: 0 };
  const cls = new Uint8Array(nVerts); // 0 other 1 hair 2 skin 3 dark
  const mask = new PNG({ width: W, height: H });
  mask.data.fill(40);

  const code = { other: 0, hair: 1, skin: 2, dark: 3 };
  const color = { 0: [120, 120, 120], 1: [255, 40, 40], 2: [60, 220, 60], 3: [60, 60, 255] };

  for (let v = 0; v < nVerts; v++) {
    let u = uv[v * 2], t = uv[v * 2 + 1];
    u = u - Math.floor(u); t = t - Math.floor(t);
    const px = Math.min(W - 1, Math.floor(u * W));
    const py = Math.min(H - 1, Math.floor(t * H));
    const idx = (py * W + px) * 4;
    const r = tex.data[idx], g = tex.data[idx + 1], b = tex.data[idx + 2];
    const c = classify(r, g, b);
    counts[c]++;
    cls[v] = code[c];
    // paint small block in mask
    const col = color[code[c]];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = px + dx, y = py + dy;
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const ii = (y * W + x) * 4;
      mask.data[ii] = col[0]; mask.data[ii + 1] = col[1]; mask.data[ii + 2] = col[2]; mask.data[ii + 3] = 255;
    }
  }
  fs.writeFileSync(`${OUT}/${tag}-uvmask.png`, PNG.sync.write(mask));

  // vertex z-distribution of hair class (mesh local: height along -z, head at min z)
  let zmin = 1e9, zmax = -1e9;
  for (let v = 0; v < nVerts; v++) { const z = pos[v * 3 + 2]; if (z < zmin) zmin = z; if (z > zmax) zmax = z; }
  const hairZ = [];
  for (let v = 0; v < nVerts; v++) if (cls[v] === 1) hairZ.push(pos[v * 3 + 2]);
  hairZ.sort((a, b) => a - b);
  const q = p => hairZ.length ? hairZ[Math.floor(p * (hairZ.length - 1))].toFixed(3) : '-';

  console.log(`\n== ${tag}: ${path}`);
  console.log('verts:', nVerts, 'tex:', W + 'x' + H);
  console.log('class counts:', counts, ' hair%:', (100 * counts.hair / nVerts).toFixed(1));
  console.log('z range:', zmin.toFixed(3), '..', zmax.toFixed(3));
  console.log('hair z percentiles 0/10/50/90/100:', q(0), q(0.1), q(0.5), q(0.9), q(1));

  // MR texture stats (v4)
  const mrTex = mat.getMetallicRoughnessTexture();
  if (mrTex) {
    const mr = decodePNG(mrTex.getImage());
    let bSum = 0, bMax = 0, gSum = 0, n = mr.width * mr.height;
    for (let i = 0; i < n; i++) {
      const bch = mr.data[i * 4 + 2], gch = mr.data[i * 4 + 1];
      bSum += bch; gSum += gch; if (bch > bMax) bMax = bch;
    }
    console.log(`MR texture ${mr.width}x${mr.height}: metallic(B) avg=${(bSum / n / 255).toFixed(3)} max=${(bMax / 255).toFixed(2)} roughness(G) avg=${(gSum / n / 255).toFixed(3)}`);
  }
  console.log('material metallicFactor:', mat.getMetallicFactor(), 'roughnessFactor:', mat.getRoughnessFactor());
}

(async () => {
  await analyze('docs/assets/eris-figure-v4.glb', 'v4');
  await analyze('docs/assets/eris-figure-v5.glb', 'v5');
})().catch(e => { console.error(e); process.exit(1); });
