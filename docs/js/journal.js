/* ============================================================
   journal.js — The ledger: every round told as a day on the road,
   plus the visitor roll (owner's machine only — it needs the API).
   ============================================================ */
(function () {
  'use strict';
  const { escapeHtml: esc, loc, apiAvailable } = window.Koyome;
  const { t } = window.I18N;

  const RM = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const hasIO = 'IntersectionObserver' in window;

  /* ---------- entrance: reveal on scroll ---------- */
  function observeReveals(scope) {
    const els = [...scope.querySelectorAll('[data-reveal]')];
    if (RM || !hasIO) {
      els.forEach((el) => el.classList.add('in-view', 'settled'));
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => {
        if (!en.isIntersecting) return;
        const el = en.target;
        el.classList.add('in-view');
        io.unobserve(el);
        const d = parseFloat(getComputedStyle(el).getPropertyValue('--d')) || 0;
        setTimeout(() => el.classList.add('settled'), d * 1000 + 1700);
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -5% 0px' });
    els.forEach((el) => io.observe(el));
  }

  /* ---------- the ledger ---------- */
  function roundRow(r, i) {
    const title = loc(r, 'title') || ('Chapter ' + r.n);
    const text = loc(r, 'text') || '';
    const place = loc(r, 'place') || '';
    return `
      <article class="jr-row" data-reveal style="--d:${Math.min(i * 0.06, 0.6).toFixed(2)}s">
        <div class="jr-side">
          <span class="jr-no">${String(r.n).padStart(2, '0')}</span>
          <span class="jr-date">${esc(r.date || '')}</span>
        </div>
        <div class="jr-body">
          <h3 class="jr-title">${esc(title)}</h3>
          ${place ? `<div class="jr-place">${esc(place)}</div>` : ''}
          <p class="jr-text">${esc(text)}</p>
        </div>
      </article>`;
  }

  async function loadJournal() {
    const host = document.getElementById('jrList');
    if (!host) return;
    let data = null;
    try {
      const r = await fetch('data/journal.json', { cache: 'no-store' });
      if (r.ok) data = await r.json();
    } catch (_) { /* offline / file:// — fall through to the notice */ }

    const rounds = (data && Array.isArray(data.rounds)) ? data.rounds : [];
    if (!rounds.length) {
      host.innerHTML = `<p class="jr-empty">${esc(t('journal_empty'))}</p>`;
      return;
    }

    const introEl = document.getElementById('jrIntro');
    if (introEl) {
      const intro = loc(data, 'intro');
      if (intro) introEl.textContent = intro;
    }
    const countEl = document.getElementById('jrCount');
    if (countEl) countEl.textContent = String(rounds.length).padStart(2, '0');

    host.innerHTML = rounds.map(roundRow).join('');
    observeReveals(host);
  }

  /* ---------- the visitor roll (owner only) ----------
     The API only answers on the machine running server.js, so on the
     public static site this whole block never renders — a guest's
     address is never written into a page anybody else can read. */
  function visitRow(v) {
    const where = v.place || (v.lan ? t('visit_lan') : t('visit_unknown'));
    return `
      <tr class="vs-row${v.src === 'cloud' ? ' is-cloud' : ''}">
        <td class="vs-time">${esc(v.time || '')}</td>
        <td class="vs-ip">${esc(v.ip || '')}</td>
        <td class="vs-place">${esc(where)}</td>
        <td class="vs-isp">${esc(v.isp || '')}</td>
        <td class="vs-page">${esc(v.page || '')}</td>
        <td class="vs-geo">${esc(v.latlon || '')}</td>
        <td class="vs-count">${v.count > 1 ? '×' + v.count : ''}</td>
      </tr>`;
  }

  const CLOUD_NOTE = {
    ok: 'visit_cloud_ok',
    'no-table': 'visit_cloud_notable',
    denied: 'visit_cloud_denied',
    'no-config': 'visit_cloud_noconfig',
    error: 'visit_cloud_off',
  };

  async function loadVisits() {
    const sec = document.getElementById('vsSection');
    if (!sec) return;
    if (!(await apiAvailable())) { sec.remove(); return; }
    sec.hidden = false;

    const body = document.getElementById('vsBody');
    const total = document.getElementById('vsTotal');

    async function refresh() {
      let list = [];
      try {
        const r = await fetch('api/visits', { cache: 'no-store' });
        if (r.ok) list = await r.json();
      } catch (_) { list = []; }
      if (!Array.isArray(list)) list = [];
      if (total) total.textContent = String(list.length).padStart(2, '0');
      if (!body) return;
      body.innerHTML = list.length
        ? list.map(visitRow).join('')
        : `<tr><td colspan="7" class="vs-empty">${esc(t('visit_empty'))}</td></tr>`;

      /* is the online half of the roll actually working? */
      const note = document.getElementById('vsNote');
      if (note) {
        try {
          const r = await fetch('api/visits/status', { cache: 'no-store' });
          const st = r.ok ? await r.json() : null;
          const key = CLOUD_NOTE[(st && st.cloud) || 'error'];
          note.textContent = st && st.cloud === 'ok' && !st.rows
            ? t('visit_cloud_ok') : t(key || 'visit_cloud_off');
        } catch (_) { if (note) note.textContent = ''; }
      }
    }

    const clearBtn = document.getElementById('vsClear');
    if (clearBtn) {
      clearBtn.addEventListener('click', async () => {
        if (!window.confirm(t('visit_clear_ask'))) return;
        await fetch('api/visits', { method: 'DELETE' });
        await refresh();
      });
    }
    await refresh();
  }

  /* ---------- go ---------- */
  (async function init() {
    await loadJournal();
    await loadVisits();
  })();
})();
