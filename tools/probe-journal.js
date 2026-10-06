/* ============================================================
   probe-journal.js — the ledger page, checked in a real browser.
   Needs the local server up (http://127.0.0.1, port 80).
   ============================================================ */
const { spawn } = require('child_process');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9341;
const BASE = process.env.KOYOME_BASE || 'http://127.0.0.1';

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra ? '  → ' + extra : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
  const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${PORT}`,
    '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });
  try {
    let wsUrl;
    for (let i = 0; i < 40; i++) {
      try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl; break; }
      catch (_) { await sleep(300); }
    }
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => (ws.onopen = r));

    const errs = [];
    async function open(w, h, mobile) {
      const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
      await send(ws, 'Page.enable', {}, sessionId);
      await send(ws, 'Runtime.enable', {}, sessionId);
      ws.addEventListener('message', (ev) => {
        const m = JSON.parse(ev.data);
        if (m.method === 'Runtime.exceptionThrown' && m.sessionId === sessionId) {
          errs.push((m.params.exceptionDetails.text || '') + ' ' +
            ((m.params.exceptionDetails.exception || {}).description || ''));
        }
        if (m.method === 'Runtime.consoleAPICalled' && m.sessionId === sessionId &&
          m.params.type === 'error') errs.push('console: ' + JSON.stringify(m.params.args));
      });
      await send(ws, 'Emulation.setDeviceMetricsOverride',
        { width: w, height: h, deviceScaleFactor: 1, mobile }, sessionId);
      await send(ws, 'Page.navigate', { url: BASE + '/journal.html' }, sessionId);
      /* the roll waits on the API probe, so give it room before asserting */
      await sleep(5200);
      return sessionId;
    }
    const ev = async (expr, s) => {
      const r = await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true }, s);
      return r.result && r.result.value;
    };

    /* ---------- desktop ---------- */
    const s = await open(1440, 1000, false);

    const nav = await ev(`[...document.querySelectorAll('nav.menu-panel a')].map(a=>a.textContent.trim())`, s);
    ok(nav.some((x) => /Journal|手記|手记/i.test(x)), 'the ledger has a nav entry', JSON.stringify(nav));

    const rows = await ev(`document.querySelectorAll('.jr-row').length`, s);
    ok(rows === 31, 'all 31 rounds rendered', 'rows=' + rows);

    const first = await ev(`(()=>{const r=document.querySelector('.jr-row');
      return {no:r.querySelector('.jr-no').textContent, title:r.querySelector('.jr-title').textContent,
              place:r.querySelector('.jr-place')?r.querySelector('.jr-place').textContent:'',
              text:r.querySelector('.jr-text').textContent.length};})()`, s);
    ok(first && first.no === '31', 'newest round first', first && first.no);
    ok(first && /Chapter|第/.test(first.title), 'chapter title present', first && first.title);
    ok(first && first.place.length > 0, 'place line present', first && first.place);
    ok(first && first.text > 40, 'narrative text present', first && String(first.text));

    const intro = await ev(`(document.getElementById('jrIntro').textContent||'').length`, s);
    ok(intro > 20, 'ledger introduction rendered', 'len=' + intro);

    /* the roll only shows where the API answers — i.e. here */
    const vsShown = await ev(`!document.getElementById('vsSection').hidden`, s);
    ok(vsShown === true, 'the visitor roll is visible on the owner machine');
    const vsRows = await ev(`document.querySelectorAll('.vs-row').length`, s);
    ok(vsRows >= 1, 'at least one visitor row (our own visit)', 'rows=' + vsRows);

    const noHScroll = await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`, s);
    ok(noHScroll, 'no horizontal overflow on desktop');

    /* ---------- language switch keeps the narrative ---------- */
    await ev(`(function(){const b=[...document.querySelectorAll('[data-lang]')].find(x=>x.dataset.lang==='zh');if(b)b.click();})()`, s);
    await sleep(1500);
    const zhTitle = await ev(`document.querySelector('.jr-title').textContent`, s);
    ok(/第/.test(zhTitle), '繁體中文 shows the Chinese chapter title', zhTitle);

    /* ---------- mobile ---------- */
    const s2 = await open(390, 844, true);
    const mRows = await ev(`document.querySelectorAll('.jr-row').length`, s2);
    ok(mRows === 31, 'all rounds render on a phone', 'rows=' + mRows);
    const mH = await ev(`document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1`, s2);
    ok(mH, 'no horizontal overflow on a phone');

    ok(errs.length === 0, 'console clean', errs.slice(0, 3).join(' | '));
    ws.close();
  } catch (e) {
    fail++; console.log('FAIL harness threw — ' + e.message);
  } finally {
    edge.kill();
  }
  console.log('\n' + (fail ? fail + ' FAILURE(S)' : 'journal suite clean') + '   (' + pass + ' passed)');
  process.exit(fail ? 1 : 0);
})();
