// Debug: in-page fetch tests
const http = require('http'), fs = require('fs'), path = require('path');
const { spawn } = require('child_process');
const PUB = path.join(__dirname, '..', 'docs');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/small.txt') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('hello'); return; }
  const f = path.join(PUB, p);
  if (f.startsWith(PUB) && fs.existsSync(f) && !fs.statSync(f).isDirectory()) {
    res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': fs.statSync(f).size });
    fs.createReadStream(f).pipe(res); return;
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
  await new Promise(r => srv.listen(8924, r));
  const env = { ...process.env };
  for (const k of ['http_proxy', 'https_proxy', 'HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'all_proxy']) delete env[k];
  const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=9327', '--no-first-run', '--no-proxy-server', 'about:blank'], { stdio: 'ignore', env });
  let wsUrl;
  for (let i = 0; i < 40; i++) { try { wsUrl = (await (await fetch('http://127.0.0.1:9327/json/version')).json()).webSocketDebuggerUrl; break; } catch { await sleep(300); } }
  const ws = new WebSocket(wsUrl); await new Promise(r => ws.onopen = r);
  const { targetId } = await send(ws, 'Target.createTarget', { url: 'http://127.0.0.1:8924/small.txt' });
  const { sessionId: sid } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
  await send(ws, 'Runtime.enable', {}, sid);
  await sleep(1000);
  const ev = async (e) => (await send(ws, 'Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }, sid)).result.value;
  console.log('small fetch:', await ev(`fetch('/small.txt').then(r=>r.text()).then(t=>'ok:'+t).catch(e=>'fail:'+e.message)`));
  console.log('glb HEAD-ish fetch:', await ev(`fetch('/assets/eris-figure-v5.glb',{method:'HEAD'}).then(r=>'ok:'+r.status).catch(e=>'fail:'+e.message)`));
  console.log('glb full fetch:', await ev(`fetch('/assets/eris-figure-v5.glb').then(r=>r.arrayBuffer()).then(b=>'ok:'+b.byteLength).catch(e=>'fail:'+e.message)`));
  edge.kill(); srv.close(); process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
