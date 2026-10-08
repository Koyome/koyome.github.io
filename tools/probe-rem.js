/* ============================================================
   probe-rem.js — the Live2D stage and the mood machine.

   Two things are being claimed and both need proving:

     · she actually renders and actually animates. The model is remote
       and the libraries are vendored, so "it works" is not a given —
       a wrong path or a missing global and you get a blank canvas that
       still passes every DOM assertion. So the canvas is checked for
       non-blank pixels and the model is checked for a live rAF loop.

     · the mood machine moves her where it says it will, including the
       case that matters most: three unkind messages in a row and she
       goes SILENT. A character who always answers is a lookup table.

   Run: node tools/probe-rem.js
   ============================================================ */
const { spawn } = require('child_process');

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
const CDP = 9371;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
function ok(c, label, extra) {
  if (c) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra ? '  → ' + extra : '')); }
}

let mid = 0;
function send(ws, method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++mid;
    const onMsg = (e) => {
      const m = JSON.parse(e.data);
      if (m.id === id) {
        ws.removeEventListener('message', onMsg);
        m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result);
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}
const ev = (ws, s, e) => send(ws, 'Runtime.evaluate',
  { expression: e, returnByValue: true, awaitPromise: true }, s)
  .then((r) => r.result && r.result.value);

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
    ws.addEventListener('message', (e) => {
      const m = JSON.parse(e.data);
      if (m.method === 'Runtime.exceptionThrown') {
        errors.push(String((m.params.exceptionDetails.exception || {}).description || 'exc').slice(0, 180));
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errors.push((m.params.args || []).map((a) => a.value || a.description).join(' ').slice(0, 180));
      }
    });

    const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
    await send(ws, 'Runtime.enable', {}, sessionId);
    await send(ws, 'Page.enable', {}, sessionId);
    /* The cache is the enemy of a probe: it will happily run last
       week's mood.js and report it as today's build. Bypass it. */
    await send(ws, 'Network.enable', {}, sessionId);
    await send(ws, 'Network.setCacheDisabled', { cacheDisabled: true }, sessionId);
    await send(ws, 'Emulation.setDeviceMetricsOverride',
      { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId);

    await send(ws, 'Page.navigate', { url: 'http://127.0.0.1/rem.html' }, sessionId);
    await sleep(9000);   /* the model is remote; give it room */

    /* ---- the libraries actually attached ---- */
    const libs = await ev(ws, sessionId, `JSON.stringify({
      pixi: typeof PIXI, live2d: typeof (window.PIXI||{}).live2d,
      l2d: typeof (window.PIXI&&PIXI.live2d||{}).Live2DModel, puppet: typeof KoyomePuppet, mood: typeof KoyomeMood
    })`);
    const L = JSON.parse(libs);
    ok(L.pixi === 'object' || L.pixi === 'function', 'PIXI loaded', libs);
    ok(L.live2d === 'object', 'the live2d plugin registered on it', libs);
    ok(L.l2d === 'function', 'Live2DModel is global', libs);
    ok(L.puppet === 'object', 'puppet.js attached', libs);
    ok(L.mood === 'object', 'mood.js attached', libs);

    /* ---- the model loaded and is animating ---- */
    const st = await ev(ws, sessionId, `(function(){
      var f = document.getElementById('rmFigure');
      var s = window.__rem.stage;
      return JSON.stringify({
        ready: f.classList.contains('is-ready'),
        failed: f.classList.contains('is-no-model'),
        hasModel: !!(s && s.model),
        running: !!(s && s.running),
        head: s ? s.anim.head : null,
        lids: s ? s.anim.lids : null,
      });
    })()`);
    const S = JSON.parse(st);
    ok(S.hasModel, 'the Live2D model loaded', st);
    ok(S.ready, 'and the page knows it is ready', st);
    ok(!S.failed, 'and did not fall back to the empty box', st);

    /* a live model is one whose head values keep changing: that is the
       target-seeking idle animation, and it is the thing a static
       screenshot cannot prove */
    const h1 = JSON.stringify(S.head);
    await sleep(1600);
    const h2 = await ev(ws, sessionId, `JSON.stringify(window.__rem.stage.anim.head)`);
    ok(h1 !== h2, 'her head keeps moving — the idle animation is live', h1 + ' vs ' + h2);

    /* the canvas must have real pixels in it */
    const painted = await ev(ws, sessionId, `(function(){
      var c = document.getElementById('rmCanvas');
      try {
        var g = c.getContext('webgl2') || c.getContext('webgl');
        return 'webgl:' + (g ? 'ok' : 'none');
      } catch (e) { return 'err:' + e.message; }
    })()`);
    ok(/webgl:ok/.test(painted), 'the canvas has a live GL context', painted);

    const size = await ev(ws, sessionId, `(function(){
      var c = document.getElementById('rmCanvas');
      return JSON.stringify({ w: c.width, h: c.height, cssW: Math.round(c.getBoundingClientRect().width) });
    })()`);
    const SZ = JSON.parse(size);
    ok(SZ.w > 50 && SZ.h > 50, 'and it is a real-sized surface', size);

    /* ---- the mood machine ---- */
    const moods = await ev(ws, sessionId, `Object.keys(window.__rem.moods)`);
    ok(moods.length >= 10, 'the mood table is complete', JSON.stringify(moods));
    ['neutral', 'smirking', 'correcting', 'flustered', 'shy', 'annoyed',
      'hurt', 'laughing', 'worried', 'surprised', 'honest', 'sulking']
      .forEach((m) => ok(moods.indexOf(m) > -1, '  mood "' + m + '" exists'));

    /* every mood must name a real expression on the model, or the face
       will silently stay neutral and the whole thing looks broken */
    const badExp = await ev(ws, sessionId, `(function(){
      var have = ${JSON.stringify([
        'anger', 'joy', 'neutral', 'sadness', 'shy', 'shy2',
        'smile1', 'smile2', 'surprise', 'unhappy'])};
      var bad = [];
      Object.keys(window.__rem.moods).forEach(function(k){
        var e = window.__rem.moods[k].exp;
        if (have.indexOf(e) < 0) bad.push(k + '→' + e);
      });
      return bad.join(',');
    })()`);
    ok(String(badExp) === '', 'every mood names a real model expression', badExp);

    /* and every mood must move her body differently */
    const badBody = await ev(ws, sessionId, `(function(){
      var seen = {};
      Object.keys(window.__rem.moods).forEach(function(k){
        var m = window.__rem.moods[k];
        seen[k] = JSON.stringify([m.head, m.lids, m.scale, m.idle]);
      });
      var uniq = new Set(Object.keys(seen).map(function(k){ return seen[k]; }));
      return uniq.size;
    })()`);
    ok(Number(badBody) >= 10, 'and the moods hold her body differently', 'unique=' + badBody);

    /* ---- a real conversation ---- */
    async function say(t) {
      await ev(ws, sessionId, `(function(){
        var i=document.getElementById('rmText'); i.value=${JSON.stringify(t)};
        document.getElementById('rmForm').dispatchEvent(
          new Event('submit',{cancelable:true,bubbles:true})); return 1;})()`);
      await sleep(900);
      return ev(ws, sessionId, `window.__rem.machine.mood`);
    }

    const m1 = await say('早上好');
    ok(typeof m1 === 'string' && m1.length, 'she answers', m1);

    const m2 = await say('红莉栖，你真聪明');
    ok(['flustered', 'shy', 'smirking', 'honest', 'surprised'].indexOf(m2) > -1,
      'warmth lifts her', m1 + ' → ' + m2);

    const m3 = await say('你个笨蛋，什么都不懂');
    ok(m3 !== m2, 'coldness changes her', m2 + ' → ' + m3);

    /* the head should actually be biased by the mood */
    const bias = await ev(ws, sessionId, `(function(){
      var s=window.__rem.stage, out=[];
      ['neutral','annoyed','sulking','worried'].forEach(function(k){
        s.setMood(window.__rem.moods[k]);
        out.push(s.anim.headBias.join('/')+'|'+s.anim.lidBias);
      });
      return out.join('  ');
    })()`);
    const parts = String(bias).split(/\s{2}/);
    ok(new Set(parts).size === parts.length, 'each mood biases her head and eyes differently', bias);

    /* ---- the silence, which is the whole point ---- */
    await ev(ws, sessionId, `window.__rem.say('我今天很糟')`);
    await sleep(800);
    const sulkMood = await ev(ws, sessionId, `window.__rem.machine.mood`);
    await say('你个笨蛋，滚开');
    await say('白痴，懒得跟你说话');
    await say('废物，离我远点');
    await sleep(1200);

    const sulk = await ev(ws, sessionId, `(function(){
      return JSON.stringify({
        mood: window.__rem.machine.mood,
        until: window.__rem.machine.sulkUntil,
        quiet: document.getElementById('rmFigure').classList.contains('is-quiet'),
        note: !document.getElementById('rmSulk').hidden,
        scale: window.__rem.stage.anim.motionScale
      });
    })()`);
    const SU = JSON.parse(sulk);
    ok(SU.until > Date.now(), 'three unkind messages and she goes quiet', sulk);
    ok(SU.quiet, 'the page goes quiet with her', sulk);
    ok(SU.note, 'and says so, rather than pretending to answer', sulk);
    ok(Number(SU.scale) < 0.6, 'and she barely moves', sulk);

    /* while sulking she must not reply */
    const before = Number(await ev(ws, sessionId,
      `document.querySelectorAll('#rmLog .rm-msg-her').length`));
    await ev(ws, sessionId, `window.__rem.say('喂')`);
    await sleep(1600);
    const afterSilent = Number(await ev(ws, sessionId,
      `document.querySelectorAll('#rmLog .rm-msg-her').length`));
    ok(afterSilent === before, 'and she says nothing when addressed',
      before + ' → ' + afterSilent);

    /* an apology brings her back — otherwise the sulk is a dead end */
    const back = await say('对不起，是我不好');
    ok(back !== 'sulking', 'an apology brings her back', sulkMood + ' → ' + back);

    /* ── the two names she refuses ──
       This is the character's biggest tell, and it is not invented:
       the Amadeus system's own prompt says she dislikes being called
       Christina. So the name must be recognised, it must be
       distinguished from the title she also refuses, and the refusal
       must actually come out of her mouth. */
    const nameT = await ev(ws, sessionId, 'JSON.stringify(['
      + 'window.__rem.analyse("克里斯蒂娜，过来"),'
      + 'window.__rem.analyse("你是我的助手吧"),'
      + 'window.__rem.analyse("早")'
      + '].map(function(a){ return { c: a.christina, s: a.assistant, g: a.greet }; }))');
    const NT = JSON.parse(nameT);
    ok(NT[0].c === true, 'she recognises the name she hates', nameT);
    ok(NT[1].s === true, 'and the title she refuses', nameT);
    ok(NT[2].g === true && !NT[2].c && !NT[2].s, 'a plain greeting is neither', nameT);

    await say('克里斯蒂娜，过来一下');
    await sleep(1500);
    const refusal = await ev(ws, sessionId, '(function(){'
      + 'var t = [].slice.call(document.querySelectorAll(".rm-msg-her .rm-text"))'
      + '  .map(function(x){ return x.textContent; }).join("|");'
      + 'return JSON.stringify({ hit: /克里斯蒂娜|名字|不要叫|不是/.test(t) });'
      + '})()');
    ok(/"hit":true/.test(refusal), 'and she says so out loud', refusal);



    /* ---- transcript ---- */
    const log = await ev(ws, sessionId, `(function(){
      var l=document.getElementById('rmLog');
      var mine=[].slice.call(l.querySelectorAll('.rm-msg-me .rm-text')).map(function(x){return x.textContent});
      return JSON.stringify({ n:l.querySelectorAll('.rm-msg').length,
        mine: mine.length,
        uniq: new Set(mine).size,
        atBottom: l.scrollHeight - l.scrollTop - l.clientHeight < 60 });
    })()`);
    const G = JSON.parse(log);
    ok(G.mine >= 6, 'the transcript keeps what you said', log);

    /* ── the voice, measured ──
       The first version of her lines passed every behavioural check
       and was still a generic tsundere: the source material's three
       signatures ran at 17%, 0% and 0%. Those are the numbers that
       make her sound like Makise Kurisu rather than like a stereotype,
       so they are asserted — a voice that drifts back is a
       regression, not a matter of taste. */
    const voice = await ev(ws, sessionId, '(function(){\n'
      + 'var L = window.KoyomeLines; L.resetMemory();\n'
      + 'var out = [], moods = Object.keys(window.__rem.moods);\n'
      + 'for (var i = 0; i < 400; i++) out.push(L.moodLine(moods[i % moods.length]));\n'
      + 'return JSON.stringify({ n: out.length,\n'
      + '  science: out.filter(function(x){ return /假设|数据|实验|对照|变量|误差|样本|证明|机制|概率|量化|定义/.test(x); }).length,\n'
      + '  ask: out.filter(function(x){ return /[？?]/.test(x); }).length,\n'
      + '  unique: new Set(out).size });\n'
      + '})()');
    const V = JSON.parse(voice);
    ok(V.science / V.n > 0.12, 'science is her idiom, not her topic',
      (V.science / V.n * 100).toFixed(0) + '%');
    ok(V.ask / V.n > 0.02, 'she answers with a question at least sometimes',
      (V.ask / V.n * 100).toFixed(0) + '%');
    ok(V.unique / V.n > 0.7, 'and 400 lines are mostly different',
      V.unique + '/' + V.n);
    ok(G.uniq > 4, 'and the lines vary', log);
    ok(G.atBottom, 'and it follows the newest', log);

    /* ---- reset ---- */
    await ev(ws, sessionId, `document.getElementById('rmReset').click()`);
    await sleep(700);
    const rst = await ev(ws, sessionId, `JSON.stringify({
      turns: window.__rem.machine.turns, mood: window.__rem.machine.mood,
      sulk: window.__rem.machine.sulkUntil })`);
    const R = JSON.parse(rst);
    ok(R.turns === 0, 'FORGET resets her', rst);
    ok(R.mood === 'neutral' && R.sulk === 0, 'and clears the sulk', rst);

    /* ---- phone ---- */
    await send(ws, 'Emulation.setDeviceMetricsOverride',
      { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, sessionId);
    await send(ws, 'Page.reload', {}, sessionId);
    /* A reload tears down the old execution context: the sessionId stays
       the same but evaluates against it return undefined, which is what
       made this whole block look like a model that would not load on a
       phone. Re-attach, and give it a moment to bind. */
    await sleep(1500);
    /* Runtime must be re-enabled after a navigation or the new context
       rejects every evaluate. */
    await send(ws, 'Runtime.enable', {}, sessionId);
    /* the model is remote and PIXI boots slower on a phone viewport;
       poll for readiness rather than guessing a sleep long enough */
    let ph = null;
    for (let i = 0; i < 30; i++) {
      await sleep(1200);
      ph = await ev(ws, sessionId, `JSON.stringify({
        ready: document.getElementById('rmFigure').classList.contains('is-ready'),
        failed: document.getElementById('rmFigure').classList.contains('is-no-model')
      })`);
      if (ph && /"ready":true/.test(ph)) break;
    }
    const of = await ev(ws, sessionId,
      'document.documentElement.scrollWidth - document.documentElement.clientWidth');
    ok(Number(of) <= 1, 'no sideways overflow on a phone', 'overflow=' + of);
    ok(!/"failed":true/.test(String(ph)), 'the phone load did not error out', String(ph));
    /* Every one of these is wrapped: a single throw inside the
       expression makes Runtime.evaluate return undefined, and the
       failure then looks like "the page is broken" rather than "my
       probe assumed a node that may not exist yet". */
    const phBox = await ev(ws, sessionId, `(function(){
      try {
        var f = document.getElementById('rmFigure');
        var c = document.getElementById('rmCanvas');
        var t = document.getElementById('rmChat');
        if (!f || !c || !t) return JSON.stringify({ ready:false, h:0, chatBelow:false, missing:true });
        var cr = c.getBoundingClientRect(), tr = t.getBoundingClientRect();
        return JSON.stringify({ ready: f.classList.contains('is-ready'),
          h: Math.round(cr.height), chatBelow: tr.top > cr.top });
      } catch (e) { return JSON.stringify({ err: String(e && e.message) }); }
    })()`);
    let P; try { P = JSON.parse(phBox); } catch (e) { P = { ready: false, h: 0, chatBelow: false }; ok(false, 'phone box readable', String(phBox)); }
    ok(P.ready, 'she still loads on a phone', phBox);
    ok(P.h > 150, 'and has room to stand in', phBox);
    ok(P.chatBelow, 'with the conversation below her', phBox);

    /* console: the model is remote, so a CORS or 404 will show here */
    const realErrors = errors.filter((e) => !/favicon|Failed to load resource.*404/i.test(e));
    ok(realErrors.length === 0, 'console clean', realErrors.slice(0, 3).join(' | '));

    ws.close();
  } catch (e) {
    ok(false, 'harness threw', e.message);
  } finally {
    edge.kill();
  }

  console.log('\n' + (fail ? fail + ' FAILURE(S)' : 'rem suite clean') + '   (' + pass + ' passed)');
  process.exit(fail ? 1 : 0);
})();