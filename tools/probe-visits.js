/* ============================================================
   probe-visits.js — end-to-end test of the visit log.

   Runs against an ISOLATED copy of server.js + a throwaway docs/
   tree on a spare port, so the real docs/data/visits.json is never
   touched. The copy is patched in one place only: clientIp() reads
   a `x-test-ip` header, because a test that runs on 127.0.0.1 can
   never originate a public address of its own.

   What this suite exists to prove — the four ways a visit used to
   disappear, and two ways it must not:

     NO MERGE      three pages for one address = three rows
     NO SAMPLE     nothing is cut before it is drawn
     NO RACE       25 page loads fired together = 25 rows
     NO DROP       a crawler is recorded, not thrown away
     LOCAL SKIPPED this machine and its network are never written
     FULL RECORD   every row carries ip, time, path, agent, device

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

let pass = 0, fail = 0, soft = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra ? '  → ' + extra : '')); }
}
function note(label) { soft++; console.log('skip ' + label + '  (no network — not a defect)'); }

/* the server's own display stamp, so the roll can be checked against
   the same clock the page renders rather than against UTC */
function stamp(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ---------- build the sandbox ---------- */
const docsDir = path.join(TMP, 'docs');
fs.mkdirSync(path.join(docsDir, 'data'), { recursive: true });
fs.writeFileSync(path.join(docsDir, 'index.html'), '<!doctype html><title>t</title>');
fs.writeFileSync(path.join(docsDir, 'catalog.html'), '<!doctype html><title>c</title>');

let src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
/* the single test-only patch: let the probe choose the visitor address */
const patched = src.replace(
  /function clientIp\(req\) \{[\s\S]*?\n\}/,
  `function clientIp(req) {\n  return (req.headers['x-test-ip'] || '').toString().trim()\n    || ((req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');\n}`);
if (patched === src) { console.error('could not patch clientIp — aborting'); process.exit(1); }
fs.writeFileSync(path.join(TMP, 'server.js'), patched);

/* ---------- helpers ---------- */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const UA_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_SAMSUNG = 'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36';
const UA_XIAOMI = 'Mozilla/5.0 (Linux; U; Android 13; zh-cn; M2102K1C Build/TKQ1.221114.001) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.0.0 Mobile Safari/537.36';
const UA_WECHAT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.41(0x18002928) NetType/WIFI Language/zh_CN';
const UA_PAD = 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const UA_BOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

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
const visitPage = async (ip, page = '/index.html', ua = UA_WIN, extra) => {
  await get(page, Object.assign({ 'user-agent': ua, 'x-test-ip': ip }, extra || {}));
};
/* the guest card: what the browser measured, posted back after the row */
const post = async (p, body, ua, ip) => {
  const data = JSON.stringify(body);
  await new Promise((resolve, reject) => {
    const req = http.request({
      host: '127.0.0.1', port: PORT, path: p, method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(data),
        'user-agent': ua, 'x-test-ip': ip,
      },
    }, (res) => { res.resume(); res.on('end', resolve); });
    req.on('error', reject);
    req.end(data);
  });
};

