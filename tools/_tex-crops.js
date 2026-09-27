// Crop texture regions by geometry selection: face-front, hands, hip
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

  const texel = (u, t) => {
    u -= Math.floor(u); t -= Math.floor(t);
    const i = (Math.min(H - 1, Math.floor(t * H)) * W + Math.min(W - 1, Math.floor(u * W))) * 4;
    return [tex.data[i], tex.data[i + 1], tex.data[i + 2]];
  };
  const isSkin = (rgb) => { const [h, s, l] = hsl(rgb[0], rgb[1], rgb[2]); return h >= 10 && h <= 50 && s > 0.05 && s <= 0.6 && l > 0.4; };
  const isPale = (rgb) => { const [h, s, l] = hsl(rgb[0], rgb[1], rgb[2]); return l > 0.55 && s < 0.42; };

  const sel = {
    face: (x, y, z, rgb) => z < -0.90 && z > -1.10 && y > 0.03 && (isSkin(rgb) || rgb[0] + rgb[1] + rgb[2] < 620),
    hand: (x, y, z, rgb) => z > -0.78 && z < -0.58 && x > 0.10 && y > 0.05 && isSkin(rgb),
    cloakfront: (x, y, z, rgb) => z > -0.95 && z < -0.35 && y > 0.06 && Math.abs(x) < 0.16 && isPale(rgb),
  };

  for (const [name, fn] of Object.entries(sel)) {
    let u0 = 9, u1 = -9, t0 = 9, t1 = -9, n = 0;
    const us = [], ts = [];
    for (let v = 0; v < nV; v++) {
      const x = pos[v * 3], y = pos[v * 3 + 1], z = pos[v * 3 + 2];
      const rgb = texel(uv[v * 2], uv[v * 2 + 1]);
      if (!fn(x, y, z, rgb)) continue;
      let u = uv[v * 2], t = uv[v * 2 + 1];
      u -= Math.floor(u); t -= Math.floor(t);
      us.push(u); ts.push(t);
      n++;
    }
    if (!n) { console.log(name, ': no verts'); continue; }
    us.sort((a, b) => a - b); ts.sort((a, b) => a - b);
    const q = (arr, p) => arr[Math.min(arr.length - 1, Math.floor(p * arr.length))];
    u0 = q(us, 0.02); u1 = q(us, 0.98); t0 = q(ts, 0.02); t1 = q(ts, 0.98);
    // pad & clamp
    const pad = 0.004;
    const x0 = Math.max(0, Math.floor((u0 - pad) * W)), x1 = Math.min(W, Math.ceil((u1 + pad) * W));
    const y0 = Math.max(0, Math.floor((t0 - pad) * H)), y1 = Math.min(H, Math.ceil((t1 + pad) * H));
    const w = x1 - x0, h = y1 - y0;
    const crop = new PNG({ width: w, height: h });
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const si = ((y0 + y) * W + (x0 + x)) * 4, di = (y * w + x) * 4;
      for (let k = 0; k < 4; k++) crop.data[di + k] = tex.data[si + k];
    }
    fs.writeFileSync(`tools/_analysis/v5crop-${name}.png`, PNG.sync.write(crop));
    console.log(`${name}: verts=${n} uv=[${u0.toFixed(3)}..${u1.toFixed(3)}]x[${t0.toFixed(3)}..${t1.toFixed(3)}] px=[${x0}..${x1}]x[${y0}..${y1}] ${w}x${h}`);
  }
})().catch(e => { console.error(e); process.exit(1); });
