/* ============================================================
   kstage.js — interactive canvas installations for koyome.me

   Zero dependencies. One canvas per mount point, one shared rAF
   clock for the whole page. Six installations:

     ORRERY — 3D armillary sphere themed on Steins;Gate: lab-member
              planets, worldline drift readout, follow / trails.
     LUNAR  — moon-phase bench: drag to scrub the synodic month,
              terminator solved from the real sun-earth-moon angle.
     PRISM  — shaded platonic solids: painter-sorted facets, hidden
              edges as hairline dashes, scan plane, explode mode.
     GLOBE  — land/sea globe: simplified coastline data rasterised
              into filled continents, starfield with parallax, axial
              tilt, pins fly the camera to the near hemisphere.
     METER  — the Worldline Divergence Meter: seven 3D nixie tubes
              with glowing filament digits, preset worldlines, drift.
     LAB    — Steins;Gate lab members as low-poly figurines on a
              pedestal: Kurisu & Okabe, poses, outfits, idle sway.

   House rules kept throughout:
     • one shared key light direction for every shaded surface
     • glow is faked with stacked strokes (never shadowBlur — it is
       re-rasterised every frame and tanks the frame rate)
     • nothing animates while the tab is hidden or the canvas is
       off-screen
     • prefers-reduced-motion stops the clocks but keeps every
       interaction alive (drag / scrub still work)
     • if the frame budget is blown, quality drops automatically
   ============================================================ */
