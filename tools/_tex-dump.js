// Dump v5 baseColor texture + UV coverage overlay + zone annotation
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
  const mat = prim.getMaterial();
  const tex = decodePNG(mat.getBaseColorTexture().getImage());
  const W = tex.width, H = tex.height;
  fs.writeFileSync('tools/_analysis/v5-basecolor.png', PNG.sync.write(tex));
  console.log('basecolor dumped', W + 'x' + H);

  // per-vertex position + UV → draw 3D position bands on UV map (head band / hands / legs)
  const pos = prim.getAttribute('POSITION').getArray();
  const uv = prim.getAttribute('TEXCOORD_0').getArray();
  const nV = pos.length / 3;
  const overlay = new PNG({ width: W, height: H });
  overlay.data = Buffer.from(tex.data);
  const mark = (x, y, r, g, b) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
      const i = ((y + dy) * W + (x + dx)) * 4;
      overlay.data[i] = r; overlay.data[i + 1] = g; overlay.data[i + 2] = b; overlay.data[i + 3] = 255;
    }
  };
  // find front sign: face = head band skin verts, use their y
  let skinY = 0, skinN = 0;
  for (let v = 0; v < nV; v++) {
    const z = pos[v * 3 + 2];
    if (z > -0.9 || z < -1.05) continue;
    let u = uv[v * 2], t = uv[v * 2 + 1];
    u -= Math.floor(u); t -= Math.floor(t);
    const i = (Math.min(H - 1, Math.floor(t * H)) * W + Math.min(W - 1, Math.floor(u * W))) * 4;
    const [h, s, l] = hsl(tex.data[i], tex.data[i + 1], tex.data[i + 2]);
    if (h >= 10 && h <= 45 && s > 0.08 && s <= 0.55 && l > 0.45) { skinY += pos[v * 3 + 1]; skinN++; }
  }
  const frontSign = (skinY / Math.max(1, skinN)) > 0 ? 1 : -1;
  console.log('front sign (y):', frontSign, 'skin samples:', skinN);

  for (let v = 0; v < nV; v++) {
    const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
    let u = uv[v * 2], t = uv[v * 2 + 1];
    u -= Math.floor(u); t -= Math.floor(t);
    const px = Math.min(W - 1, Math.floor(u * W)), py = Math.min(H - 1, Math.floor(t * H));
    if (z < -0.87 && y * frontSign > 0.02) mark(px, py, 0, 255, 0);        // face-front: green
    else if (z < -0.87) mark(px, py, 0, 128, 0);                          // head back: dark green
    else if (z > -0.78 && z < -0.55 && Math.abs(x) > 0.08) mark(px, py, 255, 128, 0); // hand zone: orange
    else if (z > -0.62 && z < -0.42 && y * frontSign > 0) mark(px, py, 255, 0, 255);  // hip/front: magenta
  }
  fs.writeFileSync('tools/_analysis/v5-uvzones.png', PNG.sync.write(overlay));
  console.log('uv zones dumped');
})().catch(e => { console.error(e); process.exit(1); });
