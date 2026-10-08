/* ============================================================
   probe-visits-page.js — docs/visits.html, the visit log on its
   own page, driven through a real browser.

   Two things are worth asserting rather than assuming:

     1. it is reachable — the nav carries it, the link resolves, and
        it marks itself active
     2. it behaves like an instrument — the readouts are filled from
        real data, the rows carry the whole record, the filters hide
        only what they claim to, and in all three languages

   It also DELETES rows, on purpose: "I can remove a record" is only
   true if something actually goes away. So it never runs against the
   real server — that would eat the owner's roll. It stands up a
   sandbox copy of server.js over a throwaway docs/ (the same trick
   as probe-visits.js) and deletes rows there.

   Run: node tools/probe-visits-page.js
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'koyome-vpage-'));
const PORT = Number(process.env.PROBE_PORT || 8971);
const CDP = 9349;

/* a throwaway docs/: the real page + assets, but a seeded roll.
   fs.cpSync is blocked in this environment (EIO on a deep copy), so
   this walks the tree by hand. */
function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const src = path.join(from, name), dst = path.join(to, name);
    const st = fs.statSync(src);
    if (st.isDirectory()) copyTree(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

const SB_DOCS = path.join(SANDBOX, 'docs');
fs.mkdirSync(SB_DOCS, { recursive: true });
for (const f of ['index.html', 'visits.html']) {
  fs.copyFileSync(path.join(ROOT, 'docs', f), path.join(SB_DOCS, f));
}
for (const d of ['css', 'js', 'data', 'components']) {
  copyTree(path.join(ROOT, 'docs', d), path.join(SB_DOCS, d));
}

/* Four kinds of row, because the page now sorts them: a located
   phone, a desktop, a crawler, and one address from this machine's
   own network — the one kind the server refuses to write any more. */
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const UA_BOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';

const SEED = [
  { id: 'vprobe001', ip: '198.51.100.7', at: '2026-10-08T06:10:00.000Z',
    last: '2026-10-08T06:40:00.000Z', time: '2026-10-08 06:10', page: '/index.html',
    pages: ['/index.html'], ua: UA_IPHONE, country: '中国', region: '广东省', city: '深圳市',
    district: '南山区', isp: '电信', lat: 22.5402, lon: 113.9463,
    lan: false, count: 1, ref: 'https://www.google.com/', lang: 'zh-CN' },
  { id: 'vprobe002', ip: '127.0.0.1', at: '2026-10-08T04:10:00.000Z',
    last: '2026-10-08T04:10:00.000Z', time: '2026-10-08 04:10', page: '/visits.html',
    pages: ['/visits.html'], ua: UA_WIN, country: '', region: '', city: '', district: '',
    isp: '', lat: null, lon: null, lan: true, count: 1 },
  { id: 'vprobe003', ip: '66.249.66.1', at: '2026-10-08T03:00:00.000Z',
    last: '2026-10-08T03:00:00.000Z', time: '2026-10-08 03:00', page: '/catalog.html',
    pages: ['/catalog.html'], ua: UA_BOT, country: '美国', region: '', city: '', district: '',
    isp: 'Google', lat: null, lon: null, lan: false, count: 1, bot: true },
  { id: 'vprobe004', ip: '203.0.113.44', at: '2026-10-08T02:00:00.000Z',
    last: '2026-10-08T02:00:00.000Z', time: '2026-10-08 02:00', page: '/hobbies.html',
    pages: ['/hobbies.html'], ua: UA_WIN, country: '中国', region: '浙江省', city: '杭州市',
    district: '西湖区', isp: '联通', lat: 30.26, lon: 120.13, lan: false, count: 1 },
];
fs.writeFileSync(path.join(SB_DOCS, 'data', 'visits.json'), JSON.stringify(SEED, null, 2));

fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(SANDBOX, 'server.js'));
const nodeBin = process.execPath;

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
  return send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)
    .then((r) => (r.result && r.result.value));
}

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

