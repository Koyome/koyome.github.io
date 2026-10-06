/* _shot-polish.js — visual baseline / regression shots for the R29 typography &
   design-language polish. Drives headless Edge over CDP.
   usage: node _shot-polish.js <outDir> */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9334;
const BASE = process.env.KOYOME_BASE || 'http://127.0.0.1:8890';
const outDir = process.argv[2] || '_shots29';
fs.mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const SPECS = [
  { name: 'home-desk-light', url: '/index.html', theme: 'light', w: 1440, h: 1000 },
  { name: 'home-desk-dark', url: '/index.html', theme: 'dark', w: 1440, h: 1000 },
  { name: 'home-mob-light', url: '/index.html', theme: 'light', w: 390, h: 844 },
  { name: 'home-desk-sigil', url: '/index.html', theme: 'light', w: 1440, h: 1000, scrollTo: '.home-sigil' },
  { name: 'home-desk-cat', url: '/index.html', theme: 'light', w: 1440, h: 1000, scrollTo: '.home-catalog' },
  { name: 'home-desk-hob', url: '/index.html', theme: 'light', w: 1440, h: 1000, scrollTo: '.home-hobbies' },
  { name: 'catalog-desk-light', url: '/catalog.html', theme: 'light', w: 1440, h: 1100 },
  { name: 'catalog-mob-light', url: '/catalog.html', theme: 'light', w: 390, h: 844 },
  { name: 'entry-t1-light', url: '/entry.html?id=t1', theme: 'light', w: 1440, h: 1100 },
  { name: 'entry-i1-light', url: '/entry.html?id=i1', theme: 'light', w: 1440, h: 1100 },
  { name: 'entry-v1-dark', url: '/entry.html?id=v1', theme: 'dark', w: 1440, h: 1100 },
  { name: 'guestbook-light', url: '/guestbook.html', theme: 'light', w: 1440, h: 1100 },
  { name: 'hobbies-desk-light', url: '/hobbies.html', theme: 'light', w: 1440, h: 1100 },
  { name: 'hobbies-mob-light', url: '/hobbies.html', theme: 'light', w: 390, h: 844 },
  { name: 'admin-desk-light', url: '/admin.html', theme: 'light', w: 1440, h: 1200 },
];

async function getWsUrl() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await r.json();
      return j.webSocketDebuggerUrl;
    } catch { await sleep(300); }
  }
  throw new Error('edge CDP not reachable');
}

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

(async () => {
  const edge = spawn(EDGE, [
    '--headless=new', `--remote-debugging-port=${PORT}`,
    '--no-first-run', '--disable-extensions', 'about:blank',
  ], { stdio: 'ignore' });

  try {
    const wsUrl = await getWsUrl();
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => (ws.onopen = r));

    for (const s of SPECS) {
      const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
      await send(ws, 'Page.enable', {}, sessionId);
      await send(ws, 'Emulation.setDeviceMetricsOverride',
        { width: s.w, height: s.h, deviceScaleFactor: 1, mobile: s.w < 700 }, sessionId);
      await send(ws, 'Page.addScriptToEvaluateOnNewDocument', {
        source: `try{localStorage.setItem("koyome_theme","${s.theme}")}catch(_){}`,
      }, sessionId);
      await send(ws, 'Page.navigate', { url: BASE + s.url }, sessionId);
      await sleep(s.wait || 3800);
      if (s.scrollTo) {
        await send(ws, 'Runtime.evaluate', {
          expression: `(()=>{const e=document.querySelector(${JSON.stringify(s.scrollTo)});if(e){const r=e.getBoundingClientRect();window.scrollTo(0, window.scrollY + r.top - 40);return r.top;}return -1;})()`,
        }, sessionId);
        await sleep(1200);
      }
      const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' }, sessionId);
      fs.writeFileSync(path.join(outDir, s.name + '.png'), Buffer.from(shot.data, 'base64'));
      console.log('OK', s.name);
      await send(ws, 'Target.closeTarget', { targetId });
    }
    ws.close();
  } finally {
    edge.kill();
  }
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
