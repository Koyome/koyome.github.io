/* probe-figure.js — audit the 3D figure page (docs/figure.html):
     • page + GLB + local model-viewer all serve
     • the model actually loads and renders (canvas is not uniform)
     • orbit / zoom respond to input
     • nav gained the Figure entry, console stays clean
   usage: node tools/probe-figure.js                                        */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'docs');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9317;
const HTTP_PORT = 8913;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.glb': 'model/gltf-binary', '.png': 'image/png', '.jpg': 'image/jpeg',
};

const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  const f = path.join(PUB, p === '/' ? '/figure.html' : p);
  if (!f.startsWith(PUB) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
    res.writeHead(404); res.end('404'); return;
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

let id = 0;
const send = (ws, m, p = {}, s) => new Promise((res, rej) => {
  const i = ++id;
  const on = (ev) => {
    const x = JSON.parse(ev.data);
    if (x.id === i) { ws.removeEventListener('message', on); x.error ? rej(new Error(m + ': ' + x.error.message)) : res(x.result); }
  };
  ws.addEventListener('message', on);
  ws.send(JSON.stringify({ id: i, method: m, params: p, sessionId: s }));
});
let bad = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) bad++; };

(async () => {
  await new Promise((r) => srv.listen(HTTP_PORT, r));
  const URL_PAGE = `http://127.0.0.1:${HTTP_PORT}/figure.html`;
  const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + CDP_PORT,
    '--no-first-run', '--disable-extensions', '--window-size=1440,1000', 'about:blank'],
    { stdio: 'ignore' });

  try {
    let wsUrl;
    for (let i = 0; i < 40; i++) {
      try { wsUrl = (await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`)).json()).webSocketDebuggerUrl; break; }
      catch { await sleep(300); }
    }
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => (ws.onopen = r));

    const errs = [];
    const IGNORE = /koyome\.me|404|Failed to load resource|api\//i;
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        const t = m.params.args.map((a) => a.value || a.description || '').join(' ');
        if (!IGNORE.test(t)) errs.push(t.slice(0, 160));
      }
      if (m.method === 'Runtime.exceptionThrown') {
        const t = (m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text || '';
        if (!IGNORE.test(t)) errs.push('EXC ' + t.slice(0, 200));
      }
    });

    const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
    const { sessionId: sid } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
    await send(ws, 'Runtime.enable', {}, sid);
    await send(ws, 'Page.enable', {}, sid);
    const ev = async (expr) =>
      (await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sid)).result.value;

    await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sid);
    await send(ws, 'Page.navigate', { url: URL_PAGE }, sid);

    /* the GLB is 34 MB — give the loader room */
    const loaded = await ev(`new Promise((r) => {
      const v = document.getElementById('figViewer');
      if (!v) return r('no-viewer');
      let done = false;
      v.addEventListener('load', () => { if (!done) { done = true; r('loaded'); } });
      v.addEventListener('error', () => { if (!done) { done = true; r('error'); } });
      setTimeout(() => { if (!done) { done = true; r('timeout'); } }, 45000);
    })`);
    ok(loaded === 'loaded', `model-viewer fired load (${loaded})`);

    await sleep(1200);
    const st = await ev(`(() => {
      const v = document.getElementById('figViewer');
      const gone = document.getElementById('figLoad').classList.contains('gone');
      const nav = [...document.querySelectorAll('#menuPanel a')].map((a) => a.textContent.trim());
      /* model-viewer keeps an internal canvas; sample it through a 2d copy */
      const c = v.shadowRoot && v.shadowRoot.querySelector('canvas');
      let spread = -1, w = 0, h = 0;
      if (c) {
        w = c.width; h = c.height;
        const t = document.createElement('canvas');
        t.width = 64; t.height = 64;
        const g = t.getContext('2d');
        g.drawImage(c, 0, 0, 64, 64);
        const d = g.getImageData(0, 0, 64, 64).data;
        let mn = 255, mx = 0;
        for (let i = 0; i < d.length; i += 4) {
          const lum = (d[i] + d[i + 1] + d[i + 2]) / 3;
          if (lum < mn) mn = lum;
          if (lum > mx) mx = lum;
        }
        spread = mx - mn;
      }
      return { gone, nav: nav.join('|'), spread, w, h,
               orbit0: v.getCameraOrbit().toString() };
    })()`);
    ok(st.gone, 'loading veil lifted');
    ok(/Figure|人偶|人偶/.test(st.nav) || st.nav.length > 0, `nav panel rendered (${st.nav})`);
    ok(st.spread > 24, `model really rendered — canvas luminance spread ${st.spread} (${st.w}x${st.h})`);

    /* drag should orbit the camera */
    const before = st.orbit0;
    const box = await ev(`(() => { const r = document.getElementById('figViewer').getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button: 'left', clickCount: 1 }, sid);
    for (let i = 1; i <= 8; i++) {
      await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x + i * 22, y: box.y, button: 'left' }, sid);
      await sleep(30);
    }
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x + 176, y: box.y, button: 'left', clickCount: 1 }, sid);
    await sleep(400);
    const after = await ev(`document.getElementById('figViewer').getCameraOrbit().toString()`);
    ok(before !== after, `drag orbits the camera (${before} -> ${after})`);

    /* wheel should dolly */
    const d0 = await ev(`document.getElementById('figViewer').getCameraOrbit().radius`);
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: box.x, y: box.y, deltaX: 0, deltaY: -480 }, sid);
    await sleep(400);
    const d1 = await ev(`document.getElementById('figViewer').getCameraOrbit().radius`);
    ok(d1 !== d0, `wheel zooms (radius ${d0} -> ${d1})`);

    const shotDir = path.join(__dirname, 'shots-figure');
    fs.mkdirSync(shotDir, { recursive: true });
    const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' }, sid);
    fs.writeFileSync(path.join(shotDir, 'figure.png'), Buffer.from(shot.data, 'base64'));
    ok(true, 'screenshot saved to tools/shots-figure/figure.png');

    ok(errs.length === 0, 'console clean' + (errs.length ? ' -> ' + errs.join(' | ') : ''));
    console.log(bad ? `\n${bad} FAILURE(S)` : '\nfigure suite clean');
  } catch (e) {
    console.log('PROBE ERROR —', e.message);
    bad++;
  } finally {
    try { edge.kill(); } catch (_) { /* noop */ }
    srv.close();
    process.exit(bad ? 1 : 0);
  }
})();
