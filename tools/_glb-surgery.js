// v6 surgery: v4 body - v4 hair + v5 hair (aligned & scaled)
// - classify hair verts by red hue sampled from baseColor texture
// - connected components anchored at head top (drops red straps etc.)
// - v4: remove hair faces + 1-ring dilation; v5: keep hair faces + 1-ring dilation
// - scale v5 hair to v4 height about feet origin; merge as second primitive with v5 texture
const fs = require('fs');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { PNG } = require('pngjs');

const V4 = 'docs/assets/eris-figure-v4.glb';
const V5 = 'docs/assets/eris-figure-v5.glb';
const OUT = 'tools/_analysis/v6-surgery.glb';

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
function isHair(r, g, b) {
  const [h, s, l] = hsl(r, g, b);
  return s > 0.35 && l > 0.12 && l < 0.75 && (h < 25 || h > 340);
}

// returns { hairFace: Uint8Array(faceCount) } for faces whose component touches head top
function hairFaces(pos, uv, idx, tex) {
  const W = tex.width, H = tex.height;
  const nV = pos.length / 3;
  const nF = idx.length / 3;
  const hairV = new Uint8Array(nV);
  for (let v = 0; v < nV; v++) {
    let u = uv[v * 2], t = uv[v * 2 + 1];
    u -= Math.floor(u); t -= Math.floor(t);
    const px = Math.min(W - 1, Math.floor(u * W));
    const py = Math.min(H - 1, Math.floor(t * H));
    const i = (py * W + px) * 4;
    hairV[v] = isHair(tex.data[i], tex.data[i + 1], tex.data[i + 2]) ? 1 : 0;
  }
  // candidate faces: >=2 hair verts
  const cand = new Uint8Array(nF);
  for (let f = 0; f < nF; f++) {
    const a = idx[f * 3], b = idx[f * 3 + 1], c = idx[f * 3 + 2];
    cand[f] = (hairV[a] + hairV[b] + hairV[c] >= 2) ? 1 : 0;
  }
  // union-find over verts of candidate faces
  const parent = new Int32Array(nV);
  for (let i = 0; i < nV; i++) parent[i] = i;
  const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const uni = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (let f = 0; f < nF; f++) if (cand[f]) { uni(idx[f * 3], idx[f * 3 + 1]); uni(idx[f * 3 + 1], idx[f * 3 + 2]); }
  // components: keep big ones anchored at head area — tiny comps are eye/brow texture fragments
  const zAnchor = -0.80, sizeMin = 300;
  const compInfo = new Map();
  for (let f = 0; f < nF; f++) if (cand[f]) {
    const r = find(idx[f * 3]);
    let c = compInfo.get(r);
    if (!c) { c = { size: 0, minZ: 9 }; compInfo.set(r, c); }
    c.size++;
    for (let k = 0; k < 3; k++) {
      const z = pos[idx[f * 3 + k] * 3 + 2];
      if (z < c.minZ) c.minZ = z;
    }
  }
  const goodRoot = new Set();
  for (const [r, c] of compInfo) if (c.size >= sizeMin && c.minZ < zAnchor) goodRoot.add(r);
  const out = new Uint8Array(nF);
  let kept = 0;
  for (let f = 0; f < nF; f++) if (cand[f] && goodRoot.has(find(idx[f * 3]))) { out[f] = 1; kept++; }
  console.log(`  faces=${nF} hairCands=${cand.reduce((a, b) => a + b, 0)} keptInHeadComponents=${kept} comps=${compInfo.size} good=${goodRoot.size}`);
  return { hairFace: out, hairV };
}

// 1-ring face dilation: include faces sharing a vert with selected faces
function dilate(idx, sel, nV) {
  const markV = new Uint8Array(nV);
  const nF = idx.length / 3;
  for (let f = 0; f < nF; f++) if (sel[f]) { markV[idx[f * 3]] = 1; markV[idx[f * 3 + 1]] = 1; markV[idx[f * 3 + 2]] = 1; }
  const out = new Uint8Array(nF);
  for (let f = 0; f < nF; f++) out[f] = sel[f] || markV[idx[f * 3]] || markV[idx[f * 3 + 1]] || markV[idx[f * 3 + 2]] ? 1 : 0;
  return out;
}

// compact mesh keeping only faces where keep[f]==1; returns {pos,norm,uv,idx}
function extract(prim, keep) {
  const pos = prim.getAttribute('POSITION').getArray();
  const normA = prim.getAttribute('NORMAL');
  const norm = normA ? normA.getArray() : null;
  const uv = prim.getAttribute('TEXCOORD_0').getArray();
  const idx = prim.getIndices().getArray();
  const nF = idx.length / 3;
  const map = new Int32Array(pos.length / 3).fill(-1);
  let nv = 0;
  for (let f = 0; f < nF; f++) if (keep[f]) for (let k = 0; k < 3; k++) { const v = idx[f * 3 + k]; if (map[v] === -1) map[v] = nv++; }
  const p = new Float32Array(nv * 3), u = new Float32Array(nv * 2), nm = norm ? new Float32Array(nv * 3) : null;
  for (let v = 0; v < map.length; v++) {
    const m = map[v];
    if (m === -1) continue;
    p[m * 3] = pos[v * 3]; p[m * 3 + 1] = pos[v * 3 + 1]; p[m * 3 + 2] = pos[v * 3 + 2];
    u[m * 2] = uv[v * 2]; u[m * 2 + 1] = uv[v * 2 + 1];
    if (nm) { nm[m * 3] = norm[v * 3]; nm[m * 3 + 1] = norm[v * 3 + 1]; nm[m * 3 + 2] = norm[v * 3 + 2]; }
  }
  const ni = new Uint32Array(keep.reduce((a, b) => a + b, 0) * 3);
  let w = 0;
  for (let f = 0; f < nF; f++) if (keep[f]) for (let k = 0; k < 3; k++) ni[w++] = map[idx[f * 3 + k]];
  return { pos: p, norm: nm, uv: u, idx: ni };
}

