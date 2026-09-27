// Compress v6 textures: baseColor + MR PNG → JPEG q93 (opaque model, no alpha needed)
// normal map stays PNG. Output: docs/assets/eris-figure-v6.glb
const fs = require('fs');
const { NodeIO } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');
const { PNG } = require('pngjs');
const jpeg = require('jpeg-js');

const SRC = process.argv[2] || 'tools/_analysis/v6-final.glb';
const OUT = process.argv[3] || 'docs/assets/eris-figure-v6.glb';

(async () => {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(SRC);
  const root = doc.getRoot();
  for (const tex of root.listTextures()) {
    const name = tex.getName() || '';
    if (tex.getMimeType() !== 'image/png') continue;
    if (name.includes('normal')) { console.log('keep PNG (normal):', name); continue; }
    const png = PNG.sync.read(Buffer.from(tex.getImage()));
    const raw = { data: Buffer.from(png.data), width: png.width, height: png.height };
    // strip alpha (force opaque) — jpeg-js ignores alpha anyway
    const enc = jpeg.encode(raw, 93);
    const before = tex.getImage().byteLength / 1048576;
    tex.setImage(new Uint8Array(enc.data.buffer, enc.data.byteOffset, enc.data.byteLength));
    tex.setMimeType('image/jpeg');
    console.log(`jpeg q93: ${name} ${before.toFixed(1)}MB -> ${(enc.data.length / 1048576).toFixed(1)}MB`);
  }
  await io.write(OUT, doc);
  console.log('wrote', OUT, (fs.statSync(OUT).size / 1048576).toFixed(1) + 'MB');
})().catch(e => { console.error(e); process.exit(1); });
