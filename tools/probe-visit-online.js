/* ============================================================
   probe-visit-online.js — the ONLINE half of the visitor roll.

   Two things nobody has been able to see yet:

   1. Does the beacon actually fire on the public static site, and
      does it send a well-formed registration to the cloud table?
      (Served from a bare static server so `api/content` 404s — that
      is exactly the GitHub Pages condition.)

   2. Does the address come out as 广东省深圳市南山区 with
      coordinates? (Uses a throwaway copy of server.js to reach the
      formatting helpers without running a second real server.)

   Run: node tools/probe-visit-online.js
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const STATIC_PORT = 8933;
const UNIT_PORT = 8934;
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra ? '  → ' + extra : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ================= 1. address formatting ================= */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'koyome-fmt-'));
let fmtOk = false;
try {
  let src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');
  src += '\nmodule.exports = { placeOf, latlonOf, stampOf };\n';
  fs.writeFileSync(path.join(TMP, 'server.js'), src);
  const saved = process.env.PORT;
  process.env.PORT = String(UNIT_PORT);
  const mod = require(path.join(TMP, 'server.js'));   /* starts a throwaway server */
  process.env.PORT = saved;

  const p1 = mod.placeOf({ country: '中国', region: '广东', city: '深圳市', district: '南山区' });
  ok(p1 === '广东省深圳市南山区', '省 + 市 + 区 reads as one Chinese address', p1);

  const p2 = mod.placeOf({ country: '中国', region: '浙江', city: '杭州', district: '' });
  ok(p2 === '浙江省杭州市', 'a missing 省/市 suffix is filled in', p2);

  const p3 = mod.placeOf({ country: '美国', region: '弗吉尼亚州', city: 'Ashburn', district: '' });
  ok(p3.indexOf('美国') === 0 && p3.indexOf('Ashburn') > -1, 'non-Chinese addresses keep their own shape', p3);

  const p4 = mod.placeOf({ country: '中国', region: '北京市', city: '北京市', district: '丰台区' });
  ok(p4 === '北京市丰台区', 'a 直辖市 is not given a 省 suffix', p4);

  const ll = mod.latlonOf({ lat: 22.5431, lon: 114.0579 });
  ok(/^22\.5431, 114\.0579$/.test(ll), 'coordinates render as "lat, lon"', ll);
  ok(mod.latlonOf({ lat: null, lon: null }) === '', 'no coordinates → empty, not "null"');
  fmtOk = true;
  process.exitCode = 0;
} catch (e) {
  ok(false, 'formatting helpers could not be loaded', e.message);
}
fs.rmSync(TMP, { recursive: true, force: true });

/* ================= 2. the beacon on a static site ================= */
(async () => {
  /* --- a bare static server: no /api, exactly like GitHub Pages --- */
  const docsDir = path.join(ROOT, 'docs');
  const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8' };
  const stat = http.createServer((req, res) => {
    const p = decodeURIComponent(req.url.split('?')[0]);
    const f = path.join(docsDir, p === '/' ? 'index.html' : p);
    if (!f.startsWith(docsDir)) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('404'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
      res.end(buf);
    });
  });
  await new Promise((r) => stat.listen(STATIC_PORT, '127.0.0.1', r));

  const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9345',
    '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });

  let msgId = 0;
  function send(ws, method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++msgId;
      const onMsg = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.id === id) {
          ws.removeEventListener('message', onMsg);
          m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result);
        }
      };
      ws.addEventListener('message', onMsg);
      ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }

  try {
    let wsUrl;
    for (let i = 0; i < 40; i++) {
      try { wsUrl = (await (await fetch('http://127.0.0.1:9345/json/version')).json()).webSocketDebuggerUrl; break; }
      catch (_) { await sleep(300); }
    }
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => (ws.onopen = r));

    const seen = [];        /* every outbound request the page makes */
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Network.requestWillBeSent') {
        seen.push({ url: m.params.request.url, method: m.params.request.method, body: m.params.request.postData || '' });
      }
    });

    const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
    await send(ws, 'Page.enable', {}, sessionId);
    await send(ws, 'Network.enable', {}, sessionId);
    /* an ordinary phone, not "HeadlessChrome" — the beacon (rightly)
       ignores crawlers and our own headless probes */
    await send(ws, 'Network.setUserAgentOverride', {
      userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15' +
        ' (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      platform: 'iPhone',
    }, sessionId);
    await send(ws, 'Emulation.setDeviceMetricsOverride',
      { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
    await send(ws, 'Page.navigate', { url: `http://127.0.0.1:${STATIC_PORT}/index.html` }, sessionId);
    await sleep(12000);   /* three fallbacks, 4.5s each worst case */

    /* the page must first discover there is no API, then look up its address */
    const apiProbe = seen.find((r) => /\/api\/content/.test(r.url));
    ok(!!apiProbe, 'the page probed for the local API (and found none)', apiProbe && apiProbe.url);

    const ipLook = seen.find((r) => /ipwho\.is|ipify|freeipapi|jsonip/.test(r.url));
    ok(!!ipLook, 'the beacon asked a public service for its own address', ipLook && ipLook.url);

    /* …and then register itself in the cloud table */
    const reg = seen.find((r) => /\/rest\/v1\/visits/.test(r.url) && r.method === 'POST');
    ok(!!reg, 'the beacon POSTed a visit to the cloud table', reg && reg.url);
    if (reg) {
      let body = {};
      try { body = JSON.parse(reg.body); } catch (_) { /* malformed */ }
      ok(/^\d+\.\d+\.\d+\.\d+$/.test(String(body.ip || '')),
        'the registration carries a real public address', String(body.ip));
      ok(typeof body.page === 'string' && body.page.length > 0, 'and the page it happened on', body.page);
      ok(typeof body.ua === 'string' && body.ua.length > 0, 'and the device that made it');
    }

    /* one registration per half hour, not one per page view */
    await send(ws, 'Page.navigate', { url: `http://127.0.0.1:${STATIC_PORT}/catalog.html` }, sessionId);
    await sleep(3500);
    const posts = seen.filter((r) => /\/rest\/v1\/visits/.test(r.url) && r.method === 'POST').length;
    ok(posts === 1, 'a second page view does not register again', 'posts=' + posts);

    ws.close();
  } catch (e) {
    ok(false, 'beacon harness threw', e.message);
  } finally {
    edge.kill();
    stat.close();
  }

  console.log('\n' + (fail ? fail + ' FAILURE(S)' : 'online-visit suite clean') + '   (' + pass + ' passed)');
  process.exit(fail ? 1 : 0);
})();
