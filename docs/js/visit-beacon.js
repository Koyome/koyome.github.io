/* ============================================================
   visit-beacon.js — register a visit when the site is NOT being
   served by the owner's own machine.

   Why this exists: the public site is static (GitHub Pages). A phone
   opening koyome.github.io never touches the owner's computer, so
   server.js cannot possibly see it. The only way for that visit to
   reach the owner is to drop a line into the shared cloud table,
   which the local server then reads back and enriches.

   So this beacon fires ONLY when the local API answers "no". On the
   owner's machine the server already logs the visit itself — running
   both would count the same person twice. (And on the owner's machine
   the address is a local one, which the server skips anyway.)

   EVERY page load registers. There used to be a half-hour throttle in
   localStorage; it was a de-duplication rule, and a de-duplication
   rule on a visit log is a bug — it threw away every page a visitor
   opened after the first one and quietly under-reported the site by
   however many pages they read. Nothing here is throttled, cached or
   sampled now.

   Nothing here is shown to anybody; every failure is swallowed.
   ============================================================ */
  (function () {
  'use strict';
  /* The version of THIS file, stamped into every card it writes. It is
     the only way to answer "is the phone running the code I just
     pushed?" — a browser that cached an old copy of this script keeps
     writing cards from it for as long as the cache holds, and the card
     is the only evidence that reaches the owner. Bump it whenever this
     file changes; the owner's page prints it beside the card. */
  var BEACON_V = '20261009b';
  var CFG = (window.GB_CLOUD || {});
  if (!CFG.url || !CFG.anonKey) return;          /* no cloud configured */

  /* ---------- the visitor's own public address ----------
     No single free service is reliable, and "unreliable" here means
     "the visit is lost", so this asks four and takes the first usable
     answer. The list is ordered by what has actually held up:

       api64.ipify.org   small, fast, sends CORS headers, years stable.
                         (the IPv4-only api.ipify.org does NOT send
                         them, so it cannot be used from a page)
       freeipapi.com     answers with coordinates as well
       ipwho.is          good data, rate-limits under load
       jsonip.com        last resort, blocked on some networks

     Coordinates ride along when a source offers them, so the roll
     still shows a position even if the owner's machine cannot reach a
     lookup service at that moment. */
  var SOURCES = [
    { url: 'https://api64.ipify.org?format=json', pick: function (j) {
        return { ip: j.ip };
      } },
    { url: 'https://freeipapi.com/api/json', pick: function (j) {
        return { ip: j.ipAddress || j.ip, lat: j.latitude, lon: j.longitude };
      } },
    { url: 'https://ipwho.is/', pick: function (j) {
        return { ip: j.ip, lat: j.latitude, lon: j.longitude };
      } },
    { url: 'https://jsonip.com/', pick: function (j) { return { ip: j.ip }; } },
  ];

  /* Field names differ between services and change without notice, and
     a service that is rate-limited answers 200 with a body that has no
     address in it at all — so the address is looked for everywhere it
     has ever lived, and a body without one is treated as a failure. */
  var IP_FIELDS = ['ip', 'ipAddress', 'query', 'address', 'IPv4', 'ipv4', 'YourFuckingIPAddress'];
  function pickIp(j) {
    if (!j || typeof j !== 'object') return '';
    for (var i = 0; i < IP_FIELDS.length; i++) {
      var v = j[IP_FIELDS[i]];
      if (typeof v === 'string' && v) return v;
    }
    return '';
  }
  var IS_IP = /^(\d{1,3}\.){3}\d{1,3}$|^[0-9a-f:]{6,}$/i;

  function timed(url, ms) {
    var ctl = ('AbortController' in window) ? new AbortController() : null;
    var opts = ctl ? { signal: ctl.signal } : {};
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, ms);
    return fetch(url, opts).then(function (r) {
      return r.ok ? r.json() : null;
    }).catch(function () { return null; }).then(function (j) {
      clearTimeout(timer);
      return j;
    });
  }

  /* The address is remembered for the length of one browsing session —
     two minutes — but the registration never is. Caching *who* the
     visitor is does not drop a single visit; it only stops us asking
     three services the same question on every page they open. */
  var IP_KEY = 'koyome_visit_ip';
  var IP_TTL = 2 * 60 * 1000;

  function heldIp() {
    try {
      var raw = sessionStorage.getItem(IP_KEY);
      if (!raw) return null;
      var j = JSON.parse(raw);
      if (!j || !j.ip || Date.now() - (j.at || 0) > IP_TTL) return null;
      return j;
    } catch (_) { return null; }
  }
  function keepIp(info) {
    try { sessionStorage.setItem(IP_KEY, JSON.stringify({ at: Date.now(), ip: info.ip, lat: info.lat, lon: info.lon })); }
    catch (_) { /* private mode */ }
  }

  function publicIp() {
    var held = heldIp();
    if (held) return Promise.resolve(held);
    var out = null;
    return SOURCES.reduce(function (chain, s) {
      return chain.then(function () {
        if (out) return;
        return timed(s.url, 4500).then(function (j) {
          if (!j) return;
          var got;
          try { got = s.pick(j); } catch (_) { got = null; }
          var ip = got && got.ip ? String(got.ip).trim() : pickIp(j);
          if (!ip || !IS_IP.test(ip)) return;        /* rate-limited or wrong shape */
          out = { ip: ip, lat: got && got.lat, lon: got && got.lon };
        });
      });
    }, Promise.resolve()).then(function () {
      if (out) keepIp(out);
      return out || null;
    });
  }

  /* ---------- the guest card ----------
     A UA string is what the device *claims* to be. Everything below is
     what it *is*: the panel it measured, the cores it runs, the clock
     on its wall, the colours it prefers. Two of these facts beat the
     UA outright —
       · Chromium, asked politely, answers with the real Android model
         and the real Windows version. Windows 11 and Windows 10 both
         say "NT 10.0", so this is the only way to tell them apart.
       · screen × devicePixelRatio is an exact physical resolution, and
         Apple's resolutions are distinctive — which is the only way to
         name the iPhone, since Apple stopped putting the model in the
         UA years ago.
     Nothing here is required: a browser that answers none of it still
     registers, and simply has no card. */

  /** Chromium's high-entropy hints, or nothing (Safari/Firefox have no
      such API, and a slow phone must not sit waiting for one) */
  function hints() {
    var d = navigator.userAgentData;
    if (!d || typeof d.getHighEntropyValues !== 'function') return Promise.resolve(null);
    var asked = d.getHighEntropyValues(
      ['architecture', 'bitness', 'model', 'platformVersion', 'uaFullVersion']
    ).then(function (v) {
      var out = {
        arch: v.architecture, bit: v.bitness, model: v.model,
        platv: v.platformVersion, uafull: v.uaFullVersion,
      };
      /* Chromium answers these fields even when it will not fill them
         (a UA override, a privacy setting), and five empty strings are
         worse than no object at all — they would be stored as a card
         that says nothing */
      var any = false;
      for (var k in out) {
        if (Object.prototype.hasOwnProperty.call(out, k) && out[k]) any = true;
      }
      return any ? out : null;
    }).catch(function () { return null; });
    return Promise.race([
      asked,
      new Promise(function (r) { setTimeout(function () { r(null); }, 1500); }),
    ]);
  }

  /** who is this, and how many times have they been here */
  function ids() {
    var out = {};
    try {
      var vid = localStorage.getItem('koyome_vid');
      if (!vid) {
        vid = 'v' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        localStorage.setItem('koyome_vid', vid);
        localStorage.setItem('koyome_first', String(Date.now()));
      }
      out.visits = Number(localStorage.getItem('koyome_n') || 0) + 1;
      localStorage.setItem('koyome_n', String(out.visits));
      out.first = localStorage.getItem('koyome_first') || '';
      var sid = sessionStorage.getItem('koyome_sid');
      if (!sid) {
        sid = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
        sessionStorage.setItem('koyome_sid', sid);
      }
      out.sid = sid;
    } catch (_) { /* private mode: no counts, but nothing is lost */ }
    return out;
  }

  /* ---------- the fun half ----------
     Everything below is measured or feature-detected on the device
     itself, and none of it is personal: no name, no account, no precise
     position, no contacts — only what the screen and the engine can do.
     Two of them are worth calling out:

       · the refresh rate is MEASURED (frames counted over ~600ms), not
         read off a claim, so ProMotion really does answer 120;
       · the core count the browser offers is not trusted on its own —
         Safari answers 4 for a six-core A17 Pro, so the server corrects
         it from the chip the identified model ships.

     Anything a browser cannot answer is simply absent. */

  /** frames per second, counted — the only way to know a panel's rate.
      Not frames ÷ time: one long frame while the page is still loading
      drags that average down and would report a 120Hz phone as 60. The
      interval at the 20th percentile is used instead, which is the
      panel's own speed with the browser's own hiccups ignored. */
  function refreshRate() {
    return new Promise(function (resolve) {
      if (!window.requestAnimationFrame) return resolve(0);
      var t0 = 0, last = 0, gaps = [], done = false;
      function finish() {
        if (done) return;
        done = true;
        /* fewer than eight frames is not a measurement */
        if (gaps.length < 8) return resolve(0);
        gaps.sort(function (a, b) { return a - b; });
        var v = gaps[Math.floor(gaps.length * 0.2)] || gaps[0];
        resolve(v > 0 ? Math.round(1000 / v) : 0);
      }
      function frame(t) {
        if (done) return;
        if (!t0) { t0 = t; last = t; requestAnimationFrame(frame); return; }
        if (t > last) gaps.push(t - last);
        last = t;
        if (t - t0 >= 700) return finish();
        requestAnimationFrame(frame);
      }
      requestAnimationFrame(frame);
      /* a hidden tab never fires a frame, and a page that never draws
         has no refresh rate to report — both end here with nothing */
      setTimeout(finish, 1600);
    }).catch(function () { return 0; });
  }

  /** what the engine can actually do, asked of the objects themselves */
  function feats() {
    var out = [];
    try { if (navigator.gpu) out.push('WebGPU'); } catch (_) { /* no WebGPU */ }
    try {
      var c = document.createElement('canvas');
      if (c.getContext) {
        if (c.getContext('webgl2')) out.push('WebGL2');
        else if (c.getContext('webgl')) out.push('WebGL');
      }
    } catch (_) { /* canvas refused (rare, blocked) */ }
    try {
      if (typeof WebAssembly === 'object') {
        out.push('WASM');
        /* The module below is the smallest one that cannot be built
           without the v128 type: one function taking nothing and
           returning v128, whose body is a single v128.const. An engine
           with SIMD validates it; one without it fails. Verified in
           node — and the previous version of these bytes was wrong
           (the code section said 21 bytes where it has 22), so it
           answered false everywhere and never reported SIMD at all. */
        var simd = [0, 97, 115, 109, 1, 0, 0, 0,
          1, 5, 1, 96, 0, 1, 123,          /* type: () -> v128 */
          3, 2, 1, 0,                       /* one function, that type */
          10, 22, 1, 20, 0, 253, 12,        /* code: body 20, v128.const */
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          11];
        if (WebAssembly.validate(new Uint8Array(simd))) out.push('WASM SIMD');
      }
    } catch (_) { /* no WebAssembly */ }
    try { if (typeof OffscreenCanvas === 'function') out.push('OffscreenCanvas'); } catch (_) {}
    return out;
  }

  /** how long this page took to show something — about our site, on
      their machine, and therefore the one performance number worth
      having */
  function firstPaint() {
    try {
      var e = performance.getEntriesByName
        ? performance.getEntriesByName('first-contentful-paint') : [];
      if (e.length && e[0].startTime) return Math.round(e[0].startTime);
    } catch (_) { /* Paint Timing unavailable */ }
    return 0;
  }

  function measured() {
    var c = {
      sw: screen.width, sh: screen.height, dpr: window.devicePixelRatio || 1,
      vw: window.innerWidth, vh: window.innerHeight,
      cores: navigator.hardwareConcurrency || 0, mem: navigator.deviceMemory || 0,
      depth: screen.colorDepth || 0,
    };
    try {
      c.gamut = matchMedia('(color-gamut: rec2020)').matches ? 'rec2020'
        : matchMedia('(color-gamut: p3)').matches ? 'p3' : 'srgb';
    } catch (_) { /* no media queries for gamut */ }
    try {
      c.hdr = matchMedia('(dynamic-range: high)').matches
        || matchMedia('(video-dynamic-range: high)').matches;
    } catch (_) { /* no HDR query */ }
    c.feat = feats();
    try { c.tz = (Intl.DateTimeFormat().resolvedOptions().timeZone) || ''; } catch (_) { c.tz = ''; }
    try { c.theme = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (_) {}
    try { c.motion = matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduce' : 'no'; } catch (_) {}
    try {
      c.touch = ('ontouchstart' in window || navigator.maxTouchPoints > 0) ? 'touch' : 'pointer';
    } catch (_) {}
    var n = navigator.connection || navigator.webkitConnection;
    if (n) {
      try {
        c.net = n.effectiveType || '';
        if (typeof n.rtt === 'number') c.rtt = n.rtt;
        if (typeof n.downlink === 'number') c.down = n.downlink;
      } catch (_) { /* a connection object that answers nothing */ }
    }
    return c;
  }

  async function card() {
    var c = measured();
    c.bv = BEACON_V;
    var id = ids();
    for (var k in id) if (Object.prototype.hasOwnProperty.call(id, k)) c[k] = id[k];
    var last = lastPage();
    if (last) { c.lastPage = last.lastPage; c.lastDwell = last.lastDwell; c.lastScroll = last.lastScroll; }
    var h = await hints();
    if (h) c.ch = h;
    return c;
  }

  /* Does the shared table have somewhere to put the card? Asking the
     table about the column is the only honest way to know: PostgREST
     answers 400 when a named column does not exist and 200 (with no
     rows, because only the owner may read them) when it does. Knowing
     beforehand is what keeps the card out of the fallback chain — a
     registration must never be lost to a column that isn't there yet. */
  var CAPS_KEY = 'koyome_caps_ok';
  function capsSupported() {
    try { if (sessionStorage.getItem(CAPS_KEY) === '1') return Promise.resolve(true); } catch (_) {}
    return fetch(CFG.url + '/rest/v1/visits?select=caps&limit=1', {
      headers: { apikey: CFG.anonKey, Authorization: 'Bearer ' + CFG.anonKey },
    }).then(function (r) {
      if (r.ok) { try { sessionStorage.setItem(CAPS_KEY, '1'); } catch (_) {} return true; }
      return false;
    }).catch(function () { return false; });
  }

  /* The shared table's columns (tools/supabase-visits.sql):
     id, ip, page, ua, lat, lon, ts, and — once the owner runs
     supabase-visits-caps.sql — one `caps` jsonb column carrying the
     card. Device, OS and browser are still NOT sent as columns: the
     owner's machine reads them back out of `ua` with the same parser
     it uses for its own rows, so there is one parser and one answer. */
  function post(body) {
    return fetch(CFG.url + '/rest/v1/visits', {
      method: 'POST',
      headers: {
        apikey: CFG.anonKey,
        Authorization: 'Bearer ' + CFG.anonKey,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return true;
    });
  }

  /* ---------- three ways to write one row ----------
     An address lookup is a third party. Third parties go down, and
     when one did, the old code returned early and the visit was lost
     — which is the one outcome this file exists to prevent. So a
     registration is attempted in decreasing order of richness, and
     only gives up when every shape has been refused:

       1. address + page + agent   the normal case
       2. page + agent             no `ip` field at all, which lets the
                                   table fill the address in itself
                                   from the request (see the default in
                                   tools/supabase-visits.sql — it is
                                   more trustworthy than ours anyway)
       3. address left empty       one row with a blank address still
                                   says when, which page, and on what
                                   machine. A blank field is a worse
                                   record than a full one and a far
                                   better one than none. */
  async function register(info, caps) {
    var base = {
      page: (location.pathname || '/') + (location.search || ''),
      ua: (navigator.userAgent || '').slice(0, 400),
    };
    if (caps) base.caps = caps;
    if (Number.isFinite(info.lat) && Number.isFinite(info.lon)) {
      base.lat = info.lat;
      base.lon = info.lon;
    }
    var tries = [];
    if (info.ip) tries.push(Object.assign({ ip: info.ip }, base));
    tries.push(Object.assign({}, base));
    tries.push(Object.assign({ ip: '' }, base));

    for (var i = 0; i < tries.length; i++) {
      try { if (await post(tries[i])) return true; } catch (_) { /* next shape */ }
    }
    return false;
  }

  /* On the owner's own machine there is nowhere to POST a card but the
     server itself, and the server already logged the visit — so the
     card is handed straight to it and the cloud half is skipped. */
  function handToServer(caps) {
    try {
      return fetch('/api/visit/caps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(caps),
        keepalive: true,
      });
    } catch (_) { return Promise.resolve(null); }
  }

  /* how long they stayed, and how far down they read — sent when the
     page goes away, which is the only moment it can be known */
  var START = Date.now();
  var LAST_KEY = 'koyome_last_page';
  function sendDwell() {
    var ms = Date.now() - START;
    var sc = 0;
    try {
      var h = document.documentElement;
      var span = Math.max(1, (h.scrollHeight || 0) - window.innerHeight);
      sc = Math.min(100, Math.round(((window.scrollY || window.pageYOffset || 0) / span) * 100));
    } catch (_) { /* no scroll to measure */ }
    /* Remembered for the next page: a row is written when a page OPENS,
       so the time spent on a page can only be carried by the page that
       comes after it. That is why the card says "上一页停留" — it is
       exactly what was measured, and nothing more. */
    try {
      sessionStorage.setItem(LAST_KEY, JSON.stringify({
        p: (location.pathname || '/') + (location.search || ''), ms: ms, sc: sc,
      }));
    } catch (_) { /* private mode */ }
    var body = JSON.stringify({ dwell: ms, scroll: sc });
    try {
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/visit/caps', new Blob([body], { type: 'application/json' }));
      } else { handToServer({ dwell: ms, scroll: sc }); }
    } catch (_) { /* leaving anyway — nothing to do about it */ }
  }

  /** what the page that came before this one reported about itself */
  function lastPage() {
    try {
      var raw = sessionStorage.getItem(LAST_KEY);
      if (!raw) return null;
      var j = JSON.parse(raw);
      if (!j || !j.ms) return null;
      return { lastPage: j.p || '', lastDwell: j.ms, lastScroll: j.sc || 0 };
    } catch (_) { return null; }
  }

  (async function run() {
    /* the frame counter runs alongside everything else rather than
       before it — a visit must never be delayed by a measurement */
    var hzP = refreshRate();
    var caps = await card();
    /* the moment the page goes away is the only moment the time spent
       on it is known, so it is captured whichever way the visit is
       being recorded */
    window.addEventListener('pagehide', sendDwell);
    /* on the owner's machine the API answers — the server logs it, we don't */
    try {
      if (window.Koyome && typeof window.Koyome.apiAvailable === 'function') {
        if (await window.Koyome.apiAvailable()) {
          await handToServer(caps);
          return;
        }
      }
    } catch (_) { /* no data layer — assume the public site */ }
    var info = await publicIp();
    /* both of these are only knowable now, well after the card was
       measured: the frame rate has finished counting, and the page has
       had time to paint */
    caps.hz = await hzP;
    caps.fcp = firstPaint();
    try {
      if (navigator.storage && navigator.storage.estimate) {
        var q = await navigator.storage.estimate();
        if (q && q.quota) caps.quota = Math.round(q.quota / 1073741824);
      }
    } catch (_) { /* no Storage API — the quota is just left out */ }
    /* no address found is not a reason to skip the visit — register()
       knows what to write without one */
    var caps2 = (await capsSupported()) ? caps : null;
    await register(info || {}, caps2);
  })();
})();
