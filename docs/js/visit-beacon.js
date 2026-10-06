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
   both would count the same person twice.

   Nothing here is shown to anybody; every failure is swallowed.
   ============================================================ */
(function () {
  'use strict';
  var CFG = (window.GB_CLOUD || {});
  if (!CFG.url || !CFG.anonKey) return;          /* no cloud configured */

  var LS = 'koyome_visit_beacon';
  var WINDOW = 30 * 60 * 1000;                    /* one registration per half hour */

  function throttled() {
    try {
      var t = parseInt(localStorage.getItem(LS) || '0', 10);
      return Date.now() - t < WINDOW;
    } catch (_) { return false; }
  }
  function mark() {
    try { localStorage.setItem(LS, String(Date.now())); } catch (_) { /* private mode */ }
  }

  /* ---------- the visitor's own public address ----------
     No single free service is reliable: they rate-limit, move, and
     sometimes simply 429. So ask three in turn and take the first
     answer. freeipapi and ipwho both hand back coordinates too —
     those ride along so the roll still shows a position even if the
     owner's machine cannot reach a lookup service at that moment. */
  var SOURCES = [
    { url: 'https://freeipapi.com/api/json', pick: function (j) {
        return { ip: j.ipAddress || j.ip, lat: j.latitude, lon: j.longitude };
      } },
    { url: 'https://ipwho.is/', pick: function (j) {
        return { ip: j.ip, lat: j.latitude, lon: j.longitude };
      } },
    { url: 'https://jsonip.com/', pick: function (j) { return { ip: j.ip }; } },
  ];

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

  function publicIp() {
    var out = null;
    return SOURCES.reduce(function (chain, s) {
      return chain.then(function () {
        if (out && out.ip) return;
        return timed(s.url, 4500).then(function (j) {
          if (!j) return;
          var got;
          try { got = s.pick(j); } catch (_) { got = null; }
          if (got && /^\d+\.\d+\.\d+\.\d+$/.test(String(got.ip || ''))) out = got;
        });
      });
    }, Promise.resolve()).then(function () { return out || null; });
  }

  function register(info) {
    var body = {
      ip: info.ip,
      page: (location.pathname || '/') + (location.search || ''),
      ua: (navigator.userAgent || '').slice(0, 200),
    };
    if (Number.isFinite(info.lat) && Number.isFinite(info.lon)) {
      body.lat = info.lat;
      body.lon = info.lon;
    }
    return fetch(CFG.url + '/rest/v1/visits', {
      method: 'POST',
      headers: {
        apikey: CFG.anonKey,
        Authorization: 'Bearer ' + CFG.anonKey,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(body),
    }).then(function () { mark(); }).catch(function () { /* offline / blocked */ });
  }

  function isBot() {
    return /bot|crawler|spider|slurp|curl|wget|python-requests|headless/i
      .test(navigator.userAgent || '');
  }

  (async function run() {
    if (isBot()) return;
    if (throttled()) return;
    /* on the owner's machine the API answers — the server logs it, we don't */
    try {
      if (window.Koyome && typeof window.Koyome.apiAvailable === 'function') {
        if (await window.Koyome.apiAvailable()) return;
      }
    } catch (_) { /* no data layer — assume the public site */ }
    var info = await publicIp();
    if (!info) return;
    await register(info);
  })();
})();
