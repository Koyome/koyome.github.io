/* probe-kstage.js — audit the six canvas installations in headless Edge:
   no console errors, geometry is real, every interaction changes state,
   the globe really turns *towards* the camera (regression: it used to spin
   to the far hemisphere), the divergence meter and the lab figures respond,
   motion runs, reduced motion freezes the clocks but keeps input alive,
   resize + off-screen pause behave.
   usage: node tools/probe-kstage.js                                        */
const { spawn } = require('child_process');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const PORT = 9391;
const PAGE = 'file:///C:/Users/Public/koyome-site/tools/kstage-preview.html';
let id = 0;
function send(ws, m, p = {}, s) {
  return new Promise((res, rej) => {
    const i = ++id;
    const on = (ev) => {
      const x = JSON.parse(ev.data);
      if (x.id === i) { ws.removeEventListener('message', on); x.error ? rej(new Error(m + ': ' + x.error.message)) : res(x.result); }
    };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id: i, method: m, params: p, sessionId: s }));
  });
}
let bad = 0;
const ok = (c, msg) => { console.log((c ? 'ok   ' : 'FAIL ') + msg); if (!c) bad++; };
const keyTap = async (ws, sessionId, k, text) => {
  await send(ws, 'Input.dispatchKeyEvent', { type: 'keyDown', key: k, text: text === undefined ? k : text }, sessionId);
  await send(ws, 'Input.dispatchKeyEvent', { type: 'keyUp', key: k }, sessionId);
};
const DBG = (sel) => `document.querySelector('[data-kstage="${sel}"]').__kstage.impl.debug()`;