(async () => {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);

  console.log('== load v4');
  const doc4 = await io.read(V4);
  const root4 = doc4.getRoot();
  const prim4 = root4.listMeshes()[0].listPrimitives()[0];
  const mat4 = prim4.getMaterial();
  const tex4 = decodePNG(mat4.getBaseColorTexture().getImage());
  const pos4 = prim4.getAttribute('POSITION').getArray();
  const uv4 = prim4.getAttribute('TEXCOORD_0').getArray();
  const idx4 = prim4.getIndices().getArray();

  console.log('== v4 hair faces:');
  const h4 = hairFaces(pos4, uv4, idx4, tex4);
  const remove4 = dilate(idx4, h4.hairFace, pos4.length / 3);
  const keep4 = new Uint8Array(remove4.length);
  let removed = 0;
  for (let f = 0; f < remove4.length; f++) { keep4[f] = remove4[f] ? 0 : 1; if (remove4[f]) removed++; }
  console.log('  v4 removed faces (hair+dilate):', removed, '/', remove4.length);

  console.log('== load v5');
  const doc5 = await io.read(V5);
  const root5 = doc5.getRoot();
  const prim5 = root5.listMeshes()[0].listPrimitives()[0];
  const mat5 = prim5.getMaterial();
  const tex5 = decodePNG(mat5.getBaseColorTexture().getImage());
  const pos5 = prim5.getAttribute('POSITION').getArray();
  const uv5 = prim5.getAttribute('TEXCOORD_0').getArray();
  const idx5 = prim5.getIndices().getArray();

  console.log('== v5 hair faces:');
  const h5 = hairFaces(pos5, uv5, idx5, tex5);
  const keep5 = dilate(idx5, h5.hairFace, pos5.length / 3);
  console.log('  v5 kept faces (hair+dilate):', keep5.reduce((a, b) => a + b, 0), '/', keep5.length);

  // extract
  const body = extract(prim4, keep4);
  const hair = extract(prim5, keep5);
  console.log('  body verts:', body.pos.length / 3, 'hair verts:', hair.pos.length / 3);

  // align: scale v5 hair about feet origin by height ratio
  const SCALE = 1.151 / 1.137;
  for (let i = 0; i < hair.pos.length; i++) hair.pos[i] *= SCALE;

  // build v6: modify doc4 — replace prim4 geometry with body, add hair primitive with mat5 texture
  const buffer = root4.listBuffers()[0];
  const mkAcc = (name, type, arr) => doc4.createAccessor(name).setType(type).setArray(arr).setBuffer(buffer);

  prim4.setAttribute('POSITION', mkAcc('POSITION', 'VEC3', body.pos));
  if (body.norm) prim4.setAttribute('NORMAL', mkAcc('NORMAL', 'VEC3', body.norm));
  prim4.setAttribute('TEXCOORD_0', mkAcc('TEXCOORD_0', 'VEC2', body.uv));
  prim4.setIndices(mkAcc('indices', 'SCALAR', body.idx));
  // drop COLOR_0/extra attrs if any
  for (const sem of prim4.listSemantics()) {
    if (!['POSITION', 'NORMAL', 'TEXCOORD_0'].includes(sem)) prim4.setAttribute(sem, null);
  }

  // v5 material → import baseColor texture into doc4
  const tex5Img = mat5.getBaseColorTexture().getImage();
  const newTex = doc4.createTexture('v5hair').setImage(tex5Img).setMimeType('image/png');
  const hairMat = doc4.createMaterial('HairV5')
    .setBaseColorTexture(newTex)
    .setMetallicFactor(0)
    .setRoughnessFactor(0.55)
    .setDoubleSided(true);

  const mesh4 = root4.listMeshes()[0];
  const hairPrim = doc4.createPrimitive()
    .setAttribute('POSITION', mkAcc('POSITION', 'VEC3', hair.pos))
    .setIndices(mkAcc('indices', 'SCALAR', hair.idx))
    .setMaterial(hairMat);
  if (hair.norm) hairPrim.setAttribute('NORMAL', mkAcc('NORMAL', 'VEC3', hair.norm));
  hairPrim.setAttribute('TEXCOORD_0', mkAcc('TEXCOORD_0', 'VEC2', hair.uv));
  mesh4.addPrimitive(hairPrim);

  await io.write(OUT, doc4);
  console.log('wrote', OUT, (fs.statSync(OUT).size / 1048576).toFixed(1) + 'MB');
})().catch(e => { console.error(e); process.exit(1); });
