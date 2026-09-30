/* probe-home-armillary.js — audit the armillary sphere that now sits at the
   bottom of the home page, in the slot the hexagram used to hold.

     • the canvas rig stays out of the first paint (lazy injection)
     • the mount really boots once the section is a screen away
     • it is toned with the site's own CSS variables (day + night)
     • no console errors, no horizontal scroll, desktop + phone
     • the frame budget holds, and prefers-reduced-motion / touch degrade
   usage: node tools/probe-home-armillary.js                                */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'docs');
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP_PORT = 9312;
const HTTP_PORT = 8907;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.mp3': 'audio/mpeg', '.mp4': 'video/mpeg',
};

/* Writes the owner would trigger are recorded here, never applied —
   docs/data/*.json is not ours to touch from a test. */
const posted = [];

const srv = http.createServer((req, res) => {
  const p = decodeURIComponent(req.url.split('?')[0]);
  /* owner mode: answer the content API from the baked json so main.js
     takes the editable branch. POSTs are acknowledged, not persisted. */
  const api = p.match(/^\/api\/([a-z]+)$/);
  if (api) {
    const file = path.join(PUB, 'data', api[1] + '.json');
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        posted.push({ path: p, body });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ok":true}');
      });
      return;
    }
    if (fs.existsSync(file)) {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      fs.createReadStream(file).pipe(res);
      return;
    }
  }
  const f = path.join(PUB, p === '/' ? '/index.html' : p);
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
  const URL_HOME = `http://127.0.0.1:${HTTP_PORT}/index.html`;
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

    /* the static server has no /api, so 404s from the fallback chain are
       expected noise — everything else counts */
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
    const media = (features) => send(ws, 'Emulation.setEmulatedMedia', { features }, sid);
    const metrics = (width, height, mobile) => send(ws, 'Emulation.setDeviceMetricsOverride',
      { width, height, deviceScaleFactor: 1, mobile }, sid);
    const open = async () => { await send(ws, 'Page.navigate', { url: URL_HOME }, sid); await sleep(2400); };
    const toBottom = async () => {
      await ev(`document.querySelector('.home-sigil').scrollIntoView({block:'center'})`);
      await sleep(1800);
    };

    /* ================= desktop ================= */
    await metrics(1440, 1000, false);
    await open();

    ok(errs.length === 0, 'console clean' + (errs.length ? ' -> ' + errs.join(' | ') : ''));

    const first = await ev(`({
      hex: document.querySelectorAll('.sigil-svg').length,
       mount: !!document.querySelector('.sigil-orrery[data-kstage="orrery"]'),
       kjs: performance.getEntriesByType('resource').filter(r => /kstage\\.js/.test(r.name)).length,
       cssOrder: [...document.querySelectorAll('link[rel=stylesheet]')].map(l => l.getAttribute('href')),
       name: (document.getElementById('sigilName').textContent || '').trim()
    })`);
    ok(first.hex === 0, 'hexagram is gone (0 .sigil-svg left)');
    ok(first.mount, 'armillary mount point sits in the section');
    ok(first.kjs === 0, 'first paint carries no kstage.js (' + first.kjs + ' request)');
    ok(first.cssOrder[0].indexOf('kstage.css') > -1,
      'kstage.css loads before style.css (' + first.cssOrder.join(' , ') + ')');

    /* ---- scroll down: the rig must arrive and boot ---- */
    await toBottom();
    const live = await ev(`(() => {
      const el = document.querySelector('.sigil-orrery');
      const c = el.querySelector('canvas');
      const kjs = performance.getEntriesByType('resource').filter(r => /kstage\\.js/.test(r.name));
      const box = el.getBoundingClientRect();
      const nm = document.getElementById('sigilName').getBoundingClientRect();
      return {
        live: el.classList.contains('is-live'),
        cw: c ? c.width : 0, ch: c ? c.height : 0,
        kjs: kjs.length, kbytes: Math.round((kjs[0] ? kjs[0].transferSize || kjs[0].encodedBodySize || 0 : 0) / 1024),
        w: Math.round(box.width), h: Math.round(box.height),
        nameBelow: nm.top >= box.bottom - 1,
        name: document.getElementById('sigilName').textContent.trim(),
        kind: el.__kstage && el.__kstage.kind
      };
    })()`);
    ok(live.kjs === 1, 'kstage.js injected exactly once after scrolling (' + live.kjs + ')');
    ok(live.live && live.kind === 'orrery', 'the armillary booted (' + live.kind + ', is-live ' + live.live + ')');
    ok(live.cw > 200 && live.ch > 200, `canvas backing store sized ${live.cw}x${live.ch}`);
    ok(Math.abs(live.w - live.h) <= 2, `box stays square ${live.w}x${live.h} (no layout shift)`);
    ok(live.nameBelow, 'the name now sits below the sphere, not on top of it');
    ok(live.name.length > 0, 'name still fed from the profile ("' + live.name + '")');

    /* ---- the sphere blends in: no engineering grid, no scan line ---- */
    const chrome = await ev(`(() => {
      const st = document.querySelector('.sigil-orrery').__kstage;
      return { grid: st.opts.grid, scan: st.opts.scan, hud: st.opts.hud,
               wash: st.opts.wash, brackets: st.opts.brackets, readout: st.opts.readout,
               global: { grid: window.KStage.opts.grid, scan: window.KStage.opts.scan,
                         wash: window.KStage.opts.wash, brackets: window.KStage.opts.brackets },
               attr: document.querySelector('.sigil-orrery').getAttribute('data-opts') };
    })()`);
    ok(chrome.grid === false && chrome.scan === false && chrome.wash === false &&
       chrome.brackets === false && chrome.hud === false,
      `instrument chrome stripped (grid ${chrome.grid}, scan ${chrome.scan}, wash ${chrome.wash}, brackets ${chrome.brackets}, hud ${chrome.hud})`);
    ok(chrome.readout === true, 'the world-line readout stays — it is data, not chrome (readout ' + chrome.readout + ')');
    ok(chrome.global.grid === true && chrome.global.scan === true &&
       chrome.global.wash === true && chrome.global.brackets === true,
      'the override is local to this mount — the global switches are untouched');

    /* nothing but the drawing: the canvas must leave the paper untouched */
    const blend = await ev(`(() => {
      const c = document.querySelector('.sigil-orrery .kstage-canvas');
      const b = c.getBoundingClientRect();
      const g = c.getContext('2d');
      /* four corners of the backing store — with the wash off they are
         fully transparent, i.e. nothing is painted over the page */
      const px = (x, y) => g.getImageData(Math.round(x), Math.round(y), 1, 1).data[3];
      return { tl: px(2, 2), tr: px(c.width - 3, 2), bl: px(2, c.height - 3), br: px(c.width - 3, c.height - 3),
               w: c.width, h: c.height };
    })()`);
    ok(blend.tl === 0 && blend.tr === 0 && blend.bl === 0 && blend.br === 0,
      `canvas corners are transparent — no wash, no frame (alpha ${blend.tl}/${blend.tr}/${blend.bl}/${blend.br})`);

    /* ---- zoom in hard: the sphere must bottom out at its fit bound, and
         one click on the reset button brings the view home ---- */
    const sendWheel = async (dy) => send(ws, 'Input.dispatchMouseEvent',
      { type: 'mouseWheel', x: (await ev(`(() => { const r = document.querySelector('.sigil-orrery').getBoundingClientRect(); return r.left + r.width / 2; })()`)),
        y: (await ev(`(() => { const r = document.querySelector('.sigil-orrery').getBoundingClientRect(); return r.top + r.height / 2; })()`)),
        deltaX: 0, deltaY: dy }, sid);
    /* 新规则：滚轮默认归页面滚动，只有跟装置互动过（4s 内）滚轮才缩放。
       所以先点一下画布"激活"，再发滚轮。 */
    const engage = async () => {
      const cc = await ev(`(() => { const r = document.querySelector('.sigil-orrery').getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
      await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: cc.x, y: cc.y, button: 'left', clickCount: 1 }, sid);
      await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: cc.x, y: cc.y, button: 'left', clickCount: 1 }, sid);
      await sleep(80);
    };
    await engage();
    for (let i = 0; i < 14; i++) { await sendWheel(-160); await sleep(60); }
    await sleep(700);
    const zf = await ev(`(() => { const s = document.querySelector('.sigil-orrery').__kstage;
      return { lo: s.impl.fit(s), dist: s.impl.debug().dist, rb: s._rb, w: s.w, h: s.h }; })()`);
    ok(zf.dist + 1e-6 >= zf.lo,
      `zoom-in bottoms at the fit bound, nothing clipped (dist ${zf.dist.toFixed(3)} ≥ fit ${zf.lo.toFixed(3)})`);
    ok(zf.rb && zf.rb[0] > 0 && zf.rb[0] < zf.w && zf.rb[1] > 0 && zf.rb[1] < zf.h,
      'reset button is drawn inside the canvas');
    /* 彩蛋语义：两星重合（含 6s 宽限）时复位键只触发彩蛋不复位。
       等宽限期结束，再测真正的复位。 */
    for (let i = 0; i < 30; i++) {
      const a = await ev(`(() => { const s = document.querySelector('.sigil-orrery').__kstage;
        return s.impl.egg ? s.impl.egg().aligned : false; })()`);
      if (!a) break;
      await sleep(500);
    }
    const brb = await ev(`(() => { const r = document.querySelector('.sigil-orrery canvas').getBoundingClientRect();
      const rb = document.querySelector('.sigil-orrery').__kstage._rb; return { x: r.left + rb[0], y: r.top + rb[1] }; })()`);
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mousePressed', x: brb.x, y: brb.y, button: 'left', clickCount: 1 }, sid);
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseReleased', x: brb.x, y: brb.y, button: 'left', clickCount: 1 }, sid);
    await sleep(500);
    const zr = await ev(`(() => { const s = document.querySelector('.sigil-orrery').__kstage;
      return s.impl.debug().dist; })()`);
    ok(Math.abs(zr - 3.4) < 0.01, `one click on the reset button restores the default view (dist ${zr.toFixed(2)})`);

    /* ---- member pins: one click locates / locks / follows ---- */
    const pins = await ev(`(() => [...document.querySelectorAll('#sigilPins button')]
      .map(b => b.dataset.member + ':' + b.textContent.trim()).join(' | '))()`);
    ok(pins.split(' | ').length === 5, '5 member pins beside the sphere (' + pins + ')');
    await ev(`document.querySelector('#sigilPins button[data-member="4"]').click()`);
    await sleep(400);
    const p4 = await ev(`(() => { const s = document.querySelector('.sigil-orrery').__kstage;
      const d = s.impl.debug(); return { lock: d.lock, follow: d.follow,
        on: [...document.querySelectorAll('#sigilPins button')].map(b => b.classList.contains('on')).join(',') }; })()`);
    ok(p4.lock === 3 && p4.follow === true,
      `pin 004 locks member IV and starts following (lock ${p4.lock}, follow ${p4.follow})`);
    ok(p4.on.split(',')[3] === 'true', 'the active pin lights up (' + p4.on + ')');
    await ev(`document.querySelector('#sigilPins button[data-member="4"]').click()`);
    await sleep(300);
    const p4b = await ev(`(() => { const s = document.querySelector('.sigil-orrery').__kstage;
      const d = s.impl.debug(); return { lock: d.lock, follow: d.follow }; })()`);
    ok(p4b.lock < 0 && p4b.follow === false,
      'clicking the active pin again releases the lock (lock ' + p4b.lock + ')');

    /* ---- the editable caption beside it ---- */
    const note0 = await ev(`(() => {
      const n = document.getElementById('sigilNote');
      const s = document.querySelector('.sigil').getBoundingClientRect();
      const bl = document.querySelector('.sigil-block').getBoundingClientRect();
      const r = n.getBoundingClientRect();
      return { exists: !!n, hidden: n.hidden, editable: n.classList.contains('editable'),
               empty: n.classList.contains('is-empty'), text: (n.textContent || '').trim(),
               w: Math.round(r.width),
               under: r.top >= s.bottom - 2,
               rightAligned: Math.abs(r.right - bl.right) <= 2,
               sphereCentred: Math.abs((s.left + s.right) / 2 - (bl.left + bl.right) / 2) <= 2,
               align: getComputedStyle(n).textAlign };
    })()`);
    ok(note0.exists && !note0.hidden, 'caption is there for the owner');
    ok(note0.editable && note0.empty, 'empty caption shows its dashed placeholder and is editable');
    ok(note0.under && note0.rightAligned,
      `caption hangs off the bottom-right of the block (${note0.w}px wide, ${note0.align})`);
    ok(note0.sphereCentred, 'the sphere is centred in the section');

    /* double-click → input → Enter → saved (the POST is recorded, not applied) */
    await ev(`(() => { const n = document.getElementById('sigilNote');
      n.dispatchEvent(new MouseEvent('dblclick', { bubbles: true })); })()`);
    await sleep(250);
    const hasInput = await ev(`!!document.querySelector('#sigilNote .t-edit')`);
    ok(hasInput, 'double-click opens an inline editor');
    await ev(`(() => { const i = document.querySelector('#sigilNote .t-edit');
      i.value = '一台會自己走的渾天儀。\\n拖著它轉，鬆手後還是回到原位。';
      /* Enter = newline now; saving is Ctrl+Enter */
      i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true })); })()`);
    await sleep(600);
    const saved = await ev(`(() => { const n = document.getElementById('sigilNote');
      return { text: (n.textContent || '').trim(), empty: n.classList.contains('is-empty'),
               lines: (n.textContent || '').trim().split('\\n').length }; })()`);
    ok(saved.text.startsWith('一台會自己走的渾天儀。') && saved.lines === 2,
      'the new words show up right away, with the line break kept ("' + saved.text.replace(/\n/g, ' / ') + '")');
    ok(!saved.empty, 'placeholder styling drops once there is text');
    ok(posted.some((x) => x.path === '/api/profile' && /armNote/.test(x.body)),
      'the edit went to api/profile (' + JSON.stringify(posted.map((x) => x.path)) + ')');

    /* ---- tokens: the canvas reads the site's palette, not its own ---- */
    const tone = await ev(`(() => {
      const el = document.querySelector('.sigil-orrery');
      const cs = getComputedStyle(el);
      const root = getComputedStyle(document.documentElement);
      const pick = n => cs.getPropertyValue(n).trim();
      return {
        ink: pick('--ks-ink'), siteInk: root.getPropertyValue('--ink').trim(),
        accent: pick('--ks-accent'), siteAccent: root.getPropertyValue('--accent').trim(),
        paper: pick('--ks-paper'), siteBg: root.getPropertyValue('--bg').trim(),
        theme: document.documentElement.dataset.theme
      };
    })()`);
    ok(tone.ink === tone.siteInk && tone.accent === tone.siteAccent && tone.paper === tone.siteBg,
      `--ks-* follow the site tokens (ink ${tone.ink} / accent ${tone.accent} / paper ${tone.paper}, theme ${tone.theme})`);

    /* ---- dark mode re-tunes without a reload ---- */
    const dark = await ev(`(() => {
      document.documentElement.dataset.theme = 'dark';
      const cs = getComputedStyle(document.querySelector('.sigil-orrery'));
      const root = getComputedStyle(document.documentElement);
      return { accent: cs.getPropertyValue('--ks-accent').trim(),
               siteAccent: root.getPropertyValue('--accent').trim(),
               glow: cs.getPropertyValue('--ks-glow').trim() };
    })()`);
    await sleep(400);
    ok(dark.accent === dark.siteAccent, `night mode re-points the accent (${dark.accent}, glow ${dark.glow})`);
    await ev(`document.documentElement.dataset.theme = 'light'`);

    /* ---- frame budget with the sphere on screen ---- */
    const fps = await ev(`new Promise(r => { let n = 0; const t0 = performance.now();
      const t = () => { n++; if (performance.now() - t0 < 1500) requestAnimationFrame(t); else r(Math.round(n / 1.5)); };
      requestAnimationFrame(t); })`);
    ok(fps >= 45, `frame pacing ${fps} fps with the armillary running`);

    const scroll = await ev(`({ sw: document.documentElement.scrollWidth, iw: window.innerWidth,
      sh: document.body.scrollHeight, foot: document.querySelector('.site-footer').getBoundingClientRect().top })`);
    ok(scroll.sw <= scroll.iw + 1, `no horizontal scroll (${scroll.sw} <= ${scroll.iw})`);
    ok(scroll.foot > 0, 'footer still pushed below the section');

    /* ================= phone =================
       NB: Emulation.setEmulatedMedia cannot fake hover/pointer in this
       build — only setTouchEmulationEnabled flips them. */
    await metrics(390, 844, true);
    await send(ws, 'Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sid);
    await open();
    await toBottom();
    const ph = await ev(`(() => {
      const el = document.querySelector('.sigil-orrery');
      const c = el.querySelector('canvas');
      const b = el.getBoundingClientRect();
      const n = document.getElementById('sigilNote');
      const nb = n.getBoundingClientRect();
      return { sw: document.documentElement.scrollWidth, iw: window.innerWidth,
               w: Math.round(b.width), left: Math.round(b.left),
               live: el.classList.contains('is-live'),
               hoverNone: matchMedia('(hover: none), (pointer: coarse)').matches,
               pe: c ? getComputedStyle(c).pointerEvents : 'n/a',
               ta: c ? getComputedStyle(c).touchAction : 'n/a',
               taBox: getComputedStyle(el).touchAction,
               noteHidden: n.hidden, noteText: (n.textContent || '').trim().length,
               noteVisible: nb.height > 0 && nb.top < window.innerHeight + nb.height,
               cx: Math.round(b.left + b.width / 2), cy: Math.round(b.top + b.height / 2),
               dist0: el.__kstage ? el.__kstage.impl.debug().dist : 0 };
    })()`);
    ok(ph.hoverNone, 'phone: touch really is being emulated (hover:none matched)');
    ok(ph.sw <= ph.iw + 1, `phone: no horizontal scroll (${ph.sw} <= ${ph.iw})`);
    ok(ph.left >= 0 && ph.left + ph.w <= ph.iw + 1, `phone: sphere inside the viewport (${ph.left}..${ph.left + ph.w} of ${ph.iw})`);
    ok(ph.live, 'phone: sphere still boots');
    ok(ph.pe !== 'none' && ph.ta === 'pan-y' && ph.taBox === 'pan-y',
      `phone: canvas takes touches, vertical swipe still scrolls (pointer-events ${ph.pe}, touch-action ${ph.ta})`);
    ok(!ph.noteHidden && ph.noteText > 0,
      `phone: the caption is rendered, never display-locked (${ph.noteText} chars)`);

    /* pinch out (fingers spread) must zoom the model in — dist shrinks */
    const touch = (type, points) => send(ws, 'Input.dispatchTouchEvent', { type, touchPoints: points }, sid);
    const spread = async (gap) => touch('touchMove', [
      { x: ph.cx - gap / 2, y: ph.cy, id: 1 }, { x: ph.cx + gap / 2, y: ph.cy, id: 2 }]);
    await touch('touchStart', [{ x: ph.cx - 40, y: ph.cy, id: 1 }]);
    await touch('touchStart', [{ x: ph.cx - 40, y: ph.cy, id: 1 }, { x: ph.cx + 40, y: ph.cy, id: 2 }]);
    for (const g of [96, 116, 140, 168, 200]) { await spread(g); await sleep(40); }
    await touch('touchEnd', []);
    await sleep(120);
    const pinch = await ev(`(() => { const s = document.querySelector('.sigil-orrery').__kstage;
      return { dist: s.impl.debug().dist, pinching: !!s._pinch }; })()`);
    ok(pinch.dist < ph.dist0 - 0.15,
      `phone: two-finger pinch zooms the model (dist ${ph.dist0.toFixed(2)} -> ${pinch.dist.toFixed(2)})`);
    ok(!pinch.pinching, 'phone: pinch state released after both fingers lift');

    /* and a tap on the reset button brings it home again
       （重合宽限期内复位键只触发彩蛋，先等宽限期结束） */
    for (let i = 0; i < 30; i++) {
      const a = await ev(`(() => { const s = document.querySelector('.sigil-orrery').__kstage;
        return s.impl.egg ? s.impl.egg().aligned : false; })()`);
      if (!a) break;
      await sleep(500);
    }
    const trb = await ev(`(() => { const r = document.querySelector('.sigil-orrery').getBoundingClientRect();
      const rb = document.querySelector('.sigil-orrery').__kstage._rb;
      return rb ? { x: Math.round(r.left + rb[0]), y: Math.round(r.top + rb[1]) } : null; })()`);
    ok(!!trb, 'phone: reset button is drawn on the small canvas too');
    await touch('touchStart', [{ x: trb.x, y: trb.y, id: 1 }]);
    await sleep(60);
    await touch('touchEnd', []);
    await sleep(150);
    const trst = await ev(`document.querySelector('.sigil-orrery').__kstage.impl.debug().dist`);
    ok(Math.abs(trst - 3.4) < 0.05, `phone: tapping the reset button restores the view (dist ${trst.toFixed(2)})`);

    /* ================= reduced motion ================= */
    await metrics(1440, 1000, false);
    await send(ws, 'Emulation.setTouchEmulationEnabled', { enabled: false }, sid);
    await media([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    await open();
    await toBottom();
    const rm = await ev(`(() => {
      const el = document.querySelector('.sigil-orrery');
      const st = el.__kstage;
      const nm = getComputedStyle(document.getElementById('sigilName')).animationName;
      return { rm: st ? st.RM : null, live: el.classList.contains('is-live'),
               spin: window.KStage ? window.KStage.opts.spin : null,
               nameAnim: nm };
    })()`);
    ok(rm.live && rm.rm === true, 'reduced motion: sphere still renders, clocks frozen (RM ' + rm.rm + ')');
    ok(rm.nameAnim === 'none', 'reduced motion: the name stops flickering (animation ' + rm.nameAnim + ')');
    await media([]);

    ok(errs.length === 0, 'console still clean at the end' + (errs.length ? ' -> ' + errs.join(' | ') : ''));
    console.log(bad ? `\n${bad} FAILURE(S)` : '\nhome armillary suite clean');
  } catch (e) {
    console.log('PROBE ERROR —', e.message);
    bad++;
  } finally {
    try { edge.kill(); } catch (_) { }
    srv.close();
    process.exit(bad ? 1 : 0);
  }
})();
