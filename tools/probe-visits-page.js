/* ============================================================
   probe-visits-page.js — docs/visits.html, the roll on its own page.

   The journal page used to carry this section; it now has a page of
   its own and sits in the top navigation. That means two things worth
   asserting rather than assuming:

     1. it is actually reachable — the nav has it, the link resolves,
        and it is marked active when you are on it
     2. it behaves like a page, not a fragment — the state readout,
        the key field and the table all render, in all three languages,
        on a phone as well as a desktop

   Run: node tools/probe-visits-page.js
   ============================================================ */
const { spawn } = require('child_process');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = process.env.PROBE_PORT || 80;   /* the real server, on its real port */
const CDP = 9349;

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra ? '  → ' + extra : '')); }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let mid = 0;
function send(ws, method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++mid;
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
function evalJs(ws, sessionId, expr) {
  return send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true }, sessionId)
    .then((r) => (r.result && r.result.value));
}

(async () => {
  const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP}`,
    '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });

  try {
    let wsUrl;
    for (let i = 0; i < 40; i++) {
      try { wsUrl = (await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json()).webSocketDebuggerUrl; break; }
      catch (_) { await sleep(300); }
    }
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => (ws.onopen = r));

    const errors = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') {
        errors.push(String((m.params.exceptionDetails.exception || {}).description || 'exc'));
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errors.push((m.params.args || []).map((a) => a.value || a.description).join(' '));
      }
    });

    const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
    await send(ws, 'Runtime.enable', {}, sessionId);
    await send(ws, 'Page.enable', {}, sessionId);

    /* ---------- desktop ---------- */
    await send(ws, 'Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send(ws, 'Page.navigate',
      { url: `http://127.0.0.1:${PORT}/visits.html` }, sessionId);
    await sleep(6000);

    /* --- the page is a page --- */
    ok(await evalJs(ws, sessionId, `!!document.getElementById('vsSection')`),
      'the roll section exists');
    ok(await evalJs(ws, sessionId, `document.body.dataset.page === 'visits'`),
      'and the page knows what it is', await evalJs(ws, sessionId, 'document.body.dataset.page'));

    /* --- reachable from the top nav, and active --- */
    const navLinks = await evalJs(ws, sessionId, `(function(){
      var a = [].slice.call(document.querySelectorAll('#siteHeader a'));
      return a.map(function(x){ return { href: x.getAttribute('href'), active: x.classList.contains('active') }; });
    })()`);
    const hasVisits = Array.isArray(navLinks) && navLinks.some((l) => /visits\.html$/.test(l.href || ''));
    ok(hasVisits, 'the top navigation carries it', JSON.stringify(navLinks));
    ok(Array.isArray(navLinks) && navLinks.some((l) => l.active),
      'and marks itself active on this page');

    /* --- the state readout is filled in, not left as "—" --- */
    for (const [id, label] of [['vsSrv', 'server'], ['vsCloud', 'cloud'], ['vsPrec', 'precision'], ['vsTotal', 'count']]) {
      const v = String(await evalJs(ws, sessionId,
        `(document.getElementById('${id}')||{}).textContent||''`)).trim();
      ok(v && v !== '—', 'the ' + label + ' readout is filled', v);
    }

    /* --- precision must be honest about the key --- */
    const prec = String(await evalJs(ws, sessionId,
      `(document.getElementById('vsPrec')||{}).textContent||''`)).toLowerCase();
    ok(/区|縣|县|city|市/.test(prec), 'precision states a level the reader understands', prec);

    /* --- the key field exists and behaves like an input --- */
    ok(await evalJs(ws, sessionId, `!!document.getElementById('vsKey')`), 'the Amap key field exists');
    ok(await evalJs(ws, sessionId,
      `document.getElementById('vsKey').tagName === 'INPUT'`), 'and it is a real input');
    ok(await evalJs(ws, sessionId, `!!document.getElementById('vsKeySave')`), 'with a save control');
    ok(await evalJs(ws, sessionId, `!!document.getElementById('vsDiag')`), 'and a self-check');

    /* --- the table itself --- */
    const rows = Number(await evalJs(ws, sessionId,
      `document.querySelectorAll('#vsBody tr').length`)) || 0;
    const n = Number(await evalJs(ws, sessionId,
      `(document.getElementById('vsTotal')||{}).textContent||'0'`)) || 0;
    ok(rows === n, 'the counter agrees with the rows drawn', rows + ' rows / ' + n);
    ok(await evalJs(ws, sessionId, `document.getElementById('vsSection').hidden === false`),
      'the section is shown once the API answered');

    if (rows > 0) {
      /* index by header text, not position — the column set has
         changed before and will again */
      const first = await evalJs(ws, sessionId, `(function(){
        var ths = [].slice.call(document.querySelectorAll('.vs-table thead th'))
          .map(function(x){ return x.textContent.trim(); });
        var tds = [].slice.call(document.querySelectorAll('#vsBody tr:first-child td'))
          .map(function(x){ return x.textContent.trim(); });
        var at = function(label){ var i = ths.indexOf(label); return i < 0 ? '' : (tds[i] || ''); };
        var geoIdx = ths.map(function(h){ return /COORDINATES|經緯度|经纬度/.test(h); })
          .indexOf(true);
        return { ip: tds[1] || '', place: at('WHERE') || at('所在') || tds[2] || '',
                 geo: geoIdx < 0 ? '' : (tds[geoIdx] || '') };
      })()`);
      ok(first.ip.length > 0, 'a row carries an address', first.ip);
      ok(first.place.length > 0, 'and a place', first.place);
      ok(first.geo.length > 0, 'and a coordinate cell', JSON.stringify(first));
    } else {
      ok(await evalJs(ws, sessionId, `document.getElementById('vsEmpty').hidden === false`),
        'with nothing to show, the empty state says so');
    }

    /* --- the three languages all render --- */
    for (const [lang, expect] of [['en', 'Visitors'], ['zh', '訪客'], ['zhcn', '访客']]) {
      await evalJs(ws, sessionId, `localStorage.setItem('koyome_lang', ${JSON.stringify(lang)})`);
      await send(ws, 'Page.reload', {}, sessionId);
      await sleep(4500);
      const title = String(await evalJs(ws, sessionId,
        `(document.querySelector('.vs-title')||{}).textContent||''`)).trim();
      ok(title === expect, lang + ' renders the page title', title);
      const srvK = String(await evalJs(ws, sessionId,
        `(document.querySelector('.vs-stat-k')||{}).textContent||''`)).trim();
      ok(srvK.length > 0, lang + ' translates the readout labels', srvK);
    }
    await evalJs(ws, sessionId, `localStorage.setItem('koyome_lang','en')`);

    /* --- phone: it has to survive a 390px screen --- */
    await send(ws, 'Emulation.setDeviceMetricsOverride',
      { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
    await send(ws, 'Page.reload', {}, sessionId);
    await sleep(4500);
    const of1 = await evalJs(ws, sessionId,
      'document.documentElement.scrollWidth - document.documentElement.clientWidth');
    ok(Number(of1) <= 1, 'no sideways overflow on a phone', 'overflow=' + of1);
    ok(await evalJs(ws, sessionId,
      `document.getElementById('vsKey').getBoundingClientRect().width > 40`),
      'the key field is still usable on a phone');
    ok(await evalJs(ws, sessionId,
      `document.querySelectorAll('#vsBody tr, #vsEmpty:not([hidden])').length > 0`),
      'and the roll or its empty state is on screen');

    ok(errors.length === 0, 'console clean', errors.slice(0, 3).join(' | '));

    ws.close();
  } catch (e) {
    ok(false, 'harness threw', e.message);
  } finally {
    edge.kill();
  }

  console.log('\n' + (fail ? fail + ' FAILURE(S)' : 'visits-page suite clean') + '   (' + pass + ' passed)');
  process.exit(fail ? 1 : 0);
})();