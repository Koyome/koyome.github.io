const fs = require('fs');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
(async () => {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read('docs/assets/eris-figure-v5.glb');
  const prim = doc.getRoot().listMeshes()[0].listPrimitives()[0];
  const pos = prim.getAttribute('POSITION').getArray();
  const nV = pos.length / 3;
  const bins = {};
  for (let v = 0; v < nV; v++) { const y = pos[v * 3 + 1]; const b = Math.floor(y * 10); bins[b] = (bins[b] || 0) + 1; }
  const keys = Object.keys(bins).map(Number).sort((a, b) => a - b);
  console.log('Y histogram (bin=0.1):');
  for (const k of keys) console.log(`  ${(k / 10).toFixed(1)}..${(k / 10 + 0.1).toFixed(1)}: ${bins[k]}`);
})().catch(e => { console.error(e); process.exit(1); });
