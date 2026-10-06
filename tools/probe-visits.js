/* ============================================================
   probe-visits.js — end-to-end test of the visitor roll.

   Runs against an ISOLATED copy of server.js + a throwaway docs/
   tree on a spare port, so the real docs/data/visits.json is never
   touched. The copy is patched in one place only: clientIp() reads
   a `x-test-ip` header, because a local test cannot originate a
   public address of its own.

   Run: node tools/probe-visits.js
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'koyome-visits-'));
const PORT = 8931;
const BASE = `http://127.0.0.1:${PORT}`;

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra ? '  → ' + extra : '')); }
}

/* ---------- build the sandbox ---------- */
const docsDir = path.join(TMP, 'docs');
fs.mkdirSync(path.join(docsDir, 'data'), { recursive: true });
fs.writeFileSync(path.join(docsDir, 'index.html'), '<!doctype html><title>t</title>');
fs.writeFileSync(path.join(docsDir, 'visits.html'), '<!doctype html><title>j</title>');

let src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
/* the single test-only patch: let the probe choose the visitor address */
const patched = src.replace(
  /function clientIp\(req\) \{[\s\S]*?\n\}/,
  `function clientIp(req) {\n  return (req.headers['x-test-ip'] || '').toString().trim()\n    || ((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');\n}`);
if (patched === src) { console.error('could not patch clientIp — aborting'); process.exit(1); }
fs.writeFileSync(path.join(TMP, 'server.js'), patched);

/* ---------- helpers ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

function get(p, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.get(BASE + p, { headers }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ code: res.statusCode, body }));
    });
    req.on('error', reject);
  });
}
const visits = async () => {
  const r = await get('/api/visits');
  try { return JSON.parse(r.body); } catch (_) { return []; }
};
const visitPage = async (ip, page = '/index.html', ua = UA) => {
  await get(page, { 'user-agent': ua, 'x-test-ip': ip });
  await sleep(60);
};

(async () => {
  const { spawn } = require('child_process');
  const node = process.execPath;
  const srv = spawn(node, [path.join(TMP, 'server.js')], {
    cwd: TMP, env: { ...process.env, PORT: String(PORT) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvLog = '';
  srv.stdout.on('data', (c) => { srvLog += c; });
  srv.stderr.on('data', (c) => { srvLog += c; });

  try {
    /* wait for the port */
    for (let i = 0; i < 40; i++) {
      try { await get('/api/visits'); break; } catch (_) { await sleep(200); }
    }

    /* ---- 1. a blank roll to start ---- */
    ok((await visits()).length === 0, 'roll starts empty');

    /* ---- 2. a public address gets recorded ---- */
    await visitPage('114.114.114.114');
    let list = await visits();
    ok(list.length === 1, 'one visitor recorded', JSON.stringify(list));
    ok(list[0] && list[0].ip === '114.114.114.114', 'address kept verbatim', list[0] && list[0].ip);
    ok(list[0] && list[0].lan === false, 'a public address is not marked as local');

    /* the place arrives asynchronously — give the lookup a moment */
    await sleep(4000);
    list = await visits();
    const row = list[0] || {};
    ok(!!row.country, 'country resolved', row.country);
    ok(!!row.city, 'city resolved', row.city);
    console.log('     place → ' + [row.country, row.region, row.city, row.district].filter(Boolean).join(' / ') +
      (row.district ? '' : '   (no district in the data for this address)'));

    /* ---- 3. the same visitor inside the merge window folds into one row ---- */
    await visitPage('114.114.114.114', '/visits.html');
    list = await visits();
    ok(list.length === 1, 'repeat visit does not create a second row', 'rows=' + list.length);
    ok(list[0] && list[0].count === 2, 'counter went up', list[0] && list[0].count);
    ok(list[0] && Array.isArray(list[0].pages) && list[0].pages.length === 2,
      'both pages remembered', JSON.stringify(list[0] && list[0].pages));

    /* ---- 4. a different address is a different visitor ---- */
    await visitPage('223.5.5.5');
    list = await visits();
    ok(list.length === 2, 'a second address adds a row', 'rows=' + list.length);

    /* ---- 5. private / LAN addresses degrade instead of failing ---- */
    await visitPage('192.168.1.77');
    await sleep(600);
    list = await visits();
    const lan = list.find((v) => v.ip === '192.168.1.77');
    ok(!!lan, 'a LAN visitor is still recorded');
    ok(lan && lan.lan === true, 'LAN visitor flagged as local', lan && String(lan.lan));
    ok(lan && !lan.district, 'no bogus place invented for a LAN address', lan && lan.district);

    /* ---- 6. crawlers are not visitors ---- */
    const before = (await visits()).length;
    await visitPage('8.8.8.8', '/index.html', 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)');
    await sleep(200);
    ok((await visits()).length === before, 'a crawler is not counted as a visitor');

    /* ---- 7. the roll survives a restart (it is a file, not memory) ---- */
    const kept = (await visits()).length;
    srv.kill();
    await sleep(500);
    const srv2 = spawn(node, [path.join(TMP, 'server.js')], {
      cwd: TMP, env: { ...process.env, PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    for (let i = 0; i < 40; i++) {
      try { await get('/api/visits'); break; } catch (_) { await sleep(200); }
    }
    ok((await visits()).length === kept, 'the roll is persisted to disk', 'kept=' + kept);

    /* ---- 8. clearing ---- */
    await new Promise((resolve) => {
      const req = http.request(BASE + '/api/visits', { method: 'DELETE' }, (res) => {
        res.resume(); res.on('end', resolve);
      });
      req.end();
    });
    ok((await visits()).length === 0, 'clear empties the roll');
    ok(fs.existsSync(path.join(docsDir, 'data', 'visits.json')), 'visits.json exists on disk');

    srv2.kill();

    const crashed = /Error|throw|uncaught/i.test(srvLog);
    ok(!crashed, 'server log clean', srvLog.slice(0, 300));
  } catch (e) {
    fail++;
    console.log('FAIL harness threw — ' + e.message);
  } finally {
    try { srv.kill(); } catch (_) { /* already gone */ }
  }

  console.log('\n' + (fail ? fail + ' FAILURE(S)' : 'visits suite clean') + '   (' + pass + ' passed)');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();
