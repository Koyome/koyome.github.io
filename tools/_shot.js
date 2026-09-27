// Generic GLB screenshot rig: node tools/_shot.js <glbUrlPath> <outPrefix> [w h]
// Serves docs/ and tools/_analysis/ over HTTP, renders with model-viewer, 4 standard views.
const http = require('http'), fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
const ROOTS = [path.join(__dirname, '..', 'docs'), path.join(__dirname, '_analysis')];
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.glb': 'model/gltf-binary', '.png': 'image/png' };

const glbPath = '/' + (process.argv[2] || '').replace(/^[A-Za-z]:[\/\\].*?1\.2\.0[\/\\]/, '').replace(/^[\/\\]+/, '').replace(/\\/g, '/');
const prefix = process.argv[3] || 'shot';
const VW = +(process.argv[4] || 1100), VH = +(process.argv[5] || 1100);

const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  console.log('[req]', p);
  req.on('aborted', () => console.log('[aborted]', p));
  res.on('error', (e) => console.log('[res error]', p, e.message));
  res.on('finish', () => console.log('[done]', p, res.statusCode));
  if (p === '/' || p === '/view') {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<!DOCTYPE html><html><head><meta charset="utf-8"><style>html,body{margin:0;height:100%;background:#888}model-viewer{width:100vw;height:100vh}</style>
<script type="module" src="/components/model-viewer.min.js"></script></head><body>
<model-viewer id="v" src="${glbPath}" camera-controls shadow-intensity="1" exposure="1.05" interaction-prompt="none" loading="eager"></model-viewer>
</body></html>`);
    return;
  }
  for (const root of ROOTS) {
    const f = path.join(root, p);
    if (f.startsWith(root) && fs.existsSync(f) && !fs.statSync(f).isDirectory()) {
      res.writeHead(200, { 'Content-Type': MIME[path.extname(f).toLowerCase()] || 'application/octet-stream', 'Content-Length': fs.statSync(f).size });
      fs.createReadStream(f).pipe(res); return;
    }
  }
  res.writeHead(404); res.end();
});

let id = 0;
const send = (ws, m, p = {}, s) => new Promise((res, rej) => {
  const i = ++id;
  const on = (ev) => { const x = JSON.parse(ev.data); if (x.id === i) { ws.removeEventListener('message', on); x.error ? rej(new Error(x.error.message)) : res(x.result); } };
  ws.addEventListener('message', on);
  ws.send(JSON.stringify({ id: i, method: m, params: p, sessionId: s }));
});

(async () => {
  await new Promise(r => srv.listen(8931, r));
  const env = { ...process.env };
  for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'all_proxy']) delete env[k];
  const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9326', '--no-first-run', '--no-proxy-server', `--window-size=${VW},${VH}`, 'about:blank'], { stdio: 'ignore', env });
  let wsUrl;
  for (let i = 0; i < 40; i++) { try { wsUrl = (await (await fetch('http://127.0.0.1:9326/json/version')).json()).webSocketDebuggerUrl; break; } catch { await sleep(300); } }
  const ws = new WebSocket(wsUrl); await new Promise(r => ws.onopen = r);
  const { targetId } = await send(ws, 'Target.createTarget', { url: 'http://127.0.0.1:8931/view' });
  const { sessionId: sid } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
  await send(ws, 'Runtime.enable', {}, sid);
  await send(ws, 'Network.enable', {}, sid);
  ws.addEventListener('message', (ev) => {
    const x = JSON.parse(ev.data);
    if (x.method === 'Network.requestWillBeSent') console.log('[net req]', x.params.request.url.slice(0, 120));
    if (x.method === 'Network.loadingFailed') console.log('[net FAIL]', (x.params.errorText || ''), (x.params.blockedReason || ''));
    if (x.method === 'Network.responseReceived') console.log('[net res]', x.params.response.status, x.params.response.url.slice(0, 100));
  });
  ws.addEventListener('message', (ev) => {
    const x = JSON.parse(ev.data);
    if (x.method === 'Runtime.consoleAPICalled') {
      const args = (x.params.args || []).map(a => a.value !== undefined ? a.value : (a.description || a.type)).join(' ');
      console.log('[console.' + x.params.type + ']', args.slice(0, 300));
    }
    if (x.method === 'Runtime.exceptionThrown') {
      console.log('[exception]', JSON.stringify(x.params.exceptionDetails).slice(0, 400));
    }
  });
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, sid)).result.value;
  // wait for page parse
  for (let i = 0; i < 60; i++) {
    const ready = await ev(`document.readyState + ':' + !!document.getElementById('v')`).catch(() => '');
    if (String(ready).endsWith(':true')) break;
    await sleep(500);
  }
  console.log('page url:', await ev(`location.href`));
  console.log('base uri:', await ev(`document.baseURI`));
  console.log('mv src attr:', await ev(`(document.getElementById('v')||{}).getAttribute ? document.getElementById('v').getAttribute('src') : 'n/a'`));
  const loaded = await ev(`new Promise(r=>{const v=document.getElementById('v');if(!v){r('no-element');return;}if(v.loaded){r('already');return;}v.addEventListener('load',()=>r('event'));v.addEventListener('error',(e)=>r('error:'+(e.detail&&e.detail.type||'')));setTimeout(()=>r('timeout'),90000)})`);
  console.log('model load status:', loaded);
  await sleep(800);
  const outDir = path.join(__dirname, '_analysis');
  const shot = async (n) => { const s = await send(ws, 'Page.captureScreenshot', { format: 'png' }, sid); fs.writeFileSync(path.join(outDir, n), Buffer.from(s.data, 'base64')); };
  const cam = async (t, o, ms) => { await ev(`(()=>{const v=document.getElementById('v');v.cameraTarget='${t}';v.cameraOrbit='${o}';v.jumpCameraToGoal();return 1})()`); await sleep(ms || 700); };
  const c = await ev(`(()=>{const v=document.getElementById('v');const b=v.getBoundingBoxCenter();return b.x+','+b.y+','+b.z})()`);
  const [cx, cy, cz] = c.split(',').map(Number);
  const H = (cy * 2).toFixed(3);
  await cam(`${cx}m ${cy}m ${cz}m`, '8deg 82deg 2.6m'); await shot(`${prefix}-front.png`);
  await cam(`${cx}m ${cy}m ${cz}m`, '98deg 82deg 2.6m'); await shot(`${prefix}-side.png`);
  await cam(`${cx}m ${cy}m ${cz}m`, '188deg 82deg 2.6m'); await shot(`${prefix}-back.png`);
  await cam(`${cx}m ${(cy * 1.6).toFixed(3)}m ${cz}m`, '8deg 84deg 0.55m'); await shot(`${prefix}-face.png`);
  await cam(`${cx}m ${(cy * 1.62).toFixed(3)}m ${cz}m`, '8deg 84deg 0.28m'); await shot(`${prefix}-eyes.png`);
  await cam(`${cx}m ${(cy * 0.95).toFixed(3)}m ${cz + 0.15}m`, '15deg 78deg 0.6m'); await shot(`${prefix}-hands.png`);
  console.log('shots ok, center', c, 'height', H);
  edge.kill(); srv.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
