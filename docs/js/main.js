/* ============================================================
   main.js — Homepage: loading curtain + the profile block
   (portrait, name, welcome line, self-introduction).
   Everything here comes from /api/profile, so it is editable
   from the Admin page without touching code.
   ============================================================ */
(function () {
  'use strict';
  const { loadProfile, loadContent, loadHobbies, loc, escapeHtml, typeLabel, apiAvailable } = window.Koyome;
  const { t } = window.I18N;
  const esc = escapeHtml;

  /* gentle staggered fade-in as elements enter the viewport */
  function observeReveals(els) {
    const rm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (rm || !('IntersectionObserver' in window)) {
      els.forEach((r) => r.classList.add('in-view', 'settled'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        en.target.classList.add('in-view');
        io.unobserve(en.target);
        setTimeout(() => en.target.classList.add('settled'), 1600);
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -5% 0px' });
    els.forEach((r) => io.observe(r));
  }

  /* ---------- Loading curtain ---------- */
  const loader = document.getElementById('loader');
  const fill = document.getElementById('loaderFill');
  const num = document.getElementById('loaderNum');
  let p = 0;
  const timer = setInterval(() => {
    p = Math.min(100, p + Math.random() * 16 + 5);
    fill.style.width = p + '%';
    num.textContent = String(Math.floor(p)).padStart(3, '0');
    if (p >= 100) {
      clearInterval(timer);
      setTimeout(() => loader.classList.add('done'), 250);
    }
  }, 110);

  /* ---------- Profile ---------- */
  function paragraphs(text) {
    return String(text || '')
      .split(/\n\s*\n/)
      .map((t) => t.trim())
      .filter(Boolean)
      .map((t) => `<p>${esc(t).replace(/\n/g, '<br />')}</p>`)
      .join('');
  }

  async function render() {
    const profile = await loadProfile();

    const name = loc(profile, 'name') || 'Koyome';
    const tagline = loc(profile, 'tagline');
    const intro = loc(profile, 'intro');

    const nameEl = document.getElementById('homeName');
    nameEl.innerHTML = `${esc(name)}<span class="dot">.</span>`;

    /* the hexagram sigil carries the same name, and the welcome
       line gets a soft flicker — both follow the profile */
    const sigil = document.getElementById('sigilName');
    if (sigil) sigil.textContent = name;
    document.getElementById('homeTagline').classList.add('flicker-soft');

    document.getElementById('homeTagline').textContent = tagline;
    document.getElementById('homeIntro').innerHTML = paragraphs(intro);

    if (profile.avatar) {
      const img = document.getElementById('portraitImg');
      /* theme-aware: assigning src blindly here clobbers the dark variant
         that header.js' swapCutouts() just installed (dark-mode page load
         ended up showing the light asset = dark ink on dark paper).
         Keep data-light-src in sync, and only keep the dark swap when the
         baked *_dark variant actually pairs with this avatar — a custom
         owner upload has no baked variant, so the swap is dropped. */
      const derivedDark = profile.avatar.replace(/(\.\w+)$/, '_dark$1');
      if (img.dataset.darkSrc && img.dataset.darkSrc !== derivedDark) {
        img.removeAttribute('data-dark-src');
        delete img.dataset.darkSrc;
      }
      img.dataset.lightSrc = profile.avatar;
      img.src = (document.documentElement.dataset.theme === 'dark' && img.dataset.darkSrc)
        ? img.dataset.darkSrc
        : profile.avatar;
      img.alt = name;
    }

    /* portrait footnote — an editable content component: the words
       live in profile.json (figNote / figNoteZh), so the owner can
       retune them anytime; hidden entirely when empty (visitors) */
    renderPortraitNote(profile);
    renderSigilNote(profile);

    document.title = name + t('home_title_suffix');
  }

  async function renderPortraitNote(profile) {
    const note = document.getElementById('portraitNote');
    if (!note) return;
    const text = loc(profile, 'figNote');
    let owner = false;
    try { owner = await apiAvailable(); } catch (_) { owner = false; }

    const show = (v) => {
      note.textContent = v;
      note.hidden = !v && !owner;
      note.classList.toggle('is-empty', !v);
      if (!v && owner) note.textContent = t('home_fig_note_ph');
    };
    show(text);
    if (!owner) return;

    note.classList.add('editable');
    note.title = t('caption_edit_hint');
    note.addEventListener('dblclick', () => {
      if (note.classList.contains('editing')) return;
      note.classList.add('editing');
      const current = loc(profile, 'figNote') || '';
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 't-edit';
      input.value = current;
      note.textContent = '';
      note.appendChild(input);
      input.focus();
      input.select();
      let done = false;
      const finish = async (save) => {
        if (done) return;
        done = true;
        note.classList.remove('editing');
        const v = input.value.trim();
        if (!save || v === current) { show(current); return; }
        const field = window.I18N.isZh ? 'figNoteZh' : 'figNote';
        try {
          const r = await fetch('api/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [field]: v }),
          });
          if (!r.ok) throw new Error('fail');
          profile[field] = v;
          show(v);
        } catch (_) { show(current); }
      };
      input.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); finish(true); }
        if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
      });
      input.addEventListener('blur', () => finish(true));
    });
  }

  /* ---------- Caption beside the armillary sphere ----------
     Exactly the contract of the portrait note: the words live in
     profile.json (armNote / armNoteZh), the owner rewrites them in place
     with a double-click, and while it is empty visitors see nothing. */
  async function renderSigilNote(profile) {
    const note = document.getElementById('sigilNote');
    if (!note) return;
    const text = loc(profile, 'armNote');
    let owner = false;
    try { owner = await apiAvailable(); } catch (_) { owner = false; }

    const show = (v) => {
      /* 简介区域始终渲染：空内容时显示占位提示（owner 可双击编辑），
         移动端/游客视角也不再整块消失 */
      note.hidden = false;
      note.classList.toggle('is-empty', !v);
      note.textContent = v || t('home_arm_note_ph');
    };
    show(text);
    setupOrreryView(profile);          /* 套用已保存的展示视角 + 站长按钮 */
    if (!owner) return;

    note.classList.add('editable');
    note.title = t('caption_edit_hint');
    note.addEventListener('dblclick', () => {
      if (note.classList.contains('editing')) return;
      note.classList.add('editing');
      const current = loc(profile, 'armNote') || '';
      const input = document.createElement('textarea');
      input.className = 't-edit';
      input.value = current;
      input.rows = Math.min(6, current.split('\n').length + 1);
      note.textContent = '';
      note.appendChild(input);
      input.focus();
      input.select();
      let done = false;
      const finish = async (save) => {
        if (done) return;
        done = true;
        note.classList.remove('editing');
        const v = input.value.trim();
        if (!save || v === current) { show(current); return; }
        const field = window.I18N.isZh ? 'armNoteZh' : 'armNote';
        try {
          const r = await fetch('api/profile', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [field]: v }),
          });
          if (!r.ok) throw new Error('fail');
          profile[field] = v;
          show(v);
        } catch (_) { show(current); }
      };
      input.addEventListener('keydown', (ev) => {
        /* Enter alone = a new line (the note wraps); Ctrl/Cmd+Enter saves */
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); finish(true); }
        if (ev.key === 'Escape') { ev.preventDefault(); finish(false); }
      });
      input.addEventListener('blur', () => finish(true));
    });
  }

  /* ---------- Catalog preview on the home page ---------- */
  async function renderCatalog() {
    const listEl = document.getElementById('homeCatList');
    if (!listEl) return;
    const items = await loadContent();
    document.getElementById('homeCatCount').textContent =
      String(items.length).padStart(2, '0') + ' ' + t('items');
    listEl.innerHTML = items.map((it, i) => `
      <a class="entry-row reveal-row" style="--d:${(0.05 + i * 0.08).toFixed(2)}s" href="entry.html?id=${encodeURIComponent(it.id)}">
        <span class="idx">${String(i + 1).padStart(2, '0')}</span>
        <span class="t">${esc(loc(it, 'title') || t('untitled'))}</span>
        <span class="d">${esc(typeLabel(it.type))}${it.date ? ' · ' + esc(it.date) : ''}</span>
      </a>`).join('');

    observeReveals([...listEl.querySelectorAll('.reveal-row')]);
  }

  /* ---------- Hobbies invitation strip ----------
     daily picks: the pictured favorites are shuffled once per calendar
     day (seeded by the date), so the strip feels alive but stays
     stable within the same day */
  function dailyShuffle(arr) {
    const d = new Date();
    let seed = d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
    const rand = () => {
      /* mulberry32 — tiny deterministic PRNG */
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let z = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      z = (z + Math.imul(z ^ (z >>> 7), 61 | z)) ^ z;
      return ((z ^ (z >>> 14)) >>> 0) / 4294967296;
    };
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  async function renderHobbies() {
    const strip = document.getElementById('hhStrip');
    if (!strip) return;
    const doc = await loadHobbies();
    const total = doc.sections.reduce((n, s) => n + s.items.length, 0);
    document.getElementById('hhCount').textContent = String(total).padStart(2, '0') + ' ' + t('items');

    /* every pictured item from every section, shuffled by today's date */
    const pool = doc.sections.flatMap((s) => s.items.filter((it) => it.src));
    const picks = dailyShuffle(pool).slice(0, 4);
    if (!picks.length) { strip.remove(); return; } /* words + links still invite */

    strip.innerHTML = picks.map((it, i) => {
      /* proper nouns: when the current-language name is empty,
         show whichever language exists rather than "Untitled" */
      const name = loc(it, 'name') || it.name || it.nameZh || t('untitled');
      return `
      <a class="hh-card reveal-row" style="--d:${(0.05 + i * 0.09).toFixed(2)}s" href="hobbies.html">
        <figure class="hh-fig">
          <img src="${esc(it.src)}" alt="${esc(name)}" loading="lazy" decoding="async" />
        </figure>
        <div class="hh-name">${esc(name)}</div>
      </a>`;
    }).join('');

    const daily = document.getElementById('hhDaily');
    if (daily) daily.hidden = false;

    observeReveals([...strip.querySelectorAll('.reveal-row')]);
  }

  /* load the kstage rig exactly once — shared by the lazy arm and the
     member pins (a click on a pin must never hit a half-loaded stage) */
  var sigilInjected = false;
  function injectKstage() {
    if (sigilInjected || window.KStage) return;
    sigilInjected = true;
    var s = document.createElement('script');
    s.src = 'components/kstage.js?v=202609261820';
    s.async = true;
    document.body.appendChild(s);
  }

  /* ---------- Bottom sigil: the armillary sphere (浑天仪) ----------
     The canvas rig (components/kstage.js) is ~130 KB — far too much to
     put in the first paint of the home page. So: reserve the box in HTML
     (aspect-ratio, no layout shift) and inject the script only once the
     sigil is one screen away. The script mounts itself on load — it
     scans for [data-kstage] — and hides the placeholder ring by adding
     .is-live. No IntersectionObserver (old browser): just load it.
     No canvas / no JS: the hairline placeholder ring stays, nothing
     breaks. */
  function mountSigilOrrery() {
    var host = document.querySelector('.sigil-orrery');
    if (!host || window.KStage) return;

    if (!('IntersectionObserver' in window)) { injectKstage(); return; }
    var io = new IntersectionObserver(function (es) {
      if (!es[0].isIntersecting) return;
      io.disconnect();                            /* one-shot */
      injectKstage();
    }, { rootMargin: '400px 0px' });
    io.observe(host);
  }

  /* ---------- Member pins beside the sphere ----------
     001-008 buttons: locate + lock + follow that member in one click
     (they call the same number-key path the canvas uses). Clicking the
     active member again releases the lock. */
  function wireOrreryPins() {
    var row = document.getElementById('sigilPins');
    if (!row) return;

    var apply = function (btn) {
      var el = document.querySelector('.sigil-orrery');
      var st = window.KStage && el && el.__kstage;
      if (!st) return false;
      if (btn.classList.contains('on')) {
        st.impl.key('Escape', st);              /* release the lock */
        row.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
      } else {
        st.impl.key(btn.dataset.member, st);    /* lock + follow */
        row.querySelectorAll('button').forEach(function (x) {
          x.classList.toggle('on', x === btn);
        });
      }
      st.dirty = true; st.kick();
      if (st.canvas && st.canvas.focus) st.canvas.focus({ preventScroll: true });
      return true;
    };

    row.addEventListener('click', function (ev) {
      var btn = ev.target.closest('button[data-member]');
      if (!btn) return;
      if (apply(btn)) return;
      /* the rig may still be on its way (lazy-loaded) — inject now and
         retry once it is live */
      injectKstage();
      var tries = 0;
      var t2 = setInterval(function () {
        if (apply(btn)) clearInterval(t2);
        else if (++tries > 50) clearInterval(t2);
      }, 100);
    });
  }

  /* ================= 浑天仪彩蛋 =================
     台词与互动都落在仪器下方那条字幕里（pointer-events:none，绝不抢手势）：
       · 锁定某个成员（按钮 / 点星 / 数字键）→ 显示他的台词
       · 冈部与红莉栖两星垂直重合 → 提示"按复位键触发彩蛋"
       · 此时按复位键（画布右下角 R 或键盘 R）→ 播放两人对话 */
  const EGG_KEY = { 1: 'egg_okabe', 2: 'egg_daru', 3: 'egg_mayuri', 4: 'egg_kurisu', 5: 'egg_suzuha' };

  /* 一条字幕，两个互不干扰的通道 —— 早期版本让两者靠定时器抢同一个元素，
     结果台词刚显示就被提示逻辑收掉（探针实测：pin2/pin4 点完是空的）。
     现在：台词通道播完自动让位；提示通道持续显示，遇到台词就暂时退下。 */
  var eggT = { q1: 0, q2: 0, fade: 0 };
  var eggQuoteSeq = 0;      /* 作废上一串待播台词 */
  var eggQuoteUntil = 0;    /* 台词占用字幕的截止时间 */
  var eggAligned = false;   /* 当前两星是否重合 */
  var eggHintOn = false;    /* 提示是否正在显示 */

  function eggEl() { return document.getElementById('sigilEgg'); }
  function paint(text, cls) {
    var el = eggEl(); if (!el) return;
    clearTimeout(eggT.fade);
    el.hidden = false;
    el.className = 'sigil-egg show' + (cls ? ' ' + cls : '');
    el.textContent = text;
  }
  function fade() {
    var el = eggEl(); if (!el) return;
    el.classList.remove('show');
    clearTimeout(eggT.fade);
    eggT.fade = setTimeout(function () {
      if (!el.classList.contains('show')) { el.hidden = true; el.textContent = ''; }
    }, 420);
  }
  /* 播一串台词（1~2 句）；播完若仍重合则补上提示 */
  function sayQuote(lines) {
    var my = ++eggQuoteSeq;
    clearTimeout(eggT.q1); clearTimeout(eggT.q2);
    paint(lines[0][0], 'is-egg');
    eggQuoteUntil = Date.now() + lines[0][1];
    eggT.q1 = setTimeout(function () {
      if (my !== eggQuoteSeq) return;
      if (lines.length > 1) {
        paint(lines[1][0], 'is-egg');
        eggQuoteUntil = Date.now() + lines[1][1];
        eggT.q2 = setTimeout(function () {
          if (my !== eggQuoteSeq) return;
          eggQuoteUntil = 0;
          if (eggAligned) showHint(); else fade();
        }, lines[1][1]);
      } else {
        eggQuoteUntil = 0;
        if (eggAligned) showHint(); else fade();
      }
    }, lines[0][1]);
  }
  function showHint() {
    if (Date.now() < eggQuoteUntil) return;      /* 台词在播，不抢位 */
    paint(t('egg_hint'), 'is-egg');
    eggHintOn = true;
  }
  function clearHint() {
    if (!eggHintOn) return;
    eggHintOn = false;
    if (Date.now() < eggQuoteUntil) return;      /* 字幕正被台词占用 */
    fade();
  }
  function stopQuote() {
    eggQuoteSeq++;                              /* 作废待播的第二句 */
    clearTimeout(eggT.q1); clearTimeout(eggT.q2);
    eggQuoteUntil = 0;
  }
  /* 对外：一次性短消息（视角保存提示等） */
  function showEgg(text, cls, ms) { sayQuote([[text, ms || 2600]]); }

  /* 每次显示都领一个序号：延时播出的第二句若已过期就作废。
     没有这个令牌，真由理的第二句会盖掉后面点到的人（探针实测到的 bug） */
  function showEgg(text, cls, ms, seq) {
    const el = document.getElementById('sigilEgg');
    if (!el) return;
    if (seq != null && seq !== eggSeq) return;
    clearTimeout(eggT1); clearTimeout(eggT2);
    el.hidden = false;
    el.className = 'sigil-egg show' + (cls ? ' ' + cls : '');
    el.textContent = text;
    eggBusyUntil = ms ? Date.now() + ms : 0;      /* 台词占用期间，提示不抢位 */
    if (ms) {
      const my = eggSeq;
      eggT1 = setTimeout(function () {
        if (my !== eggSeq) return;
        el.classList.remove('show');
        eggT2 = setTimeout(function () { if (!el.classList.contains('show')) el.hidden = true; }, 420);
      }, ms);
    }
  }
  function memberQuote(n) {
    const k = EGG_KEY[n];
    if (!k) return;
    /* 真由理说两句 */
    if (n === 3) { sayQuote([[t('egg_mayuri'), 2200], [t('egg_mayuri2'), 5000]]); return; }
    sayQuote([[t(k), 5200]]);
  }
  function playDuo() {
    sayQuote([[t('egg_duo_a'), 3800], [t('egg_duo_b'), 5600]]);
  }

  /* 轮询装置状态（不侵入 canvas 的事件）：
     锁定变化 → 台词；重合 → 提示；重合时复位 → 对话彩蛋 */
  function watchOrreryEggs() {
    var lastSeq = -1, lastLock = -2, wasAligned = false;
    setInterval(function () {
      var el = document.querySelector('.sigil-orrery');
      var st = el && el.__kstage;
      if (!st || !st.impl || !st.impl.egg) return;
      var s = st.impl.egg();

      /* 锁定变化 → 台词；取消锁定 → 收回台词（若仍重合则显示提示） */
      if (s.lock !== lastLock) {
        lastLock = s.lock;
        if (s.lock >= 0) memberQuote(s.lock + 1);     /* 001-008 → 1-5 */
        else {
          stopQuote();
          if (s.aligned) showHint(); else fade();
        }
      }
      if (s.aligned !== wasAligned) {
        wasAligned = s.aligned;
        eggAligned = s.aligned;
        if (s.aligned) showHint(); else clearHint();
      }

      if (lastSeq < 0) { lastSeq = s.homeSeq; return; }
      if (s.homeSeq !== lastSeq) {
        lastSeq = s.homeSeq;
        /* 用"按下复位键那一刻"的对齐状态判定（相机复位后两星可能已错开） */
        if (s.homeAligned) playDuo();
      }
    }, 240);
  }

  /* ================= 自定义展示视角 =================
     站长把当前相机姿态存进 profile.orreryView（yaw,pitch,dist），
     随内容一起 commit/push；游客打开首页就看到这个视角。 */
  function parseView(s) {
    var a = String(s || '').split(',');
    if (a.length < 3) return null;
    var n = a.map(Number);
    if (n.some(function (x) { return !isFinite(x); })) return null;
    return { yaw: n[0], pitch: n[1], dist: n[2] };
  }
  async function setupOrreryView(profile) {
    var wrap = document.getElementById('sigilView');
    var host = document.querySelector('.sigil-orrery');
    var stOf = function () { return (host && host.__kstage) || null; };

    var saved = parseView(profile && profile.orreryView);
    if (saved) {
      /* 装置可能是懒加载的：反复套几次直到它真的活着 */
      var tries = 0;
      var iv = setInterval(function () {
        var st = stOf();
        if (st && st.impl && st.impl.setPose) {
          st.impl.setPose(saved); st.dirty = true; st.kick();
          if (++tries > 25) clearInterval(iv);
        } else if (++tries > 80) clearInterval(iv);
      }, 150);
    }

    var owner = false;
    try { owner = await apiAvailable(); } catch (_) { owner = false; }
    if (!owner || !wrap) return;
    wrap.hidden = false;

    var post = async function (obj, okMsg) {
      try {
        var r = await fetch('api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(obj),
        });
        if (!r.ok) throw new Error('fail');
        showEgg(okMsg, '', 2800);
        return true;
      } catch (_) { showEgg('保存失败 · 本机服务是否在运行？', '', 3200); return false; }
    };
    var saveBtn = document.getElementById('sigSaveView');
    var clearBtn = document.getElementById('sigClearView');
    if (saveBtn) saveBtn.addEventListener('click', async function () {
      var st = stOf();
      if (!st || !st.impl || !st.impl.pose) { showEgg('装置还没就绪', '', 2400); return; }
      var p = st.impl.pose();
      var v = [p.yaw, p.pitch, p.dist].map(function (n) { return (+n).toFixed(3); }).join(',');
      await post({ orreryView: v }, t('sig_view_saved'));
    });
    if (clearBtn) clearBtn.addEventListener('click', async function () {
      var ok = await post({ orreryView: '' }, t('sig_view_cleared'));
      if (!ok) return;
      var st = stOf();
      if (st && st.impl && st.impl.setPose) { st.impl.setPose({ yaw: -0.62, pitch: 0.44, dist: 3.4 }); st.dirty = true; st.kick(); }
    });
  }

  /* Arm the armillary only once the page has its real height. Watching it
     any earlier is a trap: the catalog and hobbies strips are still empty,
     the document is short, the sigil falls inside the observer margin and
     the 130 KB rig loads right away — exactly what lazy loading exists to
     avoid. The timeout is the safety net: if an API hangs, the sphere
     still arrives. armSigil is one-shot, so whichever wins, wins once. */
  var sigilArmed = false;
  function armSigil() {
    if (sigilArmed) return;
    sigilArmed = true;
    mountSigilOrrery();
  }

  Promise.all([render(), renderCatalog(), renderHobbies()]).then(armSigil, armSigil);
  setTimeout(armSigil, 1200);
  wireOrreryPins();
  watchOrreryEggs();      /* 台词 / 重合提示 / 复位触发的对话 */
})();