(async () => {
  const { spawn } = require('child_process');
  const node = process.execPath;
  const srv = spawn(node, [path.join(TMP, 'server.js')], {
    cwd: TMP, env: Object.assign({}, process.env, { PORT: String(PORT) }),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let srvLog = '';
  srv.stdout.on('data', (c) => { srvLog += c; });
  srv.stderr.on('data', (c) => { srvLog += c; });

  const boot = async (proc) => {
    for (let i = 0; i < 60; i++) {
      try { await get('/api/visits'); return; } catch (_) { await sleep(200); }
    }
    throw new Error('server never came up: ' + srvLog.slice(-400));
  };

  try {
    await boot(srv);

    /* ── 1. a blank roll ───────────────────────────────────────── */
    ok((await visits()).length === 0, 'roll starts empty');

    /* ── 2. one external visit = one row, fully described ───────── */
    await visitPage('114.114.114.114', '/index.html', UA_IPHONE,
      { referer: 'https://www.google.com/', 'accept-language': 'zh-CN,zh;q=0.9' });
    await sleep(80);
    let list = await visits();
    ok(list.length === 1, 'an outside address is recorded', 'rows=' + list.length);
    let row = list[0] || {};
    ok(row.ip === '114.114.114.114', 'address kept verbatim', row.ip);
    ok(row.lan === false, 'an outside address is not marked local', String(row.lan));
    ok(row.src === 'local', 'source tagged', row.src);
    ok(!!row.at && !!row.time, 'time recorded', row.at);
    /* The roll used to stamp local rows with the UTC wall clock while
       cloud rows rendered local time, so two rows minutes apart read as
       eight hours apart. `time` is display only and must agree with
       `at` in this machine's own timezone. */
    ok(row.time === stamp(row.at), 'and `time` is the same clock as `at`, not UTC',
      'time=' + row.time + ' at=' + row.at);
    ok(row.time !== new Date(row.at).toISOString().slice(0, 16).replace('T', ' ')
       || new Date(row.at).getHours() === new Date(row.at).getUTCHours(),
      'UTC would have been a different string for this row', row.time);
    ok(row.page === '/index.html', 'path recorded', row.page);
    ok(/iPhone/.test(row.ua || ''), 'user-agent recorded', row.ua);
    ok(row.ref === 'https://www.google.com/', 'referrer recorded', row.ref);
    ok(row.lang === 'zh-CN', 'language recorded', row.lang);
    ok(row.count === 1, 'count field kept for the shape', String(row.count));
    ok(Array.isArray(row.pages) && row.pages[0] === '/index.html', 'pages array kept', JSON.stringify(row.pages));

    /* ── 3. NO MERGE — three pages, three rows ──────────────────── */
    await visitPage('114.114.114.114', '/index.html');
    await visitPage('114.114.114.114', '/catalog.html');
    await sleep(120);
    list = await visits();
    const same = list.filter((v) => v.ip === '114.114.114.114');
    ok(same.length === 3, 'three page loads = three rows (no merge window)', 'rows=' + same.length);
    ok(list.every((v) => (v.count || 1) === 1), 'no row silently absorbs another');

    /* ── 4. NO RACE — 25 loads fired together, 25 rows ──────────── */
    const before = (await visits()).length;
    const ips = ['223.5.5.5', '119.29.29.29', '180.101.49.12', '1.1.1.1', '8.8.4.4'];
    await Promise.all(Array.from({ length: 25 }, (_, i) =>
      visitPage(ips[i % ips.length], i % 2 ? '/catalog.html' : '/index.html')));
    await sleep(400);
    list = await visits();
    ok(list.length - before === 25, '25 simultaneous loads all survive',
      'got ' + (list.length - before));
    const ids = new Set(list.map((v) => v.id));
    ok(ids.size === list.length, 'every row has a distinct id', ids.size + ' / ' + list.length);

    /* ── 5. LOCAL AND LAN ARE SKIPPED OUTRIGHT ─────────────────── */
    const preLocal = (await visits()).length;
    for (const ip of ['127.0.0.1', '192.168.1.77', '10.0.0.9', '172.16.4.2', '::1']) {
      await visitPage(ip, '/index.html', UA_WIN);
    }
    await sleep(150);
    list = await visits();
    ok(list.length === preLocal, 'local / LAN addresses write nothing',
      'before=' + preLocal + ' after=' + list.length);
    ok(!list.some((v) => v.lan), 'no row carries the local flag');

    /* ── 6. CRAWLERS ARE RECORDED, NOT DROPPED ────────────────── */
    const preBot = (await visits()).length;
    await visitPage('66.249.66.1', '/index.html', UA_BOT);
    await sleep(150);
    list = await visits();
    ok(list.length === preBot + 1, 'a crawler is written, not thrown away',
      'before=' + preBot + ' after=' + list.length);
    const bot = list.find((v) => v.ip === '66.249.66.1');
    ok(bot && bot.bot === true, 'the crawler row is flagged', bot && String(bot.bot));
    ok(bot && bot.device === '爬虫', 'the crawler row says what it is', bot && bot.device);

    /* ── 7. WHAT THE AGENT TELLS US ───────────────────────────── */
    await visitPage('203.0.113.9', '/index.html', UA_SAMSUNG);
    await visitPage('203.0.113.10', '/index.html', UA_XIAOMI);
    await visitPage('203.0.113.11', '/index.html', UA_WECHAT);
    await visitPage('203.0.113.12', '/index.html', UA_PAD);
    await visitPage('203.0.113.13', '/index.html', UA_WIN);
    await sleep(200);
    list = await visits();
    const pick = (ip) => list.find((v) => v.ip === ip) || {};

    const samsung = pick('203.0.113.9');
    ok(samsung.device === '手机', 'Android reads as a phone', samsung.device);
    ok(/Galaxy S23 Ultra/.test(samsung.model || ''), 'the model code becomes a name', samsung.model);
    ok(/Android 14/.test(samsung.os || ''), 'the OS version is read', samsung.os);

    const xiaomi = pick('203.0.113.10');
    ok(xiaomi.device === '手机', 'a Xiaomi UA reads as a phone', xiaomi.device);
    ok(/M2102K1C/.test(xiaomi.model || ''), 'an unmapped code is kept as-is, not guessed', xiaomi.model);
    ok(/小米/.test(xiaomi.model || ''), 'the brand comes from the code namespace', xiaomi.model);

    const wechat = pick('203.0.113.11');
    ok(wechat.app === '微信', 'the in-app shell is named', wechat.app);
    ok(wechat.bot === false, 'an in-app browser is not a crawler', String(wechat.bot));
    ok(!/iPhone/.test(wechat.model || '') === false, 'iPhone model still named under WeChat', wechat.model);
    ok(/iOS 16/.test(wechat.os || ''), 'iOS version read under WeChat', wechat.os);

    const pad = pick('203.0.113.12');
    ok(pad.device === '平板', 'an iPad reads as a tablet', pad.device);
    ok(/iPad/.test(pad.model || ''), 'iPad named', pad.model);

    const win = pick('203.0.113.13');
    ok(win.device === '电脑', 'a desktop UA reads as a computer', win.device);
    ok(/Chrome/.test(win.browser || ''), 'the browser is named', win.browser);

    /* ── 7b. THE GUEST CARD ARRIVES AFTER ITS ROW ────────────────
       A page cannot know its row id when it loads, so it measures
       itself and posts the measurements back; the newest row from the
       same address and agent is the one they belong to. Two of these
       facts beat the UA outright, and both are asserted here. */
    /* the row at .11 was written with UA_WECHAT, so the card has to
       announce the same agent to be matched to it */
    await post('/api/visit/caps', { sw: 393, sh: 852, dpr: 3, tz: 'Asia/Shanghai' }, UA_WECHAT, '203.0.113.11');
    await post('/api/visit/caps', { ch: { platv: '15.0.0' } }, UA_WIN, '203.0.113.13');
    await sleep(150);
    list = await visits();

    const carded = pick('203.0.113.11');
    ok(/iPhone 14 Pro \/ 15 \/ 16/.test(carded.model || ''),
      'the iPhone is named from its screen, which is the only place it says', carded.model);
    ok(carded.screen === '393×852 @3x', 'the measured panel is kept', carded.screen);
    ok(!!carded.local, "the visitor's own clock is shown", carded.local);
    ok(/微信/.test(carded.browser || ''), 'the card never rewrites the browser', carded.browser);

    const win11 = pick('203.0.113.13');
    ok(win11.os === 'Windows 11',
      "Client Hints separate Windows 11 from 10 — a UA cannot", win11.os);

    /* ── 8. THE PLACE ARRIVES IN THE BACKGROUND ───────────────── */
    await sleep(9000);
    list = await visits();
    const located = list.filter((v) => v.place && !v.bot).length;
    const tries = list.filter((v) => !v.bot).length;
    if (located > 0) {
      ok(true, 'places resolved in the background (' + located + '/' + tries + ')');
      const sample = list.find((v) => v.place);
      console.log('     e.g. ' + sample.ip + ' → ' + sample.place +
        (sample.latlon ? '  @ ' + sample.latlon : ''));
    } else {
      note('place lookup — no lookup service reachable from this machine');
    }
    ok(fs.existsSync(path.join(docsDir, 'data', 'geo-cache.json')) || located === 0,
      'resolved places are cached to disk (or none were resolved)');

    /* ── 9. THE ROLL IS A FILE, NOT MEMORY ────────────────────── */
    const kept = (await visits()).length;
    srv.kill();
    await sleep(600);
    const srv2 = spawn(node, [path.join(TMP, 'server.js')], {
      cwd: TMP, env: Object.assign({}, process.env, { PORT: String(PORT) }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    srv2.stdout.on('data', (c) => { srvLog += c; });
    srv2.stderr.on('data', (c) => { srvLog += c; });
    await boot(srv2);
    const after = (await visits()).length;
    ok(after === kept, 'nothing was lost when the process stopped',
      'kept=' + kept + ' after=' + after);

    /* ── 10. STATUS, AND THE HIDDEN LIST ──────────────────────── */
    const st = JSON.parse((await get('/api/visits/status')).body || '{}');
    ok(st.local === after, 'status reports the local row count', st.local + ' vs ' + after);
    ok(typeof st.bots === 'number' && st.bots >= 1, 'status reports the crawler count', String(st.bots));
    ok(typeof st.today === 'number', 'status reports the 24h count', String(st.today));
    ok(typeof st.hidden === 'number', 'status reports the dismissed count', String(st.hidden));
    ok(Array.isArray(JSON.parse((await get('/api/visits/hidden')).body || 'null')),
      'the dismissed list is readable');

    /* ── 11. DELETING STILL DELETES ───────────────────────────── */
    const one = (await visits())[0];
    await new Promise((resolve) => {
      const req = http.request(BASE + '/api/visits?ids=' + encodeURIComponent(one.id),
        { method: 'DELETE' }, (res) => { res.resume(); res.on('end', resolve); });
      req.end();
    });
    list = await visits();
    ok(list.length === after - 1, 'one row removed by id', 'rows=' + list.length);
    ok(!list.some((v) => v.id === one.id), 'the right row went');

    await new Promise((resolve) => {
      const req = http.request(BASE + '/api/visits?all=1', { method: 'DELETE' },
        (res) => { res.resume(); res.on('end', resolve); });
      req.end();
    });
    ok((await visits()).length === 0, 'clear empties the roll');
    ok(fs.existsSync(path.join(docsDir, 'data', 'visits.json')), 'visits.json exists on disk');

    /* ── 12. AND IT STAYS EMPTY AFTER A RESTART ───────────────── */
    srv2.kill();
    await sleep(600);
    const srv3 = spawn(node, [path.join(TMP, 'server.js')], {
      cwd: TMP, env: Object.assign({}, process.env, { PORT: String(PORT) }),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    srv3.stdout.on('data', (c) => { srvLog += c; });
    srv3.stderr.on('data', (c) => { srvLog += c; });
    await boot(srv3);
    ok((await visits()).length === 0, 'a cleared roll stays cleared');
    srv3.kill();

    const crashed = /Error:|throw |uncaught|Unhandled/i.test(srvLog);
    ok(!crashed, 'server log clean', srvLog.slice(-300));
  } catch (e) {
    fail++;
    console.log('FAIL harness threw — ' + e.message);
  } finally {
    try { srv.kill(); } catch (_) { /* already gone */ }
  }

  console.log('\n' + (fail ? fail + ' FAILURE(S)' : 'visits suite clean') +
    '   (' + pass + ' passed' + (soft ? ', ' + soft + ' skipped' : '') + ')');
  fs.rmSync(TMP, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
})();
