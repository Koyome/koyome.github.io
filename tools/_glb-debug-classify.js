// Build debug GLB: COLOR_0 per-vertex class colors, plain white material
const fs = require('fs');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { PNG } = require('pngjs');

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
  if (s > 0.35 && l > 0.12 && l < 0.75 && (h < 25 || h > 340)) return 1; // hair
  if (h >= 10 && h <= 45 && s > 0.08 && s <= 0.55 && l > 0.45) return 2; // skin
  if (l < 0.22) return 3; // dark
  return 0;
}

const CLASS_RGB = {
  0: [0.55, 0.55, 0.55], // other: grey
  1: [1.0, 0.1, 0.1],    // hair: red
  2: [0.2, 0.9, 0.2],    // skin: green
  3: [0.15, 0.15, 0.9],  // dark: blue
};

async function build(path, outPath) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(path);
  const root = doc.getRoot();
  const prim = root.listMeshes()[0].listPrimitives()[0];
  const uv = prim.getAttribute('TEXCOORD_0').getArray();
  const nVerts = uv.length / 2;
  const mat = prim.getMaterial();
  const tex = decodePNG(mat.getBaseColorTexture().getImage());
  const W = tex.width, H = tex.height;

  const colArr = new Float32Array(nVerts * 3);
  for (let v = 0; v < nVerts; v++) {
    let u = uv[v * 2], t = uv[v * 2 + 1];
    u -= Math.floor(u); t -= Math.floor(t);
    const px = Math.min(W - 1, Math.floor(u * W));
    const py = Math.min(H - 1, Math.floor(t * H));
    const idx = (py * W + px) * 4;
    const c = classify(tex.data[idx], tex.data[idx + 1], tex.data[idx + 2]);
    const rgb = CLASS_RGB[c];
    colArr[v * 3] = rgb[0]; colArr[v * 3 + 1] = rgb[1]; colArr[v * 3 + 2] = rgb[2];
  }

  const colAcc = doc.createAccessor('COLOR_0')
    .setType('VEC3').setArray(colArr)
    .setBuffer(root.listBuffers()[0]);
  prim.setAttribute('COLOR_0', colAcc);

  mat.setBaseColorTexture(null);
  mat.setNormalTexture(null);
  mat.setMetallicRoughnessTexture(null);
  mat.setBaseColorFactor([1, 1, 1, 1]);
  mat.setMetallicFactor(0);
  mat.setRoughnessFactor(1);

  await io.write(outPath, doc);
  console.log('wrote', outPath);
}

(async () => {
  await build('docs/assets/eris-figure-v4.glb', 'tools/_analysis/v4-classified.glb');
  await build('docs/assets/eris-figure-v5.glb', 'tools/_analysis/v5-classified.glb');
})().catch(e => { console.error(e); process.exit(1); });
