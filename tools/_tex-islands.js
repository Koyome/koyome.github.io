// Texture-space skin/pale island detection: find big color islands, crop them
const fs = require('fs');
const { PNG } = require('pngjs');
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
  const png = PNG.sync.read(fs.readFileSync('tools/_analysis/v5-basecolor.png'));
  const W = png.width, H = png.height;
  const DS = 4, w = W / DS, h = H / DS; // 1024x1024 working grid

  // classify per downsampled cell (average)
  const cls = new Uint8Array(w * h); // 0 other, 1 skin(pale warm), 2 cream fabric
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let r = 0, g = 0, b = 0;
    for (let dy = 0; dy < DS; dy++) for (let dx = 0; dx < DS; dx++) {
      const i = ((y * DS + dy) * W + (x * DS + dx)) * 4;
      r += png.data[i]; g += png.data[i + 1]; b += png.data[i + 2];
    }
    r /= DS * DS; g /= DS * DS; b /= DS * DS;
    const [hh, s, l] = hsl(r, g, b);
    if (hh >= 8 && hh <= 50 && s > 0.08 && s < 0.5 && l > 0.55) cls[y * w + x] = 1;      // skin
    else if (l > 0.62 && s <= 0.35) cls[y * w + x] = 2;                                  // cream fabric
  }

  // connected components (4-neigh) per class
  const comp = new Int32Array(w * h).fill(-1);
  const comps = [];
  const stack = [];
  for (let i = 0; i < w * h; i++) {
    if (cls[i] === 0 || comp[i] !== -1) continue;
    const c = comps.length;
    comps.push({ cls: cls[i], size: 0, x0: w, x1: 0, y0: h, y1: 0 });
    stack.push(i); comp[i] = c;
    while (stack.length) {
      const p = stack.pop();
      const px = p % w, py = (p / w) | 0;
      const C = comps[c];
      C.size++;
      if (px < C.x0) C.x0 = px; if (px > C.x1) C.x1 = px;
      if (py < C.y0) C.y0 = py; if (py > C.y1) C.y1 = py;
      const nb = [p - 1, p + 1, p - w, p + w];
      for (const q of nb) {
        if (q < 0 || q >= w * h) continue;
        if ((p % w === 0 && q === p - 1) || (p % w === w - 1 && q === p + 1)) continue;
        if (cls[q] !== cls[i] || comp[q] !== -1) continue;
        comp[q] = c; stack.push(q);
      }
    }
  }
  comps.sort((a, b) => b.size - a.size);
  console.log('total islands:', comps.length);
  const top = comps.slice(0, 14);
  for (const [i, c] of top.entries()) {
    console.log(`#${i} cls=${c.cls === 1 ? 'skin' : 'cream'} cells=${c.size} bbox=[${c.x0 * DS}..${(c.x1 + 1) * DS}]x[${c.y0 * DS}..${(c.y1 + 1) * DS}] (${(c.x1 - c.x0 + 1) * DS}x${(c.y1 - c.y0 + 1) * DS}px)`);
  }

  // crop top islands from full-res (with index label in filename)
  for (const [i, c] of top.entries()) {
    if (c.size < 30) continue;
    const x0 = Math.max(0, c.x0 * DS - 8), y0 = Math.max(0, c.y0 * DS - 8);
    const x1 = Math.min(W, (c.x1 + 1) * DS + 8), y1 = Math.min(H, (c.y1 + 1) * DS + 8);
    const cw = x1 - x0, ch = y1 - y0;
    const crop = new PNG({ width: cw, height: ch });
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      const si = ((y0 + y) * W + (x0 + x)) * 4, di = (y * cw + x) * 4;
      for (let k = 0; k < 4; k++) crop.data[di + k] = png.data[si + k];
    }
    fs.writeFileSync(`tools/_analysis/v5island-${i}-${c.cls === 1 ? 'skin' : 'cream'}.png`, PNG.sync.write(crop));
  }
  console.log('island crops written');
})().catch(e => { console.error(e); process.exit(1); });