(function () {
  'use strict';

  /* ---------- tiny math ---------- */
  var TAU = Math.PI * 2;
  function clamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function easeOut(t) { return 1 - Math.pow(1 - t, 3); }
  function mod(a, n) { return ((a % n) + n) % n; }
  function wrapPi(a) { return mod(a + Math.PI, TAU) - Math.PI; }

  /* deterministic PRNG — identical geometry every reload */
  function rng(seed) {
    var s = seed >>> 0 || 1;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  }

  /* ---------- vectors (plain 3-arrays) ---------- */
  function rotX(p, a) {
    var c = Math.cos(a), s = Math.sin(a);
    return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c];
  }
  function rotY(p, a) {
    var c = Math.cos(a), s = Math.sin(a);
    return [p[0] * c - p[2] * s, p[1], p[0] * s + p[2] * c];
  }
  function rotZ(p, a) {
    var c = Math.cos(a), s = Math.sin(a);
    return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
  }
  function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
  function cross(a, b) {
    return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  }
  function dot(a, b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
  function norm(a) {
    var l = Math.sqrt(dot(a, a)) || 1;
    return [a[0] / l, a[1] / l, a[2] / l];
  }

  /* single key light, shared by every installation */
  var LIGHT = norm([-0.52, -0.66, 0.54]);
  function lambert(n) { return clamp(dot(norm(n), LIGHT), 0, 1); }

  /* ---------- camera ---------- */
  function Camera() {
    this.yaw = -0.62; this.pitch = 0.44; this.dist = 3.4; this.fov = 1.02;
    this.vyaw = 0; this.vpitch = 0;
    this._c = { f: 0, w: 0, h: 0 };
  }
  /* project a world point -> [screenX, screenY, depth, scale] */
  Camera.prototype.project = function (p, out) {
    var r = rotX(rotY(p, this.yaw), this.pitch);
    var z = r[2] + this.dist;
    if (z < 0.05) z = 0.05;
    var s = this._c.f / z;
    out[0] = this._c.w + r[0] * s;
    out[1] = this._c.h - r[1] * s;
    out[2] = z;
    out[3] = s;
    return out;
  };
  Camera.prototype.frame = function (w, h) {
    this._c.f = (Math.min(w, h) * 0.5) / Math.tan(this.fov * 0.5);
    this._c.w = w * 0.5;
    this._c.h = h * 0.5;
  };
  /* frame-rate independent inertia */
  Camera.prototype.slide = function (dt) {
    if (this.vyaw || this.vpitch) {
      this.yaw += this.vyaw * dt;
      this.pitch = clamp(this.pitch + this.vpitch * dt, -1.32, 1.32);
      var k = Math.pow(0.0028, dt); /* ~exponential decay */
      this.vyaw *= k; this.vpitch *= k;
      if (Math.abs(this.vyaw) < 1e-4) this.vyaw = 0;
      if (Math.abs(this.vpitch) < 1e-4) this.vpitch = 0;
    }
  };
  /* 平滑缩放：滚轮/捏合只改目标值，实际 dist 每帧向目标缓动（帧率无关）。
     直接改 dist 会让缩放一格一格跳，手感生硬。 */
  Camera.prototype.zoomStep = function (d, lo, hi) {
    var base = (this.dTarget == null) ? this.dist : this.dTarget;
    this.dTarget = clamp(base + d, lo, hi);
  };
  Camera.prototype.slideZoom = function (dt) {
    if (this.dTarget == null) return false;
    var k = 1 - Math.pow(0.0002, dt);          /* ~0.6s 收敛，与帧率无关 */
    this.dist += (this.dTarget - this.dist) * k;
    if (Math.abs(this.dTarget - this.dist) < 0.0015) { this.dist = this.dTarget; this.dTarget = null; }
    return true;
  };

  /* ---------- 自动取景 ----------
     把装置内容的采样点投到当前镜头上，解出"刚好完整装进画布"的
     最小 dist：对每个点要求 |rx|·f/(rz+dist) ≤ roomX（y 同理），
     即 dist ≥ |rx|·f/roomX − rz，取全部采样点的最大值 —— 这是
     精确下界，不是保守估计。缩放用它当下限，于是放大到底时画面
     依然完整：不是靠裁切，也不是靠把边框藏起来。 */
  function fitDist(cam, stage, pts, mx, my) {
    var w = stage.w, h = stage.h;
    var f = (Math.min(w, h) * 0.5) / Math.tan(cam.fov * 0.5);
    var roomX = Math.max(28, w * 0.5 - mx);
    var roomY = Math.max(28, h * 0.5 - my);
    var need = 1;
    for (var i = 0; i < pts.length; i++) {
      var r = rotX(rotY(pts[i], cam.yaw), cam.pitch);
      var nx = Math.abs(r[0]) * f / roomX - r[2];
      var ny = Math.abs(r[1]) * f / roomY - r[2];
      if (nx > need) need = nx;
      if (ny > need) need = ny;
    }
    return need;
  }

  /* ---------- colour ---------- */
  var _cc = {};
  function parseColor(s) {
    if (_cc[s]) return _cc[s];
    var r = 0, g = 0, b = 0;
    if (s.charAt(0) === '#') {
      var h = s.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      var n = parseInt(h, 16);
      r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
    } else {
      var m = s.match(/-?\d+\.?\d*/g);
      if (m && m.length >= 3) { r = +m[0]; g = +m[1]; b = +m[2]; }
    }
    return (_cc[s] = [r, g, b]);
  }
  function ca(s, a) {                    /* colour + alpha */
    var c = parseColor(s);
    return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')';
  }
  function mix(s1, s2, t) {              /* blend two css colours */
    var a = parseColor(s1), b = parseColor(s2);
    return 'rgb(' + Math.round(lerp(a[0], b[0], t)) + ',' +
      Math.round(lerp(a[1], b[1], t)) + ',' + Math.round(lerp(a[2], b[2], t)) + ')';
  }

  /* ---------- canvas helpers ---------- */
  /* mono carries the readouts; the CJK fallbacks keep Chinese legible on
     Windows and macOS without a webfont; the serif is for the seal only */
  var MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "PingFang SC", "Microsoft YaHei", monospace';
  var SERIF = 'Georgia, "Songti SC", "STSong", "SimSun", serif';

  function setFont(ctx, size, weight, fam) {
    ctx.font = (weight || 400) + ' ' + size + 'px ' + (fam || MONO);
  }
  function text(ctx, str, x, y, color, alpha, align, size, spacing, weight, fam) {
    setFont(ctx, size || 10, weight, fam);
    if ('letterSpacing' in ctx) {
      try { ctx.letterSpacing = (spacing == null ? 1.4 : spacing) + 'px'; } catch (e) { /* older engines */ }
    }
    ctx.textAlign = align || 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.fillText(str, x, y);
    ctx.globalAlpha = 1;
    if ('letterSpacing' in ctx) { try { ctx.letterSpacing = '0px'; } catch (e2) { /* noop */ } }
  }

  /* stacked strokes = cheap glow. `build` must lay down the path. */
  function glowStroke(ctx, build, color, w, alpha, glow) {
    ctx.strokeStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (glow > 0.02) {
      ctx.globalAlpha = alpha * 0.13 * glow; ctx.lineWidth = w * 5.5; build(); ctx.stroke();
      ctx.globalAlpha = alpha * 0.26 * glow; ctx.lineWidth = w * 2.6; build(); ctx.stroke();
    }
    ctx.globalAlpha = alpha; ctx.lineWidth = w; build(); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function polyline(ctx, pts, n, close) {
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (var i = 1; i < n; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    if (close) ctx.closePath();
  }

  /* 点是否落在投影后的（凸）多边形里 —— 用来拾取面 */
  function inPoly(x, y, p, n) {
    var inside = false;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var xi = p[i][0], yi = p[i][1], xj = p[j][0], yj = p[j][1];
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / ((yj - yi) || 1e-6) + xi) inside = !inside;
    }
    return inside;
  }

  /* 通用凸包取面：三点定平面，其余顶点都在同一侧 → 这就是一个面；
     把落在该平面上的顶点绕面心按角度排序，三角/四边/五边面都能正确
     生成。多面体装置和人偶装置共用。 */
  function convexFaces(VV) {
    var n = VV.length, tol = 1e-7, out = [], seen = {};
    var a, b, c, m, s;
    for (a = 0; a < n; a++) for (b = a + 1; b < n; b++) for (c = b + 1; c < n; c++) {
      var nn = cross(sub(VV[b], VV[a]), sub(VV[c], VV[a]));
      if (dot(nn, nn) < 1e-18) continue;
      nn = norm(nn);
      var d = dot(nn, VV[a]);
      var pos = 0, neg = 0, on = [];
      for (m = 0; m < n; m++) {
        s = dot(nn, VV[m]) - d;
        if (s > tol) pos++; else if (s < -tol) neg++; else on.push(m);
      }
      if (on.length < 3 || (pos && neg)) continue;
      if (pos > 0) { nn = [-nn[0], -nn[1], -nn[2]]; d = -d; }   /* 法线一律朝外 */
      var key = on.join(',');
      if (seen[key]) continue;
      seen[key] = 1;
      var cen = [0, 0, 0];
      for (m = 0; m < on.length; m++) { cen[0] += VV[on[m]][0]; cen[1] += VV[on[m]][1]; cen[2] += VV[on[m]][2]; }
      cen = [cen[0] / on.length, cen[1] / on.length, cen[2] / on.length];
      var ux = norm(sub(VV[on[0]], cen));
      var vx = norm(cross(nn, ux));
      var ord = on.slice().sort(function (p, q2) {
        var dp = sub(VV[p], cen), dq = sub(VV[q2], cen);
        return Math.atan2(dot(dp, vx), dot(dp, ux)) - Math.atan2(dot(dq, vx), dot(dq, ux));
      });
      var pbuf = [];
      for (m = 0; m < ord.length; m++) pbuf.push([0, 0, 0, 0]);
      out.push({ idx: ord, c: nn, p: pbuf, z: 0, n: [0, 0, 0] });
    }
    return out;
  }

  /* corner brackets — the cyber HUD signature */
  function brackets(ctx, x, y, w, h, len, color, alpha, lw) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = lw || 1;
    ctx.beginPath();
    var c = [[x, y, 1, 1], [x + w, y, -1, 1], [x, y + h, 1, -1], [x + w, y + h, -1, -1]];
    for (var i = 0; i < 4; i++) {
      var p = c[i];
      ctx.moveTo(p[0], p[1] + p[3] * len);
      ctx.lineTo(p[0], p[1]);
      ctx.lineTo(p[0] + p[2] * len, p[1]);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /* faint engineering grid */
  function grid(ctx, x, y, w, h, step, color, alpha) {
    ctx.strokeStyle = color;
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var gx = x + step; gx < x + w; gx += step) { ctx.moveTo(gx, y); ctx.lineTo(gx, y + h); }
    for (var gy = y + step; gy < y + h; gy += step) { ctx.moveTo(x, gy); ctx.lineTo(x + w, gy); }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  /* deterministic stipple — screen-space grain, no filter */
  function stipple(ctx, x, y, w, h, count, color, alpha, seed) {
    var r = rng(seed || 7);
    ctx.fillStyle = color;
    ctx.globalAlpha = alpha;
    for (var i = 0; i < count; i++) {
      ctx.fillRect(x + r() * w, y + r() * h, 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- theme ---------- */
  function readTheme(el) {
    var cs = getComputedStyle(el);
    function v(n, d) { var s = cs.getPropertyValue(n).trim(); return s || d; }
    return {
      ink: v('--ks-ink', '#3b3a38'),
      dim: v('--ks-dim', '#7c7a75'),
      faint: v('--ks-faint', 'rgba(59,58,56,0.085)'),
      accent: v('--ks-accent', '#9e2b25'),
      cool: v('--ks-cool', '#4d6f79'),
      paper: v('--ks-paper', '#e4e2df'),
      lit: v('--ks-lit', '#f4f2ef'),
      shade: v('--ks-shade', '#9a9892'),
      glow: parseFloat(v('--ks-glow', '0.34')) || 0.34
    };
  }

  /* ============================================================
     全局开关（页面控制台直接改这一个对象，所有装置同时生效）
     ============================================================ */
  var OPTS = {
    grid: true,      /* 背景工程网格 */
    scan: true,      /* 扫描线扫过 + 微故障抖动 */
    grain: true,     /* 颗粒噪点 */
    spin: true,      /* 空闲自动巡航 */
    time: 1,         /* 时间倍速 0 = 冻结（拖拽/擦洗仍然有效） */
    hud: true,       /* 标题 / 状态 / 暦 印记 */
    readout: true,   /* 右上两行数据读数（世界线变动率在这里） */
    wash: true,      /* 纸面洗光（中心亮、四角压暗的那层薄底） */
    brackets: true   /* 四角括号 */
  };

  var ALL = [];                 /* 所有已挂载的装置（控制台要广播开关） */

  /* 单一时钟：整页只有一个 requestAnimationFrame，
     所有装置在这一个节拍里各画各的 —— 比每个画布各起一条
     rAF 更稳，也不会互相抢帧 */
  var _tk = { q: [], raf: 0 };
  function _pump(now) {
    _tk.raf = 0;
    var q = _tk.q; _tk.q = [];
    for (var i = 0; i < q.length; i++) q[i]._tick(now);
    if (_tk.q.length && !_tk.raf) _tk.raf = requestAnimationFrame(_pump);
  }

  /* ============================================================
     Stage — one canvas, one installation, one loop
     ============================================================ */
  function Stage(root) {
    var self = this;
    this.root = root;
    this.kind = (root.getAttribute('data-kstage') || 'orrery').toLowerCase();
    this.impl = (BUILD[this.kind] || BUILD.orrery)();

    this.canvas = document.createElement('canvas');
    this.canvas.className = 'kstage-canvas';
    this.canvas.setAttribute('tabindex', '0');
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', this.impl.aria || 'interactive diagram');
    root.appendChild(this.canvas);
    var ctx = this.canvas.getContext('2d');
    if (!ctx) { root.classList.remove('is-live'); return; }
    this.ctx = ctx;
    root.classList.add('is-live');

    this.theme = readTheme(root);
    this.w = 1; this.h = 1; this.dpr = 1;
    this.t = 0; this.last = 0; this.raf = 0;
    this.ema = 1 / 60; this.qual = 1;
    this.onscreen = true; this.visible = !document.hidden; this.dirty = true;
    this.mm = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.RM = this.mm.matches;
    this.p = { down: false, x: 0, y: 0, sx: 0, sy: 0, moved: 0, t0: 0, vx: 0, vy: 0 };
    /* 与全站共享同一个开关对象；挂载点可以用 data-opts="grid:0,scan:0"
       临时盖掉几项 —— 嵌进安静版面的那台（首页底部）不要工程网格和扫描线。
       用 Object.create 继承：KStage.set() 改的仍是全局 OPTS，只有这里显式
       盖掉的键才不听全局的。 */
    this.opts = OPTS;
    var _po = root.getAttribute('data-opts');
    if (_po) {
      this.opts = Object.create(OPTS);
      var _kv = _po.split(',');
      for (var _i = 0; _i < _kv.length; _i++) {
        var _p = _kv[_i].split(':');
        if (_p.length !== 2) continue;
        var _k = _p[0].trim(), _v = _p[1].trim();
        this.opts[_k] = (_v === 'true' || _v === '1') ? true
          : (_v === 'false' || _v === '0') ? false
            : parseFloat(_v);
      }
    }
    this._queued = false;
    ALL.push(this);

    this.impl.init(this);
    this.resize();

    /* --- observers --- */
    if (window.ResizeObserver) {
      this.ro = new ResizeObserver(function () { self.resize(); });
      this.ro.observe(root);
    } else {
      window.addEventListener('resize', function () { self.resize(); });
    }
    if (window.IntersectionObserver) {
      this.io = new IntersectionObserver(function (es) {
        self.onscreen = es[0].isIntersecting;
        if (self.onscreen) self.kick();
      }, { rootMargin: '80px' });
      this.io.observe(root);
    }
    document.addEventListener('visibilitychange', function () {
      self.visible = !document.hidden;
      if (self.visible) { self.last = 0; self.kick(); }
    });
    /* 触屏滑动页面 → 冻结本装置的重绘（滑完 140ms 自动唤醒）。
       触屏上"边滑边重画"是掉帧的头号来源。 */
    this.coarse = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);
    this.scrolling = false;
    var sTimer = 0;
    window.addEventListener('scroll', function () {
      self.scrolling = true;
      clearTimeout(sTimer);
      sTimer = setTimeout(function () {
        self.scrolling = false; self.last = 0; self.dirty = true; self.kick();
      }, 140);
    }, { passive: true });
    /* day/night swap: CSS variables change, we re-read them */
    if (window.MutationObserver) {
      this.mo = new MutationObserver(function () {
        self.theme = readTheme(self.root);
        self.dirty = true; self.kick();
      });
      this.mo.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] });
    }
    var onRM = function () { self.RM = self.mm.matches; self.dirty = true; self.kick(); };
    if (this.mm.addEventListener) this.mm.addEventListener('change', onRM);
    else if (this.mm.addListener) this.mm.addListener(onRM);

    /* --- input --- */
    var c = this.canvas;
    this.engaged = 0;                        /* 最近一次与装置互动的时间戳 */
    c.addEventListener('pointerdown', function (e) { self.onDown(e); });
    c.addEventListener('pointermove', function (e) { self.onMove(e); });
    c.addEventListener('pointerup', function (e) { self.onUp(e); });
    c.addEventListener('pointercancel', function (e) { self.onUp(e); });
    c.addEventListener('pointerleave', function () {
      if (!self.p.down && self.impl.hover) { self.impl.hover(null, null, self); self.dirty = true; self.kick(); }
    });
    /* 滚轮默认归页面滚动：只有"正在跟装置互动"（4 秒内点过/拖过它，
       或按住 Ctrl/⌘）时滚轮才缩放装置。否则访客翻页时滚轮一掠过画布，
       模型视角就被改了（用户点名要修这个）。 */
    c.addEventListener('wheel', function (e) {
      if (!self.impl.zoom) return;
      var active = (performance.now() - self.engaged < 4000) || e.ctrlKey || e.metaKey;
      if (!active) return;                    /* 不 preventDefault → 页面照常滚 */
      e.preventDefault();
      self.impl.zoom(e.deltaY * 0.0016, self);
      self.dirty = true; self.kick();
    }, { passive: false });
    c.addEventListener('keydown', function (e) {
      if (!self.impl.key) return;
      var used = self.impl.key(e.key, self);
      if (used) { e.preventDefault(); self.dirty = true; self.kick(); }
    });

    this.kick();
  }

  Stage.prototype.local = function (e) {
    var r = this.canvas.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  Stage.prototype.onDown = function (e) {
    this.engaged = performance.now();        /* 用户开始跟它玩 → 滚轮暂时归它 */
    var l = this.local(e);
    this.p.down = true; this.p.x = l[0]; this.p.y = l[1];
    this.p.sx = l[0]; this.p.sy = l[1]; this.p.moved = 0; this.p.t0 = performance.now();
    this.p.vx = 0; this.p.vy = 0;
    /* 手势方向：触屏先不定（0），等手指真的横着走才接管旋转；
       纵向一律让给页面滚动 —— 这是"往下滑时模型也跟着动"的根因 */
    this.p.axis = (e.pointerType === 'touch') ? 0 : 1;
    if (this.canvas.setPointerCapture) { try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* noop */ } }
    /* 多指跟踪：第二根手指落下时从拖拽切换成捏合缩放 */
    if (!this.ptrs) { this.ptrs = {}; this.ptrN = 0; }
    if (!this.ptrs[e.pointerId]) this.ptrN++;
    this.ptrs[e.pointerId] = l;
    if (this.ptrN === 2) {
      if (this.impl.release) this.impl.release(0, 0, this);
      this.p.down = false; this.p.moved = 999;
      this._pinch = true;
      this.pinchD = this._ptrGap();
    } else if (this.ptrN > 2) {
      this._pinch = true;
    }
    /* 触屏要等方向定了才 grab，否则一次下滑也会先转一下模型 */
    if (!this._pinch && this.impl.grab && this.p.axis === 1) this.impl.grab(l[0], l[1], this);
    this.dirty = true; this.kick();
  };
  Stage.prototype._ptrGap = function () {
    var ids = Object.keys(this.ptrs);
    if (ids.length < 2) return 0;
    var a = this.ptrs[ids[0]], b = this.ptrs[ids[1]];
    var dx = a[0] - b[0], dy = a[1] - b[1];
    var d = Math.sqrt(dx * dx + dy * dy);
    return d > 1 ? d : 1;
  };
  Stage.prototype.onMove = function (e) {
    var l = this.local(e);
    if (this.ptrs && this.ptrs[e.pointerId]) this.ptrs[e.pointerId] = l;
    /* 捏合缩放：两指间距变化率 → zoom（语义同 wheel，正=拉远） */
    if (this._pinch && this.ptrN >= 2 && this.impl.zoom) {
      var d = this._ptrGap();
      if (this.pinchD > 0 && d !== this.pinchD) {
        this.impl.zoom((this.pinchD - d) / this.pinchD * 2.2, this);
        this.pinchD = d;
        this.dirty = true; this.kick();
      }
      return;
    }
    var dx = l[0] - this.p.x, dy = l[1] - this.p.y;
    if (this.p.down) {
      /* 触屏首次移动：判定方向 —— 纵向让给滚动，横向才开始旋转 */
      if (this.p.axis === 0) {
        var adx = Math.abs(l[0] - this.p.sx), ady = Math.abs(l[1] - this.p.sy);
        if (adx < 7 && ady < 7) { this.p.x = l[0]; this.p.y = l[1]; return; }
        if (ady >= adx) {                        /* 竖向滑动 = 滚页 */
          this.p.axis = -1; this.p.down = false;
          if (this.impl.release) this.impl.release(0, 0, this);
          this.dirty = true; this.kick();
          return;
        }
        this.p.axis = 1;
        if (this.impl.grab) this.impl.grab(l[0], l[1], this);
        dx = l[0] - this.p.x; dy = l[1] - this.p.y;
      }
      this.p.x = l[0]; this.p.y = l[1];
      this.p.moved += Math.abs(dx) + Math.abs(dy);
      this.p.vx = dx; this.p.vy = dy;
      this.engaged = performance.now();      /* 拖动中持续刷新互动窗口 */
      if (this.impl.drag) this.impl.drag(dx, dy, this);
    } else if (this.impl.hover) {
      this.impl.hover(l[0], l[1], this);
    }
    this.dirty = true; this.kick();
  };
  Stage.prototype.onUp = function (e) {
    /* 捏合期间（或刚结束）不做点按/双击判定，避免误触复位键或 dbl */
    if (this.ptrs && this.ptrs[e.pointerId]) {
      delete this.ptrs[e.pointerId]; this.ptrN--;
    }
    if (this._pinch) {
      if (this.ptrN <= 0) { this.ptrN = 0; this._pinch = false; this.pinchD = 0; }
      this.p.down = false;
      this.dirty = true; this.kick();
      return;
    }
    if (!this.p.down) return;
    this.p.down = false;
    var quick = performance.now() - this.p.t0 < 420 && this.p.moved < 6;
    if (quick) {
      /* the reset button first — it is drawn above the scene, so a click
         on it must never fall through to the scene behind it */
      if (this._rb) {
        var dxr = this.p.x - this._rb[0], dyr = this.p.y - this._rb[1];
        if (dxr * dxr + dyr * dyr <= this._rb[2] * this._rb[2]) {
          this.tapAt = null;
          this.impl.reset(this);
          this.dirty = true; this.kick();
          if (this.impl.release) this.impl.release(0, 0, this);
          return;
        }
      }
      /* our own double-tap detection: works for touch, pen and mouse,
         and does not depend on the browser synthesising dblclick */
      var now = performance.now();
      var prev = this.tapAt;
      var twice = prev && now - prev.t < 380 &&
        Math.abs(prev.x - this.p.x) < 26 && Math.abs(prev.y - this.p.y) < 26;
      if (twice && this.impl.dbl) {
        this.tapAt = null;
        this.impl.dbl(this);
      } else {
        this.tapAt = { t: now, x: this.p.x, y: this.p.y };
        if (this.impl.tap) this.impl.tap(this.p.x, this.p.y, this);
      }
      /* 点一下也是"松手"：必须让装置知道拖拽结束了，
         否则 dragging 会一直卡住（跟随、状态文字都会错） */
      if (this.impl.release) this.impl.release(0, 0, this);
    } else if (this.impl.release) {
      this.impl.release(this.p.vx, this.p.vy, this);
    }
    this.dirty = true; this.kick();
  };

  Stage.prototype.resize = function () {
    var r = this.root.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width || this.root.clientWidth || 320));
    var h = Math.max(1, Math.round(r.height || this.root.clientHeight || 320));
    var dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w; this.h = h; this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    if (this.impl.resize) this.impl.resize(this);
    this.dirty = true; this.kick();
  };

  /* 把自己的下一帧登记到统一时钟上（不是自己起一条 rAF） */
  Stage.prototype.kick = function () {
    if (this._queued) return;
    this._queued = true;
    _tk.q.push(this);
    if (!_tk.raf) _tk.raf = requestAnimationFrame(_pump);
  };
  Stage.prototype._tick = function (now) { this._queued = false; this.frame(now); };

  Stage.prototype.frame = function (now) {
    if (!this.onscreen || !this.visible) { this.last = now; return; }
    /* 滑动期间降频而非冻结：全帧率重绘会和滚动合成抢主线程（边滑边卡），
       但全冻结又让模型显得"死了"（用户两边都不满意）。折中：每 ~260ms
       画一帧——滑过时它还在缓慢呼吸，停手 140ms 后恢复全速。 */
    if (this.scrolling && this.coarse) {
      if (now - (this._scDrawn || 0) < 260) { this.last = now; this.dirty = true; this.kick(); return; }
      this._scDrawn = now;
    }
    var dt = this.last ? (now - this.last) / 1000 : 1 / 60;
    this.last = now;
    dt = clamp(dt, 0, 1 / 20);

    /* adaptive quality: sustained slow frames => cheaper render */
    this.ema = lerp(this.ema, dt, 0.06);
    if (this.ema > 0.028 && this.qual === 1) this.qual = 0.55;
    else if (this.ema < 0.0195 && this.qual !== 1) this.qual = 1;

    var sdt = dt * this.opts.time;      /* 时间倍速（0 = 冻结，操作照旧） */
    var live = (!this.RM && this.opts.time > 0) || this.dirty;
    if (live) {
      this.t += sdt;
      if (this.impl.update) this.impl.update(sdt, this.t, this);
    }
    this.render();
    if (live) this.kick();
    this.dirty = false;
  };

  Stage.prototype.render = function () {
    var ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    this.impl.draw(ctx, this);
    this.chrome(ctx);
  };

  /* ---------- 共用的 HUD 外框（中文读数 + 暦 印记） ---------- */
  var _sn = 0;
  Stage.prototype.chrome = function (ctx) {
    var w = this.w, h = this.h, th = this.theme, q = this.qual, op = this.opts;
    var pad = Math.max(8, Math.min(14, w * 0.028));
    var gl = th.glow * q;
    var t = this.t;

    /* 纸面洗光：中心稍亮，四角压暗——画面立刻有"被照亮的仪器"感。
       嵌进安静版面时关掉（wash:0），画布就完全透明，只剩线稿本身 */
    if (op.wash) {
    if (!this._wash || this._washW !== w || this._washH !== h || this._washC !== th.paper) {
      var vg = ctx.createRadialGradient(w * 0.5, h * 0.46, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.72);
      vg.addColorStop(0, ca(th.lit, 0.16));
      vg.addColorStop(0.55, ca(th.lit, 0.05));
      vg.addColorStop(1, ca(th.shade, 0.10));
      this._wash = vg; this._washW = w; this._washH = h; this._washC = th.paper;
    }
    ctx.fillStyle = this._wash;
    ctx.fillRect(0, 0, w, h);
    }

    /* 工程网格 */
    if (op.grid) {
      grid(ctx, pad, pad, w - pad * 2, h - pad * 2, Math.max(14, Math.round(Math.min(w, h) / 14)),
        th.ink, 0.05 + 0.03 * gl);
    }

    /* 四角括号 */
    if (op.brackets) {
      brackets(ctx, pad, pad, w - pad * 2, h - pad * 2, Math.max(9, Math.min(18, w * 0.045)),
        th.ink, 0.5, 1);
    }

    /* 标题 */
    var fs = Math.max(9, Math.min(12, Math.round(w / 34)));
    if (op.hud) {
      text(ctx, this.impl.title || '', pad + 4, pad + fs + 4, th.accent, 0.95, 'left', fs, 2.6, 600);
      if (this.impl.sub) {
        text(ctx, this.impl.sub, pad + 4, pad + fs * 2 + 8, th.dim, 0.75, 'left', fs - 1, 1.6);
      }

      /* 左下状态（中文；RM 下提示"已静止 · 仍可拖拽"） */
      var st = this.RM ? '静止模式 · 可拖拽' : (this.impl.status ? this.impl.status(this) : '拖拽 · 旋转');
      text(ctx, st, pad + 4, h - pad - 4, th.dim, 0.66, 'left', fs - 2, 1.8);
    }

    /* 右上读数：世界线变动率等数据。它是数据而不是"仪器外壳"，
       所以单独一个开关 —— 首页那台关掉外壳但留着读数。 */
    if (op.readout) {
      var rows = (this.impl.hud && this.impl.hud(this)) || [];
      var gap = Math.min(72, w * 0.26);
      for (var i = 0; i < rows.length && i < 2; i++) {
        var y = pad + fs + 4 + i * (fs + 5);
        text(ctx, rows[i][0], w - pad - 4 - gap, y, th.dim, 0.62, 'right', fs - 1, 1.2);
        text(ctx, rows[i][1], w - pad - 4, y, i === 0 ? th.accent : th.ink, 0.92, 'right', fs - 1, 1.2);
      }
    }

    /* 右下角：暦 印记 + 编号（复位键出现时让开位置） */
    if (op.hud) {
      if (!this.sn) this.sn = 'KS-' + ('0' + (++_sn)).slice(-2);
      var sealSize = Math.max(11, Math.min(15, Math.round(w / 30)));
      var sealX = w - pad - 4 - (this._rb ? this._rb[2] * 2 + 8 : 0);
      text(ctx, '暦', sealX, h - pad - 5 - sealSize * 0.2, th.accent, 0.9, 'right', sealSize, 0, 600, SERIF);
      text(ctx, this.sn, pad + 4, h - pad - 16, th.dim, 0.45, 'left', 7, 1.2);
      if (op.time !== 1) text(ctx, '×' + op.time, sealX - sealSize - 6, h - pad - 4, th.dim, 0.6, 'right', 8, 1.2);
    }

    /* 一键复位键：画在右下角（叠在暦印记上方一格）。外壳全关的
       嵌入式装置（首页底部）也保留它 —— 用户拖飞了视角就靠它回来。
       this._rb = [x, y, r]，点击命中检测在 Stage.tap 里。 */
    if (this.impl.reset) {
      var rf = Math.max(9, Math.min(13, w * 0.028));
      var rx = w - pad - 4 - rf, ry = h - pad - 5 - rf * 0.2 - (op.hud ? rf * 2.4 : 0);
      var rr = rf + 5;
      ctx.strokeStyle = th.dim; ctx.lineWidth = 1; ctx.globalAlpha = 0.55;
      ctx.beginPath(); ctx.arc(rx, ry, rr, 0, TAU); ctx.stroke();
      ctx.globalAlpha = 1;
      text(ctx, 'R', rx, ry + rf * 0.36, th.dim, 0.85, 'center', rf, 1, 600);
      this._rb = [rx, ry, rr];
    } else this._rb = null;

    /* 扫描线 */
    if (op.scan && !this.RM) {
      var sy = mod(t * (h * 0.16), h - pad * 2) + pad;
      var g = ctx.createLinearGradient(0, sy - 14, 0, sy + 14);
      g.addColorStop(0, ca(th.cool, 0));
      g.addColorStop(0.5, ca(th.cool, 0.16 * gl));
      g.addColorStop(1, ca(th.cool, 0));
      ctx.fillStyle = g;
      ctx.fillRect(pad, sy - 14, w - pad * 2, 28);
      ctx.fillStyle = ca(th.cool, 0.5 * gl);
      ctx.fillRect(pad, sy, w - pad * 2, 1);
    }

    /* 微故障：每 ~4.6s 抖 90ms（跟扫描线同一路的"仪器感"，scan:0 一起关） */
    if (op.scan && !this.RM && op.time > 0) {
      var gi = Math.floor(t / 4.6), gt = t - gi * 4.6;
      if (gt < 0.09) {
        var r = rng(gi * 977 + 13), n = 3 + Math.floor(r() * 3);
        ctx.globalAlpha = 0.16 * gl * (1 - gt / 0.09);
        ctx.fillStyle = th.accent;
        for (var k = 0; k < n; k++) {
          var gy = pad + r() * (h - pad * 2);
          var gh = 1 + r() * 3;
          ctx.fillRect(pad + (r() - 0.5) * 10, gy, w - pad * 2, gh);
        }
        ctx.globalAlpha = 1;
      }
    }
  };

  var BUILD = {};

  /* ============================================================
     ORRERY — a real armillary sphere
     ------------------------------------------------------------
     The instrument body is a static frame; what moves is what
     really moves: the graduation dial creeps, planets run their
     own orbits, the sun breathes, light sweeps the rings.
     ============================================================ */
  BUILD.orrery = function () {
    var cam = new Camera();
    var R = rng(20260926);
    var tmp = [0, 0, 0, 0];

    /* star shell */
    var stars = [];
    for (var i = 0; i < 130; i++) {
      var u = R() * 2 - 1, a = R() * TAU, sr = Math.sqrt(1 - u * u), rad = 3.0 + R() * 2.2;
      stars.push([rad * sr * Math.cos(a), rad * u, rad * sr * Math.sin(a), 0.3 + R() * 0.7]);
    }

    var D = Math.PI / 180;
    /* 命运石之门主题：环 = 世界线的收束结构，星体 = 实验室成员 */
    var RINGS = [
      { r: 1.00, tilt: 0, spin: 0.055, w: 1.5, key: '收束环' },
      { r: 1.17, tilt: 23.44 * D, spin: -0.034, w: 1.2, key: '观测环' },
      { r: 0.83, tilt: Math.PI / 2, spin: 0.021, w: 1.0, key: '跃迁环' },
      { r: 1.34, tilt: -0.34, spin: 0.013, w: 1.0, key: '波动环' }
    ];
    var BODIES = [
      { n: '001 冈部', r: 0.40, tilt: 0.07, per: 13, ph: 0.4, s: 0.030, tone: 'ink', moon: 0 },
      { n: '002 桶子', r: 0.58, tilt: -0.11, per: 21, ph: 2.1, s: 0.038, tone: 'cool', moon: 0 },
      { n: '003 真由理', r: 0.79, tilt: 0.04, per: 34, ph: 4.2, s: 0.043, tone: 'ink', moon: 1 },
      { n: '004 红莉栖', r: 1.00, tilt: -0.06, per: 52, ph: 1.1, s: 0.034, tone: 'accent', moon: 0 },
      { n: '008 铃羽', r: 1.24, tilt: 0.10, per: 78, ph: 5.3, s: 0.027, tone: 'cool', moon: 1 }
    ];
    BODIES.forEach(function (b) { b.tr = []; b.w = [0, 0, 0]; b.sp = [0, 0, 0, 0]; });

    var hover = -1, lock = -1, idle = 99, dragging = false;
    var follow = false, trails = true;
    /* 彩蛋：冈部(0) 与 红莉栖(3) 投影后垂直重合的判定结果。
       alignedUntil = 宽限期：重合的瞬间很短（一两秒），若不加宽限，
       用户看到提示再去按复位键时两星早已错开，彩蛋就成了摆设。
       eggSeq = 彩蛋触发计数：重合时按复位键只涨它，相机不动。 */
    var aligned = false, homeSeq = 0, homeAligned = false, alignedUntil = 0, eggSeq = 0;
    /* ---------- 世界线：收束范围 + 官方作品中出现的真实变动率 ----------
       数值全部取自作品（不是编的）：α 0.409431 / 0.571046、β 1.130426 /
       1.129848、STEINS;GATE 1.048596、γ 2.615074、δ 3.600104、ε 4.456441、
       Ω -0.275349。装置每 18 秒跳一次世界线，跳变时读数乱跳一下、环发光、
       屏幕中央闪出"世界线变动 · α → β"。 */
    /* desc = 该世界线"发生了什么"（照作品里的结局概述写，不是编的） */
    var WORLDLINES = [
      { k: 'α', n: 'α 世界线', v: 0.409431, band: '0.3–0.6%', tone: 'cool',
        desc: ['真由理 2010.8 死亡 · 收束无法回避', 'SERN 反乌托邦：冈部 2025、桶子与红莉栖 2036 前死亡'] },
      { k: 'α', n: 'α 世界线', v: 0.571046, band: '0.3–0.6%', tone: 'cool',
        desc: ['发出第一封 D-mail 后进入的世界线', '真由理的死亡在此线同样收束'] },
      { k: 'SG', n: 'STEINS;GATE', v: 1.048596, band: '1.048596%', tone: 'accent',
        desc: ['真结局：真由理与红莉栖都活下来', '规避世界大战与 SERN 收束 · 未来未知'] },
      { k: 'β', n: 'β 世界线', v: 1.130426, band: '1.0–2.0%', tone: 'ink',
        desc: ['红莉栖 2010.7.28 死于广播馆 · 真由理存活', '《命运石之门 0》所在 · 第三次世界大战收束'] },
      { k: 'β', n: 'β 世界线', v: 1.129848, band: '1.0–2.0%', tone: 'ink',
        desc: ['删除首封 D-mail 后返回的世界线', '救下真由理，却要面对红莉栖的死'] },
      { k: 'γ', n: 'γ 世界线', v: 2.615074, band: '2.0–3.0%', tone: 'ink',
        desc: ['广播剧《暗黑次元的海德》：冈部成为 Rounder', '300 人委员会 · 以凤凰院凶真之名独裁日本'] },
      { k: 'δ', n: 'δ 世界线', v: 3.600104, band: '3.0–4.0%', tone: 'ink',
        desc: ['《比翼恋理的爱人》所在 · 全员存活', '看似和平的日常线 · 铃羽仍自 1975 归来'] },
      { k: 'ε', n: 'ε 世界线', v: 4.456441, band: '4.0–5.0%', tone: 'ink',
        desc: ['《线形拘束的树状图》· 三世因果的绑架', '真由理死后一年，Time Leap 失败而落至此线'] },
      { k: 'Ω', n: 'Ω 世界线', v: -0.275349, band: '−1.0–0%', tone: 'cool',
        desc: ['菲利斯线 · 形同陌路的生疏', '未创立未来道具研究所 · 变动率为负'] }
    ];
    /* wlFlash = 辉光/数字乱跳（约 1.2s）；wlText = 提示与概述的停留（约 7s） */
    var wlIdx = 0, wlPrev = null, wlFlash = 0, wlText = 0;
    var wlShown = WORLDLINES[0];
    var divg = WORLDLINES[0].v;

    function strokeGlowPath(ctx, color, w, alpha, glow) {
      ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      if (glow > 0.02) {
        ctx.globalAlpha = alpha * 0.12 * glow; ctx.lineWidth = w * 5; ctx.stroke();
        ctx.globalAlpha = alpha * 0.25 * glow; ctx.lineWidth = w * 2.4; ctx.stroke();
      }
      ctx.globalAlpha = alpha; ctx.lineWidth = w; ctx.stroke();
      ctx.globalAlpha = 1;
    }

    /* a circle in a tilted plane, drawn in three depth bands so the
       far side falls into mist and the near side comes forward */
    function ringPath(ctx, radius, tilt, N, out) {
      var pts = out || [];
      var ct = Math.cos(tilt), st = Math.sin(tilt);
      for (var i = 0; i <= N; i++) {
        var a = i / N * TAU;
        var x = radius * Math.cos(a), z = radius * Math.sin(a);
        var p = [x, -z * st, z * ct];
        cam.project(p, tmp);
        pts[i] = pts[i] || [0, 0, 0];
        pts[i][0] = tmp[0]; pts[i][1] = tmp[1]; pts[i][2] = tmp[2];
      }
      return pts;
    }
    function drawBands(ctx, pts, N, color, w, glow, aFar, aNear) {
      var zmin = 1e9, zmax = -1e9, i;
      for (i = 0; i <= N; i++) { if (pts[i][2] < zmin) zmin = pts[i][2]; if (pts[i][2] > zmax) zmax = pts[i][2]; }
      var span = (zmax - zmin) || 1;
      for (var b = 0; b < 3; b++) {
        ctx.beginPath();
        var any = false;
        for (i = 0; i < N; i++) {
          var zm = (pts[i][2] + pts[i + 1][2]) * 0.5;
          var f = 1 - clamp((zm - zmin) / span, 0, 1);          /* 1 = near */
          var band = Math.min(2, Math.floor(f * 3));
          if (band !== b) continue;
          ctx.moveTo(pts[i][0], pts[i][1]);
          ctx.lineTo(pts[i + 1][0], pts[i + 1][1]);
          any = true;
        }
        if (!any) continue;
        strokeGlowPath(ctx, color, w, lerp(aFar, aNear, b / 2), glow);
      }
    }

    var bufA = [], bufB = [], bufC = [];

    var api = {
      title: '01 浑天仪',
      sub: 'ORRERY · 世界线观测',
      aria: '可交互浑天仪：拖拽旋转，滚轮缩放，点击实验室成员星体锁定，数字键 1-5 直接选中，F 开启跟随，T 切换轨迹',

      init: function () { },
      resize: function () { },

      /* 复位基准：与 key('R') 完全一致，按钮和键盘走同一条路 */
      HOME: function () {
        /* 彩蛋语义（用户点名）：两星重合（含宽限期）时按复位键 =
           只触发彩蛋，相机绝不动；只有平时按复位才真的复位。 */
        if (aligned) { eggSeq++; return; }
        cam.yaw = -0.62; cam.pitch = 0.44; cam.dist = 3.4; cam.dTarget = null;
        cam.vyaw = cam.vpitch = 0; lock = -1; follow = false; idle = 0;
        homeSeq++;                      /* 复位计数：彩蛋靠它识别"按了复位键" */
        homeAligned = aligned;          /* 快照按下那一刻的对齐状态 */
      },
      reset: function () { api.HOME(); },

      /* 视角读写：站长可把当前姿态存成默认展示视角 */
      pose: function () { return { yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist }; },
      setPose: function (p) {
        if (!p) return;
        if (typeof p.yaw === 'number') cam.yaw = p.yaw;
        if (typeof p.pitch === 'number') cam.pitch = clamp(p.pitch, -1.32, 1.32);
        if (typeof p.dist === 'number') { cam.dist = clamp(p.dist, 1.2, 7.2); cam.dTarget = null; }
        cam.vyaw = cam.vpitch = 0;
      },
      /* 彩蛋状态：冈部(0) 与 红莉栖(3) 两星是否垂直重合 + 复位次数 */
      egg: function () { return { aligned: aligned, homeSeq: homeSeq, homeAligned: homeAligned, eggSeq: eggSeq, lock: lock }; },

      /* 采样点 = 仪器本体（环 + 刻度伸出量）。星壳是背景，本来就不在
         "内容"范围里——把它们算进去会把镜头推到远处，整台仪器缩成点。 */
      fit: function (stage) {
        var pts = [];
        for (var i = 0; i < RINGS.length; i++) pts.push([RINGS[i].r + 0.12, 0, 0]);
        return fitDist(cam, stage, pts, 14 + stage.w * 0.015, 14 + stage.h * 0.015);
      },

      grab: function () { dragging = true; idle = 0; cam.vyaw = cam.vpitch = 0; },
      drag: function (dx, dy) {
        cam.yaw += dx * 0.0075;
        cam.pitch = clamp(cam.pitch + dy * 0.0062, -1.25, 1.25);
        idle = 0;
        if (Math.abs(dx) + Math.abs(dy) > 2) follow = false;   /* 手一动就交还控制权 */
      },
      release: function (vx, vy, stage) {
        dragging = false; idle = 0;
        if (!stage.RM) { cam.vyaw = vx * 0.16; cam.vpitch = vy * 0.13; }
      },
      /* 缩放只改目标值，实际距离每帧缓动过去 —— 不再一格一格跳 */
      zoom: function (d, stage) {
        var lo = api.fit(stage);
        cam.zoomStep(d * 3.2, lo, 7.2);
        idle = 0;
      },
      dbl: function () { follow = !follow; if (follow && lock < 0) lock = 0; },
      key: function (k, stage) {
        if (k >= '1' && k <= '5') { lock = +k - 1; follow = true; idle = 0; return true; }
        if (k === 'f' || k === 'F') { follow = !follow; if (follow && lock < 0) lock = 0; return true; }
        if (k === 't' || k === 'T') { trails = !trails; return true; }
        if (k === 'r' || k === 'R') { api.HOME(); return true; }
        if (k === 'Escape') { lock = -1; follow = false; return true; }
        if (k === 'ArrowLeft') { cam.yaw -= 0.12; follow = false; return true; }
        if (k === 'ArrowRight') { cam.yaw += 0.12; follow = false; return true; }
        if (k === 'ArrowUp') { cam.pitch = clamp(cam.pitch - 0.1, -1.25, 1.25); return true; }
        if (k === 'ArrowDown') { cam.pitch = clamp(cam.pitch + 0.1, -1.25, 1.25); return true; }
        if (k === '+' || k === '=') { cam.zoomStep(-0.3, api.fit(stage), 7.2); return true; }
        if (k === '-' || k === '_') { cam.zoomStep(0.3, api.fit(stage), 7.2); return true; }
        return false;
      },

      hover: function (x, y, stage) {
        if (x == null) { hover = -1; return; }
        var best = -1, bd = 20 * 20;
        for (var i = 0; i < BODIES.length; i++) {
          var b = BODIES[i];
          var dx = b.sp[0] - x, dy = b.sp[1] - y;
          var d = dx * dx + dy * dy;
          if (d < bd) { bd = d; best = i; }
        }
        hover = best;
        stage.canvas.style.cursor = best >= 0 ? 'pointer' : '';
      },
      tap: function (x, y) {
        if (x == null) return;
        lock = (hover >= 0 && hover !== lock) ? hover : -1;
        if (lock < 0) follow = false;
      },

      update: function (dt, t, stage) {
        idle += dt;
        cam.slide(dt);
        /* 缩放缓动（滚轮/捏合都走这里） */
        cam.slideZoom(dt);
        /* 取景下限随视角变化：转到某个角度内容变"宽"时，镜头自动往外让，
           滞回 0.4% 防抖 —— 任何姿态下内容都不许出画布 */
        var lo0 = api.fit(stage);
        if (lo0 > cam.dist * 1.004) {
          cam.dist = lo0;
          if (cam.dTarget != null && cam.dTarget < lo0) cam.dTarget = lo0;
        }
        /* 空闲时整台仪器缓慢自转（可在控制台关掉） */
        if (idle > 2.6 && !dragging && !cam.vyaw && stage.opts.spin) cam.yaw += dt * 0.045;
        if (dragging) idle = 0;

        for (var i = 0; i < BODIES.length; i++) {
          var b = BODIES[i];
          var a = b.ph + t * TAU / b.per;
          var p = [b.r * Math.cos(a), 0, b.r * Math.sin(a)];
          b.w = rotX(p, b.tilt);
          b.tr.push(b.w[0], b.w[1], b.w[2]);
          if (b.tr.length > 48 * 3) b.tr.splice(0, 3);
        }

        /* --- 世界线跳变（每 14 秒一根，一整轮 9 根 ≈ 2 分钟）+ 跳变闪光 --- */
        var wi = Math.floor(t / 14) % WORLDLINES.length;
        if (wi !== wlIdx) {
          wlPrev = wlShown;
          wlIdx = wi;
          wlShown = WORLDLINES[wi];
          wlFlash = 1;                     /* 辉光 + 数字乱跳 */
          wlText = 1;                      /* 提示与概述停留约 7 秒 */
        }
        if (wlFlash > 0) wlFlash = Math.max(0, wlFlash - dt / 1.2);
        if (wlText > 0) wlText = Math.max(0, wlText - dt / 7);
        /* 读数在"当前收束范围内"缓慢漂移（不再整表乱走），
           并带一点世界线自身的波动（时间倍速越大漂得越快） */
        var amp = 0.000031 * stage.opts.time;
        divg = wlShown.v + (Math.sin(t * 0.37) * 0.6 + Math.sin(t * 0.11) * 0.4) * amp;

        /* 跟随：镜头追到被锁定星体的正面方向（+π 修正——
           atan2(x,z) 解出的是背面半球，必须翻到面向镜头的那一侧） */
        if (follow && lock >= 0 && !dragging) {
          var lb = BODIES[lock];
          var want = Math.atan2(-lb.w[0], -lb.w[2]);
          cam.yaw += wrapPi(want - cam.yaw) * Math.min(1, dt * 2.4);
        }
      },

      draw: function (ctx, stage) {
        var th = stage.theme, w = stage.w, h = stage.h, q = stage.qual;
        /* 世界线色调：α/Ω 冷、β/γ/δ/ε 墨、STEINS;GATE 用强调色（红）。
           跳变瞬间整体辉光上扬一下 —— "世界线在动"的直接观感。 */
        var wlTone = th[wlShown.tone] || th.ink;
        var gl = th.glow * q * (1 + wlFlash * 0.9);
        cam.frame(w, h);
        var t = stage.t;
        var cx = w * 0.5, cy = h * 0.5, unit = Math.min(w, h) * 0.5;

        /* --- star shell --- */
        for (var i = 0; i < stars.length; i++) {
          cam.project(stars[i], tmp);
          if (tmp[0] < -20 || tmp[0] > w + 20 || tmp[1] < -20 || tmp[1] > h + 20) continue;
          /* 星点缓慢明灭（确定性，用 t 而不是随机数，避免每帧抖动） */
          var a = stars[i][3] * clamp(1.25 - tmp[2] / 8, 0.08, 1) * 0.5 *
                  (0.72 + 0.28 * Math.sin(t * 1.15 + i * 1.7));
          ctx.globalAlpha = a;
          ctx.fillStyle = th.dim;
          ctx.fillRect(tmp[0], tmp[1], 1.2, 1.2);
        }
        ctx.globalAlpha = 1;

        /* --- orbits --- */
        ctx.setLineDash([2, 5]);
        for (i = 0; i < BODIES.length; i++) {
          var b = BODIES[i];
          var pts = ringPath(ctx, b.r, b.tilt, 60, bufA);
          var act = (i === hover || i === lock);
          drawBands(ctx, pts, 60, act ? th.accent : th.dim, act ? 1.3 : 1,
            act ? gl : gl * 0.25, act ? 0.12 : 0.05, act ? 0.75 : 0.3);
        }
        ctx.setLineDash([]);

        /* --- rings + creeping graduations --- */
        for (i = 0; i < RINGS.length; i++) {
          var rg = RINGS[i];
          var p2 = ringPath(ctx, rg.r, rg.tilt, 84, bufB);
          drawBands(ctx, p2, 84, th.ink, rg.w, gl * 0.5, 0.1, 0.62);

          /* 环名：贴在圆环最左端，随远近淡入淡出 */
          var li = 0, lx0 = 1e9;
          for (var q2 = 0; q2 <= 84; q2++) { if (p2[q2][0] < lx0) { lx0 = p2[q2][0]; li = q2; } }
          var lAl = clamp(1.15 - p2[li][2] / (cam.dist + 1.4), 0.12, 0.85);
          text(ctx, rg.key, p2[li][0] - 3, p2[li][1] - 3, th.dim, lAl, 'right', 8, 1.2);

          /* graduation ticks ride the dial */
          var ct = Math.cos(rg.tilt), st = Math.sin(rg.tilt);
          var ang0 = rg.spin * t;
          for (var pass = 0; pass < 2; pass++) {          /* 0 = minor, 1 = major */
            ctx.beginPath();
            for (var k = 0; k < 60; k++) {
              var maj = (k % 5 === 0) ? 1 : 0;
              if (maj !== pass) continue;
              var a2 = ang0 + k / 60 * TAU;
              var r0 = rg.r, r1 = rg.r + (maj ? 0.075 : 0.036);
              var pa = [r0 * Math.cos(a2), -r0 * Math.sin(a2) * st, r0 * Math.sin(a2) * ct];
              var pb = [r1 * Math.cos(a2), -r1 * Math.sin(a2) * st, r1 * Math.sin(a2) * ct];
              cam.project(pa, tmp); var x0 = tmp[0], y0 = tmp[1], z0 = tmp[2];
              cam.project(pb, tmp);
              if (z0 > cam.dist) continue;               /* hide the far side */
              ctx.moveTo(x0, y0); ctx.lineTo(tmp[0], tmp[1]);
            }
            strokeGlowPath(ctx, pass ? th.ink : th.dim, pass ? 1.2 : 1, pass ? 0.5 : 0.34, gl * 0.3);
          }
        }

        /* --- 当前世界线（收束范围边界）：最外一圈虚线，颜色随世界线变 ---
           α/Ω 冷色、β/γ/δ/ε 墨色、STEINS;GATE 是强调的红。跳变时它先亮起 */
        {
          var wlPts = ringPath(ctx, 1.42, 0.20, 96, bufC);
          ctx.setLineDash([3, 6]);
          drawBands(ctx, wlPts, 96, wlTone, 1, gl * (0.35 + wlFlash * 1.1), 0.06, 0.10 + 0.34 * (0.3 + wlFlash));
          ctx.setLineDash([]);
          var wli = 0, wlx = 1e9;
          for (var q3 = 0; q3 <= 96; q3++) { if (wlPts[q3][0] < wlx) { wlx = wlPts[q3][0]; wli = q3; } }
          text(ctx, wlShown.n, wlPts[wli][0] - 3, wlPts[wli][1] - 5, wlTone,
            0.42 + 0.42 * wlFlash, 'right', 8, 1.2);
          text(ctx, '收束 ' + wlShown.band, wlPts[wli][0] - 3, wlPts[wli][1] + 5, wlTone,
            0.30 + 0.30 * wlFlash, 'right', 7, 1.2);
        }

        /* --- the sun --- */
        var pulse = 0.82 + 0.18 * Math.sin(t * 1.35);
        cam.project([0, 0, 0], tmp);
        var sx = tmp[0], sy = tmp[1], ss = tmp[3];
        var gr = ctx.createRadialGradient(sx, sy, 0, sx, sy, unit * 0.30 * pulse);
        gr.addColorStop(0, ca(th.accent, 0.85 * (0.5 + gl * 0.5)));
        gr.addColorStop(0.35, ca(th.accent, 0.20 * gl));
        gr.addColorStop(1, ca(th.accent, 0));
        ctx.fillStyle = gr;
        ctx.beginPath(); ctx.arc(sx, sy, unit * 0.30 * pulse, 0, TAU); ctx.fill();
        ctx.fillStyle = th.accent;
        ctx.globalAlpha = 0.95;
        ctx.beginPath(); ctx.arc(sx, sy, Math.max(2, 0.030 * ss), 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
        /* corona rays */
        ctx.beginPath();
        for (k = 0; k < 12; k++) {
          var ra = t * 0.16 + k / 12 * TAU;
          var rr = 0.055 + 0.02 * Math.sin(t * 2.2 + k);
          ctx.moveTo(sx + Math.cos(ra) * rr * ss, sy + Math.sin(ra) * rr * ss);
          ctx.lineTo(sx + Math.cos(ra) * (rr + 0.045) * ss, sy + Math.sin(ra) * (rr + 0.045) * ss);
        }
        strokeGlowPath(ctx, th.accent, 1, 0.5, gl);

        /* --- trails, then bodies (far to near) --- */
        var order = [];
        for (i = 0; i < BODIES.length; i++) {
          var bb = BODIES[i];
          cam.project(bb.w, tmp);
          bb.sp[0] = tmp[0]; bb.sp[1] = tmp[1]; bb.sp[2] = tmp[2]; bb.sp[3] = tmp[3];
          order.push(i);
        }
        order.sort(function (a2, b2) { return BODIES[b2].sp[2] - BODIES[a2].sp[2]; });

        /* --- 彩蛋判定：冈部(0) 与 红莉栖(3) 是否"垂直重合" ---
           同一条竖线上（横向几乎重合、纵向错开），且两颗都在镜头前方。
           命中后由页面提示"按复位键触发"，复位键在此状态下触发对话彩蛋。 */
        var E0 = BODIES[0].sp, E3 = BODIES[3].sp;
        /* 窗口给宽一点（约画布宽度的 4%）：两颗星的相对相位约 17 秒扫一圈，
           太窄的窗口会让"重合"一闪而过，用户根本来不及按复位键 */
        /* 深度判据用"在镜头前方"而不是"比中心近"：轨道半径 1.24 的那颗
           跑到远侧时 z 会大于 dist，但它在画面里一样看得见 —— 之前的
           写法会把这种最常见的情况判掉（探针实测最小 14.8px 却不命中） */
        var hitNow = Math.abs(E0[0] - E3[0]) < Math.max(14, w * 0.045) &&
                     Math.abs(E0[1] - E3[1]) > 5 &&
                     E0[2] > 0.05 && E3[2] > 0.05;
        if (hitNow) alignedUntil = performance.now() + 6000;   /* 6 秒宽限 */
        aligned = hitNow || performance.now() < alignedUntil;

        for (var oi = 0; oi < order.length; oi++) {
          var ob = BODIES[order[oi]];
          /* trail in four alpha steps */
          var n = ob.tr.length / 3;
          if (trails && n > 6) {
            var segs = 4, per = Math.floor((n - 1) / segs);
            for (var sg = 0; sg < segs; sg++) {
              ctx.beginPath();
              var started = false;
              for (var j = sg * per; j <= (sg + 1) * per && j < n; j++) {
                cam.project([ob.tr[j * 3], ob.tr[j * 3 + 1], ob.tr[j * 3 + 2]], tmp);
                if (!started) { ctx.moveTo(tmp[0], tmp[1]); started = true; }
                else ctx.lineTo(tmp[0], tmp[1]);
              }
              strokeGlowPath(ctx, th.cool, 1.2, 0.05 + sg * 0.11, gl * 0.4);
            }
          }
        }

        for (oi = 0; oi < order.length; oi++) {
          var idx = order[oi], bd = BODIES[idx];
          var tone = th[bd.tone] || th.ink;
          var px = bd.sp[0], py = bd.sp[1], pr = Math.max(2.2, bd.s * bd.sp[3]);
          var front = bd.sp[2] < cam.dist;
          var al = front ? 1 : 0.4;
          /* glow body */
          var bg = ctx.createRadialGradient(px, py, 0, px, py, pr * 3.4);
          bg.addColorStop(0, ca(tone, 0.5 * gl * al));
          bg.addColorStop(1, ca(tone, 0));
          ctx.fillStyle = bg;
          ctx.beginPath(); ctx.arc(px, py, pr * 3.4, 0, TAU); ctx.fill();
          ctx.fillStyle = tone; ctx.globalAlpha = 0.92 * al;
          ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
          /* 明暗过渡：径向渐变替代原来那条生硬的发丝线——
             亮面朝日、暗面沉进纸色的阴影里，球体立刻立体 */
          var shg = ctx.createRadialGradient(
            px - pr * 0.38, py - pr * 0.38, pr * 0.08, px, py, pr * 1.18);
          shg.addColorStop(0, ca(tone, 0));
          shg.addColorStop(0.62, ca(th.shade, 0.18 * al));
          shg.addColorStop(1, ca(th.shade, 0.62 * al));
          ctx.fillStyle = shg;
          ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fill();
          /* 边缘光：朝日一侧一圈极细高光（赛璐璐的"轮廓光"） */
          ctx.strokeStyle = ca(th.lit, 0.45 * gl * al);
          ctx.lineWidth = Math.max(0.8, pr * 0.17);
          ctx.beginPath(); ctx.arc(px, py, pr * 0.94, -2.62, -0.45); ctx.stroke();
          ctx.globalAlpha = 1;

          /* moon */
          if (bd.moon) {
            var ma = t * TAU / 3.1 + idx;
            var mp = [bd.w[0] + 0.075 * Math.cos(ma), bd.w[1] + 0.02 * Math.sin(ma), bd.w[2] + 0.075 * Math.sin(ma)];
            cam.project(mp, tmp);
            ctx.fillStyle = th.dim; ctx.globalAlpha = 0.8;
            ctx.beginPath(); ctx.arc(tmp[0], tmp[1], Math.max(1.2, pr * 0.34), 0, TAU); ctx.fill();
            ctx.globalAlpha = 1;
          }
        }

        /* --- lock / hover annotation --- */
        var ann = lock >= 0 ? lock : hover;
        if (ann >= 0) {
          var an = BODIES[ann], tone2 = th[an.tone] || th.ink;
          var ax = an.sp[0], ay = an.sp[1], ar = Math.max(12, an.s * an.sp[3] * 2.6);
          var bcol = lock >= 0 ? th.accent : tone2;
          ctx.strokeStyle = bcol; ctx.globalAlpha = lock >= 0 ? 0.95 : 0.6; ctx.lineWidth = 1;
          var spin = lock >= 0 ? t * 0.9 : 0;
          for (var c2 = 0; c2 < 4; c2++) {
            var a3 = spin + c2 / 4 * TAU + Math.PI / 4;
            var cxp = ax + Math.cos(a3) * ar, cyp = ay + Math.sin(a3) * ar;
            ctx.beginPath();
            ctx.moveTo(cxp - Math.cos(a3) * 5, cyp - Math.sin(a3) * 5);
            ctx.lineTo(cxp, cyp);
            ctx.lineTo(cxp + Math.cos(a3 + Math.PI / 2) * 5 - Math.cos(a3) * 0, cyp + Math.sin(a3 + Math.PI / 2) * 5);
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          /* leader line + readout —— 牌子不许跑出画布：
             右缘不足时整块翻到星体左侧（文字右对齐方向随之翻转） */
          var wantR = ax + ar + 8 + 110, flip = wantR > w - 8;
          var lx = flip ? ax - ar - 8 : ax + ar + 8, ly = ay - ar * 0.4;
          var sgn = flip ? -1 : 1;
          ctx.strokeStyle = bcol; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(ax + sgn * ar * 0.7, ay - ar * 0.7);
          ctx.lineTo(lx, ly); ctx.lineTo(lx + sgn * 46, ly);
          ctx.stroke();
          ctx.globalAlpha = 1;
          var tAl = flip ? 'right' : 'left', tx = flip ? lx - 3 : lx + 3;
          text(ctx, an.n, tx, ly - 4, bcol, 0.95, tAl, 9, 1.6, 600);
          text(ctx, '周期 ' + an.per.toFixed(0) + 's · 轨道 ' + an.r.toFixed(2), tx, ly + 7, th.dim, 0.8, tAl, 8, 1.2);
          if (lock >= 0) {
            var pang = mod(Math.atan2(an.w[2], an.w[0]) * 57.2958, 360);
            text(ctx, '相位 ' + pang.toFixed(0) + '°' + (follow ? ' · 跟随中' : ''), tx, ly + 18, th.accent, 0.7, tAl, 8, 1.4);
          }
        }

        /* --- 世界线变动率计（Divergence Meter）：8 管辉光数字 ---
           跳变的前 0.45 秒数字乱跳（作品里世界线变动时的样子）。
           负值的 Ω 线首位留空（作品设定：负值时个位管不显示）。 */
        var pad2 = Math.max(8, Math.min(14, w * 0.028));
        var ds = Math.abs(divg).toFixed(6);
        var cwid = Math.max(7, Math.min(11, w * 0.023)), chei = cwid * 1.5;
        var gap2 = Math.max(2, cwid * 0.18);
        var mx0 = pad2, my0 = h - pad2 - chei;
        var scrambling = wlFlash > 0.45;
        for (var ci = 0; ci < ds.length; ci++) {
          var bx = mx0 + ci * (cwid + gap2);
          var glyph = ds.charAt(ci);
          if (glyph === '.') glyph = '·';
          else if (ci === 0 && divg < 0) glyph = ' ';           /* Ω：首位空管 */
          else if (scrambling) glyph = String(Math.floor(Math.abs(Math.sin(t * 31.7 + ci * 2.3)) * 10));
          ctx.strokeStyle = wlTone; ctx.globalAlpha = 0.30 + 0.30 * wlFlash; ctx.lineWidth = 1;
          ctx.strokeRect(bx, my0, cwid, chei);
          ctx.globalAlpha = 1;
          text(ctx, glyph, bx + cwid * 0.5, my0 + chei * 0.66, wlTone,
            0.55 + 0.45 * wlFlash, 'center', cwid * 0.78, 1, 600);
        }
        text(ctx, wlShown.k, mx0 + ds.length * (cwid + gap2) + 4, my0 + chei * 0.66,
          wlTone, 0.7 + 0.3 * wlFlash, 'left', Math.max(9, cwid * 0.8), 1, 600);
        if (divg < 0) text(ctx, '−', mx0 - 6, my0 + chei * 0.66, wlTone, 0.8, 'right', Math.max(9, cwid * 0.8), 1, 600);

        /* --- 世界线跳变提示：停留约 7 秒，下面两行是该线的结局概述 --- */
        if (wlText > 0.02) {
          var aTx = Math.min(1, wlText * 3);            /* 最后约 2 秒淡出 */
          var y0 = pad2 + Math.max(13, h * 0.038);
          /* 同一收束范围内换线（α → α）时写成变动率的变化，否则显示 α → β 这种 */
          var sameField = wlPrev && wlPrev.k === wlShown.k;
          var cap, csz = Math.max(9.5, w * 0.029);
          if (!wlPrev) cap = '世界线 · ' + wlShown.n;
          else if (sameField) {
            cap = '世界线变动 · ' + wlShown.k + ' ' + wlPrev.v.toFixed(6) + ' → ' + wlShown.v.toFixed(6);
            csz = Math.max(8, w * 0.021);
          } else cap = '世界线变动 · ' + wlPrev.k + ' → ' + wlShown.k;
          text(ctx, cap, w * 0.5, y0, wlTone, aTx * 0.95, 'center', csz, 2.4, 600);
          /* 一行细分隔线，把标题与概述分开 */
          ctx.globalAlpha = aTx * 0.28; ctx.strokeStyle = wlTone; ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(w * 0.5 - Math.min(70, w * 0.16), y0 + 6);
          ctx.lineTo(w * 0.5 + Math.min(70, w * 0.16), y0 + 6);
          ctx.stroke(); ctx.globalAlpha = 1;
          var dsz = Math.max(7.5, Math.min(10, w * 0.019));
          for (var di = 0; di < wlShown.desc.length && di < 2; di++) {
            text(ctx, wlShown.desc[di], w * 0.5, y0 + 18 + di * (dsz + 5), wlTone,
              aTx * (di === 0 ? 0.7 : 0.55), 'center', dsz, 1.1);
          }
        }

        /* grain */
        if (stage.opts.grain) stipple(ctx, 0, 0, w, h, Math.round(220 * q), th.ink, 0.035, 4242);
      },

      /* read-only snapshot — the headless probe asserts against this */
      debug: function () {
        return {
          yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist,
          lock: lock, hover: hover, follow: follow, trails: trails,
          divg: divg, aligned: aligned, homeSeq: homeSeq,
          wl: wlShown.k, wlIdx: wlIdx, wlFlash: wlFlash, wlText: wlText, wlName: wlShown.n,
          lockFront: lock >= 0 ? BODIES[lock].sp[2] < cam.dist : null,
          bodies: BODIES.map(function (b) { return [b.sp[0], b.sp[1]]; })
        };
      },

      /* 上限两行是 chrome 的契约（多出来的行会被丢掉），
         所以收束范围挂在世界线环的标签上，而不是塞成第三行 */
      hud: function (stage) {
        return [
          ['世界线', divg.toFixed(6) + wlShown.k],
          ['锁定', lock >= 0 ? BODIES[lock].n : '—']
        ];
      },
      status: function () {
        if (dragging) return '旋转中 · 滚轮缩放';
        if (lock >= 0) return (follow ? '跟随中 · ' : '已锁定 · ') + BODIES[lock].n;
        return '拖拽旋转 · 点击成员锁定 · 双击跟随';
      }
    };
    return api;
  };

  /* ============================================================
     LUNAR — a moon-phase bench you can scrub
     ------------------------------------------------------------
     Drag horizontally to run the synodic month backwards and
     forwards; drag vertically to nod the disc (libration, it
     springs back); click a key phase to ease to it; click
     anywhere else to play / pause. The terminator is solved from
     the real phase angle — it is not a masked bitmap.
     ============================================================ */
  BUILD.lunar = function () {
    var SYN = 29.530588;
    var day = 6.4, vel = 0, playing = true, dragging = false;
    var tilt = 0, target = null;

    /* deterministic face: craters, maria, ejecta rays */
    var CR = [], MA = [], RY = [];
    (function () {
      var r = rng(31415);
      for (var i = 0; i < 30; i++) {
        var a = r() * TAU, rr = Math.sqrt(r()) * 0.9;
        CR.push([Math.cos(a) * rr, Math.sin(a) * rr, 0.028 + r() * 0.10]);
      }
      for (i = 0; i < 5; i++) {
        var a2 = r() * TAU, r2 = 0.25 + r() * 0.45;
        MA.push([Math.cos(a2) * r2, Math.sin(a2) * r2, 0.20 + r() * 0.24]);
      }
      for (i = 0; i < 4; i++) {
        var a3 = r() * TAU, r3 = 0.3 + r() * 0.4;
        RY.push([Math.cos(a3) * r3, Math.sin(a3) * r3, 0.18 + r() * 0.2, r() * TAU]);
      }
    })();

    var KEYS = [
      [0, '新月'], [SYN * 0.25, '上弦'], [SYN * 0.5, '满月'], [SYN * 0.75, '下弦']
    ];
    function phaseName(d) {
      var f = mod(d, SYN) / SYN;
      if (f < 0.02 || f > 0.98) return '新月';
      if (f < 0.23) return '蛾眉月';
      if (f < 0.27) return '上弦月';
      if (f < 0.48) return '盈凸月';
      if (f < 0.52) return '满月';
      if (f < 0.73) return '亏凸月';
      if (f < 0.77) return '下弦月';
      return '残月';
    }
    /* 粗略但方向正确的升降时刻：新月随日出升，满月随日落升 */
    function hhmm(v) {
      var hh = Math.floor(v), mm = Math.round((v - hh) * 60);
      if (mm >= 60) { mm -= 60; hh += 1; }
      return ('0' + mod(hh, 24)).slice(-2) + ':' + ('0' + mm).slice(-2);
    }
    function riseSet(d) {
      var f = mod(d, SYN) / SYN;
      return { rise: mod(6 + f * 24, 24), set: mod(18 + f * 24, 24) };
    }
    function nextKey(d) {                 /* 双击＝跳到下一个关键相位 */
      var cur = mod(d, SYN);
      for (var i = 0; i < KEYS.length; i++) if (KEYS[i][0] > cur + 0.05) return KEYS[i][0];
      return KEYS[0][0];
    }

    var geo = { cx: 0, cy: 0, R: 0, tx: 0, ty: 0, tw: 0 };
    function layout(stage) {
      var w = stage.w, h = stage.h, m = Math.min(w, h);
      geo.R = m * 0.245;
      geo.cx = w * 0.32; geo.cy = h * 0.42;
      geo.ty = h - Math.max(20, m * 0.075);
      geo.tx = Math.max(14, w * 0.04);
      geo.tw = w - geo.tx * 2;
    }
    function dayToX(d, stage) { return geo.tx + mod(d, SYN) / SYN * geo.tw; }
    function xToDay(x) { return mod((x - geo.tx) / geo.tw * SYN, SYN); }

    var api = {
      title: '02 月相台',
      sub: 'LUNAR · 朔望月 29.53 天',
      aria: '可交互月相台：横向拖拽擦洗一个月，纵向拖拽点头（天平动），点击相位标记跳转，点击月面暂停/播放',
      init: function () { },
      resize: function () { },

      /* 复位 = 回到上弦之后的经典观察日，姿态与播放恢复（2D 版式，
         没有镜头缩放，不存在裁切问题） */
      reset: function () { day = 6.4; tilt = 0; vel = 0; target = null; playing = true; },

      grab: function () { dragging = true; vel = 0; target = null; },
      drag: function (dx, dy, stage) {
        day = mod(day + dx * (SYN / Math.max(80, geo.tw)), SYN);
        tilt = clamp(tilt + dy * 0.0022, -0.38, 0.38);
      },
      release: function (vx, stage) {
        dragging = false;
        vel = clamp(vx * (SYN / Math.max(80, geo.tw)) * 60, -9, 9);
      },
      hover: function (x, y, stage) {
        if (x == null) { stage.canvas.style.cursor = ''; return; }
        stage.canvas.style.cursor = (y > geo.ty - 16) ? 'ew-resize' : 'grab';
      },
      tap: function (x, y) {
        if (x == null) return;
        if (y > geo.ty - 18) {                     /* clicked the scrubber */
          var best = null, bd = 1e9;
          for (var i = 0; i < KEYS.length; i++) {
            var d = Math.abs(dayToX(KEYS[i][0]) - x);
            if (d < bd) { bd = d; best = KEYS[i][0]; }
          }
          target = (bd < 26) ? best : xToDay(x);
          vel = 0;
          return;
        }
        playing = !playing;
        vel = 0;
      },
      dbl: function () { target = nextKey(day); vel = 0; return true; },
      key: function (k) {
        if (k === ' ' || k === 'Enter') { playing = !playing; return true; }
        if (k >= '1' && k <= '4') { target = KEYS[+k - 1][0]; vel = 0; return true; }
        if (k === 'n' || k === 'N') { target = nextKey(day); vel = 0; return true; }
        if (k === 'r' || k === 'R') { day = 6.4; tilt = 0; vel = 0; target = null; playing = true; return true; }
        if (k === 'ArrowLeft') { day = mod(day - 0.5, SYN); playing = false; return true; }
        if (k === 'ArrowRight') { day = mod(day + 0.5, SYN); playing = false; return true; }
        if (k === 'ArrowUp') { day = mod(day - 2, SYN); playing = false; return true; }
        if (k === 'ArrowDown') { day = mod(day + 2, SYN); playing = false; return true; }
        return false;
      },

      update: function (dt, t, stage) {
        if (target != null) {
          var diff = wrapPi((target - day) / SYN * TAU) / TAU * SYN;
          if (Math.abs(diff) < 0.01) { day = mod(target, SYN); target = null; }
          else day = mod(day + diff * Math.min(1, dt * 5.5), SYN);
        } else if (!dragging) {
          if (Math.abs(vel) > 0.002) {
            day = mod(day + vel * dt, SYN);
            vel *= Math.pow(0.09, dt);
          } else if (playing && !stage.RM) {
            day = mod(day + dt * (SYN / 48), SYN);
          }
        }
        tilt += (0 - tilt) * Math.min(1, dt * 1.7);
      },

      draw: function (ctx, stage) {
        var th = stage.theme, w = stage.w, h = stage.h, q = stage.qual, gl = th.glow * q;
        layout(stage);
        var cx = geo.cx, cy = geo.cy, R = geo.R;
        var phi = mod(day, SYN) / SYN * TAU;
        var litRight = phi < Math.PI;
        var k = (1 - Math.cos(phi)) * 0.5;
        var t = stage.t;

        /* ---------- the moon ---------- */
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(tilt);
        ctx.translate(-cx, -cy);

        /* halo */
        var hg = ctx.createRadialGradient(cx, cy, R * 0.9, cx, cy, R * 1.7);
        hg.addColorStop(0, ca(th.cool, 0.20 * gl));
        hg.addColorStop(1, ca(th.cool, 0));
        ctx.fillStyle = hg;
        ctx.beginPath(); ctx.arc(cx, cy, R * 1.7, 0, TAU); ctx.fill();

        /* dark side base */
        ctx.save();
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.clip();
        ctx.fillStyle = th.shade;
        ctx.globalAlpha = 0.9;
        ctx.fillRect(cx - R, cy - R, R * 2, R * 2);
        ctx.globalAlpha = 1;

        /* earthshine — the dark side is never fully black */
        ctx.fillStyle = ca(th.cool, 0.10 + 0.05 * gl);
        ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU); ctx.fill();

        /* lit region: limb arc + terminator ellipse */
        /* terminator: an ellipse through the poles whose x-radius is
           r·cos φ, bulging to the lit side while waxing and to the dark
           side while waning (the sign flip is what makes a gibbous moon
           read gibbous instead of collapsing to a sliver) */
        var A = litRight ? R * Math.cos(phi) : -R * Math.cos(phi);
        ctx.beginPath();
        ctx.arc(cx, cy, R, -Math.PI / 2, Math.PI / 2, !litRight);
        ctx.ellipse(cx, cy, Math.abs(A), R, 0, Math.PI / 2, -Math.PI / 2, A >= 0);
        ctx.save();
        ctx.clip();

        var lg = ctx.createLinearGradient(cx + (litRight ? R : -R), cy - R * 0.3,
          cx - (litRight ? R * 0.35 : -R * 0.35), cy + R * 0.3);
        lg.addColorStop(0, th.lit);
        lg.addColorStop(0.62, mix(th.lit, th.shade, 0.30));
        lg.addColorStop(1, mix(th.lit, th.shade, 0.62));
        ctx.fillStyle = lg;
        ctx.fillRect(cx - R, cy - R, R * 2, R * 2);

        /* maria */
        for (var i = 0; i < MA.length; i++) {
          var m0 = MA[i];
          ctx.fillStyle = ca(th.shade, 0.30);
          ctx.beginPath();
          ctx.ellipse(cx + m0[0] * R, cy + m0[1] * R, m0[2] * R, m0[2] * R * 0.78, m0[0], 0, TAU);
          ctx.fill();
        }
        /* craters: shadow bowl + bright rim on the lit side */
        for (i = 0; i < CR.length; i++) {
          var c0 = CR[i];
          var px = cx + c0[0] * R, py = cy + c0[1] * R, pr = c0[2] * R;
          ctx.fillStyle = ca(th.shade, 0.24);
          ctx.beginPath(); ctx.ellipse(px, py, pr, pr * 0.9, 0, 0, TAU); ctx.fill();
          ctx.strokeStyle = ca(th.lit, 0.55); ctx.lineWidth = Math.max(0.7, pr * 0.16);
          ctx.beginPath();
          ctx.ellipse(px, py, pr, pr * 0.9, 0, litRight ? -1.9 : 1.25, litRight ? 1.9 : 4.9);
          ctx.stroke();
          ctx.strokeStyle = ca(th.shade, 0.4); ctx.lineWidth = Math.max(0.6, pr * 0.1);
          ctx.beginPath();
          ctx.ellipse(px, py, pr, pr * 0.9, 0, litRight ? 1.25 : -1.9, litRight ? 4.9 : 1.9);
          ctx.stroke();
        }
        /* ejecta rays */
        ctx.strokeStyle = ca(th.lit, 0.3); ctx.lineWidth = 1;
        for (i = 0; i < RY.length; i++) {
          var r0 = RY[i], rx = cx + r0[0] * R, ry = cy + r0[1] * R;
          ctx.beginPath();
          for (var s = 0; s < 7; s++) {
            var ra = r0[3] + s / 7 * TAU;
            ctx.moveTo(rx + Math.cos(ra) * r0[2] * R * 0.3, ry + Math.sin(ra) * r0[2] * R * 0.3);
            ctx.lineTo(rx + Math.cos(ra) * r0[2] * R * 1.5, ry + Math.sin(ra) * r0[2] * R * 1.5);
          }
          ctx.stroke();
        }
        ctx.restore();  /* unclip lit region */

        /* grain, clipped to the disc */
        stipple(ctx, cx - R, cy - R, R * 2, R * 2, Math.round(260 * q), th.shade, 0.10, 8123);
        ctx.restore();  /* unclip disc */

        /* terminator soft edge + limb rim */
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.abs(A), R, 0, Math.PI / 2, -Math.PI / 2, A >= 0);
        ctx.strokeStyle = ca(th.shade, 0.5); ctx.lineWidth = Math.max(2, R * 0.035);
        ctx.stroke();
        ctx.beginPath();
        ctx.ellipse(cx, cy, Math.abs(A), R, 0, Math.PI / 2, -Math.PI / 2, A >= 0);
        ctx.strokeStyle = ca(th.shade, 0.28); ctx.lineWidth = Math.max(5, R * 0.09);
        ctx.stroke();

        ctx.beginPath(); ctx.arc(cx, cy, R, 0, TAU);
        ctx.strokeStyle = th.ink; ctx.globalAlpha = 0.5; ctx.lineWidth = 1; ctx.stroke();
        ctx.globalAlpha = 1;
        /* lit limb highlight */
        var la0 = litRight ? -1.15 : Math.PI - 1.15, la1 = litRight ? 1.15 : Math.PI + 1.15;
        ctx.beginPath(); ctx.arc(cx, cy, R - 0.5, la0, la1);
        ctx.strokeStyle = ca(th.lit, 0.85); ctx.lineWidth = 1.6; ctx.stroke();
        ctx.restore();  /* unrotate */

        /* ---------- mini phase sequence ---------- */
        var n = 8, span = geo.tw * 0.46, mx0 = cx - span * 0.5;
        var my = cy + R + Math.max(20, R * 0.30);
        var mr = Math.max(4, R * 0.115);
        for (i = 0; i < n; i++) {
          var md = i / n * SYN, mphi = md / SYN * TAU;
          var mLit = mphi < Math.PI;
          var mA = mLit ? mr * Math.cos(mphi) : -mr * Math.cos(mphi);
          var px2 = mx0 + span * (i / (n - 1));
          ctx.beginPath(); ctx.arc(px2, my, mr, 0, TAU);
          ctx.fillStyle = th.shade; ctx.globalAlpha = 0.75; ctx.fill(); ctx.globalAlpha = 1;
          ctx.beginPath();
          ctx.arc(px2, my, mr, -Math.PI / 2, Math.PI / 2, !mLit);
          ctx.ellipse(px2, my, Math.abs(mA), mr, 0, Math.PI / 2, -Math.PI / 2, mA >= 0);
          ctx.fillStyle = th.lit; ctx.globalAlpha = 0.92; ctx.fill(); ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.arc(px2, my, mr, 0, TAU);
          var near = Math.abs(mod(day - md + SYN * 0.5, SYN) - SYN * 0.5) < SYN / (n * 2);
          ctx.strokeStyle = near ? th.accent : th.ink;
          ctx.globalAlpha = near ? 0.95 : 0.4;
          ctx.lineWidth = near ? 1.4 : 0.8;
          ctx.stroke(); ctx.globalAlpha = 1;
        }

        /* ---------- sun / earth / moon plan view ---------- */
        var gx = w * 0.74, gy = h * 0.23, gr = Math.min(w, h) * 0.135;
        ctx.save();
        ctx.translate(gx, gy);
        ctx.setLineDash([2, 4]);
        ctx.strokeStyle = th.dim; ctx.globalAlpha = 0.45; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(0, 0, gr, 0, TAU); ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;
        /* sunlight arrives from the right */
        for (i = 0; i < 5; i++) {
          var ly = -gr * 0.9 + i * gr * 0.45;
          ctx.beginPath();
          ctx.moveTo(gr * 1.95, ly); ctx.lineTo(gr * 1.45, ly);
          ctx.strokeStyle = ca(th.accent, 0.5); ctx.lineWidth = 1; ctx.stroke();
          ctx.beginPath();
          ctx.moveTo(gr * 1.95, ly); ctx.lineTo(gr * 1.95 - 6, ly - 3);
          ctx.moveTo(gr * 1.95, ly); ctx.lineTo(gr * 1.95 - 6, ly + 3);
          ctx.stroke();
        }
        /* earth + its shadow cone */
        var cone = gr * 1.05;
        ctx.beginPath();
        ctx.moveTo(0, -gr * 0.17); ctx.lineTo(-cone, -gr * 0.42);
        ctx.lineTo(-cone, gr * 0.42); ctx.lineTo(0, gr * 0.17);
        ctx.closePath();
        ctx.fillStyle = ca(th.shade, 0.22); ctx.fill();
        ctx.fillStyle = th.cool;
        ctx.beginPath(); ctx.arc(0, 0, gr * 0.17, 0, TAU); ctx.fill();
        /* moon on its orbit */
        var ma2 = -phi + Math.PI * 0.5;
        var mxp = Math.cos(ma2) * gr, myp = -Math.sin(ma2) * gr;
        ctx.strokeStyle = ca(th.dim, 0.5);
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(mxp, myp); ctx.stroke();
        ctx.fillStyle = th.shade;
        ctx.beginPath(); ctx.arc(mxp, myp, gr * 0.09, 0, TAU); ctx.fill();
        ctx.fillStyle = th.lit;
        ctx.beginPath();
        ctx.arc(mxp, myp, gr * 0.09, -Math.PI / 2, Math.PI / 2, false);
        ctx.fill();
        ctx.restore();
        text(ctx, '阳光 →', gx + gr * 2.0, gy - gr * 0.95, th.accent, 0.75, 'left', 8, 1.4);
        text(ctx, '地球', gx - gr * 0.2, gy + gr * 0.34, th.dim, 0.7, 'center', 8, 1.4);
        text(ctx, '月球', mxp + gx + gr * 0.14, myp + gy - gr * 0.12, th.dim, 0.7, 'left', 8, 1.4);

        /* ---------- readout block ---------- */
        var bx = w * 0.60, by = h * 0.46;
        text(ctx, '照度 ILLUMINATION', bx, by, th.dim, 0.65, 'left', 8, 1.6);
        var bwid = Math.min(w * 0.32, 150);
        ctx.strokeStyle = th.ink; ctx.globalAlpha = 0.28; ctx.lineWidth = 1;
        ctx.strokeRect(bx, by + 6, bwid, 7);
        ctx.globalAlpha = 1;
        ctx.fillStyle = th.accent;
        ctx.fillRect(bx + 1, by + 7, (bwid - 2) * k, 5);
        for (i = 0; i < 5; i++) {
          ctx.fillStyle = th.ink; ctx.globalAlpha = 0.35;
          ctx.fillRect(bx + bwid * i / 4 - 0.5, by + 4, 1, 11);
          ctx.globalAlpha = 1;
        }
        text(ctx, (k * 100).toFixed(1) + '%', bx + bwid + 8, by + 12, th.ink, 0.9, 'left', 9, 1.2);
        text(ctx, '月龄 ' + mod(day, SYN).toFixed(2) + ' / ' + SYN.toFixed(2) + ' 天',
          bx, by + 30, th.dim, 0.72, 'left', 8, 1.4);
        text(ctx, phaseName(day), bx, by + 44, th.accent, 0.95, 'left', 10, 2, 600);
        var rs = riseSet(day);
        text(ctx, '月出 ' + hhmm(rs.rise) + ' · 月落 ' + hhmm(rs.set), bx, by + 58, th.dim, 0.7, 'left', 8, 1.4);
        text(ctx, '天平动 ' + (tilt * 57.2958).toFixed(1) + '°', bx, by + 71, th.dim, 0.6, 'left', 8, 1.4);

        /* ---------- scrubber ---------- */
        var ty = geo.ty, tx = geo.tx, tw = geo.tw;
        ctx.strokeStyle = th.ink; ctx.globalAlpha = 0.35; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(tx + tw, ty); ctx.stroke();
        ctx.globalAlpha = 1;
        var fs = 8;
        for (i = 0; i <= 29; i++) {
          var xx = tx + i / 29 * tw;
          ctx.strokeStyle = th.dim; ctx.globalAlpha = i % 5 === 0 ? 0.55 : 0.28;
          ctx.beginPath();
          ctx.moveTo(xx, ty); ctx.lineTo(xx, ty - (i % 5 === 0 ? 7 : 3.5));
          ctx.stroke();
          ctx.globalAlpha = 1;
        }
        for (i = 0; i < KEYS.length; i++) {
          var kx = dayToX(KEYS[i][0], stage);
          ctx.fillStyle = th.accent;
          ctx.beginPath(); ctx.arc(kx, ty, 2.4, 0, TAU); ctx.fill();
          text(ctx, KEYS[i][1], kx, ty + 11, th.dim, 0.72, 'center', fs, 1.2);
        }
        /* cursor */
        var pcx = dayToX(day, stage);
        ctx.strokeStyle = th.accent; ctx.globalAlpha = 0.9; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.moveTo(pcx, ty - 12); ctx.lineTo(pcx, ty + 4); ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.fillStyle = th.accent;
        ctx.beginPath();
        ctx.moveTo(pcx - 4.5, ty - 12); ctx.lineTo(pcx + 4.5, ty - 12); ctx.lineTo(pcx, ty - 5);
        ctx.closePath(); ctx.fill();
        text(ctx, playing ? '▶ 播放中' : '❚❚ 已暂停', tx, ty + 11,
          playing ? th.accent : th.dim, 0.8, 'left', fs, 1.4);

        if (stage.opts.grain) stipple(ctx, 0, 0, w, h, Math.round(160 * q), th.ink, 0.03, 8123);
      },

      /* read-only snapshot — the headless probe asserts against this */
      debug: function (stage) {
        return {
          day: day, playing: playing, vel: vel, tilt: tilt, target: target,
          cursorX: dayToX(day, stage),
          geo: { cx: geo.cx, cy: geo.cy, R: geo.R, ty: geo.ty, tw: geo.tw }
        };
      },

      hud: function (stage) {
        var phi = mod(day, SYN) / SYN * TAU;
        return [
          ['月龄', mod(day, SYN).toFixed(2) + '天'],
          ['照度', ((1 - Math.cos(phi)) * 50).toFixed(1) + '%']
        ];
      },
      status: function () {
        if (dragging) return '擦洗中 · 上下拖＝点头';
        return playing ? '拖拽擦洗 · 点击暂停 · 双击跳下一相位' : '已暂停 · 拖拽擦洗 · 空格继续';
      }
    };
    return api;
  };

  /* ============================================================
     PRISM — a shaded icosahedron with hidden-line back faces
     ------------------------------------------------------------
     Painter-sorted facets lit by the same key light as everything
     else; the back of the solid is kept as hairline dashes (the
     line-art convention), a scan plane sweeps through it, and
     double-click explodes the faces along their normals.
     ============================================================ */
  BUILD.prism = function () {
    var cam = new Camera();
    cam.pitch = 0.36; cam.dist = 3.4;
    var tmp = [0, 0, 0, 0], tmp2 = [0, 0, 0, 0];
    var PHI = (1 + Math.sqrt(5)) / 2;

    /* --- 五种柏拉图立体（M 键切换） ---
       取面用顶部的通用凸包法 convexFaces()。 */
    var SOLID_ORDER = ['icosa', 'dodeca', 'octa', 'cube', 'tetra'];
    var SOLID_CN = { icosa: '正二十面体', dodeca: '正十二面体', octa: '正八面体', cube: '立方体', tetra: '正四面体' };
    var SOLID_EN = { icosa: 'ICOSAHEDRON', dodeca: 'DODECAHEDRON', octa: 'OCTAHEDRON', cube: 'CUBE', tetra: 'TETRAHEDRON' };
    var solidKind = 'icosa', solidIdx = 0;
    var V = [], EDGES = [], FACES = [];
    var i, j, k;

    function rawVerts(kind) {
      var P = (1 + Math.sqrt(5)) / 2, ip = 1 / P, v = [];
      if (kind === 'tetra') {
        v = [[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]];
      } else if (kind === 'cube') {
        for (i = 0; i < 8; i++) v.push([(i & 1) ? 1 : -1, (i & 2) ? 1 : -1, (i & 4) ? 1 : -1]);
      } else if (kind === 'octa') {
        v = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      } else if (kind === 'icosa') {
        v = [[0, 1, P], [0, 1, -P], [0, -1, P], [0, -1, -P], [1, P, 0], [1, -P, 0],
          [-1, P, 0], [-1, -P, 0], [P, 0, 1], [P, 0, -1], [-P, 0, 1], [-P, 0, -1]];
      } else {                                        /* dodeca */
        for (i = 0; i < 8; i++) v.push([(i & 1) ? 1 : -1, (i & 2) ? 1 : -1, (i & 4) ? 1 : -1]);
        for (i = 0; i < 4; i++) {
          var s1 = (i & 1) ? 1 : -1, s2 = (i & 2) ? 1 : -1;
          v.push([0, s1 * ip, s2 * P]); v.push([s1 * ip, s2 * P, 0]); v.push([s1 * P, 0, s2 * ip]);
        }
      }
      var mx = 0;
      for (i = 0; i < v.length; i++) mx = Math.max(mx, Math.sqrt(dot(v[i], v[i])));
      for (i = 0; i < v.length; i++) v[i] = [v[i][0] / mx, v[i][1] / mx, v[i][2] / mx];
      return v;
    }

    function edgesOf(FF) {
      var e = [], seen = {};
      for (var f = 0; f < FF.length; f++) {
        var ix = FF[f].idx;
        for (var m = 0; m < ix.length; m++) {
          var a2 = ix[m], b2 = ix[(m + 1) % ix.length];
          var key = Math.min(a2, b2) + '-' + Math.max(a2, b2);
          if (!seen[key]) { seen[key] = 1; e.push([a2, b2]); }
        }
      }
      return e;
    }

    function setSolid(kind) {
      solidKind = kind;
      V = rawVerts(kind);
      FACES = convexFaces(V);
      EDGES = edgesOf(FACES);
    }
    setSolid('icosa');
    /* inner cage: an octahedron core */
    var OCT = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
    var OCTE = [[0, 2], [0, 3], [0, 4], [0, 5], [1, 2], [1, 3], [1, 4], [1, 5],
      [2, 4], [2, 5], [3, 4], [3, 5]];
    for (i = 0; i < OCT.length; i++) OCT[i] = [OCT[i][0] * 0.46, OCT[i][1] * 0.46, OCT[i][2] * 0.46];

    var expl = 0, explTarget = 0, idle = 99, dragging = false;
    var scan = 0, wire = false, scanOn = true, spinning = true;
    var hoverFace = -1, lastList = [];

    function facePoint(f, vi, e, out) {
      var v = V[f.idx[vi]];
      out[0] = v[0] + f.c[0] * e;
      out[1] = v[1] + f.c[1] * e;
      out[2] = v[2] + f.c[2] * e;
      return out;
    }
    var fp = [0, 0, 0];

    var api = {
      title: '03 多面体',
      sub: 'PRISM · 柏拉图立体',
      aria: '可交互多面体：拖拽旋转，双击爆开，M 切换立体，W 线框，S 扫描，空格自转',

      init: function () { },
      resize: function () { },

      HOME: function () {
        cam.yaw = -0.62; cam.pitch = 0.36; cam.dist = 3.4;
        cam.vyaw = cam.vpitch = 0; explTarget = 0; idle = 0;
      },
      reset: function () { api.HOME(); },

      /* 外接球半径：本体 1 + 爆开位移（面心 |c|≤1）→ 最大 2。
         爆开中用当前的 expl，缩小同样精确。 */
      fit: function (stage) {
        var R2 = 1 + expl * 1.02;
        return fitDist(cam, stage,
          [[R2, 0, 0], [-R2, 0, 0], [0, R2, 0], [0, -R2, 0], [0, 0, R2], [0, 0, -R2]],
          14 + stage.w * 0.015, 14 + stage.h * 0.015);
      },

      grab: function () { dragging = true; idle = 0; cam.vyaw = cam.vpitch = 0; },
      drag: function (dx, dy) {
        cam.yaw += dx * 0.0082;
        cam.pitch = clamp(cam.pitch + dy * 0.0068, -1.3, 1.3);
        idle = 0;
      },
      release: function (vx, vy, stage) {
        dragging = false; idle = 0;
        if (!stage.RM) { cam.vyaw = vx * 0.17; cam.vpitch = vy * 0.14; }
      },
      zoom: function (d, stage) {
        cam.dist = clamp(cam.dist + d * 2.8, api.fit(stage), 7.0);
        idle = 0;
      },
      dbl: function () { explTarget = explTarget > 0.5 ? 0 : 1; idle = 0; },
      hover: function (x, y, stage) {
        if (x == null) { hoverFace = -1; stage.canvas.style.cursor = ''; return; }
        hoverFace = -1;
        for (var f = lastList.length - 1; f >= 0; f--) {          /* 从最前面的面往回找 */
          var fc = lastList[f];
          if (fc.n[2] <= 0) continue;
          if (inPoly(x, y, fc.p, fc.idx.length)) { hoverFace = f; break; }
        }
        stage.canvas.style.cursor = hoverFace >= 0 ? 'crosshair' : '';
      },
      key: function (key) {
        if (key === 'e' || key === 'E') { explTarget = explTarget > 0.5 ? 0 : 1; return true; }
        if (key === 'm' || key === 'M') {
          solidIdx = (solidIdx + 1) % SOLID_ORDER.length;
          setSolid(SOLID_ORDER[solidIdx]); hoverFace = -1; return true;
        }
        if (key === 'w' || key === 'W') { wire = !wire; return true; }
        if (key === 's' || key === 'S') { scanOn = !scanOn; return true; }
        if (key === ' ') { spinning = !spinning; return true; }
        if (key === 'r' || key === 'R') { api.HOME(); return true; }
        if (key === 'ArrowLeft') { cam.yaw -= 0.12; return true; }
        if (key === 'ArrowRight') { cam.yaw += 0.12; return true; }
        if (key === 'ArrowUp') { cam.pitch = clamp(cam.pitch - 0.1, -1.3, 1.3); return true; }
        if (key === 'ArrowDown') { cam.pitch = clamp(cam.pitch + 0.1, -1.3, 1.3); return true; }
        return false;
      },

      update: function (dt, t, stage) {
        idle += dt;
        if (dragging) idle = 0;
        cam.slide(dt);
        var loP = api.fit(stage);
        if (loP > cam.dist * 1.004) cam.dist = loP;
        if (idle > 2.2 && !dragging && !cam.vyaw && spinning && stage.opts.spin) cam.yaw += dt * 0.06;
        expl += (explTarget - expl) * Math.min(1, dt * 3.4);
        scan = Math.sin(t * 0.42);
      },

      draw: function (ctx, stage) {
        this._st = stage;
        var th = stage.theme, w = stage.w, h = stage.h, q = stage.qual, gl = th.glow * q;
        cam.frame(w, h);
        var t = stage.t, e = expl * 0.30;
        var cyaw = Math.cos(cam.yaw), syaw = Math.sin(cam.yaw);
        var cpi = Math.cos(cam.pitch), spi = Math.sin(cam.pitch);

        function viewN(n) {
          var x = n[0] * cyaw - n[2] * syaw, z = n[0] * syaw + n[2] * cyaw;
          var y = n[1] * cpi - z * spi, z2 = n[1] * spi + z * cpi;
          return [x, y, z2];
        }

        /* --- cage rings (cyber scaffolding) --- */
        var cageR = 1.22, cn = 44;
        for (var ring = 0; ring < 3; ring++) {
          ctx.beginPath();
          for (i = 0; i <= cn; i++) {
            var a = i / cn * TAU;
            var p;
            if (ring === 0) p = [Math.cos(a) * cageR, Math.sin(a) * cageR, 0];
            else if (ring === 1) p = [Math.cos(a) * cageR, 0, Math.sin(a) * cageR];
            else p = [0, Math.cos(a) * cageR, Math.sin(a) * cageR];
            cam.project(p, tmp);
            if (i === 0) ctx.moveTo(tmp[0], tmp[1]); else ctx.lineTo(tmp[0], tmp[1]);
          }
          ctx.strokeStyle = th.dim; ctx.globalAlpha = 0.16; ctx.lineWidth = 1;
          ctx.stroke(); ctx.globalAlpha = 1;
        }

        /* --- inner octahedron core --- */
        ctx.setLineDash([2, 3]);
        ctx.beginPath();
        for (i = 0; i < OCTE.length; i++) {
          cam.project(OCT[OCTE[i][0]], tmp);
          var ax = tmp[0], ay = tmp[1];
          cam.project(OCT[OCTE[i][1]], tmp);
          ctx.moveTo(ax, ay); ctx.lineTo(tmp[0], tmp[1]);
        }
        ctx.strokeStyle = th.cool; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;

        /* --- scan plane in screen space --- */
        cam.project([0, scan * 1.15, 0], tmp);
        var scanY = tmp[1];
        var sweep = scanOn && Math.abs(Math.cos(t * 0.42)) < 0.995;

        /* --- facets（三角 / 四边形 / 五边形通用） --- */
        var list = [];
        for (i = 0; i < FACES.length; i++) {
          var f = FACES[i], zs = 0, nv = f.idx.length;
          for (j = 0; j < nv; j++) {
            facePoint(f, j, e, fp);
            cam.project(fp, f.p[j]);
            zs += f.p[j][2];
          }
          f.z = zs / nv;
          f.n = viewN(f.c);
          list.push(f);
        }
        list.sort(function (a2, b2) { return b2.z - a2.z; });
        lastList = list;

        function pathFace(fc) {
          ctx.beginPath();
          ctx.moveTo(fc.p[0][0], fc.p[0][1]);
          for (var m = 1; m < fc.idx.length; m++) ctx.lineTo(fc.p[m][0], fc.p[m][1]);
          ctx.closePath();
        }
        function faceMidY(fc) {
          var s2 = 0;
          for (var m = 0; m < fc.idx.length; m++) s2 += fc.p[m][1];
          return s2 / fc.idx.length;
        }

        for (i = 0; i < list.length; i++) {
          var fc = list[i];
          var front = fc.n[2] > 0;
          var hot = (i === hoverFace);

          if (!front && !wire) {
            /* 背面保留为虚线——线稿制图的老规矩 */
            ctx.setLineDash([3, 4]);
            pathFace(fc);
            ctx.strokeStyle = th.dim; ctx.globalAlpha = 0.30; ctx.lineWidth = 0.9;
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
            continue;
          }

          var lam = clamp(dot(norm(fc.n), LIGHT), 0, 1);
          var rimv = 1 - Math.abs(fc.n[2]);
          var base = mix(th.shade, th.lit, 0.10 + 0.90 * Math.pow(lam, 0.85));
          var fill = mix(base, th.cool, rimv * 0.30);

          pathFace(fc);
          if (!wire) {
            ctx.fillStyle = fill;
            ctx.globalAlpha = 0.94;
            ctx.fill();
            ctx.globalAlpha = 1;
          }

          /* 受光的边亮、背光的边沉 */
          ctx.strokeStyle = hot ? th.accent : mix(th.lit, th.ink, 0.35);
          ctx.globalAlpha = hot ? 0.95 : (wire ? 0.7 : 0.55 + 0.35 * lam);
          ctx.lineWidth = hot ? 1.9 : (wire ? 0.9 : 1.15);
          ctx.stroke();
          ctx.globalAlpha = 1;

          /* 扫描平面切到这个面时点亮 */
          if (sweep) {
            var dd = Math.abs(faceMidY(fc) - scanY);
            if (dd < 26) {
              ctx.strokeStyle = th.accent;
              ctx.globalAlpha = (1 - dd / 26) * 0.9;
              ctx.lineWidth = 1.8;
              ctx.stroke();
              ctx.globalAlpha = 1;
            }
          }

          /* 悬停面：读数贴片 */
          if (hot) {
            var hx = 0, hy = 0;
            for (var m2 = 0; m2 < fc.idx.length; m2++) { hx += fc.p[m2][0]; hy += fc.p[m2][1]; }
            hx /= fc.idx.length; hy /= fc.idx.length;
            ctx.strokeStyle = th.accent; ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(hx + 6, hy - 6); ctx.lineTo(hx + 22, hy - 20); ctx.lineTo(hx + 62, hy - 20);
            ctx.stroke();
            ctx.globalAlpha = 1;
            text(ctx, '面 ' + (i + 1), hx + 24, hy - 23, th.accent, 0.95, 'left', 8, 1.4, 600);
            text(ctx, '亮度 ' + (lam * 100).toFixed(0) + '%', hx + 24, hy - 12, th.dim, 0.75, 'left', 7, 1.2);
          }
        }

        /* --- vertices --- */
        for (i = 0; i < V.length; i++) {
          cam.project(V[i], tmp);
          var vs = Math.max(1.6, 0.018 * tmp[3]);
          ctx.fillStyle = th.accent;
          ctx.globalAlpha = 0.85;
          ctx.fillRect(tmp[0] - vs * 0.5, tmp[1] - vs * 0.5, vs, vs);
          ctx.globalAlpha = 1;
          ctx.strokeStyle = ca(th.accent, 0.25 * gl);
          ctx.lineWidth = Math.max(2, vs * 3);
          ctx.strokeRect(tmp[0] - vs * 0.5, tmp[1] - vs * 0.5, vs, vs);
        }

        /* --- 扫描线本体 --- */
        if (sweep) {
          ctx.strokeStyle = ca(th.accent, 0.55);
          ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(w * 0.06, scanY); ctx.lineTo(w * 0.94, scanY); ctx.stroke();
          text(ctx, '扫描 ' + (scan * 100).toFixed(0), w * 0.06, scanY - 5, th.accent, 0.7, 'left', 8, 1.6);
        }

        if (stage.opts.grain) stipple(ctx, 0, 0, w, h, Math.round(200 * q), th.ink, 0.03, 555);
      },

      /* read-only snapshot — the headless probe asserts against this */
      debug: function () {
        return {
          yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist,
          expl: explTarget, faces: FACES.length, edges: EDGES.length,
          solid: solidKind, wire: wire, hoverFace: hoverFace
        };
      },

      hud: function (stage) {
        return [
          ['立体', SOLID_CN[solidKind]],
          ['面 / 棱', FACES.length + ' / ' + EDGES.length]
        ];
      },
      status: function () {
        if (explTarget > 0.5) return '已爆开 · 双击合拢 · M 换立体';
        return '拖拽旋转 · 双击爆开 · M 换立体 · W 线框';
      }
    };
    return api;
  };

  /* ============================================================
     GLOBE — 04 行星观测
     ------------------------------------------------------------
     海陆地球仪：内置简化海岸线数据，建台时栅格化成 3° 网格，
     每帧只把面向镜头的陆块格填色并描出海岸线，看起来像一台
     真正的显示地球仪。背后是一层带视差的确定性星空，地轴有
     23.4° 倾角。图钉：秋叶原 / CERN / 济州岛，点击后镜头沿最
     短角路径飞到该点的正面半球（旧版少翻了 180°，一点图钉就
     转到背面去——已修）。
     ============================================================ */
  BUILD.globe = function () {
    var cam = new Camera();
    cam.pitch = -0.35; cam.yaw = -0.5; cam.dist = 3.05;
    var TILT = -23.44 * Math.PI / 180;          /* 地轴倾角 */
    var tmp = [0, 0, 0, 0];
    var spinning = true, dragging = false, idle = 99;
    var hoverPin = -1, fly = -1;
    var i, j, spin = 0;

    var PINS = [
      { cn: '秋叶原', en: 'AKIHABARA', lat: 35.7021, lon: 139.7729 },
      { cn: '日内瓦', en: 'CERN', lat: 46.2333, lon: 6.0550 },
      { cn: '济州岛', en: 'JEJU', lat: 33.50, lon: 126.53 }
    ];
    for (i = 0; i < PINS.length; i++) {
      var la = PINS[i].lat * Math.PI / 180, lo = PINS[i].lon * Math.PI / 180;
      PINS[i].v = [Math.cos(la) * Math.cos(lo), Math.sin(la), Math.cos(la) * Math.sin(lo)];
      PINS[i].s = [0, 0, 0, 0];
    }
    /* 开局把秋叶原解到面向镜头的半球（推导见 update 的飞行解算） */
    spin = 1.5 * Math.PI - Math.atan2(PINS[0].v[2], PINS[0].v[0]) - cam.yaw;

    /* ---- 简化海岸线（[lon,lat,...] 扁平数组，手绘工程风格） ---- */
    var LANDPoly = [
      /* 北美洲 */
      [-168,66,-166,60,-158,58,-153,57,-148,60,-140,60,-135,57,-132,53,-125,49,-124,43,-121,35,-117,32,-110,24,-106,20,-97,16,-92,15,-84,10,-78,7,-82,9,-86,12,-88,16,-87,21,-90,21,-94,18,-97,22,-93,29,-89,29,-84,30,-81,25,-80,27,-76,35,-70,42,-66,45,-60,47,-56,52,-64,60,-70,58,-78,62,-82,55,-94,58,-92,63,-85,66,-77,70,-85,73,-100,74,-115,74,-128,72,-140,70,-155,71,-165,68],
      /* 格陵兰 */
      [-52,60,-43,60,-40,64,-32,68,-22,70,-25,76,-38,78,-58,76,-68,72,-60,68,-53,65],
      /* 南美洲 */
      [-78,7,-70,12,-62,10,-52,5,-50,0,-44,-3,-38,-6,-35,-9,-39,-14,-41,-22,-48,-26,-52,-32,-58,-38,-62,-40,-65,-45,-68,-50,-68,-55,-72,-54,-74,-48,-73,-40,-71,-33,-70,-25,-70,-18,-76,-14,-81,-6,-80,0],
      /* 非洲 */
      [-17,15,-16,20,-13,27,-9,32,-5,35,0,36,10,37,11,34,19,31,25,32,32,31,35,28,37,22,37,18,43,11,48,11,51,12,46,5,40,-3,39,-10,35,-15,35,-20,33,-26,27,-34,20,-35,18,-32,15,-27,12,-18,13,-10,9,-2,9,4,5,5,-4,5,-8,4,-13,8],
      /* 阿拉伯半岛 */
      [35,29,37,24,41,16,43,12,48,14,53,17,57,20,59,22,56,26,52,25,48,28,44,30],
      /* 欧亚大陆 */
      [-9,43,-2,48,2,51,8,54,8,57,12,56,18,59,21,60,25,65,22,66,30,70,40,68,55,68,60,70,70,73,80,73,95,78,105,77,115,74,130,72,140,72,150,70,160,70,170,67,178,66,178,64,165,60,162,56,162,52,158,52,155,58,150,59,142,54,135,44,130,42,129,35,126,35,126,38,122,40,120,35,122,30,118,24,110,20,108,16,107,10,104,8,100,13,98,12,94,16,91,22,86,20,80,15,80,10,77,8,73,16,70,21,66,25,61,25,57,26,50,30,44,31,36,36,30,36,27,37,23,37,20,40,16,41,12,44,7,44,3,43,0,40,-2,37,-6,36,-9,37],
      /* 不列颠 */
      [-5,50,-3,53,-5,56,-3,58,-6,58,-8,54,-10,52,-6,50],
      /* 冰岛 */
      [-22,64,-18,66,-14,65,-18,63],
      /* 日本 */
      [130,31,132,34,136,35,140,36,141,39,142,42,145,44,142,45,140,42,137,37,133,34,129,32],
      /* 苏门答腊 */
      [95,5,99,2,104,-3,106,-6,102,-5,97,1],
      /* 婆罗洲 */
      [109,1,113,4,117,6,119,1,116,-3,111,-2],
      /* 爪哇 */
      [105,-6,110,-7,114,-8,110,-8,105,-7],
      /* 新几内亚 */
      [131,-1,136,-2,141,-3,146,-6,150,-9,147,-8,143,-8,138,-7,133,-4],
      /* 菲律宾 */
      [120,18,122,16,124,12,125,8,122,8,120,14],
      /* 澳大利亚 */
      [114,-22,114,-30,116,-34,124,-33,130,-32,136,-35,140,-38,146,-39,150,-37,153,-30,153,-25,147,-19,143,-14,142,-11,137,-12,135,-15,131,-12,126,-14,122,-17],
      /* 新西兰 */
      [167,-45,170,-44,173,-41,175,-37,174,-40,170,-46],
      /* 马达加斯加 */
      [44,-25,47,-25,50,-16,49,-12,46,-16,44,-20],
      /* 古巴 */
      [-84,22,-80,23,-75,20,-79,21]
    ];

    /* ---- 栅格化：3° 一格，建台时跑一次 ---- */
    var GSTEP = 3, GLON = 120, GLAT = 60;
    var LANDR = [], landList = [];
    for (j = 0; j < GLAT; j++) LANDR.push(new Uint8Array(GLON));
    (function () {
      function mark(flat) {
        var n = flat.length / 2, k2, x0 = 999, x1 = -999, y0 = 999, y1 = -999;
        for (k2 = 0; k2 < n; k2++) {
          var xv = flat[k2 * 2], yv = flat[k2 * 2 + 1];
          if (xv < x0) x0 = xv; if (xv > x1) x1 = xv;
          if (yv < y0) y0 = yv; if (yv > y1) y1 = yv;
        }
        var c0 = Math.max(0, Math.floor((x0 + 180) / GSTEP - 1));
        var c1 = Math.min(GLON - 1, Math.ceil((x1 + 180) / GSTEP + 1));
        var r0 = Math.max(0, Math.floor((y0 + 90) / GSTEP - 1));
        var r1 = Math.min(GLAT - 1, Math.ceil((y1 + 90) / GSTEP + 1));
        for (var r = r0; r <= r1; r++) for (var c = c0; c <= c1; c++) {
          var lon = -180 + (c + 0.5) * GSTEP, lat = -90 + (r + 0.5) * GSTEP;
          var inside = false, a, b;
          for (a = 0, b = n - 1; a < n; b = a++) {
            var xi = flat[a * 2], yi = flat[a * 2 + 1], xj = flat[b * 2], yj = flat[b * 2 + 1];
            if ((yi > lat) !== (yj > lat) && lon < (xj - xi) * (lat - yi) / ((yj - yi) || 1e-9) + xi) inside = !inside;
          }
          if (inside) LANDR[r][c] = 1;
        }
      }
      for (var p2 = 0; p2 < LANDPoly.length; p2++) mark(LANDPoly[p2]);
      /* 南极洲：纬度带近似（r=0 是南极点一侧，只填 0..rA 这半边） */
      var rA = Math.floor((-72 + 90) / GSTEP);
      for (var r2 = 0; r2 <= rA; r2++) for (var c2 = 0; c2 < GLON; c2++) LANDR[r2][c2] = 1;
      /* 收集陆块格：本地单位向量 + 四角方向 + 海岸标记 */
      var dHalf = GSTEP * Math.PI / 360;
      for (var r3 = 0; r3 < GLAT; r3++) for (var c3 = 0; c3 < GLON; c3++) {
        if (!LANDR[r3][c3]) continue;
        var latC = -90 + (r3 + 0.5) * GSTEP, lonC = -180 + (c3 + 0.5) * GSTEP;
        var laC = latC * Math.PI / 180, loC = lonC * Math.PI / 180;
        var cl = Math.cos(laC), sl = Math.sin(laC);
        var coast = false, dd = [[1, 0], [-1, 0], [0, 1], [0, -1]];
        for (var q3 = 0; q3 < 4; q3++) {
          var rr3 = r3 + dd[q3][0], cc3 = (c3 + dd[q3][1] + GLON) % GLON;
          if (rr3 < 0 || rr3 >= GLAT || !LANDR[rr3][cc3]) coast = true;
        }
        var k4 = [];
        /* 环形顺序必须是 SW → NW → NE → SE（纬度掩码用 (q3+1)&2，
           写成 q3&1 会排出 S,N,S,N 的对角环，每个四边形都自交，
           非零环绕规则下中心抵消不填色 —— 棋盘格 bug 的根源） */
        for (q3 = 0; q3 < 4; q3++) {
          var laK = laC + (((q3 + 1) & 2) ? dHalf : -dHalf);
          var loK = loC + ((q3 & 2) ? dHalf : -dHalf);
          k4.push([Math.cos(laK) * Math.cos(loK), Math.sin(laK), Math.cos(laK) * Math.sin(loK)]);
        }
        landList.push({ cx: cl * Math.cos(loC), cy: sl, cz: cl * Math.sin(loC),
          k: k4, coast: coast, z: 0,
          p: [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]] });
      }
    })();

    /* ---- 背景星空（确定性 + 视差） ---- */
    var BG = [];
    (function () {
      var br = rng(777);
      for (var s = 0; s < 150; s++) {
        BG.push([br(), br(), 0.5 + br() * 1.3, br() * TAU, 0.4 + br() * 1.1, 0.25 + br() * 0.75]);
      }
    })();

    var LAT = [-60, -30, 0, 30, 60];
    var NAMED = { '0': '赤道' };

    /* 环形缓冲：每帧复用，避免每帧新建上千个数组 */
    var MAXN = 48, POOL = [], poolI = 0;
    for (i = 0; i < 26; i++) {
      var arr = []; for (var z = 0; z <= MAXN; z++) arr.push([0, 0, 0]); POOL.push(arr);
    }
    function nextBuf() { return POOL[(poolI++) % POOL.length]; }

    /* w2：地球本地系 → 世界系（先绕地轴自转，再整体倾斜） */
    function w2(p) { return rotZ(rotY(p, spin), TILT); }

    function ringPts(c, u, v, r, N) {
      var out = nextBuf();
      var c2 = w2(c), u2 = w2(u), v2 = w2(v);
      for (var m = 0; m <= N; m++) {
        var a = m / N * TAU, cs = Math.cos(a), sn = Math.sin(a);
        cam.project([c2[0] + (u2[0] * cs + v2[0] * sn) * r,
          c2[1] + (u2[1] * cs + v2[1] * sn) * r,
          c2[2] + (u2[2] * cs + v2[2] * sn) * r], tmp);
        out[m][0] = tmp[0]; out[m][1] = tmp[1]; out[m][2] = tmp[2];
      }
      return out;
    }
    /* 只画 b0..b1 这几个深度层：远层先画、纸面居中、近层压上 */
    function bandStroke(ctx, pts, N, color, w0, aFar, aNear, b0, b1) {
      var zmin = 1e9, zmax = -1e9, m;
      for (m = 0; m <= N; m++) { if (pts[m][2] < zmin) zmin = pts[m][2]; if (pts[m][2] > zmax) zmax = pts[m][2]; }
      var span = (zmax - zmin) || 1;
      ctx.strokeStyle = color; ctx.lineWidth = w0; ctx.lineCap = 'round';
      for (var b = b0; b <= b1; b++) {
        ctx.beginPath();
        var any = false;
        for (m = 0; m < N; m++) {
          var zm = (pts[m][2] + pts[m + 1][2]) * 0.5;
          var f = 1 - clamp((zm - zmin) / span, 0, 1);
          if (Math.min(2, Math.floor(f * 3)) !== b) continue;
          ctx.moveTo(pts[m][0], pts[m][1]); ctx.lineTo(pts[m + 1][0], pts[m + 1][1]);
          any = true;
        }
        if (!any) continue;
        ctx.globalAlpha = lerp(aFar, aNear, b / 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    function slerp(a, b, u) {
      var om = Math.acos(clamp(dot(a, b), -1, 1)), so = Math.sin(om) || 1e-6;
      return [(Math.sin((1 - u) * om) * a[0] + Math.sin(u * om) * b[0]) / so,
        (Math.sin((1 - u) * om) * a[1] + Math.sin(u * om) * b[1]) / so,
        (Math.sin((1 - u) * om) * a[2] + Math.sin(u * om) * b[2]) / so];
    }
    var vis = [], scr = [0, 0, 0];

    var api = {
      title: '04 行星观测',
      sub: 'GLOBE · 海陆与星空',
      aria: '可交互海陆地球仪：拖拽旋转，滚轮缩放，点击图钉飞向该地（秋叶原、CERN、济州岛），数字键 1-3 直达，空格开关自转',
      init: function () { },
      resize: function () { },

      HOME: function () {
        cam.yaw = -0.5; cam.pitch = -0.35; cam.dist = 3.05;
        cam.vyaw = cam.vpitch = 0; fly = -1; spinning = true; idle = 0;
        /* 开局角度：秋叶原面向镜头（与建台时同一解算） */
        spin = 1.5 * Math.PI - Math.atan2(PINS[0].v[2], PINS[0].v[0]) - cam.yaw;
      },
      reset: function () { api.HOME(); },

      /* 内容 = 半径 1 的球（含图钉与引出线的上缘余量）。
         星空是屏幕空间的，铺满画布不算"内容出界"。 */
      fit: function (stage) {
        return fitDist(cam, stage,
          [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]],
          14 + stage.w * 0.015, 48 + stage.h * 0.02);
      },

      grab: function () { dragging = true; idle = 0; fly = -1; cam.vyaw = cam.vpitch = 0; },
      drag: function (dx, dy) {
        cam.yaw += dx * 0.0072;
        cam.pitch = clamp(cam.pitch + dy * 0.0060, -1.2, 1.2);
        idle = 0; fly = -1;
      },
      release: function (vx, vy, stage) {
        dragging = false; idle = 0;
        if (!stage.RM) { cam.vyaw = vx * 0.15; cam.vpitch = vy * 0.12; }
      },
      zoom: function (d, stage) {
        cam.dist = clamp(cam.dist + d * 2.6, api.fit(stage), 6.4);
        idle = 0;
      },
      dbl: function () { spinning = !spinning; },
      hover: function (x, y, stage) {
        if (x == null) { hoverPin = -1; stage.canvas.style.cursor = ''; return; }
        var best = -1, bd = 18 * 18;
        for (var m = 0; m < PINS.length; m++) {
          var p = PINS[m];
          if (p.s[2] > cam.dist) continue;                 /* 背面的图钉不响应 */
          var ddx = p.s[0] - x, ddy = p.s[1] - y, d2 = ddx * ddx + ddy * ddy;
          if (d2 < bd) { bd = d2; best = m; }
        }
        hoverPin = best;
        stage.canvas.style.cursor = best >= 0 ? 'pointer' : '';
      },
      tap: function () { if (hoverPin >= 0) { fly = hoverPin; spinning = false; idle = 0; } },
      key: function (k) {
        if (k >= '1' && k <= String(PINS.length)) { fly = +k - 1; spinning = false; return true; }
        if (k === ' ') { spinning = !spinning; return true; }
        if (k === 'r' || k === 'R') { api.HOME(); return true; }
        if (k === 'ArrowLeft') { cam.yaw -= 0.12; fly = -1; return true; }
        if (k === 'ArrowRight') { cam.yaw += 0.12; fly = -1; return true; }
        if (k === 'ArrowUp') { cam.pitch = clamp(cam.pitch - 0.1, -1.2, 1.2); fly = -1; return true; }
        if (k === 'ArrowDown') { cam.pitch = clamp(cam.pitch + 0.1, -1.2, 1.2); fly = -1; return true; }
        return false;
      },

      update: function (dt, t, stage) {
        idle += dt;
        if (dragging) idle = 0;
        cam.slide(dt);
        var loG = api.fit(stage);
        if (loG > cam.dist * 1.004) cam.dist = loG;
        if (spinning && stage.opts.spin) spin += dt * 0.085;

        /* 飞向图钉：目标角取 atan2(-x,-z) —— 面向镜头的半球。
           （镜头在 -z 侧看向 +z，近半球 r[2]<0；旧版用 atan2(x,z)
           解到 z'>0 的远半球，所以一点图钉就"转到背面"） */
        if (fly >= 0) {
          var q = w2(PINS[fly].v);
          var want = Math.atan2(-q[0], -q[2]);
          cam.yaw += wrapPi(want - cam.yaw) * Math.min(1, dt * 2.6);
          var pt = -Math.asin(clamp(q[1], -1, 1));
          cam.pitch += (clamp(pt, -1.15, 1.15) - cam.pitch) * Math.min(1, dt * 2.6);
        } else if (idle > 2.6 && !dragging && !cam.vyaw && stage.opts.spin) {
          spin += dt * 0.02;      /* 没人动的时候多转一点点 */
        }
      },

      draw: function (ctx, stage) {
        var th = stage.theme, w = stage.w, h = stage.h, q = stage.qual, gl = th.glow * q;
        cam.frame(w, h);
        var t = stage.t;
        var N = q < 1 ? 30 : 44;
        poolI = 0;
        var cs = Math.cos(spin), sn = Math.sin(spin);
        var ct = Math.cos(TILT), st2 = Math.sin(TILT);

        /* ---- 宇宙星空：先画，被地球挡住；随镜头视差轻移 ---- */
        for (i = 0; i < BG.length; i++) {
          var sb = BG[i];
          var px3 = mod(sb[0] * (w + 40) + cam.yaw * 80 * sb[5] + w, w);
          var py3 = mod(sb[1] * (h + 40) - cam.pitch * 55 * sb[5] + h, h);
          var tw3 = 0.45 + 0.55 * Math.abs(Math.sin(t * sb[4] + sb[3]));
          ctx.globalAlpha = (0.14 + 0.5 * tw3) * sb[5];
          ctx.fillStyle = th.dim;
          ctx.fillRect(px3, py3, sb[2], sb[2]);
          if (i < 5) {                                   /* 几颗亮星带十字光 */
            ctx.globalAlpha = 0.18 * tw3 * sb[5];
            ctx.fillRect(px3 - 3, py3, 7, 0.8);
            ctx.fillRect(px3, py3 - 3, 0.8, 7);
          }
        }
        ctx.globalAlpha = 1;

        /* ---- 太阳方向 → 昼夜（世界系，随时间缓移） ---- */
        var dec = 0.41 * Math.sin(t * 0.045);
        var slon = t * 0.13;
        var sc = Math.cos(dec);
        var sun = [sc * Math.cos(slon), Math.sin(dec), sc * Math.sin(slon)];
        /* 反旋转回地球本地系：陆块分昼夜、晨昏线都用它 */
        var sul = rotY(rotZ(sun, -TILT), -spin);
        var su = norm(cross(sul, [0, 1, 0.0001]));
        var sv = norm(cross(sul, su));

        /* ---- 远侧线稿 ---- */
        for (i = 0; i < LAT.length; i++) {
          var la = LAT[i] * Math.PI / 180, cl = Math.cos(la), sl = Math.sin(la);
          var pts = ringPts([0, sl, 0], [1, 0, 0], [0, 0, 1], cl, N);
          var isEq = (LAT[i] === 0);
          bandStroke(ctx, pts, N, isEq ? th.accent : th.ink, isEq ? 1.25 : 1,
            isEq ? 0.10 : 0.06, isEq ? 0.5 : 0.34, 0, 1);
        }
        for (i = 0; i < 12; i++) {
          var lo = i / 12 * TAU;
          var mp = ringPts([0, 0, 0], [Math.cos(lo), 0, Math.sin(lo)], [0, 1, 0], 1, N);
          bandStroke(ctx, mp, N, th.ink, 1, 0.05, 0.30, 0, 1);
        }

        /* ---- 半透明纸面球体：海洋 ---- */
        cam.project([0, 0, 0], tmp);
        var cxs = tmp[0], cys = tmp[1];
        var rr = cam._c.f / Math.sqrt(Math.max(0.05, cam.dist * cam.dist - 1));
        var bg = ctx.createRadialGradient(cxs - rr * 0.35, cys - rr * 0.4, rr * 0.1, cxs, cys, rr * 1.05);
        bg.addColorStop(0, ca(th.lit, 0.66));
        bg.addColorStop(0.7, ca(th.paper, 0.55));
        bg.addColorStop(1, ca(th.shade, 0.45));
        ctx.fillStyle = bg;
        ctx.globalAlpha = 0.92;
        ctx.beginPath(); ctx.arc(cxs, cys, rr, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;

        /* ---- 陆块：背面剔除 → 远到近填色 + 海岸线 ---- */
        var visN = 0;
        for (i = 0; i < landList.length; i++) {
          var ce = landList[i];
          scr[0] = ce.cx * cs - ce.cz * sn; scr[1] = ce.cy; scr[2] = ce.cx * sn + ce.cz * cs;
          var x1 = scr[0], z1 = scr[2];
          scr[0] = x1 * ct - scr[1] * st2; scr[1] = x1 * st2 + scr[1] * ct;
          cam.project(scr, tmp);
          if (tmp[2] > cam.dist - 0.36) continue;          /* 地平线以下不画 */
          ce.z = tmp[2];
          vis[visN++] = i;
        }
        vis.length = visN;
        vis.sort(function (a4, b4) { return landList[b4].z - landList[a4].z; });

        /* 陆块的昼夜色阶按太阳本地方向量化成 8 档（避免每格拼字符串） */
        var shade8 = [];
        for (var b5 = 0; b5 < 8; b5++) {
          shade8.push(mix(mix(th.shade, th.ink, 0.42), th.lit, 0.10 + 0.24 * (b5 / 7)));
        }
        for (var vi = 0; vi < visN; vi++) {
          var ce2 = landList[vis[vi]];
          for (var k4 = 0; k4 < 4; k4++) {
            var kd = ce2.k[k4];
            scr[0] = kd[0] * cs - kd[2] * sn; scr[1] = kd[1]; scr[2] = kd[0] * sn + kd[2] * cs;
            var x2 = scr[0], z2 = scr[2];
            scr[0] = x2 * ct - scr[1] * st2; scr[1] = x2 * st2 + scr[1] * ct;
            cam.project(scr, ce2.p[k4]);
          }
          var lit = ce2.cx * sul[0] + ce2.cy * sul[1] + ce2.cz * sul[2];
          ctx.beginPath();
          ctx.moveTo(ce2.p[0][0], ce2.p[0][1]);
          ctx.lineTo(ce2.p[1][0], ce2.p[1][1]);
          ctx.lineTo(ce2.p[2][0], ce2.p[2][1]);
          ctx.lineTo(ce2.p[3][0], ce2.p[3][1]);
          ctx.closePath();
          ctx.fillStyle = shade8[clamp((lit * 3.5 + 3.5) | 0, 0, 7)];
          ctx.globalAlpha = 0.88;
          ctx.fill();
          if (ce2.coast) {
            ctx.strokeStyle = th.ink; ctx.globalAlpha = 0.5; ctx.lineWidth = 1;
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
        }

        /* ---- 近侧线稿（更淡，不盖过陆块） ---- */
        for (i = 0; i < LAT.length; i++) {
          var la2 = LAT[i] * Math.PI / 180, cl2 = Math.cos(la2), sl2 = Math.sin(la2);
          var pt2 = ringPts([0, sl2, 0], [1, 0, 0], [0, 0, 1], cl2, N);
          var eq2 = (LAT[i] === 0);
          bandStroke(ctx, pt2, N, eq2 ? th.accent : th.ink, eq2 ? 1.25 : 1,
            eq2 ? 0.08 : 0.05, eq2 ? 0.6 : 0.45, 2, 2);
          if (NAMED[String(LAT[i])]) {
            var li = 0, lx0 = 1e9;
            for (var m0 = 0; m0 <= N; m0++) if (pt2[m0][0] < lx0) { lx0 = pt2[m0][0]; li = m0; }
            if (pt2[li][2] < cam.dist) {
              text(ctx, NAMED[String(LAT[i])], pt2[li][0] - 4, pt2[li][1] - 3, th.accent, 0.7, 'right', 8, 1.2);
            }
          }
        }
        for (i = 0; i < 12; i++) {
          var lo2 = i / 12 * TAU;
          var mp2 = ringPts([0, 0, 0], [Math.cos(lo2), 0, Math.sin(lo2)], [0, 1, 0], 1, N);
          bandStroke(ctx, mp2, N, th.ink, 1, 0.05, 0.4, 2, 2);
        }

        /* ---- 晨昏线 ---- */
        ctx.setLineDash([4, 4]);
        var tp = ringPts([0, 0, 0], su, sv, 1, N);
        bandStroke(ctx, tp, N, th.accent, 1.1, 0.10, 0.55, 0, 2);
        ctx.setLineDash([]);

        /* ---- 航线：秋叶原 → CERN（大圆虚线） ---- */
        var A = w2(PINS[0].v), B = w2(PINS[1].v);
        ctx.setLineDash([3, 3]);
        ctx.beginPath();
        for (i = 0; i <= 20; i++) {
          cam.project(slerp(A, B, i / 20), tmp);
          if (i === 0) ctx.moveTo(tmp[0], tmp[1]); else ctx.lineTo(tmp[0], tmp[1]);
        }
        ctx.strokeStyle = th.cool; ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.globalAlpha = 1;

        /* ---- 图钉 ---- */
        for (i = 0; i < PINS.length; i++) {
          var p = PINS[i];
          cam.project(w2(p.v), tmp);
          p.s[0] = tmp[0]; p.s[1] = tmp[1]; p.s[2] = tmp[2]; p.s[3] = tmp[3];
          var front = p.s[2] < cam.dist;
          var hot = (i === hoverPin || i === fly);
          var al = front ? 1 : 0.3;
          var pr = Math.max(3, 0.022 * p.s[3]);
          /* 光晕 */
          var pg = ctx.createRadialGradient(p.s[0], p.s[1], 0, p.s[0], p.s[1], pr * 4);
          pg.addColorStop(0, ca(th.accent, 0.45 * gl * al));
          pg.addColorStop(1, ca(th.accent, 0));
          ctx.fillStyle = pg;
          ctx.beginPath(); ctx.arc(p.s[0], p.s[1], pr * 4, 0, TAU); ctx.fill();
          /* 针杆 + 圆徽 */
          ctx.strokeStyle = th.ink; ctx.globalAlpha = 0.75 * al; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(p.s[0], p.s[1]); ctx.lineTo(p.s[0], p.s[1] - pr * 2.4); ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.beginPath(); ctx.arc(p.s[0], p.s[1] - pr * 2.9, pr * 1.5, 0, TAU);
          ctx.fillStyle = hot ? th.accent : th.paper;
          ctx.globalAlpha = 0.95 * al; ctx.fill(); ctx.globalAlpha = 1;
          ctx.strokeStyle = th.accent; ctx.globalAlpha = 0.9 * al; ctx.lineWidth = hot ? 1.5 : 1;
          ctx.stroke(); ctx.globalAlpha = 1;
          /* 引出线 + 名称（按序号上下错开，近邻图钉的标签不打架） */
          if (front) {
            var lx2 = p.s[0] + pr * 3, ly2 = p.s[1] - pr * 4.6 - i * 13;
            ctx.strokeStyle = th.accent; ctx.globalAlpha = hot ? 0.8 : 0.4; ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(p.s[0] + pr, p.s[1] - pr * 3.4);
            ctx.lineTo(lx2, ly2); ctx.lineTo(lx2 + 30, ly2);
            ctx.stroke();
            ctx.globalAlpha = 1;
            text(ctx, p.cn, lx2 + 2, ly2 - 4, hot ? th.accent : th.ink, 0.95, 'left', 9, 1.6, 600);
            text(ctx, p.en + ' ' + p.lat.toFixed(1) + '°', lx2 + 2, ly2 + 7, th.dim, 0.7, 'left', 7, 1.2);
          }
        }

        /* 球体轮廓 */
        ctx.beginPath(); ctx.arc(cxs, cys, rr, 0, TAU);
        ctx.strokeStyle = th.ink; ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.stroke();
        ctx.globalAlpha = 1;

        if (stage.opts.grain) stipple(ctx, 0, 0, w, h, Math.round(180 * q), th.ink, 0.03, 991);
      },

      debug: function () {
        return {
          yaw: cam.yaw, pitch: cam.pitch, dist: cam.dist, spin: spin,
          fly: fly, hoverPin: hoverPin,
          land: landList.length, stars: BG.length,
          flyFront: fly >= 0 ? PINS[fly].s[2] < cam.dist : null,
          pins: PINS.map(function (p) { return [p.s[0], p.s[1]]; })
        };
      },

      hud: function (stage) {
        var p = PINS[fly >= 0 ? fly : (hoverPin >= 0 ? hoverPin : 0)];
        return [
          ['站点', p.cn],
          ['自转', spinning ? '开' : '停']
        ];
      },
      status: function () {
        if (fly >= 0) return '飞向 ' + PINS[fly].cn + ' · 空格恢复自转';
        return spinning ? '拖拽旋转 · 点击图钉飞过去' : '自转已停 · 空格重启';
      }
    };
    return api;
  };

  /* ============================================================
     METER — 05 变动率计量仪
     ------------------------------------------------------------
     命运石之门的世界线变动率计量仪：暗色仪表箱里立着 7 支
     3D 辉光管，管内是发光丝状数字（7 段码 + 叠加辉光，绝不
     用 shadowBlur），管间悬着十进制小数点。数字键 1-5 跳到
     著名世界线（数字滚动过渡），N 随机漂移，空格冻结漂移，
     点某支管让该位进一。玻璃柱面按真实可见性画（近半亮、
     远半淡），辉光管各自带确定性的灯丝闪烁。
     ============================================================ */
  BUILD.meter = function () {
    var cam = new Camera();
    /* 相机是 min(w,h) 归一化的：7 支管子排开的半宽必须落在 0.44·min(w,h)
       之内（也就是面板内壁），否则最外侧两支会被裁到画布外。
       dist 4.8 时 s = 0.186·min(w,h)，半宽 2.29 单位 → 0.426·min ✓ */
    cam.pitch = 0.10; cam.yaw = 0; cam.dist = 4.8;
    var tmp = [0, 0, 0, 0];
    var dragging = false, idle = 99;
    var i, j, k;

    var PRESETS = [
      [0.409431, 'α 收束域 · 观测点'],
      [0.571024, 'α 收束域 · 深渊'],
      [1.130205, 'β 收束域 · 第三次世界大战'],
      [1.048596, '命运石之门 · Steins Gate'],
      [0.000000, 'β 起点 · 原点世界线']
    ];
    var div = 0.409431, targetV = null, drift = true;

    var NT = 7, SP = 0.66, RT = 0.21, HT = 2.5, Y0 = -1.25, YC = 0;
    /* 7 段码（A B C D E F G 顺序） */
    var SEGPTS = [[-1, 1, 1, 1], [1, 1, 1, 0], [1, 0, 1, -1], [1, -1, -1, -1],
      [-1, -1, -1, 0], [-1, 0, -1, 1], [-1, 0, 1, 0]];
    var DIGSEG = [
      [1, 1, 1, 1, 1, 1, 0], [0, 1, 1, 0, 0, 0, 0], [1, 1, 0, 1, 1, 0, 1],
      [1, 1, 1, 1, 0, 0, 1], [0, 1, 1, 0, 0, 1, 1], [1, 0, 1, 1, 0, 1, 1],
      [1, 0, 1, 1, 1, 1, 1], [1, 1, 1, 0, 0, 0, 0], [1, 1, 1, 1, 1, 1, 1],
      [1, 1, 1, 1, 0, 1, 1]
    ];
    var DW = RT * 0.85, DH = HT * 0.295;

    function digitsOf(v) {
      var ip = Math.floor(mod(v, 10));
      var f = Math.round(mod(v, 1) * 1e6);
      if (f >= 1e6) { f -= 1e6; ip = (ip + 1) % 10; }
      var out = [ip];
      for (var d = 5; d >= 0; d--) out.push(Math.floor(f / Math.pow(10, d)) % 10);
      return out;
    }
    function labelOf(v) {
      for (var p = 0; p < PRESETS.length; p++) {
        if (Math.abs(v - PRESETS[p][0]) < 5e-5) return PRESETS[p][1];
      }
      return v < 1 ? 'α 收束域 · 未观测点' : 'β 收束域 · 未观测点';
    }

    /* 玻璃柱：预建顶点与面（侧面 + 顶/底盖），法线每帧自动朝外校正 */
    var TUBES = [];
    (function () {
      var SEG = 10;
      for (var t = 0; t < NT; t++) {
        var cx = (t - (NT - 1) / 2) * SP;
        var VV = [], FF = [];
        for (var s = 0; s < SEG; s++) {
          var a = s / SEG * TAU;
          VV.push([cx + Math.cos(a) * RT, Y0, Math.sin(a) * RT]);
        }
        for (s = 0; s < SEG; s++) VV.push([VV[s][0], Y0 + HT, VV[s][2]]);
        for (s = 0; s < SEG; s++) {
          var s2 = (s + 1) % SEG;
          FF.push({ idx: [s, s2, s2 + SEG, s + SEG] });
        }
        var top = [];
        for (s = 0; s < SEG; s++) top.push(s + SEG);
        FF.push({ idx: top });
        var bot = [];
        for (s = SEG - 1; s >= 0; s--) bot.push(s);
        FF.push({ idx: bot });
        TUBES.push({ cx: cx, VV: VV, FF: FF, pv: [], sc: [0, 0, 0, 0] });
      }
      /* 底座长条盒 */
      var BW = (NT - 1) / 2 * SP + RT + 0.10;
      var BV = [[-BW, Y0, -0.16], [BW, Y0, -0.16], [BW, Y0, 0.16], [-BW, Y0, 0.16],
        [-BW, Y0 - 0.16, -0.16], [BW, Y0 - 0.16, -0.16], [BW, Y0 - 0.16, 0.16], [-BW, Y0 - 0.16, 0.16]];
      var BF = [];
      for (var a2 = 0; a2 < 4; a2++) BF.push({ idx: [a2, (a2 + 1) % 4, (a2 + 1) % 4 + 4, a2 + 4] });
      BF.push({ idx: [3, 2, 1, 0] });
      BF.push({ idx: [4, 5, 6, 7] });
      TUBES.push({ cx: 0, VV: BV, FF: BF, pv: [], sc: [0, 0, 0, 0], isBase: true });
    })();

    var api = {
      title: '05 变动率计量仪',
      sub: 'DIVERGENCE · 辉光管',
      aria: '可交互世界线变动率计量仪：拖拽旋转，数字键 1-5 跳到著名世界线，N 随机漂移，空格冻结，点击单管进位',
      init: function () { },
      resize: function () { },

      HOME: function () {
        cam.yaw = 0; cam.pitch = 0.10; cam.dist = 4.8;
        cam.vyaw = cam.vpitch = 0;
        div = 0.409431; targetV = null; drift = true; idle = 0;
      },
      reset: function () { api.HOME(); },

      /* 内容 = 7 支管 + 底座的精确包围盒角点（x±BW、y −1.41..1.25、
         z±0.21）。老下限 3.6 会让最外侧两支管出画布——现在由角点解算。 */
      fit: function (stage) {
        var BW2 = (NT - 1) / 2 * SP + RT + 0.10;
        var pts = [];
        for (var sx = -1; sx <= 1; sx += 2) for (var sy = -1; sy <= 1; sy += 2)
          for (var sz = -1; sz <= 1; sz += 2)
            pts.push([sx * BW2, sy < 0 ? Y0 - 0.16 : Y0 + HT, sz * (RT + 0.01)]);
        return fitDist(cam, stage, pts, 12 + stage.w * 0.015, 30 + stage.h * 0.02);
      },

      grab: function () { dragging = true; idle = 0; cam.vyaw = cam.vpitch = 0; },
      drag: function (dx, dy) {
        cam.yaw += dx * 0.0075;
        cam.pitch = clamp(cam.pitch + dy * 0.005, -0.5, 0.5);
        idle = 0;
      },
      release: function (vx, vy, stage) {
        dragging = false; idle = 0;
        if (!stage.RM) { cam.vyaw = vx * 0.14; cam.vpitch = vy * 0.08; }
      },
      zoom: function (d, stage) {
        cam.dist = clamp(cam.dist + d * 2.4, api.fit(stage), 8.0);
        idle = 0;
      },
      dbl: function () { targetV = Math.random() * 2; return true; },
      hover: function (x, y, stage) {
        if (x == null) { stage.canvas.style.cursor = ''; return; }
        var over = false;
        for (var m = 0; m < NT; m++) {
          var tb = TUBES[m];
          if (Math.abs(x - tb.sc[0]) < SP * tb.sc[3] * 0.5 &&
              Math.abs(y - tb.sc[1]) < HT * tb.sc[3] * 0.62) over = true;
        }
        stage.canvas.style.cursor = over ? 'pointer' : '';
      },
      tap: function (x, y) {
        if (x == null) return;
        for (var m = 0; m < NT; m++) {
          var tb = TUBES[m];
          if (Math.abs(x - tb.sc[0]) < SP * tb.sc[3] * 0.5 &&
              Math.abs(y - tb.sc[1]) < HT * tb.sc[3] * 0.62) {
            var dg = digitsOf(div);
            dg[m] = (dg[m] + 1) % 10;
            div = dg[0] + (dg[1] * 1e5 + dg[2] * 1e4 + dg[3] * 1e3 + dg[4] * 100 + dg[5] * 10 + dg[6]) / 1e6;
            targetV = null;
            return;
          }
        }
      },
      key: function (k) {
        if (k >= '1' && k <= '5') { targetV = PRESETS[+k - 1][0]; return true; }
        if (k === 'n' || k === 'N') { targetV = Math.random() * 2; return true; }
        if (k === ' ') { drift = !drift; return true; }
        if (k === 'r' || k === 'R') { api.HOME(); return true; }
        if (k === 'ArrowLeft') { cam.yaw -= 0.12; return true; }
        if (k === 'ArrowRight') { cam.yaw += 0.12; return true; }
        if (k === 'ArrowUp') { cam.pitch = clamp(cam.pitch - 0.08, -0.5, 0.5); return true; }
        if (k === 'ArrowDown') { cam.pitch = clamp(cam.pitch + 0.08, -0.5, 0.5); return true; }
        return false;
      },

      update: function (dt, t, stage) {
        idle += dt;
        if (dragging) idle = 0;
        cam.slide(dt);
        var loM = api.fit(stage);
        if (loM > cam.dist * 1.004) cam.dist = loM;
        if (idle > 2.6 && !dragging && !cam.vyaw && stage.opts.spin) cam.yaw += dt * 0.03;
        if (targetV != null) {
          div += (targetV - div) * Math.min(1, dt * 5.2);
          if (Math.abs(targetV - div) < 4e-7) { div = targetV; targetV = null; }
        } else if (drift && !dragging) {
          div = mod(div + dt * 2.4e-5 * (1 + Math.sin(t * 0.21) * 2.2), 2);
        }
      },

      draw: function (ctx, stage) {
        var th = stage.theme, w = stage.w, h = stage.h, q = stage.qual, gl = th.glow * q;
        cam.frame(w, h);
        var t = stage.t;

        /* ---- 仪表箱（暗色，白昼主题里也像一台点亮的仪器） ---- */
        var hx = w * 0.06, hy = h * 0.12, hw = w * 0.88, hh = h * 0.76, hr = 10;
        ctx.beginPath();
        ctx.moveTo(hx + hr, hy);
        ctx.arcTo(hx + hw, hy, hx + hw, hy + hh, hr);
        ctx.arcTo(hx + hw, hy + hh, hx, hy + hh, hr);
        ctx.arcTo(hx, hy + hh, hx, hy, hr);
        ctx.arcTo(hx, hy, hx + hw, hy, hr);
        ctx.closePath();
        var hgr = ctx.createLinearGradient(0, hy, 0, hy + hh);
        hgr.addColorStop(0, '#221a11');
        hgr.addColorStop(0.5, '#181209');
        hgr.addColorStop(1, '#100c06');
        ctx.fillStyle = hgr;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,170,90,0.14)'; ctx.lineWidth = 1; ctx.stroke();
        text(ctx, 'DIVERGENCE METER', hx + hw * 0.5, hy + 20, '#ff9a45', 0.6, 'center', 9, 3, 600);
        text(ctx, '世界线变动率', hx + hw - 12, hy + 20, '#8a6a4a', 0.7, 'right', 8, 2);

        ctx.save();
        ctx.beginPath();
        ctx.moveTo(hx + hr, hy);
        ctx.arcTo(hx + hw, hy, hx + hw, hy + hh, hr);
        ctx.arcTo(hx + hw, hy + hh, hx, hy + hh, hr);
        ctx.arcTo(hx, hy + hh, hx, hy, hr);
        ctx.arcTo(hx, hy, hx + hw, hy, hr);
        ctx.closePath();
        ctx.clip();

        var cyaw = Math.cos(cam.yaw), syaw = Math.sin(cam.yaw);
        var cpi = Math.cos(cam.pitch), spi = Math.sin(cam.pitch);
        function viewN(n) {
          var x = n[0] * cyaw - n[2] * syaw, z = n[0] * syaw + n[2] * cyaw;
          var y = n[1] * cpi - z * spi, z2 = n[1] * spi + z * cpi;
          return [x, y, z2];
        }

        /* ---- 画管：底座先画，玻璃柱从远到近 ---- */
        var order = [];
        for (i = 0; i < TUBES.length; i++) {
          var tb = TUBES[i];
          cam.project([tb.isBase ? 0 : tb.cx, tb.isBase ? Y0 - 0.08 : YC, 0], tmp);
          tb.sc[0] = tmp[0]; tb.sc[1] = tmp[1]; tb.sc[2] = tmp[2]; tb.sc[3] = tmp[3];
          tb.z = tmp[2];
          order.push(i);
        }
        order.sort(function (a2, b2) { return TUBES[b2].z - TUBES[a2].z; });

        for (var oi = 0; oi < order.length; oi++) {
          var tb2 = TUBES[order[oi]];
          var nv = tb2.VV.length;
          if (!tb2.pv.length) { for (j = 0; j < nv; j++) tb2.pv.push([0, 0, 0, 0]); }
          for (j = 0; j < nv; j++) cam.project(tb2.VV[j], tb2.pv[j]);

          if (tb2.isBase) {
            /* 底座：不透明，按面画 */
            var bl = [];
            for (j = 0; j < tb2.FF.length; j++) {
              var bf = tb2.FF[j], zs = 0;
              for (k = 0; k < bf.idx.length; k++) zs += tb2.pv[bf.idx[k]][2];
              bf.z = zs / bf.idx.length; bl.push(bf);
            }
            bl.sort(function (a2, b2) { return b2.z - a2.z; });
            for (j = 0; j < bl.length; j++) {
              var bff = bl[j];
              ctx.beginPath();
              ctx.moveTo(tb2.pv[bff.idx[0]][0], tb2.pv[bff.idx[0]][1]);
              for (k = 1; k < bff.idx.length; k++) ctx.lineTo(tb2.pv[bff.idx[k]][0], tb2.pv[bff.idx[k]][1]);
              ctx.closePath();
              var bn = norm(cross(sub(tb2.VV[bff.idx[1]], tb2.VV[bff.idx[0]]), sub(tb2.VV[bff.idx[2]], tb2.VV[bff.idx[0]])));
              var bvn = viewN(bn);
              if (bvn[2] > 0) continue;                 /* 背面不画 */
              var blm = clamp(dot(bn, LIGHT), 0, 1);
              ctx.fillStyle = mix('#191310', '#3a2d20', 0.25 + 0.75 * blm);
              ctx.fill();
              ctx.strokeStyle = 'rgba(255,170,90,0.10)';
              ctx.stroke();
            }
            continue;
          }

          /* 玻璃柱：远半淡、近半亮 */
          var flick = 0.82 + 0.18 * (0.5 + 0.5 * Math.sin(t * 13.7 + oi * 2.4));
          if (Math.sin(t * 2.9 + oi * 9.1) > 0.992) flick *= 0.5;
          var fl2 = [];
          for (j = 0; j < tb2.FF.length; j++) {
            var f2 = tb2.FF[j], zs2 = 0;
            for (k = 0; k < f2.idx.length; k++) zs2 += tb2.pv[f2.idx[k]][2];
            f2.z = zs2 / f2.idx.length; fl2.push(f2);
          }
          fl2.sort(function (a2, b2) { return b2.z - a2.z; });
          for (j = 0; j < fl2.length; j++) {
            var ff = fl2[j];
            ctx.beginPath();
            ctx.moveTo(tb2.pv[ff.idx[0]][0], tb2.pv[ff.idx[0]][1]);
            for (k = 1; k < ff.idx.length; k++) ctx.lineTo(tb2.pv[ff.idx[k]][0], tb2.pv[ff.idx[k]][1]);
            ctx.closePath();
            var gn = norm(cross(sub(tb2.VV[ff.idx[1]], tb2.VV[ff.idx[0]]), sub(tb2.VV[ff.idx[2]], tb2.VV[ff.idx[0]])));
            var fc = [0, 0, 0];
            for (k = 0; k < ff.idx.length; k++) {
              fc[0] += tb2.VV[ff.idx[k]][0] / ff.idx.length;
              fc[1] += tb2.VV[ff.idx[k]][1] / ff.idx.length;
              fc[2] += tb2.VV[ff.idx[k]][2] / ff.idx.length;
            }
            if (dot(gn, sub(fc, [tb2.cx, Y0 + HT / 2, 0])) < 0) gn = [-gn[0], -gn[1], -gn[2]];
            var gvn = viewN(gn);
            var vis3 = gvn[2] < 0;
            ctx.fillStyle = '#ffb168';
            ctx.globalAlpha = vis3 ? 0.10 : 0.035;
            ctx.fill();
            if (vis3) {
              ctx.strokeStyle = '#ffcf9a'; ctx.globalAlpha = 0.20; ctx.lineWidth = 0.8;
              ctx.stroke();
            }
            ctx.globalAlpha = 1;
          }

          /* 管内数字：发光丝（叠加辉光，无 shadowBlur） */
          var dg2 = digitsOf(div);
          var dg = dg2[order[oi]];
          var segsOn = DIGSEG[dg];
          function digitPath() {
            ctx.beginPath();
            var started = false;
            for (var s3 = 0; s3 < 7; s3++) {
              if (!segsOn[s3]) continue;
              var sp = SEGPTS[s3];
              var p0 = [tb2.cx + sp[0] * DW, YC + sp[1] * DH, 0];
              var p1 = [tb2.cx + sp[2] * DW, YC + sp[3] * DH, 0];
              cam.project(p0, tmp);
              if (!started) { ctx.moveTo(tmp[0], tmp[1]); started = true; } else ctx.lineTo(tmp[0], tmp[1]);
              cam.project(p1, tmp);
              ctx.lineTo(tmp[0], tmp[1]);
            }
          }
          ctx.lineCap = 'round'; ctx.lineJoin = 'round';
          ctx.strokeStyle = '#d4561e';
          ctx.globalAlpha = 0.20 * flick;
          ctx.lineWidth = 7;
          digitPath(); ctx.stroke();
          ctx.strokeStyle = '#ff8c30';
          ctx.globalAlpha = 0.5 * flick;
          ctx.lineWidth = 3.2;
          digitPath(); ctx.stroke();
          ctx.strokeStyle = '#ffcf8e';
          ctx.globalAlpha = 0.95 * flick;
          ctx.lineWidth = 1.3;
          digitPath(); ctx.stroke();
          ctx.globalAlpha = 1;
        }

        /* ---- 管间十进制点 ---- */
        cam.project([(0 - (NT - 1) / 2) * SP + SP * 0.5, YC - HT * 0.22, 0], tmp);
        var dtx = tmp[0], dty = tmp[1], dts = tmp[3];
        var dgr = ctx.createRadialGradient(dtx, dty, 0, dtx, dty, 6 * dts / 60);
        dgr.addColorStop(0, 'rgba(255,160,70,0.8)');
        dgr.addColorStop(1, 'rgba(255,160,70,0)');
        ctx.fillStyle = dgr;
        ctx.beginPath(); ctx.arc(dtx, dty, 6 * dts / 60, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ffd9a0';
        ctx.beginPath(); ctx.arc(dtx, dty, Math.max(1.2, 0.010 * dts), 0, TAU); ctx.fill();

        /* ---- 箱内底部读数 ---- */
        text(ctx, labelOf(div), hx + hw * 0.5, hy + hh - 14, '#ff9a45', 0.85, 'center', 9, 2, 600);

        ctx.restore();

        if (stage.opts.grain) stipple(ctx, 0, 0, w, h, Math.round(160 * q), th.ink, 0.03, 313);
      },

      debug: function () {
        return {
          div: div, target: targetV, drift: drift, label: labelOf(div),
          digits: digitsOf(div), tubes: NT, yaw: cam.yaw, dist: cam.dist,
          tubePts: TUBES.slice(0, NT).map(function (tb) { return [tb.sc[0], tb.sc[1], tb.sc[3]]; })
        };
      },

      hud: function (stage) {
        return [
          ['世界线', labelOf(div)],
          ['读数', div.toFixed(6)]
        ];
      },
      status: function () {
        if (dragging) return '旋转中 · 滚轮缩放';
        if (targetV != null) return '跳线中 · ' + labelOf(targetV);
        return drift ? '漂移观测中 · 空格冻结 · 1-5 跳线' : '已冻结 · 空格恢复 · 点管进位';
      }
    };
    return api;
  };

  /* ============================================================
     LAB — 06 实验室成员
     ------------------------------------------------------------
     命运石之门主角的低多边形人偶，立在展示底座上：牧濑红莉栖
     （长发/红领带/棕夹克/黑丝，160cm）与冈部伦太郎（白大褂/
     刺猬头，179cm，别名凤凰院凶真）。每个部件是独立的凸多面
     体：摆姿势时用凸包取面建拓扑，每帧只做摇曳变换+投影+画家
     排序。1/2 换人，P 换姿势（红莉栖有标志性的抱臂），空格转
     台。侧边标尺对照人物档案身高，底部铭牌写实验室编号。
     ============================================================ */
  BUILD.lab = function () {
    var cam = new Camera();
    /* 初始 yaw≈π：脸在本地 +z（anchor.face z=+0.055），要转到镜头这一侧
       （-z 才是近半球）才看得到正脸和铭牌；转台默认开着慢慢转 */
    cam.pitch = 0.08; cam.yaw = 2.99; cam.dist = 1.95;
    var tmp = [0, 0, 0, 0];
    var dragging = false, idle = 99;
    var i, j, k;

    var LLIGHT = norm([-0.45, 0.72, -0.53]);   /* 人偶主光：左上前方 */

    var CH = [
      { name: '牧濑 红莉栖', en: 'MAKISE KURISU', no: 'LAB MEMBER · No.004', alias: '助手 · 160cm', h: 160 },
      { name: '冈部 伦太郎', en: 'OKABE RINTARO', no: 'LAB MEMBER · No.001', alias: '凤凰院凶真 · 179cm', h: 179 }
    ];
    var POSE_CN = [['夹克 · 站立', '夹克 · 抱臂', '便装 · 站立'], ['大衣 · 站立', '大衣 · 插袋', '便装 · 站立']];
    var ci = 0, pi = 0, spinning = true;
    var parts = [], faceN = 0, list = [];
    var anchor = { head: [0, 0, 0], face: [0, 0, 0], plate: [0, 0, 0], top: [0, 0, 0], bot: [0, 0, 0] };

    var COL = {
      skin: '#eed7ba', hairK: '#7c4632', hairO: '#241f1a',
      shirt: '#ece9e1', tie: '#a63a30', jacket: '#8a6f52',
      dark: '#2b2725', tights: '#332e2b', boots: '#5e4430',
      coat: '#e8e6de', shirtO: '#3c423b', pants: '#a28a5a', shoes: '#302c27',
      base: '#2a2624'
    };

    /* 盒子顶点模板：x∈±w/2，y∈[y0,y1]（0 = 关节枢轴），z∈±d/2 */
    function boxT(w, y0, y1, d) {
      return [[-w / 2, y0, -d / 2], [w / 2, y0, -d / 2], [w / 2, y1, -d / 2], [-w / 2, y1, -d / 2],
        [-w / 2, y0, d / 2], [w / 2, y0, d / 2], [w / 2, y1, d / 2], [-w / 2, y1, d / 2]];
    }
    function xformVec(v, m) {
      var q = [v[0], v[1], v[2]];
      if (m.rx) q = rotX(q, m.rx);
      if (m.rz) q = rotZ(q, m.rz);
      if (m.ry) q = rotY(q, m.ry);
      return [q[0] + m.p[0], q[1] + m.p[1], q[2] + m.p[2]];
    }
    function xf(v, m) {
      var out = [];
      for (var i2 = 0; i2 < v.length; i2++) out.push(xformVec(v[i2], m));
      return out;
    }
    function addPart(tpl, m, color, sway) {
      parts.push({ tpl: tpl, m: m, color: color, sway: sway || 0 });
    }
    /* 手臂链：上臂（肩枢轴）→ 肘 → 前臂 → 手 */
    function addArm(s, shx, shy, shz, pose, cUp, cFo, wU, wF) {
      var upM = { p: [shx, shy, shz], rz: s * pose.az, rx: pose.ax || 0, ry: (pose.ay || 0) * s };
      addPart(boxT(wU, -0.16, 0, wU * 0.9), upM, cUp);
      var el = xformVec([0, -0.16, 0], upM);
      var foM = { p: el, rz: s * pose.fz, rx: pose.fx || 0 };
      addPart(boxT(wF, -0.15, 0, wF * 0.85), foM, cFo);
      var ha = xformVec([0, -0.15, 0], foM);
      addPart(boxT(wF * 0.92, -0.055, 0.01, wF * 0.8), { p: ha, rz: s * pose.fz, rx: (pose.fx || 0) + (pose.hx || 0) }, COL.skin);
    }

    var OFS = -0.55;   /* 人偶整体下移，让腰腹对准画面中心 */

    function buildAll() {
      parts = [];
      var pose = pi;
      if (ci === 0) buildKurisu(pose); else buildOkabe(pose);
      /* 共用底座（圆柱，12 段） */
      (function () {
        var SEG = 12, R2 = 0.30, VV = [];
        for (i = 0; i < SEG; i++) {
          var a = i / SEG * TAU;
          VV.push([Math.cos(a) * R2, -0.055, Math.sin(a) * R2]);
        }
        for (i = 0; i < SEG; i++) VV.push([VV[i][0], 0.001, VV[i][2]]);
        var pt = { tpl: VV, m: { p: [0, 0, 0] }, color: COL.base, sway: 0 };
        parts.push(pt);
      })();
      /* 建拓扑：静止姿态顶点 → 凸包取面 → 统一下移 */
      faceN = 0;
      for (i = 0; i < parts.length; i++) {
        var pt2 = parts[i];
        pt2.wv = xf(pt2.tpl, pt2.m);
        for (j = 0; j < pt2.wv.length; j++) pt2.wv[j][1] += OFS;
        pt2.faces = convexFaces(pt2.wv);
        for (j = 0; j < pt2.faces.length; j++) pt2.faces[j].pt = pt2;
        pt2.wv2 = [];
        for (j = 0; j < pt2.wv.length; j++) pt2.wv2.push([0, 0, 0]);
        pt2.pv = [];
        for (j = 0; j < pt2.wv.length; j++) pt2.pv.push([0, 0, 0, 0]);
        pt2.pivot = [pt2.m.p[0], pt2.m.p[1] + OFS, pt2.m.p[2]];
        faceN += pt2.faces.length;
      }
      /* 锚点：脸 / 铭牌 / 标尺上下端 */
      if (ci === 0) {
        anchor.head = [0, 0.8425 + OFS, 0];
        anchor.face = [0, 0.852 + OFS, 0.055];
        anchor.top = [0, 0.95 + OFS, 0];
      } else {
        anchor.head = [0, 0.90 + OFS, 0];
        anchor.face = [0, 0.912 + OFS, 0.052];
        anchor.top = [0, 1.06 + OFS, 0];
      }
      /* 铭牌压在底座正下方（y 在底座下缘之下），避免深底座吃掉深字 */
      anchor.plate = [0, OFS - 0.17, 0.32];
      anchor.bot = [0, OFS + 0.005, 0];
    }

    function buildKurisu(pose) {
      var coat = pose !== 2, crossed = pose === 1;
      addPart(boxT(0.05, 0, 0.06, 0.10), { p: [0.030, 0, 0.014], ry: -0.10 }, COL.boots);
      addPart(boxT(0.05, 0, 0.06, 0.10), { p: [-0.030, 0, 0.014], ry: 0.10 }, COL.boots);
      addPart(boxT(0.042, 0, 0.44, 0.045), { p: [0.032, 0.03, 0] }, COL.tights);
      addPart(boxT(0.042, 0, 0.44, 0.045), { p: [-0.032, 0.03, 0] }, COL.tights);
      addPart(boxT(0.125, 0, 0.10, 0.075), { p: [0, 0.42, 0] }, COL.dark);
      addPart(boxT(0.13, 0, 0.24, 0.085), { p: [0, 0.50, 0] }, COL.shirt);
      addPart(boxT(0.06, 0, 0.022, 0.05), { p: [0, 0.735, 0.015] }, COL.shirt);
      addPart(boxT(0.024, 0, 0.03, 0.014), { p: [0, 0.715, 0.052] }, COL.tie);
      addPart(boxT(0.038, 0, 0.11, 0.012), { p: [0, 0.60, 0.056], rx: 0.05 }, COL.tie, 0.5);
      if (coat) {
        addPart(boxT(0.135, 0, 0.28, 0.02), { p: [0, 0.47, -0.035] }, COL.jacket);
        addPart(boxT(0.05, 0, 0.28, 0.02), { p: [0.048, 0.47, 0.012], ry: -0.05 }, COL.jacket);
        addPart(boxT(0.05, 0, 0.28, 0.02), { p: [-0.048, 0.47, 0.012], ry: 0.05 }, COL.jacket);
        addPart(boxT(0.095, 0, 0.035, 0.03), { p: [0, 0.75, -0.015], rx: -0.3 }, COL.jacket);
      }
      addPart(boxT(0.03, 0, 0.045, 0.028), { p: [0, 0.74, 0] }, COL.skin);
      addPart(boxT(0.10, 0, 0.115, 0.095), { p: [0, 0.785, 0] }, COL.skin);
      addPart(boxT(0.13, 0, 0.34, 0.05), { p: [0, 0.56, -0.022], rx: 0.05 }, COL.hairK, 1);
      addPart(boxT(0.115, 0, 0.05, 0.105), { p: [0, 0.895, 0.002] }, COL.hairK);
      addPart(boxT(0.10, 0, 0.045, 0.022), { p: [0, 0.852, 0.047], rx: 0.18 }, COL.hairK);
      addPart(boxT(0.026, 0, 0.18, 0.02), { p: [0.055, 0.62, 0.043] }, COL.hairK, 1.3);
      addPart(boxT(0.026, 0, 0.18, 0.02), { p: [-0.055, 0.62, 0.043] }, COL.hairK, 1.6);
      var arm = crossed ? { az: -0.35, ax: -0.3, fz: -1.30, fx: -0.1 } : { az: 0.14, ax: 0, fz: 0.10, fx: 0 };
      addArm(1, 0.072, 0.72, 0, arm, coat ? COL.jacket : COL.shirt, coat ? COL.jacket : COL.shirt, 0.048, 0.042);
      addArm(-1, -0.072, 0.72, 0, arm, coat ? COL.jacket : COL.shirt, coat ? COL.jacket : COL.shirt, 0.048, 0.042);
    }

    function buildOkabe(pose) {
      var coat = pose !== 2, pockets = pose === 1;
      addPart(boxT(0.052, 0, 0.05, 0.11), { p: [0.032, 0, 0.016] }, COL.shoes);
      addPart(boxT(0.052, 0, 0.05, 0.11), { p: [-0.032, 0, 0.016] }, COL.shoes);
      addPart(boxT(0.048, 0, 0.50, 0.05), { p: [0.034, 0.02, 0] }, COL.pants);
      addPart(boxT(0.048, 0, 0.50, 0.05), { p: [-0.034, 0.02, 0] }, COL.pants);
      addPart(boxT(0.135, 0, 0.03, 0.08), { p: [0, 0.50, 0] }, COL.dark);
      addPart(boxT(0.13, 0, 0.26, 0.085), { p: [0, 0.52, 0] }, COL.shirtO);
      if (coat) {
        addPart(boxT(0.16, 0, 0.44, 0.02), { p: [0, 0.38, -0.05] }, COL.coat, 0.7);
        addPart(boxT(0.06, 0, 0.44, 0.02), { p: [0.062, 0.38, 0.028], ry: -0.09 }, COL.coat, 0.7);
        addPart(boxT(0.06, 0, 0.44, 0.02), { p: [-0.062, 0.38, 0.028], ry: 0.09 }, COL.coat, 0.9);
        addPart(boxT(0.105, 0, 0.04, 0.032), { p: [0, 0.79, -0.028], rx: -0.35 }, COL.coat);
        addPart(boxT(0.02, 0, 0.035, 0.008), { p: [-0.035, 0.68, 0.078], ry: 0.25 }, COL.tie);
      }
      addPart(boxT(0.03, 0, 0.045, 0.028), { p: [0, 0.78, 0] }, COL.skin);
      addPart(boxT(0.095, 0, 0.11, 0.09), { p: [0, 0.845, 0] }, COL.skin);
      addPart(boxT(0.105, 0, 0.045, 0.10), { p: [0, 0.945, -0.004] }, COL.hairO);
      /* 刺猬头：5 枚小刺 */
      addPart(boxT(0.03, 0, 0.05, 0.03), { p: [-0.032, 0.985, -0.028], rz: 0.42, rx: -0.15 }, COL.hairO);
      addPart(boxT(0.03, 0, 0.055, 0.03), { p: [-0.014, 0.99, -0.005], rz: 0.16, rx: 0.05 }, COL.hairO);
      addPart(boxT(0.032, 0, 0.06, 0.032), { p: [0.004, 0.99, 0.012], rz: -0.05, rx: 0.2 }, COL.hairO);
      addPart(boxT(0.03, 0, 0.055, 0.03), { p: [0.022, 0.988, -0.01], rz: -0.3, rx: 0.02 }, COL.hairO);
      addPart(boxT(0.028, 0, 0.045, 0.028), { p: [0.036, 0.982, -0.03], rz: -0.5, rx: -0.1 }, COL.hairO);
      var arm = pockets ? { az: 0.10, ax: 0.18, fz: 0.55, fx: 0.55, hx: 0.3 } : { az: 0.18, ax: 0, fz: 0.12, fx: 0 };
      addArm(1, 0.075, 0.76, 0, arm, coat ? COL.coat : COL.shirtO, coat ? COL.coat : COL.shirtO, 0.052, 0.046);
      addArm(-1, -0.075, 0.76, 0, arm, coat ? COL.coat : COL.shirtO, coat ? COL.coat : COL.shirtO, 0.052, 0.046);
    }
    buildAll();

    var api = {
      title: '06 实验室成员',
      sub: 'LAB · 立体人物档案',
      aria: '可交互低多边形人偶：牧濑红莉栖与冈部伦太郎，拖拽旋转，数字键 1/2 换人，P 换姿势，空格转台',
      init: function () { },
      resize: function () { },

      HOME: function () {
        cam.yaw = 2.99; cam.pitch = 0.08; cam.dist = 1.95;
        cam.vyaw = cam.vpitch = 0; idle = 0;
      },
      reset: function () { api.HOME(); },

      /* 内容包围盒：x±0.30（底座半径）、y −0.75（铭牌下缘）..0.55
         （刺头上缘）、z±0.35（铭牌与底座前后）。 */
      fit: function (stage) {
        var pts = [];
        for (var sx = -1; sx <= 1; sx += 2) for (var sy = -1; sy <= 1; sy += 2)
          for (var sz = -1; sz <= 1; sz += 2)
            pts.push([sx * 0.30, sy < 0 ? -0.75 : 0.55, sz * 0.35]);
        return fitDist(cam, stage, pts, 12 + stage.w * 0.015, 26 + stage.h * 0.02);
      },

      grab: function () { dragging = true; idle = 0; cam.vyaw = cam.vpitch = 0; },
      drag: function (dx, dy) {
        cam.yaw += dx * 0.008;
        cam.pitch = clamp(cam.pitch + dy * 0.006, -0.9, 0.9);
        idle = 0;
      },
      release: function (vx, vy, stage) {
        dragging = false; idle = 0;
        if (!stage.RM) { cam.vyaw = vx * 0.15; cam.vpitch = vy * 0.1; }
      },
      zoom: function (d, stage) {
        cam.dist = clamp(cam.dist + d * 2.2, api.fit(stage), 4.5);
        idle = 0;
      },
      dbl: function () { pi = (pi + 1) % POSE_CN[ci].length; buildAll(); return true; },
      key: function (k) {
        if (k === '1') { ci = 0; pi = 0; buildAll(); return true; }
        if (k === '2') { ci = 1; pi = 0; buildAll(); return true; }
        if (k === 'p' || k === 'P') { pi = (pi + 1) % POSE_CN[ci].length; buildAll(); return true; }
        if (k === ' ') { spinning = !spinning; return true; }
        if (k === 'r' || k === 'R') { api.HOME(); return true; }
        if (k === 'ArrowLeft') { cam.yaw -= 0.12; return true; }
        if (k === 'ArrowRight') { cam.yaw += 0.12; return true; }
        if (k === 'ArrowUp') { cam.pitch = clamp(cam.pitch - 0.08, -0.9, 0.9); return true; }
        if (k === 'ArrowDown') { cam.pitch = clamp(cam.pitch + 0.08, -0.9, 0.9); return true; }
        return false;
      },

      update: function (dt, t, stage) {
        idle += dt;
        if (dragging) idle = 0;
        cam.slide(dt);
        var loL = api.fit(stage);
        if (loL > cam.dist * 1.004) cam.dist = loL;
        if (idle > 2.6 && !dragging && !cam.vyaw && spinning && stage.opts.spin) cam.yaw += dt * 0.05;
      },

      draw: function (ctx, stage) {
        var th = stage.theme, w = stage.w, h = stage.h, q = stage.qual, gl = th.glow * q;
        cam.frame(w, h);
        var t = stage.t;
        var bob = 0.004 * Math.sin(t * 1.8);

        /* ---- 每帧：摇曳变换 + 投影 + 画家排序 ---- */
        list.length = 0;
        for (i = 0; i < parts.length; i++) {
          var pt = parts[i];
          var sw = pt.sway ? Math.sin(t * 1.15 + (pt.sway > 1 ? 1.4 : pt.sway > 0.8 ? 0 : 0.7)) * 0.03 * Math.min(1.2, pt.sway) : 0;
          var csw = Math.cos(sw), ssw = Math.sin(sw);
          for (j = 0; j < pt.wv.length; j++) {
            var v = pt.wv[j];
            var dy2 = v[1] - pt.pivot[1], dz2 = v[2] - pt.pivot[2];
            var wy = pt.pivot[1] + dy2 * csw - dz2 * ssw;
            var wz = pt.pivot[2] + dy2 * ssw + dz2 * csw;
            pt.wv2[j][0] = v[0]; pt.wv2[j][1] = wy + bob; pt.wv2[j][2] = wz;
            cam.project(pt.wv2[j], pt.pv[j]);
          }
          for (j = 0; j < pt.faces.length; j++) {
            var f = pt.faces[j], zs = 0;
            var A2 = pt.wv2[f.idx[0]], B2 = pt.wv2[f.idx[1]], C2 = pt.wv2[f.idx[2]];
            var nn = cross(sub(B2, A2), sub(C2, A2));
            f.n = norm(nn);
            for (k = 0; k < f.idx.length; k++) zs += pt.pv[f.idx[k]][2];
            f.z = zs / f.idx.length;
            list.push(f);
          }
        }
        list.sort(function (a2, b2) { return b2.z - a2.z; });

        /* ---- 台面光晕（人偶脚下的聚光） ---- */
        cam.project([0, OFS + 0.02, 0], tmp);
        var spot = ctx.createRadialGradient(tmp[0], tmp[1], 0, tmp[0], tmp[1], 0.5 * tmp[3]);
        spot.addColorStop(0, ca(th.lit, 0.30));
        spot.addColorStop(1, ca(th.lit, 0));
        ctx.fillStyle = spot;
        ctx.beginPath(); ctx.arc(tmp[0], tmp[1], 0.5 * tmp[3], 0, TAU); ctx.fill();

        /* ---- 画所有面：真可见性（面向镜头才填色），单色 + 光照 ---- */
        var cyaw = Math.cos(cam.yaw), syaw = Math.sin(cam.yaw);
        var cpi = Math.cos(cam.pitch), spi = Math.sin(cam.pitch);
        for (i = 0; i < list.length; i++) {
          var fc = list[i], pt3 = fc.pt;
          var vx = fc.n[0] * cyaw - fc.n[2] * syaw, vz = fc.n[0] * syaw + fc.n[2] * cyaw;
          var vy2 = fc.n[1] * cpi - vz * spi, vz2 = fc.n[1] * spi + vz * cpi;
          if (vz2 > 0) continue;                       /* 背面剔除 */
          ctx.beginPath();
          ctx.moveTo(pt3.pv[fc.idx[0]][0], pt3.pv[fc.idx[0]][1]);
          for (k = 1; k < fc.idx.length; k++) ctx.lineTo(pt3.pv[fc.idx[k]][0], pt3.pv[fc.idx[k]][1]);
          ctx.closePath();
          var lam = clamp(dot(fc.n, LLIGHT), 0, 1);
          ctx.fillStyle = mix(fc.pt.color, '#141110', (1 - lam) * 0.5);
          ctx.globalAlpha = 0.96;
          ctx.fill();
          ctx.strokeStyle = th.ink;
          ctx.globalAlpha = 0.22;
          ctx.lineWidth = 0.8;
          ctx.stroke();
          ctx.globalAlpha = 1;
        }

        /* ---- 脸（面向镜头才画） ---- */
        cam.project(anchor.face, tmp);
        var fz = tmp[2], fx = tmp[0], fy = tmp[1], fs = tmp[3];
        cam.project(anchor.head, tmp);
        if (fz < tmp[2]) {
          var eo = 0.020 * fs;
          ctx.strokeStyle = '#33291f'; ctx.lineCap = 'round';
          ctx.lineWidth = Math.max(1.2, 0.006 * fs);
          ctx.beginPath();
          ctx.moveTo(fx - eo - 0.004 * fs, fy - 0.008 * fs);
          ctx.lineTo(fx - eo - 0.004 * fs, fy + 0.004 * fs);
          ctx.moveTo(fx + eo + 0.004 * fs, fy - 0.008 * fs);
          ctx.lineTo(fx + eo + 0.004 * fs, fy + 0.004 * fs);
          ctx.stroke();
          ctx.lineWidth = Math.max(1, 0.004 * fs);
          ctx.beginPath();
          ctx.moveTo(fx - 0.006 * fs, fy + 0.030 * fs);
          ctx.lineTo(fx + 0.006 * fs, fy + 0.030 * fs);
          ctx.stroke();
        }

        /* ---- 身高标尺（对照人物档案） ---- */
        cam.project(anchor.top, tmp);
        var ry0 = tmp[1], rs = tmp[3];
        cam.project(anchor.bot, tmp);
        var ry1 = tmp[1];
        var rx = w * 0.12;
        ctx.strokeStyle = th.dim; ctx.globalAlpha = 0.4; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(rx, ry0); ctx.lineTo(rx, ry1); ctx.stroke();
        var cmH = CH[ci].h;
        for (var cm = 0; cm <= cmH; cm += 20) {
          var yy = ry1 - (cm / cmH) * (ry1 - ry0);
          ctx.globalAlpha = cm % 40 === 0 ? 0.55 : 0.3;
          ctx.beginPath(); ctx.moveTo(rx, yy); ctx.lineTo(rx + (cm % 40 === 0 ? 8 : 4), yy); ctx.stroke();
          if (cm % 40 === 0 && cm > 0) {
            text(ctx, cm + '', rx + 11, yy + 3, th.dim, 0.55, 'left', 7, 1);
          }
        }
        ctx.globalAlpha = 1;

        /* ---- 铭牌（面向镜头才画） ---- */
        cam.project(anchor.plate, tmp);
        var plz = tmp[2], plx = tmp[0], ply = tmp[1];
        cam.project([0, OFS + 0.02, 0], tmp);
        if (plz < tmp[2]) {
          brackets(ctx, plx - 54, ply - 26, 108, 42, 5, th.ink, 0.45, 1);
          text(ctx, CH[ci].name, plx, ply - 10, th.accent, 0.95, 'center', 10, 2, 600);
          text(ctx, CH[ci].en, plx, ply + 3, th.dim, 0.7, 'center', 7, 1.6);
          text(ctx, CH[ci].no, plx, ply + 14, th.dim, 0.6, 'center', 7, 1.6);
        }
        ctx.globalAlpha = 1;

        if (stage.opts.grain) stipple(ctx, 0, 0, w, h, Math.round(170 * q), th.ink, 0.03, 616);
      },

      debug: function () {
        return { char: ci, pose: pi, faces: faceN, spinning: spinning, name: CH[ci].name, yaw: cam.yaw, dist: cam.dist };
      },

      hud: function (stage) {
        return [
          ['成员', CH[ci].name],
          ['姿态', POSE_CN[ci][pi]]
        ];
      },
      status: function () {
        if (dragging) return '旋转中 · 滚轮缩放';
        return CH[ci].name + ' · ' + CH[ci].alias + ' · 1/2 换人 · P 换姿势';
      }
    };
    return api;
  };

  /* ============================================================
     mount
     ============================================================ */
  function mount(root) {
    var nodes = (root || document).querySelectorAll('[data-kstage]');
    var made = [];
    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.__kstage) continue;
      /* graceful fallback image (no JS / no canvas) */
      var fb = el.getAttribute('data-fallback');
      if (fb && !el.querySelector('.kstage-fb')) {
        var img = document.createElement('img');
        img.className = 'kstage-fb';
        img.src = fb;
        img.alt = '';
        el.appendChild(img);
      }
      try {
        el.__kstage = new Stage(el);
        made.push(el.__kstage);
      } catch (err) {
        el.classList.remove('is-live');   /* leave the fallback image visible */
        if (window.console) console.warn('kstage: ' + el.getAttribute('data-kstage') + ' failed', err);
      }
    }
    return made;
  }

  var API = {
    mount: mount, Stage: Stage, BUILD: BUILD, opts: OPTS,
    all: function () { return ALL.slice(); },
    /* 控制台改一个开关 → 所有装置立刻重画（时间倍速为 0 时也能立刻看到效果） */
    set: function (k, v) {
      OPTS[k] = v;
      for (var i = 0; i < ALL.length; i++) { ALL[i].dirty = true; ALL[i].kick(); }
    }
  };
  if (typeof window !== 'undefined') {
    window.KStage = API;
    var boot = function () { mount(document); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
    else boot();
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})();