(async () => {
  const srv = spawn(nodeBin, ['server.js'], {
    cwd: SANDBOX, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
  });
  for (let i = 0; i < 40; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/api/visits`, { cache: 'no-store' }); break; }
    catch (_) { await sleep(250); }
  }

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
    await send(ws, 'Network.setCacheDisabled', { cacheDisabled: true }, sessionId);

    /* ---------- desktop ---------- */
    await send(ws, 'Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send(ws, 'Page.navigate', { url: `http://127.0.0.1:${PORT}/visits.html` }, sessionId);
    await sleep(6000);

    /* the visitor log now opens behind a cute login gate; neutralize
       it (drop the lock + hide the panel) so the console underneath is
       testable. This is a dev harness, not a bypass of the gate. */
    await evalJs(ws, sessionId, `(function(){
      document.body.classList.remove('is-locked');
      var l = document.getElementById('vsLogin'); if (l) l.classList.remove('is-on');
      var w = document.getElementById('vsWelcome'); if (w) { w.classList.remove('is-on'); w.hidden = true; }
      return 1; })()`);

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
    ok(Array.isArray(navLinks) && navLinks.some((l) => /visits\.html$/.test(l.href || '')),
      'the top navigation carries it', JSON.stringify(navLinks));
    ok(Array.isArray(navLinks) && navLinks.some((l) => l.active),
      'and marks itself active on this page');

    /* --- every readout is filled in from real data, not left as "—" --- */
    for (const [id, label] of [['vsSrv', 'server'], ['vsCloud', 'online'], ['vsPrec', 'precision'],
      ['vsTotal', 'records'], ['vsToday', '24h'], ['vsUniq', 'addresses'], ['vsLocated', 'located']]) {
      const v = String(await evalJs(ws, sessionId,
        `(document.getElementById('${id}')||{}).textContent||''`)).trim();
      ok(v && v !== '—', 'the ' + label + ' readout is filled', v);
    }
    ok(String(await evalJs(ws, sessionId, `(document.getElementById('vsTotal')||{}).textContent`)) === '4',
      'records counts every row the machine holds',
      await evalJs(ws, sessionId, `(document.getElementById('vsTotal')||{}).textContent`));
    ok(String(await evalJs(ws, sessionId, `(document.getElementById('vsUniq')||{}).textContent`)) === '4',
      'addresses counts distinct addresses');
    ok(String(await evalJs(ws, sessionId, `(document.getElementById('vsLocated')||{}).textContent`)) === '3',
      'located counts the rows that resolved');

    /* --- the clock and the feed light are running --- */
    await sleep(1200);
    ok(/^\d\d:\d\d:\d\d$/.test(String(await evalJs(ws, sessionId,
      `(document.getElementById('vsClock')||{}).textContent||''`))), 'the HUD clock is ticking',
      await evalJs(ws, sessionId, `(document.getElementById('vsClock')||{}).textContent`));
    ok(await evalJs(ws, sessionId,
      `document.getElementById('vsLive').classList.contains('is-on')`),
      'the feed is live on load, not waiting to be asked');

    /* --- the filters hide exactly what they say they hide --- */
    const drawn = () => evalJs(ws, sessionId, `document.querySelectorAll('#vsBody .vs-row').length`);
    ok(Number(await drawn()) === 2, 'crawlers and local addresses are out of view by default',
      'drawn=' + (await drawn()));

    await evalJs(ws, sessionId, `document.getElementById('vsFBots').click()`);
    await sleep(300);
    ok(Number(await drawn()) === 3, 'the BOTS chip brings crawlers back', 'drawn=' + (await drawn()));
    await evalJs(ws, sessionId, `document.getElementById('vsFLan').click()`);
    await sleep(300);
    ok(Number(await drawn()) === 4, 'the LAN chip brings local addresses back', 'drawn=' + (await drawn()));
    await evalJs(ws, sessionId, `document.getElementById('vsFBots').click();
      document.getElementById('vsFLan').click()`);
    await sleep(300);
    ok(Number(await drawn()) === 2, 'and both switch back off again', 'drawn=' + (await drawn()));

    /* --- the filter box --- */
    await evalJs(ws, sessionId, `(function(){
      var f = document.getElementById('vsFind');
      f.value = '198.51'; f.dispatchEvent(new Event('input')); return 1; })()`);
    await sleep(400);
    ok(Number(await drawn()) === 1, 'typing an address narrows the roll', 'drawn=' + (await drawn()));
    await evalJs(ws, sessionId, `(function(){
      var f = document.getElementById('vsFind');
      f.value = ''; f.dispatchEvent(new Event('input')); return 1; })()`);
    await sleep(400);

    /* --- a row carries the whole record --- */
    const first = await evalJs(ws, sessionId, `(function(){
      var ths = [].slice.call(document.querySelectorAll('.vs-table thead th'))
        .map(function(x){ return x.textContent.trim(); });
      var tds = [].slice.call(document.querySelectorAll('#vsBody .vs-row:first-of-type td'))
        .map(function(x){ return x.textContent.trim(); });
      var idx = function(re){ return ths.map(function(h){ return re.test(h); }).indexOf(true); };
      return {
        heads: ths,
        ip: tds[3] || '',
        device: idx(/DEVICE|裝置|设备/) < 0 ? '' : (tds[idx(/DEVICE|裝置|设备/)] || ''),
        where: idx(/WHERE|所在/) < 0 ? '' : (tds[idx(/WHERE|所在/)] || ''),
        coord: idx(/COORD|經緯度|经纬度/) < 0 ? '' : (tds[idx(/COORD|經緯度|经纬度/)] || ''),
      };
    })()`);
    ok(/ADDRESS|地址/.test(first.heads[3] || ''), 'the address column is where it should be', first.heads[3]);
    ok(first.ip.indexOf('198.51.100.7') === 0, 'a row carries its address', first.ip);
    ok(/iPhone/.test(first.device) || /手机|手機|PHONE/i.test(first.device),
      'a row names the device', first.device);
    ok(/深圳/.test(first.where), 'a row carries the resolved place', first.where);
    ok(/22\.5402/.test(first.coord), 'and its coordinates', first.coord);

    /* --- clicking a row opens everything the record holds --- */
    await evalJs(ws, sessionId, `document.querySelector('#vsBody .vs-row td:nth-child(3)').click()`);
    await sleep(300);
    const detail = await evalJs(ws, sessionId, `(function(){
      var d = document.querySelector('#vsBody .vs-detail');
      return d ? d.textContent : '';
    })()`);
    ok(/iPhone/.test(detail), 'the opened row shows the full user-agent', detail.slice(0, 90));
    ok(/google\.com/.test(detail), 'and where the link came from');
    ok(/zh-CN/.test(detail), 'and the language the browser asked for');
    await evalJs(ws, sessionId, `document.querySelector('#vsBody .vs-row td:nth-child(3)').click()`);
    await sleep(300);
    ok(await evalJs(ws, sessionId, `!document.querySelector('#vsBody .vs-detail')`),
      'and clicking again closes it');

    /* --- the key field and the self-check --- */
    ok(await evalJs(ws, sessionId, `document.getElementById('vsKey').tagName === 'INPUT'`),
      'the 高德 key field is a real input');
    ok(await evalJs(ws, sessionId, `!!document.getElementById('vsKeySave')`), 'with a save control');
    ok(await evalJs(ws, sessionId, `!!document.getElementById('vsDiag')`), 'and a self-check');

    /* --- the three languages all render --- */
    for (const [lang, expect, label] of [
      ['en', 'Visitors', 'SERVER'], ['zh', '訪客', '本機服務'], ['zhcn', '访客', '本机服务'],
    ]) {
      await evalJs(ws, sessionId, `localStorage.setItem('koyome_lang', ${JSON.stringify(lang)})`);
      await send(ws, 'Page.reload', {}, sessionId);
      await sleep(4500);
      const title = String(await evalJs(ws, sessionId,
        `(document.querySelector('.vs-title')||{}).textContent||''`)).trim();
      ok(title === expect, lang + ' renders the page title', title);
      const k = String(await evalJs(ws, sessionId,
        `(document.querySelector('.vs-k')||{}).textContent||''`)).trim();
      ok(k === label, lang + ' translates the readout labels', k + ' (expected ' + label + ')');
      const dev = String(await evalJs(ws, sessionId,
        `(function(){ var ths=[].slice.call(document.querySelectorAll('.vs-table thead th'));
           return ths.map(function(x){return x.textContent.trim()}).join('|'); })()`));
      ok(/DEVICE|裝置|设备/.test(dev), lang + ' carries a device column', dev);
    }
    await evalJs(ws, sessionId, `localStorage.setItem('koyome_lang','en')`);

    /* --- what the DEVICE column actually says ---
       The seed roll has an iPhone, an iPad, a desktop and a crawler, and
       between them they cover both branches: a real model code, and a
       category with nothing to name it. The column used to lead with the
       category ("phone") and push the model ("iPhone") into the small
       line underneath, which is backwards — the model is the specific
       fact and the category is implied by it. */
    /* show everything: crawlers and this machine's own rows are held
       back by default, and all four kinds are wanted here */
    await evalJs(ws, sessionId, `document.getElementById('vsFBots').click();
      document.getElementById('vsFLan').click(); 1`);
    await sleep(600);
    /* keyed by address, not by row class: is-phone/is-pad live on the
       chip inside the cell, not on the <tr> */
    const devCells = await evalJs(ws, sessionId, `(function(){
      var out = {};
      [].slice.call(document.querySelectorAll('#vsBody .vs-row')).forEach(function (tr) {
        var b = tr.querySelector('.vs-dev');
        var ip = (tr.querySelector('.vs-ipv') || {}).textContent || '';
        if (!b || !ip) return;
        var model = b.querySelector('.vs-model');
        var kind  = b.querySelector('.vs-kind');
        out[ip.trim()] = {
          head:    (model || kind || {}).textContent || '',
          isModel: !!model,
          guessed: !!b.querySelector('.vs-guess'),
          sub:     (b.querySelector('s') || {}).textContent || '',
        };
      });
      return out;
    })()`);
    const phone = devCells['198.51.100.7'];     /* the seeded iPhone */
    ok(!!phone && phone.isModel && /iPhone/.test(phone.head),
      'a phone leads with its model, not with the word phone',
      phone ? phone.head : 'no iPhone row — ' + Object.keys(devCells).join(','));
    ok(!!phone && !phone.guessed,
      'a model the agent carries is not marked as a guess');
    const desk = devCells['203.0.113.44'];      /* the seeded desktop */
    ok(!!desk, 'the desktop row is present', Object.keys(devCells).join(','));
    const bot = devCells['66.249.66.1'];        /* the seeded Googlebot */
    ok(!!bot && /CRAWLER|爬/i.test(bot.head), 'a crawler still reads as a crawler',
      bot ? bot.head : 'no bot row');
    const all = Object.keys(devCells);
    ok(all.length > 0 && all.every((k) => devCells[k].head.length > 0),
      'and no row shows an empty device',
      JSON.stringify(all.map((k) => k + '=' + devCells[k].head)));
    /* the small line must add something: repeating the head is noise */
    ok(all.every((k) => !devCells[k].sub || devCells[k].sub.indexOf(devCells[k].head) === -1),
      'the OS line never repeats the model above it',
      JSON.stringify(all.map((k) => devCells[k].head + '|' + devCells[k].sub)));
    await evalJs(ws, sessionId, `document.getElementById('vsFBots').click();
      document.getElementById('vsFLan').click(); 1`);
    await sleep(400);

    /* ---------- the read: what each visitor is judged to be ----------
       The seed roll is built to exercise the rules: a phone on a
       residential carrier, a crawler that names itself, a desktop with
       no referrer, and this machine's own row. Every verdict is
       asserted together with the evidence behind it, because a verdict
       with no reason given is exactly the thing this column exists to
       avoid. */
    /* idempotent: the block above left the chips off again, and the
       crawler is the row that matters most here */
    await evalJs(ws, sessionId, `(function(){
      ['vsFBots', 'vsFLan'].forEach(function (id) {
        var b = document.getElementById(id);
        if (b && b.getAttribute('aria-pressed') !== 'true') b.click();
      });
      return 1; })()`);
    await sleep(700);
    const reads = await evalJs(ws, sessionId, `(function(){
      var out = {};
      [].slice.call(document.querySelectorAll('#vsBody .vs-row')).forEach(function (tr) {
        var ip = ((tr.querySelector('.vs-ipv') || {}).textContent || '').trim();
        var c = tr.querySelector('.vs-read');
        if (!ip || !c) return;
        out[ip] = {
          verdict: ((c.querySelector('.vs-verdict') || {}).textContent || '').trim(),
          conf:    ((c.querySelector('.vs-conf') || {}).textContent || '').trim(),
          source:  ((c.querySelector('s') || {}).textContent || '').trim(),
          why:     [].slice.call(c.querySelectorAll('u i'))
                     .map(function (i) { return i.textContent.trim(); }),
        };
      });
      return out;
    })()`);
    const rPhone = reads['198.51.100.7'];      /* iPhone, no referrer    */
    const rBot = reads['66.249.66.1'];         /* Googlebot              */
    const rDesk = reads['203.0.113.44'];       /* desktop, no referrer   */
    ok(!!rPhone && /HUMAN|真人/.test(rPhone.verdict),
      'the phone is read as a person', rPhone && rPhone.verdict);
    ok(!!rPhone && rPhone.why.some((w) => /198|iPhone/.test(w) === false && w.length > 0),
      'and the read shows why', JSON.stringify(rPhone && rPhone.why));
    ok(!!rBot && /CRAWLER|爬虫/i.test(rBot.verdict),
      'the crawler is read as a crawler', rBot && rBot.verdict);
    ok(!!rBot && rBot.why.some((w) => /Googlebot/i.test(w)),
      'and names the crawler it saw', JSON.stringify(rBot && rBot.why));
    ok(!!rDesk && rDesk.verdict.length > 0 && rDesk.why.length > 0,
      'the desktop row gets a read as well', JSON.stringify(rDesk));
    ok(Object.keys(reads).length >= 3 &&
       Object.keys(reads).every((k) => reads[k].verdict.length > 0 && reads[k].why.length > 0),
      'every row is read, and none without reasons',
      JSON.stringify(Object.keys(reads).map((k) => k + '=' + reads[k].verdict + '/' + reads[k].why.length)));
    /* the read must never outrun its evidence: "UNKNOWN" with high
       confidence would be claiming more than the row can support */
    ok(Object.keys(reads).every((k) => !(/UNKNOWN|不明/.test(reads[k].verdict) &&
       /certain|确定|確定/.test(reads[k].conf))),
      'and an unknown is never called certain',
      JSON.stringify(Object.keys(reads).map((k) => reads[k].verdict + '/' + reads[k].conf)));

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
    ok(Number(await evalJs(ws, sessionId,
      `document.querySelectorAll('#vsBody .vs-row').length`)) > 0,
      'and the roll is on screen');
    /* a row must be readable, not clipped: the device cell is the one
       that could push the others out on a 390px screen */
    ok(await evalJs(ws, sessionId, `(function(){
      var r = document.querySelector('#vsBody .vs-row');
      if (!r) return false;
      var box = r.getBoundingClientRect();
      return box.width > 200 && box.width <= 390;
    })()`), 'a row fits the phone width');

    /* --- removal: local rows delete, cloud rows hide and come back --- */
    await send(ws, 'Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send(ws, 'Page.reload', {}, sessionId);
    await sleep(4500);

    const delUI = await evalJs(ws, sessionId, `(function(){
      return {
        all: !!document.getElementById('vsDelAll'),
        sel: !!document.getElementById('vsDelSel'),
        selAll: !!document.getElementById('vsSelAll'),
        restore: !!document.getElementById('vsRestore'),
        x: document.querySelectorAll('.vs-x').length,
        picks: document.querySelectorAll('.vs-pick').length,
        rows: document.querySelectorAll('#vsBody .vs-row').length,
      };
    })()`);
    ok(delUI.all && delUI.sel && delUI.selAll, 'delete controls exist');
    ok(delUI.restore, 'a way to bring hidden rows back exists');
    ok(delUI.rows > 0, 'the sandbox roll has rows to work with', 'rows=' + delUI.rows);
    ok(delUI.x === delUI.rows, 'every row has its own × button',
      delUI.x + ' x for ' + delUI.rows + ' rows');
    ok(delUI.picks === delUI.rows, 'and a checkbox to tick it',
      delUI.picks + ' picks for ' + delUI.rows + ' rows');

    await evalJs(ws, sessionId, `document.querySelector('.vs-pick').click()`);
    await sleep(200);
    const sel1 = await evalJs(ws, sessionId, `(function(){
      var b = document.getElementById('vsDelSel');
      return { disabled: b.disabled, text: b.textContent.trim() };
    })()`);
    ok(sel1.disabled === false, 'ticking a row enables DELETE SELECTED');
    ok(/1/.test(sel1.text), 'and it says how many are ticked', sel1.text);
    ok(await evalJs(ws, sessionId, `document.getElementById('vsSelAll').indeterminate`) === true,
      'the header tick goes indeterminate when part of the roll is picked');

    const before = Number(await evalJs(ws, sessionId,
      `document.querySelectorAll('#vsBody .vs-row').length`)) || 0;
    const doomed = String(await evalJs(ws, sessionId,
      `(document.querySelector('#vsBody .vs-row')||{}).dataset.id||''`));
    await evalJs(ws, sessionId, `(function(){
      window.confirm = function(){ return true; };
      document.getElementById('vsDelSel').click(); return 1;
    })()`);
    await sleep(5200);   /* longer than one poll, so the auto-refresh
                            has certainly redrawn from the API too */
    const after = Number(await evalJs(ws, sessionId,
      `document.querySelectorAll('#vsBody .vs-row').length`)) || 0;
    ok(after === before - 1, 'removing one ticked row takes exactly that row away',
      before + ' → ' + after);

    /* The view is filtered, so "gone from the screen" and "gone from
       the machine" are two different numbers here — a crawler and a
       local address are still on disk and deliberately not drawn.
       Both halves have to be asserted, separately. */
    const gone = await evalJs(ws, sessionId, `(function(){
      return fetch('api/visits',{cache:'no-store'}).then(function(r){return r.json()})
        .then(function(list){
          var ids = (list||[]).map(function(v){ return String(v.id); });
          var dom = [].slice.call(document.querySelectorAll('#vsBody .vs-row'))
            .map(function(tr){ return String(tr.dataset.id); });
          return { api: ids.length, ids: ids, dom: dom,
            allInApi: dom.every(function(d){ return ids.indexOf(d) > -1; }) };
        });
    })()`);
    ok(gone.api === 3, 'the machine is down to three rows', 'rows=' + gone.api);
    ok(gone.ids.indexOf(doomed) < 0, 'and the ticked row is the one that went',
      doomed + ' still in ' + JSON.stringify(gone.ids));
    ok(gone.allInApi, 'every row on screen still exists server-side',
      JSON.stringify(gone.dom));

    /* ---- the cloud half: hidden locally, never deleted remotely ---- */
    const cloudFlow = await evalJs(ws, sessionId, `(function(){
      window.confirm = function(){ return true; };
      return fetch('api/visits?id=c999', { method:'DELETE' }).then(function(r){ return r.json(); })
        .then(function(j){
          return fetch('api/visits/hidden',{cache:'no-store'}).then(function(r){return r.json()})
            .then(function(h){ return { deleted: j.deleted, hidden: j.hidden, list: h }; });
        });
    })()`);
    ok(cloudFlow.deleted === 0, 'hiding a cloud row deletes nothing locally', JSON.stringify(cloudFlow));
    ok(cloudFlow.hidden === 1, 'and reports it as hidden', JSON.stringify(cloudFlow));
    ok(Array.isArray(cloudFlow.list) && cloudFlow.list.indexOf('c999') > -1,
      'the id lands in the dismissed list', JSON.stringify(cloudFlow.list));

    const restored = await evalJs(ws, sessionId, `fetch('api/visits/restore',{method:'POST'})
      .then(function(r){return r.json()})
      .then(function(){ return fetch('api/visits/hidden',{cache:'no-store'}).then(function(r){return r.json()}); })`);
    ok(Array.isArray(restored) && restored.length === 0,
      'RESTORE clears the dismissed list', JSON.stringify(restored));

    await evalJs(ws, sessionId, `fetch('api/visits?id=c777',{method:'DELETE'})`);
    await sleep(1500);
    ok(await evalJs(ws, sessionId, `document.getElementById('vsRestore').hidden`) === false,
      'the RESTORE button appears once something is hidden');

    await evalJs(ws, sessionId, `document.getElementById('vsRestore').click()`);
    await sleep(2500);
    ok(await evalJs(ws, sessionId, `document.getElementById('vsRestore').hidden`) === true,
      'clicking it clears the list and hides the button again');
    const after2 = await evalJs(ws, sessionId, `fetch('api/visits/hidden',{cache:'no-store'})
      .then(function(r){return r.json()})`);
    ok(Array.isArray(after2) && after2.length === 0, 'and nothing stays dismissed',
      JSON.stringify(after2));

    /* ---------- the theatre around the roll ----------
       Every one of these is fed from real rows. The interesting failure
       is not "the animation stopped" — it is an effect quietly showing
       invented data, so that is what gets asserted: the wire has to
       contain an address that is really in the roll. */
    const fxView = await evalJs(ws, sessionId, `(function(){
      var r = document.getElementById('vsRain');
      var s = document.getElementById('vsScope');
      return {
        rain: !!r,
        rainCss: r ? getComputedStyle(r).display : '',
        rainBox: r ? Math.round(r.getBoundingClientRect().width) + 'x' + Math.round(r.getBoundingClientRect().height) : '',
        /* the layout viewport, i.e. without the scrollbar: the field
           is fixed to that, not to innerWidth */
        view: document.documentElement.clientWidth + 'x' + document.documentElement.clientHeight,
        scopePx: s ? s.width + 'x' + s.height : '',
        wire: (document.getElementById('vsWireRun')||{}).textContent || '',
        ip: (document.querySelector('#vsBody .vs-row .vs-ipv')||{}).textContent || '',
      };
    })()`);
    ok(fxView.rain, 'the code rain canvas is on the page');
    ok(fxView.rainBox === fxView.view && fxView.rainCss !== 'none',
      'and it has been sized to the window, not to its own intrinsic box',
      'canvas=' + fxView.rainBox + ' viewport=' + fxView.view);
    ok(/^[1-9]/.test(fxView.scopePx), 'the scope has been drawn to', fxView.scopePx);
    ok(fxView.ip && fxView.wire.indexOf(fxView.ip) > -1,
      'the wire repeats an address that is really in the roll', fxView.ip);

    /* the event log: opened on demand, and it has written something */
    await evalJs(ws, sessionId, `document.getElementById('vsLogBtn').click()`);
    await sleep(300);
    const logN = await evalJs(ws, sessionId, `(function(){
      return {
        open: document.getElementById('vsLog').hidden === false,
        rows: document.querySelectorAll('#vsLogList .vs-log-row').length,
        counter: Number((document.getElementById('vsLogN')||{}).textContent || 0),
      };
    })()`);
    ok(logN.open, 'the event log opens when asked');
    ok(logN.rows > 0, 'and it has written something down', 'rows=' + logN.rows);
    ok(logN.counter >= logN.rows, 'the badge counts what it wrote', logN.counter + ' vs ' + logN.rows);

    /* the shortcut card, and the keys it describes */
    await evalJs(ws, sessionId, `document.getElementById('vsKeysBtn').click()`);
    await sleep(200);
    const keysCard = await evalJs(ws, sessionId, `(function(){
      var k = document.getElementById('vsKeys');
      return { hidden: k.hidden, text: (k.querySelector('pre')||{}).textContent || '' };
    })()`);
    ok(keysCard.hidden === false, 'the shortcut card opens too');
    ok(/\//.test(keysCard.text) && /[Aa]/.test(keysCard.text),
      'and lists the keys', JSON.stringify(keysCard.text.slice(0, 40)));

    /* pressing one of those keys actually does the thing */
    await evalJs(ws, sessionId,
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }))`);
    await sleep(200);
    ok(await evalJs(ws, sessionId, `document.activeElement && document.activeElement.id === 'vsFind'`),
      'pressing / jumps to the filter box');
    await evalJs(ws, sessionId, `document.getElementById('vsFind').blur()`);

    await evalJs(ws, sessionId, `(function(){
      var before = document.getElementById('vsLog').hidden;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'l', bubbles: true }));
      return before;
    })()`);
    await sleep(250);
    ok(await evalJs(ws, sessionId, `document.getElementById('vsLog').hidden`) === true,
      'pressing L closes it again');

    /* the old habit: up up down down left right left right B A */
    await evalJs(ws, sessionId, `(function(){
      ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a']
        .forEach(function(k){ document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
      return 1; })()`);
    await sleep(300);
    ok(await evalJs(ws, sessionId, `document.body.classList.contains('is-override')`) === true,
      'the konami sequence engages override');
    await evalJs(ws, sessionId, `(function(){
      ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a']
        .forEach(function(k){ document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); });
      return 1; })()`);
    await sleep(300);
    ok(await evalJs(ws, sessionId, `document.body.classList.contains('is-override')`) === false,
      'and it releases again');

    /* ---------- the field is a toy, not a wallpaper ----------
       Four modes, cycled from the HUD or with M; a click throws a
       pulse; whatever you type falls through the glyphs; resting the
       pointer on a row makes three columns spell that visitor's
       address. Each of those is a claim about state, so each one is
       checked rather than admired. */
    const r0 = await evalJs(ws, sessionId, `(function(){
      return { mode: window.VSFX.rain.mode,
               label: document.getElementById('vsRainMode').textContent,
               cols: window.VSFX.rain.cols };
    })()`);
    ok(r0.mode === 'RAIN' && r0.label === 'RAIN',
      'the rain opens in the default field', r0.mode + '/' + r0.label);
    ok(r0.cols > 60, 'and has a column per strip of screen', 'cols=' + r0.cols);

    /* one click at a time, and past the .5s fade: reading four
       computed opacities inside a single tick would only ever see
       the value the transition was leaving from */
    const cyc = [];
    for (let i = 0; i < 4; i++) {
      await evalJs(ws, sessionId, `document.getElementById('vsRainBtn').click()`);
      await sleep(700);
      cyc.push(await evalJs(ws, sessionId, `(function(){
        var cv = document.getElementById('vsRain');
        return { id: window.VSFX.rain.mode,
                 fps: window.VSFX.rain.fps,
                 label: document.getElementById('vsRainMode').textContent,
                 storm: document.body.classList.contains('vs-rain-storm'),
                 opacity: Number(getComputedStyle(cv).opacity).toFixed(2),
                 /* layout size, not the box: the storm skews and
                    scales the canvas, and that is deliberate */
                 box: cv.clientWidth + 'x' + cv.clientHeight };
      })()`));
    }
    const ids = cyc.map(function (c) { return c.id; }).join('>');
    ok(ids === 'STORM>TRACE>CALM>RAIN', 'the FIELD button walks the four fields and comes back', ids);
    ok(cyc.every(function (c) { return c.label === c.id; }), 'and the HUD label follows it along');
    ok(cyc[0].storm === true && !cyc[1].storm && !cyc[2].storm && !cyc[3].storm,
      'only the storm tilts the whole field', JSON.stringify(cyc.map(function (c) { return c.storm; })));
    ok(new Set(cyc.map(function (c) { return c.opacity; })).size === 4 &&
       new Set(cyc.map(function (c) { return c.fps; })).size === 4,
      'and every field has its own weight and pace',
      cyc.map(function (c) { return c.id + '@' + c.fps + '/' + c.opacity; }).join(' '));
    ok(cyc.every(function (c) { return c.box === '1425x900'; }),
      'the canvas fills the viewport, not a strip of it', cyc[0].box);

    await evalJs(ws, sessionId,
      `document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }))`);
    await sleep(200);
    ok(await evalJs(ws, sessionId, `window.VSFX.rain.mode`) === 'STORM',
      'pressing M tips it into the storm');

    /* is it actually painting, and is the storm actually heavier?
       Counting lit pixels is the only honest way to answer that. */
    const ink = await evalJs(ws, sessionId, `(function(){
      var cv = document.getElementById('vsRain'), g = cv.getContext('2d');
      function lit() {
        var d = g.getImageData(0, 0, cv.width, cv.height).data, n = 0;
        for (var i = 0; i < d.length; i += 4) if (d[i+1] > 120 || d[i+2] > 120) n++;
        return n;
      }
      function to(id) { var guard = 0;
        while (window.VSFX.rain.mode !== id && guard++ < 8) document.getElementById('vsRainBtn').click(); }
      return new Promise(function (res) {
        to('CALM');
        setTimeout(function () {
          var calm = lit();
          to('STORM');
          setTimeout(function () { res({ calm: calm, storm: lit() }); }, 1800);
        }, 1800);
      });
    })()`);
    ok(ink.calm > 200, 'the calm field is really drawing glyphs', 'lit=' + ink.calm);
    ok(ink.storm > ink.calm * 1.4,
      'and the storm draws considerably more of them',
      'calm=' + ink.calm + ' storm=' + ink.storm);

    /* a click on the background throws a pulse; a click on a control
       must never be eaten by the decoration */
    await sleep(2200);
    ok(Number(await evalJs(ws, sessionId, `window.VSFX.rain.waves`)) === 0,
      'the field settles with no pulse in flight');
    await evalJs(ws, sessionId, `(function(){
      document.body.dispatchEvent(new PointerEvent('pointerdown',
        { clientX: 520, clientY: 420, bubbles: true }));
      return 1; })()`);
    ok(Number(await evalJs(ws, sessionId, `window.VSFX.rain.waves`)) >= 1,
      'clicking the background throws a pulse');
    await sleep(2200);
    await evalJs(ws, sessionId, `(function(){
      document.getElementById('vsRainBtn').dispatchEvent(new PointerEvent('pointerdown',
        { clientX: 4, clientY: 4, bubbles: true }));
      return 1; })()`);
    ok(Number(await evalJs(ws, sessionId, `window.VSFX.rain.waves`)) === 0,
      'and a click on a control is left alone');

    /* typing falls through the glyphs — six letters, read back in
       the same tick so the frame loop cannot have drained them yet */
    const echo = await evalJs(ws, sessionId, `(function(){
      var before = window.VSFX.rain.echo;
      'GHOST'.split('').forEach(function (k) {
        document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true }));
      });
      return { before: before, after: window.VSFX.rain.echo };
    })()`);
    ok(echo.before === 0 && echo.after >= 5,
      'whatever you type falls into the rain', echo.before + '→' + echo.after);

    /* resting the pointer on a row hands that address to the field */
    const lock = await evalJs(ws, sessionId, `(function(){
      var tr = document.querySelector('#vsBody .vs-row');
      if (!tr) return { err: 'no rows' };
      tr.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
      return { ip: (tr.querySelector('.vs-ipv') || {}).textContent || '',
               focus: window.VSFX.rain.focus };
    })()`);
    ok(lock.ip && lock.focus === lock.ip,
      'resting on a row makes the field spell that address', lock.ip + ' → ' + lock.focus);

    /* the dressing that came with this round */
    const trim = await evalJs(ws, sessionId, `(function(){
      var f = document.querySelector('.vs-frame');
      return { noise: !!document.querySelector('.vs-fx-noise'),
               frame: !!f,
               wraps: !!(f && f.querySelector('.vs-scroll')),
               fxOverflow: getComputedStyle(document.querySelector('.vs-fx')).overflow };
    })()`);
    ok(trim.noise, 'the grain layer is over the whole field');
    ok(trim.frame && trim.wraps, 'the roll sits inside the bracketed frame');
    ok(trim.fxOverflow === 'hidden',
      'and the field is clipped, so the storm cannot open a scrollbar', trim.fxOverflow);

    /* ---------- hold still when asked ----------
       This is the promise every effect on the page makes, so it is
       worth asserting rather than trusting: under reduced motion the
       rain never starts, the wire never scrolls, the boot splash is
       skipped — and the roll itself still works. */
    await send(ws, 'Emulation.setEmulatedMedia',
      { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    await send(ws, 'Page.reload', {}, sessionId);
    await sleep(4500);

    /* neutralize the gate again after the reload (it re-arms) */
    await evalJs(ws, sessionId, `(function(){
      document.body.classList.remove('is-locked');
      var l = document.getElementById('vsLogin'); if (l) l.classList.remove('is-on');
      var w = document.getElementById('vsWelcome'); if (w) { w.classList.remove('is-on'); w.hidden = true; }
      return 1; })()`);

    ok(await evalJs(ws, sessionId,
      `getComputedStyle(document.getElementById('vsRain')).display === 'none'`),
      'the code rain never starts under prefers-reduced-motion');
    ok(await evalJs(ws, sessionId,
      `getComputedStyle(document.getElementById('vsWireRun')).animationName === 'none'`),
      'the wire holds still instead of scrolling');
    ok(await evalJs(ws, sessionId, `!document.getElementById('vsBoot')`),
      'the boot splash is skipped rather than played');
    ok(Number(await evalJs(ws, sessionId,
      `document.querySelectorAll('#vsBody .vs-row').length`)) > 0,
      'and the roll still works with every moving part off');
    ok(Number(await evalJs(ws, sessionId,
      'document.documentElement.scrollWidth - document.documentElement.clientWidth')) <= 1,
      'nothing overflows sideways with the effects off');
    await send(ws, 'Emulation.setEmulatedMedia', { features: [] }, sessionId);

    ok(errors.length === 0, 'console clean', errors.slice(0, 3).join(' | '));

    ws.close();
  } catch (e) {
    ok(false, 'harness threw', e.message);
  } finally {
    edge.kill();
    srv.kill();
    await sleep(400);
    for (let i = 0; i < 6; i++) {
      try { fs.rmSync(SANDBOX, { recursive: true, force: true }); break; }
      catch (_) { await sleep(300); }
    }
  }

  console.log('\n' + (fail ? fail + ' FAILURE(S)' : 'visits-page suite clean') + '   (' + pass + ' passed)');
  process.exit(fail ? 1 : 0);
})();
