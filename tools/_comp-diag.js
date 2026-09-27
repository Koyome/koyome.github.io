// Diagnose hair candidate component size/z distribution
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
function isHair(r, g, b) {
  const [h, s, l] = hsl(r, g, b);
  return s > 0.35 && l > 0.12 && l < 0.75 && (h < 25 || h > 340);
}
async function run(path) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(path);
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const pos = prim.getAttribute('POSITION').getArray();
  const uv = prim.getAttribute('TEXCOORD_0').getArray();
  const idx = prim.getIndices().getArray();
  const tex = decodePNG(prim.getMaterial().getBaseColorTexture().getImage());
  const W = tex.width, H = tex.height;
  const nV = pos.length / 3, nF = idx.length / 3;
  const hairV = new Uint8Array(nV);
  for (let v = 0; v < nV; v++) {
    let u = uv[v * 2], t = uv[v * 2 + 1];
    u -= Math.floor(u); t -= Math.floor(t);
    const i = ((Math.min(H - 1, Math.floor(t * H))) * W + Math.min(W - 1, Math.floor(u * W))) * 4;
    hairV[v] = isHair(tex.data[i], tex.data[i + 1], tex.data[i + 2]) ? 1 : 0;
  }
  const cand = new Uint8Array(nF);
  for (let f = 0; f < nF; f++) cand[f] = (hairV[idx[f * 3]] + hairV[idx[f * 3 + 1]] + hairV[idx[f * 3 + 2]] >= 2) ? 1 : 0;
  const parent = new Int32Array(nV); for (let i = 0; i < nV; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let f = 0; f < nF; f++) if (cand[f]) { const a = find(idx[f * 3]), b = find(idx[f * 3 + 1]), c = find(idx[f * 3 + 2]); if (a !== b) parent[a] = b; if (b !== c) parent[b] = c; }
  const comps = new Map(); // root -> {size, minZ, maxZ, cx, cy, cz}
  for (let f = 0; f < nF; f++) if (cand[f]) {
    const r = find(idx[f * 3]);
    let c = comps.get(r);
    if (!c) { c = { size: 0, minZ: 9, maxZ: -9, sx: 0, sy: 0, sz: 0, sv: 0 }; comps.set(r, c); }
    c.size++;
    for (let k = 0; k < 3; k++) {
      const v = idx[f * 3 + k];
      const z = pos[v * 3 + 2];
      if (z < c.minZ) c.minZ = z; if (z > c.maxZ) c.maxZ = z;
      c.sx += pos[v * 3]; c.sy += pos[v * 3 + 1]; c.sz += z; c.sv++;
    }
  }
  const arr = [...comps.values()].sort((a, b) => b.size - a.size);
  console.log('\n== ' + path + '  total comps:', arr.length);
  console.log('top 12 by size:');
  for (const c of arr.slice(0, 12)) {
    console.log(`  size=${c.size} z=[${c.minZ.toFixed(2)}..${c.maxZ.toFixed(2)}] centroid=(${(c.sx / c.sv).toFixed(2)},${(c.sy / c.sv).toFixed(2)},${(c.sz / c.sv).toFixed(2)})`);
  }
  const buckets = { '>=2000': 0, '300-1999': 0, '100-299': 0, '<100': 0 };
  for (const c of arr) {
    if (c.size >= 2000) buckets['>=2000']++;
    else if (c.size >= 300) buckets['300-1999']++;
    else if (c.size >= 100) buckets['100-299']++;
    else buckets['<100']++;
  }
  console.log('size buckets:', buckets);
  // small comps: where are they? (face fragments vs strand wisps)
  const small = arr.filter(c => c.size < 300);
  const smallFace = small.filter(c => c.minZ < -0.85).length;
  console.log(`small comps(<300): ${small.length}, of those in head band(z<-0.85): ${smallFace}`);
  // what size threshold keeps how many faces (anchored z<-0.80)
  for (const th of [100, 200, 300, 500, 1000]) {
    const kept = arr.filter(c => c.size >= th && c.minZ < -0.80).reduce((a, c) => a + c.size, 0);
    const keptAll = arr.filter(c => c.size >= th).reduce((a, c) => a + c.size, 0);
    console.log(`  th=${th}: keptFaces(anchored)=${kept} keptFaces(all)=${keptAll} comps(anchored)=${arr.filter(c => c.size >= th && c.minZ < -0.80).length}`);
  }
}
(async () => {
  await run('docs/assets/eris-figure-v4.glb');
  await run('docs/assets/eris-figure-v5.glb');
})().catch(e => { console.error(e); process.exit(1); });
