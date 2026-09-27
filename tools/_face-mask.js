// Rasterize face-front triangles into UV mask, overlay on texture
const fs = require('fs');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { PNG } = require('pngjs');
function decodePNG(buf) { return PNG.sync.read(Buffer.from(buf)); }

(async () => {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read('docs/assets/eris-figure-v5.glb');
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const tex = decodePNG(prim.getMaterial().getBaseColorTexture().getImage());
  const W = tex.width, H = tex.height;
  const pos = prim.getAttribute('POSITION').getArray();
  const nrm = prim.getAttribute('NORMAL').getArray();
  const uv = prim.getAttribute('TEXCOORD_0').getArray();
  const idx = prim.getIndices().getArray();
  const nF = idx.length / 3;
  const texelRGB = (u, t) => {
    u -= Math.floor(u); t -= Math.floor(t);
    const i = (Math.min(H - 1, Math.floor(t * H)) * W + Math.min(W - 1, Math.floor(u * W))) * 4;
    return [tex.data[i], tex.data[i + 1], tex.data[i + 2]];
  };
  const hsl = (r, g, b) => {
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
  };
  const faceOK = (rgb) => {
    const [h, s, l] = hsl(rgb[0], rgb[1], rgb[2]);
    if (l < 0.38) return true;                                    // eyes/brows/lines
    if (h >= 8 && h <= 50 && s < 0.5 && l > 0.55) return true;    // skin
    return false;
  };

  const out = new PNG({ width: W, height: H });
  out.data = Buffer.from(tex.data);
  const px = new Float64Array(3), py = new Float64Array(3);
  let painted = 0, nSel = 0;
  for (let f = 0; f < nF; f++) {
    let ok = true;
    let cu = 0, ct = 0;
    for (let k = 0; k < 3; k++) {
      const v = idx[f * 3 + k];
      const y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      const ny = nrm[v * 3 + 1];
      if (!(z < -0.88 && z > -1.10 && y > 0.02 && ny > 0.35)) { ok = false; break; }
      let u = uv[v * 2], t = uv[v * 2 + 1];
      u -= Math.floor(u); t -= Math.floor(t);
      px[k] = u * W; py[k] = t * H;
      cu += u; ct += t;
    }
    if (!ok) continue;
    if (!faceOK(texelRGB(cu / 3, ct / 3))) continue;
    nSel++;
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
      if (w0 < -0.05 || w1 < -0.05 || 1 - w0 - w1 < -0.05) continue;
      const i = (y * W + x) * 4;
      out.data[i] = 255; out.data[i + 1] = 0; out.data[i + 2] = 255; out.data[i + 3] = 255;
      painted++;
    }
  }
  fs.writeFileSync('tools/_analysis/v5-facemask.png', PNG.sync.write(out));
  console.log('selected faces:', nSel, 'painted texels:', painted);
  // bbox of painted
  let x0 = W, x1 = 0, y0 = H, y1 = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4;
    if (out.data[i] === 255 && out.data[i + 1] === 0 && out.data[i + 2] === 255) {
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  console.log('face mask bbox:', x0, '..', x1, 'x', y0, '..', y1);
})().catch(e => { console.error(e); process.exit(1); });
