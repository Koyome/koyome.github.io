// Diagnose: for hand/leg/hip regions, what zone + HSL do the texels actually land in?
// Uses same face-classification heuristics as _tex-clean4.js to reproduce the zone map,
// then samples the problem regions and reports their zone distribution + HSL stats.
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
const ZN = ['NONE','SKIN','FABRIC','LEATHER','EYE'];
const Z = { NONE: 0, SKIN: 1, FABRIC: 2, LEATHER: 3, EYE: 4 };

(async () => {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read('docs/assets/eris-figure-v5.glb');
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const tex = decodePNG(prim.getMaterial().getBaseColorTexture().getImage());
  const W = tex.width, H = tex.height;
  const pos = prim.getAttribute('POSITION').getArray();
  const uv = prim.getAttribute('TEXCOORD_0').getArray();
  const idx = prim.getIndices().getArray();
  const nF = idx.length / 3;
  const nV = pos.length / 3;

  const sampleRGB = (u, t) => {
    u -= Math.floor(u); t -= Math.floor(t);
    const i = (Math.min(H - 1, Math.floor(t * H)) * W + Math.min(W - 1, Math.floor(u * W))) * 4;
    return [tex.data[i], tex.data[i + 1], tex.data[i + 2]];
  };

  // eye z window (same as clean4)
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

  // classify per-vertex (sampled at vertex uv) instead of per-face centroid, simpler here
  function zoneOf(v) {
    const x = pos[v*3], y = pos[v*3+1], z = pos[v*3+2];
    const cu = uv[v*2], ct = uv[v*2+1];
    const [r, g, b] = sampleRGB(cu, ct);
    const [h, s, l] = hsl(r, g, b);
    if (z < -0.87 && z > -1.10 && l < 0.32 && r >= b && (h < 40 || h > 330) && z > EYE_Z0 && z < EYE_Z1) return Z.EYE;
    if (h >= 10 && h <= 45 && s > 0.06 && s <= 0.55 && l > 0.45) return Z.SKIN;
    if (l > 0.58 && s < 0.38) return Z.FABRIC;
    if (l <= 0.58) return Z.LEATHER;
    return Z.FABRIC;
  }

  // regions of interest (geometry windows from earlier diagnosis)
  const regions = {
    hand:  (x,y,z)=> z > -0.78 && z < -0.58 && x > 0.10 && y > 0.05,
    leg:   (x,y,z)=> y < -0.30 && Math.abs(x) < 0.20,
    hip:   (x,y,z)=> y > -0.15 && y < 0.05 && Math.abs(x) < 0.15 && z > -0.6,
  };

  for (const [name, fn] of Object.entries(regions)) {
    const zc = { 0:0,1:0,2:0,3:0,4:0 };
    const hls = { h:[], s:[], l:[] };
    let n = 0;
    for (let v = 0; v < nV; v++) {
      const x=pos[v*3], y=pos[v*3+1], z=pos[v*3+2];
      if (!fn(x,y,z)) continue;
      const cu=uv[v*2], ct=uv[v*2+1];
      const [r,g,b] = sampleRGB(cu,ct);
      const [h,s,l] = hsl(r,g,b);
      const zid = zoneOf(v);
      zc[zid]++;
      hls.h.push(h); hls.s.push(s); hls.l.push(l);
      n++;
    }
    if (!n) { console.log(name, ': no verts'); continue; }
    const avg = a => (a.reduce((x,y)=>x+y,0)/a.length).toFixed(2);
    const dist = Object.entries(zc).filter(([k,v])=>v>0).map(([k,v])=>`${ZN[k]}:${v}(${(v/n*100).toFixed(0)}%)`).join(' ');
    console.log(`${name}: n=${n}  ${dist}`);
    console.log(`   H avg=${avg(hls.h)}  S avg=${avg(hls.s)}  L avg=${avg(hls.l)}  L range=[${Math.min(...hls.l).toFixed(2)}..${Math.max(...hls.l).toFixed(2)}]`);
    // brightness outliers within SKIN
    const skinL = hls.l.filter((_,i)=>false); // placeholder
  }
})().catch(e => { console.error(e); process.exit(1); });
