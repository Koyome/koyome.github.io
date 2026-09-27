// Inspect GLB structure: nodes, meshes, materials, textures, bounds
const { NodeIO, getBounds } = require('@gltf-transform/core');
const { ALL_EXTENSIONS } = require('@gltf-transform/extensions');

async function inspect(path) {
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const doc = await io.read(path);
  const root = doc.getRoot();
  const scene = root.getDefaultScene() || root.listScenes()[0];
  const b = getBounds(scene);
  console.log('\n===== ' + path + ' =====');
  console.log('scene bounds min:', b.min.map(v => v.toFixed(3)).join(', '));
  console.log('scene bounds max:', b.max.map(v => v.toFixed(3)).join(', '));
  console.log('height:', (b.max[1] - b.min[1]).toFixed(3), 'width:', (b.max[0] - b.min[0]).toFixed(3), 'depth:', (b.max[2] - b.min[2]).toFixed(3));

  console.log('\n-- nodes (' + root.listNodes().length + ') --');
  for (const n of root.listNodes()) {
    const mesh = n.getMesh();
    const t = n.getTranslation().map(v => +v.toFixed(3));
    console.log(`  node "${n.getName()}" mesh=${mesh ? '"' + (mesh.getName() || 'unnamed') + '"' : '-'} t=[${t}] children=${n.listChildren().length}`);
  }

  console.log('\n-- meshes/primitives --');
  for (const m of root.listMeshes()) {
    for (const [pi, p] of m.listPrimitives().entries()) {
      const pos = p.getAttribute('POSITION');
      const mat = p.getMaterial();
      // per-primitive bounds
      let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
      if (pos) {
        const arr = pos.getArray();
        for (let i = 0; i < arr.length; i += 3) {
          for (let k = 0; k < 3; k++) {
            if (arr[i + k] < mn[k]) mn[k] = arr[i + k];
            if (arr[i + k] > mx[k]) mx[k] = arr[i + k];
          }
        }
      }
      console.log(`  mesh "${m.getName()}" prim#${pi} verts=${pos ? pos.getCount() : 0} mat="${mat ? mat.getName() : 'NONE'}" y=[${mn[1].toFixed(2)}..${mx[1].toFixed(2)}] x=[${mn[0].toFixed(2)}..${mx[0].toFixed(2)}] z=[${mn[2].toFixed(2)}..${mx[2].toFixed(2)}]`);
    }
  }

  console.log('\n-- materials (' + root.listMaterials().length + ') --');
  for (const mt of root.listMaterials()) {
    const bct = mt.getBaseColorTexture();
    console.log(`  "${mt.getName()}" baseColor=${mt.getBaseColorFactor().map(v => +v.toFixed(2))} metallic=${mt.getMetallicFactor().toFixed(2)} roughness=${mt.getRoughnessFactor().toFixed(2)} emissive=${mt.getEmissiveFactor().map(v => +v.toFixed(2))} tex=${bct ? 'Y' : 'N'} doubleSided=${mt.getDoubleSided()} alpha=${mt.getAlphaMode()}`);
  }

  console.log('\n-- textures (' + root.listTextures().length + ') --');
  for (const tx of root.listTextures()) {
    console.log(`  "${tx.getName()}" ${tx.getMimeType()} ${(tx.getImage().byteLength / 1024).toFixed(0)}KB`);
  }
}

(async () => {
  await inspect(process.argv[2]);
})().catch(e => { console.error(e); process.exit(1); });
