/* audit-links.js — link & reference integrity for docs/:
   - every local src/href/url()/data-json asset path points at a real file
   - every <img data-dark-src> variant exists
   - CSS selectors defined twice at top level (possible silent override)
   - duplicate element ids inside one HTML file
   Read-only. usage: node tools/audit-links.js */
const fs = require('fs');
const path = require('path');
const PUB = path.join(__dirname, '..', 'docs');
const exists = (rel) => fs.existsSync(path.join(PUB, rel));

let issues = 0;
const bad = (msg) => { console.log('MISSING  ' + msg); issues++; };

/* ---------- HTML ---------- */
const htmls = fs.readdirSync(PUB).filter((f) => f.endsWith('.html'));
for (const f of htmls) {
  const t = fs.readFileSync(path.join(PUB, f), 'utf8');
  let m;
  const re = /(?:src|href)="([^"#][^"]*)"/g;
  while ((m = re.exec(t))) {
    const v = m[1];
    if (/^(https?:|data:|mailto:|javascript:|#)/i.test(v)) continue;
    const rel = v.split('?')[0].split('#')[0];
    if (!rel || rel.startsWith('/')) continue;
    if (!exists(rel)) bad(`${f} -> ${v}`);
  }
  /* dark variants */
  const darkRe = /data-dark-src="([^"]+)"/g;
  while ((m = darkRe.exec(t))) if (!exists(m[1])) bad(`${f} data-dark-src -> ${m[1]}`);
  /* duplicate ids */
  const ids = [...t.matchAll(/\sid="([^"]+)"/g)].map((x) => x[1]);
  const seen = new Set();
  for (const id of ids) {
    if (seen.has(id)) { console.log('DUP ID  ' + f + ' #' + id); issues++; }
    seen.add(id);
  }
}

/* ---------- CSS url() ---------- */
const cssDir = path.join(PUB, 'css');
for (const f of fs.readdirSync(cssDir)) {
  let t = fs.readFileSync(path.join(cssDir, f), 'utf8');
  let m;
  /* An inline SVG carried in a data: URI has its own url(#id) filter
     references, and those are not assets. Blank the data: payload
     first so the scan below only ever sees real paths. */
  t = t.replace(/url\(\s*(['"]?)data:[\s\S]*?\1\s*\)/gi, '');
  t = t.replace(/(['"]?)data:[a-z0-9+\-\/.]+;/gi, '$1inline;');
  const re = /url\(\s*'?([^')]+)'?\s*\)/g;
  while ((m = re.exec(t))) {
    const v = m[1];
    if (/^(https?:|data:|#|var\()/i.test(v)) continue;
    if (!exists(v)) bad(`css/${f} url(${v})`);
  }
  /* top-level duplicate selectors */
  const body = t.replace(/@media[^{]*\{([\s\S]*?)\n\}/g, '');   /* drop @media bodies */
  const dupes = new Map();
  for (const mm of body.matchAll(/([^{}@]+)\{[^}]*\}/g)) {
    const sel = mm[1].trim().replace(/\s+/g, ' ');
    if (!sel) continue;
    dupes.set(sel, (dupes.get(sel) || 0) + 1);
  }
  for (const [sel, n] of dupes) if (n > 1) console.log('DUP CSS SELECTOR (x' + n + '): ' + sel);
}

/* ---------- data json asset fields ---------- */
const dataDir = path.join(PUB, 'data');
for (const f of fs.readdirSync(dataDir).filter((x) => x.endsWith('.json'))) {
  const t = fs.readFileSync(path.join(dataDir, f), 'utf8');
  let m;
  const re = /"(?:src|avatar|cover)":\s*"([^"]+)"/g;
  while ((m = re.exec(t))) {
    const v = m[1];
    if (/^(https?:|data:)/i.test(v)) continue;
    if (!exists(v)) bad(`data/${f} -> ${v}`);
  }
}

console.log(issues ? '\n' + issues + ' ISSUES' : '\nNO ISSUES');
