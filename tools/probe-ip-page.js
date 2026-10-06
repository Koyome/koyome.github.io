/* ============================================================
   probe-ip-page.js — section 08 of the desk preview page
   (C:/Users/杨坤/Desktop/kstage-preview.html).

   That page lives on file:// but reads the visitor roll over http
   from the owner's own server, so the whole section depends on two
   things agreeing: server.js answering cross-origin, and the table
   rendering whatever it gets back.

   Run: node tools/probe-ip-page.js
   ============================================================ */
const { spawn } = require('child_process');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PAGE = 'file:///C:/Users/%E6%9D%A8%E5%9D%A4/Desktop/kstage-preview.html';
const CDP = 9347;

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
    await send(ws, 'Page.navigate', { url: PAGE }, sessionId);
    await sleep(6000);

    /* --- the section is on the page at all --- */
    ok(await evalJs(ws, sessionId, `!!document.getElementById('iplog')`),
      'section 08 exists on the desk page');
    ok(/08/.test(String(await evalJs(ws, sessionId,
      `(document.querySelector('#iplog h2')||{}).textContent||''`))),
      'and it is numbered 08', await evalJs(ws, sessionId,
        `(document.querySelector('#iplog h2')||{}).textContent||''`));

    /* --- it reached the server --- */
    const srvText = String(await evalJs(ws, sessionId,
      `(document.getElementById('ipSrv')||{}).textContent||''`));
    ok(/在线/.test(srvText), 'the page reached the local server', srvText);

    const cloudText = String(await evalJs(ws, sessionId,
      `(document.getElementById('ipCloud')||{}).textContent||''`));
    ok(cloudText.length > 1 && cloudText !== '—', 'the cloud state is reported', cloudText);

    /* --- the roll rendered --- */
    const rows = Number(await evalJs(ws, sessionId,
      `document.querySelectorAll('#ipBody tr').length`)) || 0;
    const n = Number(await evalJs(ws, sessionId,
      `(document.getElementById('ipCount')||{}).textContent||'0'`)) || 0;
    ok(rows === n, 'the counter matches the rows on screen', rows + ' rows / ' + n + ' counted');

    const hidden = await evalJs(ws, sessionId, `document.getElementById('ipTable').hidden`);
    if (rows > 0) {
      ok(hidden === false, 'the table is visible when there is something to show');
      const first = await evalJs(ws, sessionId, `(function(){
        var r = document.querySelector('#ipBody tr');
        if (!r) return null;
        var c = r.querySelectorAll('td');
        return { ip: c[1].textContent.trim(), place: c[2].textContent.trim(),
                 geo: c[3].textContent.trim(), src: c[6].textContent.trim() };
      })()`);
      ok(!!first && first.ip.length > 0, 'a row carries an address', first && first.ip);
      ok(!!first && first.place.length > 0, 'and a place (never blank)', first && first.place);
      ok(!!first && first.geo.length > 0, 'and a coordinate cell (— when unknown)', first && first.geo);
      ok(!!first && /本机|线上/.test(first.src), 'and says where the visit came from', first && first.src);
    } else {
      ok(true, 'no visits yet — the empty state is shown instead');
      ok(await evalJs(ws, sessionId, `document.getElementById('ipEmpty').hidden === false`),
        'the empty state is visible');
    }

    /* --- controls --- */
    ok(await evalJs(ws, sessionId, `!!document.getElementById('ipRefresh')`), 'a refresh control');
    ok(await evalJs(ws, sessionId, `!!document.getElementById('ipAuto')`), 'an auto-refresh toggle');
    ok(await evalJs(ws, sessionId, `!!document.getElementById('ipClear')`), 'a clear control');

    /* --- nothing on the page scrolls sideways --- */
    const overflow = await evalJs(ws, sessionId,
      `document.documentElement.scrollWidth - document.documentElement.clientWidth`);
    ok(Number(overflow) <= 1, 'the page does not overflow sideways', 'overflow=' + overflow);

    ok(errors.length === 0, 'no console errors', errors.slice(0, 3).join(' | '));

    ws.close();
  } catch (e) {
    ok(false, 'harness threw', e.message);
  } finally {
    edge.kill();
  }

  console.log('\n' + (fail ? fail + ' FAILURE(S)' : 'ip-page suite clean') + '   (' + pass + ' passed)');
  process.exit(fail ? 1 : 0);
})();
