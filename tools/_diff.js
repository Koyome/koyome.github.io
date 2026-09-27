// pixel diff between two PNGs, per-region stats
const fs = require('fs');
const { PNG } = require('pngjs');
const A = process.argv[2], B = process.argv[3];
const a = PNG.sync.read(fs.readFileSync(A));
const b = PNG.sync.read(fs.readFileSync(B));
if (a.width !== b.width || a.height !== b.height) { console.error('size mismatch'); process.exit(1); }
let sum = 0, n = 0, over30 = 0;
for (let i = 0; i < a.data.length; i += 4) {
  const dr = a.data[i] - b.data[i], dg = a.data[i+1] - b.data[i+1], db = a.data[i+2] - b.data[i+2];
  const d = Math.sqrt(dr*dr + dg*dg + db*db);
  sum += d; n++;
  if (d > 30) over30++;
}
console.log(`${A} vs ${B}`);
console.log(`  avg diff ${(sum/n).toFixed(2)}, >30 ${(over30/n*100).toFixed(2)}%`);