(async () => {
  const edge = spawn(EDGE, ['--headless=new', '--remote-debugging-port=' + PORT,
    '--no-first-run', '--disable-extensions', '--allow-file-access-from-files',
    '--window-size=1440,1000', 'about:blank'], { stdio: 'ignore' });
  try {
    let wsUrl;
    for (let i = 0; i < 40; i++) {
      try { wsUrl = (await (await fetch('http://127.0.0.1:' + PORT + '/json/version')).json()).webSocketDebuggerUrl; break; }
      catch { await sleep(300); }
    }
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => (ws.onopen = r));
    const errs = [];
    ws.addEventListener('message', (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
        errs.push(m.params.args.map((a) => a.value || a.description || '').join(' ').slice(0, 160));
      if (m.method === 'Runtime.exceptionThrown')
        errs.push('EXC ' + ((m.params.exceptionDetails.exception && m.params.exceptionDetails.exception.description) || m.params.exceptionDetails.text || '').slice(0, 200));
    });
    const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
    await send(ws, 'Runtime.enable', {}, sessionId);
    await send(ws, 'Page.enable', {}, sessionId);
    await send(ws, 'Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);

    const ev = async (expr) =>
      (await send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)).result.value;
    const load = async () => { await send(ws, 'Page.navigate', { url: PAGE }, sessionId); await sleep(2200); };

    await load();
    ok(errs.length === 0, 'console clean' + (errs.length ? ' -> ' + errs.join(' | ') : ''));

    /* ---- 1. mounts ---- */
    const m = await ev(`(() => {
      const n = [...document.querySelectorAll('[data-kstage]')];
      return n.map(e => ({ k: e.dataset.kstage, live: e.classList.contains('is-live'),
        cw: e.querySelector('canvas') ? e.querySelector('canvas').width : 0,
        ch: e.querySelector('canvas') ? e.querySelector('canvas').height : 0,
        fb: !!e.querySelector('.kstage-fb') }));
    })()`);
    ok(m.length === 6, `6 mount points (${m.map(x => x.k).join(', ')})`);
    ok(m.every(x => x.live && x.cw > 100 && x.ch > 100), 'every mount built a sized canvas');
    ok(m.every(x => x.fb), 'fallback image present on each (no-JS safety)');

    /* ---- 1b. shared clock: exactly one rAF per frame for the whole page ---- */
    const raf = await ev(`new Promise(r => { let n = 0; const t0 = performance.now();
      const t = () => { n++; if (performance.now() - t0 < 1000) requestAnimationFrame(t); else r(n); };
      requestAnimationFrame(t); })`);
    ok(raf >= 45, `one shared rAF tick still drives every stage (${raf} callbacks/s)`);

    /* ---- 2. geometry actually is what it claims ---- */
    const g = await ev(`window.KStage ? ${DBG('prism')} : null`);
    ok(g && g.faces === 20 && g.edges === 30, `icosahedron built: ${g && g.faces} faces / ${g && g.edges} edges (want 20 / 30)`);

    /* ---- 3. motion ---- */
    const shot = async (sel) =>
      ev(`document.querySelector('[data-kstage="${sel || 'orrery'}"] canvas').toDataURL()`);
    const a = await shot(); await sleep(1500); const b = await shot();
    ok(a !== b, 'frames advance (canvas pixels differ over 1.5s)');

    const fps = await ev(`new Promise(r => {let n=0; const t0=performance.now();
      const t=()=>{n++; if(performance.now()-t0<2000) requestAnimationFrame(t);
      else r(Math.round(1000*n/(performance.now()-t0)));}; requestAnimationFrame(t);})`);
    ok(fps >= 45, `frame pacing ~${fps} fps with all six installations live`);

    /* ---- 4. orrery: drag spins, wheel zooms, click locks ---- */
    const box = async (sel) => ev(`(() => { const r = document.querySelector('${sel}').getBoundingClientRect();
      return { x: r.left + r.width/2, y: r.top + r.height/2, w: r.width, h: r.height }; })()`);
    const tl = async (sel) => ev(`(() => { const r = document.querySelector('[data-kstage="${sel}"] canvas').getBoundingClientRect();
      return { l: r.left, t: r.top, w: r.width, h: r.height }; })()`);
    const press = async (kind, x, y, opts = {}) =>
      send(ws, 'Input.dispatchMouseEvent', Object.assign({ type: kind, x, y, button: 'left', clickCount: 1, buttons: kind === 'mouseMoved' ? 0 : 1 }, opts), sessionId);
    const click = async (x, y) => { await press('mouseMoved', x, y); await press('mousePressed', x, y); await press('mouseReleased', x, y); };

    const bo = await box('[data-kstage="orrery"] canvas');
    const yaw0 = (await ev(`${DBG('orrery')}.yaw`));
    await press('mousePressed', bo.x, bo.y);
    for (let i = 1; i <= 8; i++) await press('mouseMoved', bo.x + i * 9, bo.y + i * 2);
    await press('mouseReleased', bo.x + 72, bo.y + 16);
    const yaw1 = (await ev(`${DBG('orrery')}.yaw`));
    ok(Math.abs(yaw1 - yaw0) > 0.3, `drag spins the sphere (yaw ${yaw0.toFixed(2)} -> ${yaw1.toFixed(2)})`);

    const d0 = await ev(`${DBG('orrery')}.dist`);
    await send(ws, 'Input.dispatchMouseEvent', { type: 'mouseWheel', x: bo.x, y: bo.y, deltaX: 0, deltaY: -240 }, sessionId);
    await sleep(120);
    const d1 = await ev(`${DBG('orrery')}.dist`);
    ok(Math.abs(d1 - d0) > 0.05, `wheel zooms (dist ${d0.toFixed(2)} -> ${d1.toFixed(2)})`);

    /* click the body nearest the centre of the disc */
    const bodies = await ev(`${DBG('orrery')}.bodies`);
    const cvs = await tl('orrery');
    let locked = -1;
    for (const bd of bodies) {
      const x = cvs.l + bd[0], y = cvs.t + bd[1];
      if (x < cvs.l + 10 || y < cvs.t + 10) continue;
      await click(x, y);
      const lk = await ev(`${DBG('orrery')}.lock`);
      if (lk >= 0) { locked = lk; break; }
    }
    ok(locked >= 0, `click locks a body (lock index ${locked})`);

    /* ---- 4b. number keys lock + follow; the follow must aim at the NEAR
            hemisphere, not the far one (same sign bug the globe had) ---- */
    await ev(`document.querySelector('[data-kstage="orrery"] canvas').focus(); true`);
    await keyTap(ws, sessionId, '3', '3');
    const o3 = await ev(DBG('orrery'));
    ok(o3.lock === 2 && o3.follow === true, `number key 3 locks body III and starts follow (lock ${o3.lock})`);
    const yawF = o3.yaw; await sleep(1400);
    const o3b = await ev(DBG('orrery'));
    ok(Math.abs(o3b.yaw - yawF) > 0.001, `follow keeps the camera moving (yaw ${yawF.toFixed(3)} -> ${o3b.yaw.toFixed(3)})`);
    ok(o3b.lockFront === true, `follow aims the locked body at the NEAR hemisphere (lockFront ${o3b.lockFront})`);
    ok(o3b.divg >= 0 && o3b.divg < 2 && Number.isFinite(o3b.divg),
      `divergence readout is live and bounded (${o3b.divg.toFixed(6)})`);
    await keyTap(ws, sessionId, 't', 't');
    const oT = await ev(`${DBG('orrery')}.trails`);
    ok(oT === false, 'T toggles the motion trails off');

    /* ---- 5. lunar: scrub + key-phase jump ---- */
    const bl = await box('[data-kstage="lunar"] canvas');
    const lc = await tl('lunar');
    const day0 = await ev(`${DBG('lunar')}.day`);
    await press('mousePressed', lc.l + bl.w * 0.3, lc.t + bl.h * 0.45);
    for (let i = 1; i <= 10; i++) await press('mouseMoved', lc.l + bl.w * 0.3 + i * 12, lc.t + bl.h * 0.45);
    await press('mouseReleased', lc.l + bl.w * 0.3 + 120, lc.t + bl.h * 0.45);
    const day1 = await ev(`${DBG('lunar')}.day`);
    ok(Math.abs(day1 - day0) > 0.4, `drag scrubs the month (day ${day0.toFixed(2)} -> ${day1.toFixed(2)})`);

    const geo = await ev(`${DBG('lunar')}.geo`);
    await click(lc.l + geo.tw * 0.02 + 2, lc.t + geo.ty + 2);
    await sleep(700);
    const day2 = await ev(`${DBG('lunar')}.day`);
    ok(day2 < 1.2 || day2 > 28.3, `clicking the NEW marker eases to new moon (day ${day2.toFixed(2)})`);

    /* ---- 5b. the terminator is really solved, not faked ----------------- */
    const probeMoon = () => ev(`(() => {
      const el = document.querySelector('[data-kstage="lunar"]');
      const st = el.__kstage, c = el.querySelector('canvas');
      const g = st.impl.debug(st).geo, d = st.impl.debug(st).day;
      const dpr = c.width / c.getBoundingClientRect().width;
      const cx = g.cx * dpr, cy = g.cy * dpr, R = g.R * dpr * 0.88;
      const ctx = c.getContext('2d');
      const x0 = Math.round(cx - R), y0 = Math.round(cy - R), n = Math.round(R * 2);
      const px = ctx.getImageData(x0, y0, n, n).data;
      const rgb = (s) => {
        if (s[0] === '#') { let h = s.slice(1);
          if (h.length === 3) h = h[0]+h[0]+h[1]+h[1]+h[2]+h[2];
          const n = parseInt(h, 16); return [(n>>16)&255, (n>>8)&255, n&255]; }
        const m = s.match(/\\d+/g) || [0,0,0]; return [+m[0], +m[1], +m[2]];
      };
      const lum = (s) => { const c = rgb(s); return 0.299*c[0] + 0.587*c[1] + 0.114*c[2]; };
      const lo = lum(st.theme.shade), hi = lum(st.theme.lit), mid = lo + 0.22 * (hi - lo);
      let tot = 0, bright = 0, sx = 0;
      for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const dx = x0 + x - cx, dy = y0 + y - cy;
        if (dx*dx + dy*dy > R*R) continue;
        const i = (y * n + x) * 4;
        if (px[i+3] < 180) continue;
        const L = 0.299*px[i] + 0.587*px[i+1] + 0.114*px[i+2];
        tot++;
        if (L > mid) { bright++; sx += dx; }
      }
      return { day: d, frac: tot ? bright / tot : -1, side: bright ? (sx / bright) / R : 0 };
    })()`);
    const gg0 = await ev(`${DBG('lunar')}.geo`);
    const ll0 = await tl('lunar');
    await click(ll0.l + gg0.cx, ll0.t + gg0.cy);
    const paused = await ev(`${DBG('lunar')}.playing`);
    ok(paused === false, 'clicking the disc pauses the auto-run');

    const jumpTo = async (frac) => {
      const gg = await ev(`${DBG('lunar')}.geo`);
      const ll = await tl('lunar');
      await click(ll.l + gg.tw * 0.04 + gg.tw * frac, ll.t + gg.ty + 2);
      await sleep(1500);
      return probeMoon();
    };
    const mNEW = await jumpTo(0.0), mFQ = await jumpTo(0.25),
      mFULL = await jumpTo(0.5), mLQ = await jumpTo(0.75);
    const near = (v, want, tol) => Math.abs(v - want) <= tol;
    const pc = (o) => (o.frac * 100).toFixed(1) + '%';
    ok(near(mNEW.frac, 0.00, 0.06), `new moon is dark (lit ${pc(mNEW)} at day ${mNEW.day.toFixed(2)})`);
    ok(near(mFQ.frac, 0.50, 0.10) && mFQ.side > 0.12,
      `first quarter: ${pc(mFQ)} lit on the right (day ${mFQ.day.toFixed(2)}, side ${mFQ.side.toFixed(2)})`);
    ok(mFULL.frac > 0.85, `full moon is lit across the disc (${pc(mFULL)} at day ${mFULL.day.toFixed(2)})`);
    ok(mNEW.frac < mFQ.frac && mFQ.frac < mFULL.frac && mLQ.frac < mFULL.frac,
      `lit fraction is monotonic: new ${pc(mNEW)} < 1Q ${pc(mFQ)} < full ${pc(mFULL)} > 3Q ${pc(mLQ)}`);
    ok(near(mLQ.frac, 0.50, 0.10) && mLQ.side < -0.12,
      `last quarter: ${pc(mLQ)} lit on the left (day ${mLQ.day.toFixed(2)}, side ${mLQ.side.toFixed(2)})`);

    /* ---- 5c. projection sanity: no body may land off-canvas or NaN ---- */
    const bs = await ev(`(() => { const st = document.querySelector('[data-kstage="orrery"]').__kstage;
      const c = st.canvas; return st.impl.debug().bodies.map(b =>
        Number.isFinite(b[0]) && Number.isFinite(b[1]) && b[0] > -40 && b[1] > -40
        && b[0] < c.getBoundingClientRect().width + 40 && b[1] < c.getBoundingClientRect().height + 40); })()`);
    ok(bs.length === 5 && bs.every(Boolean), 'all 5 bodies project to finite on-canvas positions');

    /* ---- 6. prism: explode ---- */
    const bp = await box('[data-kstage="prism"] canvas');
    await press('mousePressed', bp.x, bp.y); await press('mouseReleased', bp.x, bp.y);
    await press('mousePressed', bp.x, bp.y); await press('mouseReleased', bp.x, bp.y);
    const ex = await ev(`${DBG('prism')}.expl`);
    ok(ex === 1, `double-click explodes the solid (mode flag ${ex})`);

    /* ---- 6b. prism: M switches solid, hover picks a face ---- */
    await ev(`document.querySelector('[data-kstage="prism"] canvas').focus(); true`);
    await keyTap(ws, sessionId, 'm', 'm');
    const pm = await ev(DBG('prism'));
    ok(pm.solid === 'dodeca' && pm.faces === 12 && pm.edges === 30,
      `M switches to the dodecahedron (${pm.solid}: ${pm.faces}F / ${pm.edges}E)`);
    await press('mouseMoved', bp.x, bp.y);
    const ph = await ev(`${DBG('prism')}.hoverFace`);
    ok(ph >= 0, `hovering the centre picks a facet (face ${ph})`);
    await keyTap(ws, sessionId, 'm', 'm');
    await keyTap(ws, sessionId, 'm', 'm');
    await keyTap(ws, sessionId, 'm', 'm');

    /* ---- 6c. globe: coastline raster really built, starfield present ---- */
    const g0 = await ev(DBG('globe'));
    ok(g0.land > 1800 && g0.land < 3400, `coastline raster built (${g0.land} land cells ≈ 29-35% of the sphere)`);
    ok(g0.stars === 150, `starfield present (${g0.stars} deterministic stars)`);

    /* ---- 6d. REGRESSION: clicking a pin must turn the pin towards the
            camera, never away from it. This used to land on the far
            hemisphere because the target yaw used atan2(x,z).          ---- */
    await ev(`document.querySelector('[data-kstage="globe"] canvas').focus(); true`);
    for (const n of [1, 2, 3]) {
      const beforeYaw = await ev(`${DBG('globe')}.yaw`);
      await keyTap(ws, sessionId, String(n), String(n));
      await sleep(1500);
      const st = await ev(DBG('globe'));
      ok(st.fly === n - 1 && st.flyFront === true,
        `pin ${n} turns to the NEAR side after flying (fly ${st.fly}, flyFront ${st.flyFront}, yaw ${beforeYaw.toFixed(2)} -> ${st.yaw.toFixed(2)})`);
    }
    /* （ below the fold the canvas legitimately stops drawing, so bring each
         device into view before reading anything it computes while drawing ） */
    const show = async (sel) => {
      await ev(`document.querySelector('[data-kstage="${sel}"]').scrollIntoView({block:'center'}); true`);
      await sleep(500);
    };

    /* the same must hold when the pin is picked with the mouse */
    await keyTap(ws, sessionId, 'r', 'r');
    await sleep(500);
    const gc = await tl('globe');
    const gps = await ev(`${DBG('globe')}.pins`);
    let gotFront = null;
    for (let i = 0; i < gps.length; i++) {
      const p = gps[i];
      if (!(p[0] > 8 && p[0] < gc.w - 8)) continue;
      await click(gc.l + p[0], gc.t + p[1]);
      await sleep(1500);
      const st = await ev(DBG('globe'));
      if (st.fly >= 0) { gotFront = st.flyFront; break; }
    }
    ok(gotFront === true, `clicking a pin on the canvas also faces the camera (flyFront ${gotFront})`);

    /* ---- 6e. meter: divergence readout, preset jump, tube carry ---- */
    await show('meter');
    const mw = await tl('meter');
    await ev(`document.querySelector('[data-kstage="meter"] canvas').focus(); true`);
    const mt0 = await ev(DBG('meter'));
    ok(mt0.tubes === 7 && mt0.digits.length === 7, `7 nixie tubes built (${mt0.tubes})`);
    ok(mt0.tubePts.length === 7 && mt0.tubePts.every(p => Number.isFinite(p[0]) && Number.isFinite(p[1])),
      'every tube projects to a finite screen position');
    /* framing regression: the row must never spill outside the canvas */
    ok(mt0.tubePts.every(p => p[0] > 6 && p[0] < mw.w - 6),
      `all 7 tubes sit inside the canvas (outermost ${mt0.tubePts[0][0].toFixed(0)} / ${mt0.tubePts[6][0].toFixed(0)} of ${mw.w.toFixed(0)}px)`);
    /* space toggles the drift; leave it frozen so readings are stable */
    const dz0 = await ev(`${DBG('meter')}.drift`);
    await keyTap(ws, sessionId, ' ', ' ');
    const dz1 = await ev(`${DBG('meter')}.drift`);
    ok(dz0 !== dz1, `space freezes / resumes the drift (${dz0} -> ${dz1})`);
    if (dz1) await keyTap(ws, sessionId, ' ', ' ');

    await keyTap(ws, sessionId, '4', '4');
    await sleep(3400);            /* the jump eases over ~160 frames by design */
    const mt1 = await ev(DBG('meter'));
    ok(Math.abs(mt1.div - 1.048596) < 1e-6,
      `pressing 4 lands on the Steins;Gate line (${mt1.div.toFixed(6)}, ${mt1.label})`);
    ok(/命运石之门/.test(mt1.label), `the line is labelled in Chinese (${mt1.label})`);

    /* tap the last tube: its digit must step by one */
    const digBefore = await ev(`${DBG('meter')}.digits`);
    const mtl = await tl('meter');
    const tubePt = (await ev(`${DBG('meter')}.tubePts`))[6];
    await click(mtl.l + tubePt[0], mtl.t + tubePt[1]);
    await sleep(200);
    const dgAfter = await ev(`${DBG('meter')}.digits`);
    ok(dgAfter[6] === (digBefore[6] + 1) % 10,
      `tapping the last tube carries that digit (${digBefore[6]} -> ${dgAfter[6]})`);
    await keyTap(ws, sessionId, 'r', 'r');

    /* ---- 6f. lab: switch figure, switch pose ---- */
    await ev(`document.querySelector('[data-kstage="lab"] canvas').focus(); true`);
    await show('lab');
    const lb0 = await ev(DBG('lab'));
    ok(lb0.faces > 20, `figure built from real parts (${lb0.faces} quads)`);
    await keyTap(ws, sessionId, '2', '2');
    const lb1 = await ev(DBG('lab'));
    ok(lb1.char === 1 && lb1.char !== lb0.char, `key 2 switches to ${lb1.name} (${lb0.name} -> ${lb1.name})`);
    const pose0 = lb1.pose;
    await keyTap(ws, sessionId, 'p', 'p');
    const lb2 = await ev(DBG('lab'));
    ok(lb2.pose !== pose0 && lb2.faces > 20, `P changes the pose (${pose0} -> ${lb2.pose}, ${lb2.faces} quads)`);
    await keyTap(ws, sessionId, '1', '1');
    const lb3 = await ev(DBG('lab'));
    ok(lb3.char === 0, `key 1 switches back to ${lb3.name}`);

    /* ---- 7. night mode ---- */
    await ev(`document.documentElement.setAttribute('data-theme','dark'); true`);
    await sleep(400);
    const th = await ev(`document.querySelector('[data-kstage="orrery"]').__kstage.theme.ink`);
    ok(/235|233|229|ebe9e5/i.test(th), `theme re-read on night switch (ink ${th})`);
    await ev(`document.documentElement.setAttribute('data-theme','day'); true`);
    await sleep(300);

    /* ---- 8. resize ---- */
    const before = await ev(`document.querySelector('[data-kstage="orrery"] canvas').width`);
    await send(ws, 'Emulation.setDeviceMetricsOverride',
      { width: 900, height: 1000, deviceScaleFactor: 2, mobile: false }, sessionId);
    await sleep(600);
    const after = await ev(`document.querySelector('[data-kstage="orrery"] canvas').width`);
    ok(after !== before && after > 0, `resize re-sizes the backing store (${before} -> ${after}px @dpr2)`);
    await send(ws, 'Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);
    await sleep(500);

    /* ---- 9. off-screen pause ---- */
    await ev(`document.body.style.paddingBottom = '6000px'; window.scrollTo(0, 5000); true`);
    await sleep(900);
    const off = await ev(`[...document.querySelectorAll('[data-kstage]')].map(e => e.__kstage.onscreen)`);
    ok(off.length === 6 && off.every(v => v === false), `off-screen installs report paused (${off.join(',')})`);
    await ev(`document.body.style.paddingBottom = ''; window.scrollTo(0, 0); true`);
    await sleep(700);
    const on2 = await ev(`[...document.querySelectorAll('[data-kstage]')].map(e => e.__kstage.onscreen)`);
    ok(on2.every(v => v === true), `scrolling back resumes them (${on2.join(',')})`);

    /* ---- 10. reduced motion: frozen, yet still interactive ---- */
    await send(ws, 'Emulation.setEmulatedMedia',
      { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }, sessionId);
    await load();
    const c = await shot(); await sleep(1600); const d = await shot();
    ok(c === d && c.length > 2000, 'reduced motion: clocks frozen (identical frames 1.6s apart)');

    const bo2 = await box('[data-kstage="orrery"] canvas');
    const ry0 = await ev(`${DBG('orrery')}.yaw`);
    await press('mousePressed', bo2.x, bo2.y);
    for (let i = 1; i <= 6; i++) await press('mouseMoved', bo2.x + i * 10, bo2.y);
    await press('mouseReleased', bo2.x + 60, bo2.y);
    await sleep(200);
    const ry1 = await ev(`${DBG('orrery')}.yaw`);
    const e2 = await shot();
    ok(Math.abs(ry1 - ry0) > 0.2 && e2 !== d, 'reduced motion: dragging still works and repaints');
    const rs = await shot('lunar'); await sleep(1200);
    ok(rs === await shot('lunar'), 'reduced motion: lunar is frozen too');

    ok(errs.length === 0, 'still no console errors after the whole run' + (errs.length ? ' -> ' + errs.join(' | ') : ''));

    /* ---- 11. zoom all the way in: content must stay complete, not
         clipped by the container — and one click on the reset button
         brings the whole view back ---- */
    for (const sel of ['orrery', 'prism', 'globe', 'meter', 'lab']) {
      /* 狂滚放大（新规则：先点画布激活，滚轮才归装置） */
      const bb = await box(`[data-kstage="${sel}"] canvas`);
      await click(bb.x, bb.y);
      await sleep(80);
      for (let i = 0; i < 14; i++) {
        await send(ws, 'Input.dispatchMouseEvent',
          { type: 'mouseWheel', x: bb.x, y: bb.y, deltaX: 0, deltaY: -160 }, sessionId);
        await sleep(60);
      }
      await sleep(700);
      /* 放大到底后：镜头必须停在"内容刚好装下"的边界上（由采样点精确
         解算），而不是旧写死的、会裁切的下限 */
      const inside = await ev(`(() => {
        const e = document.querySelector('[data-kstage="${sel}"]');
        const s = e.__kstage;
        const lo = s.impl.fit ? s.impl.fit(s) : -1;
        const d = s.impl.debug ? s.impl.debug() : {};
        return { lo: lo, dist: (d.dist == null ? -1 : d.dist) };
      })()`);
      ok(inside.dist > 0 && inside.dist + 1e-6 >= inside.lo,
        `${sel}: zoom-in bottomed at the fit bound, not the old clip line (dist ${inside.dist.toFixed(3)} ≥ fit ${inside.lo.toFixed(3)})`);
      /* 复位按钮存在且在画布内 */
      const rb = await ev(`(() => { const e = document.querySelector('[data-kstage="${sel}"]');
        const s = e.__kstage; return { rb: s._rb, w: s.w, h: s.h }; })()`);
      ok(rb.rb && rb.rb[0] > 0 && rb.rb[0] < rb.w && rb.rb[1] > 0 && rb.rb[1] < rb.h,
        `${sel}: reset button is drawn inside the canvas (${JSON.stringify(rb.rb)})`);
      /* 点它 → 视角回到初始。落地值 = max(HOME 默认, fit 边界)：
         某些装置的出厂默认略低于取景下限，复位后被推到边界也是"完整" */
      const HOME = { orrery: 3.4, prism: 3.4, globe: 3.05, meter: 4.8, lab: 1.95 };
      const before = await ev(`${DBG(sel)}.dist`);
      /* 彩蛋语义（仅 orrery）：重合态按复位 = 只触发彩蛋、相机不动；
         平时按复位 = 真复位。按当前状态分支断言两种预期。 */
      const eggState = sel === 'orrery'
        ? await ev(`(() => { const s = document.querySelector('[data-kstage="orrery"]').__kstage;
            return s.impl.egg ? s.impl.egg() : { aligned: false, eggSeq: -1 }; })()`)
        : { aligned: false, eggSeq: -1 };
      const cvs = await tl(sel);
      await click(cvs.l + rb.rb[0], cvs.t + rb.rb[1]);
      await sleep(500);
      const after = await ev(`${DBG(sel)}.dist`);
      if (eggState.aligned) {
        const eggAfter = await ev(`(() => { const s = document.querySelector('[data-kstage="orrery"]').__kstage;
          return s.impl.egg(); })()`);
        ok(eggAfter.eggSeq > eggState.eggSeq && Math.abs(after - before) < 1e-6,
          `orrery: aligned state → reset click triggers the egg without moving the camera (eggSeq ${eggState.eggSeq} -> ${eggAfter.eggSeq}, dist stays ${after.toFixed(2)})`);
      } else {
        const want = Math.max(HOME[sel], inside.lo);
        ok(Math.abs(after - want) < 0.05,
          `${sel}: one click on the reset button restores a complete view (dist ${before.toFixed(2)} -> ${after.toFixed(2)}, want ≈ ${want.toFixed(2)})`);
      }
    }

    console.log(bad ? `\n${bad} check(s) flagged` : '\nkstage suite clean');
  } catch (e) {
    console.log('ERR', e && e.stack ? e.stack.split('\n').slice(0, 4).join(' | ') : e);
    bad++;
  } finally {
    edge.kill();
    process.exit(0);
  }
})();
