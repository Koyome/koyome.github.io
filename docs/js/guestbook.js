/* ============================================================
   guestbook.js — Guests leave notes; every note is visible to
   everyone (owner and visitors alike).

   Storage chain when sending:
     1. Supabase cloud (gb-config.js filled in) — THE shared
        guestbook, same messages for every visitor on any device.
     2. Local Node API (owner running server.js).
     3. This browser's localStorage (last-resort, private fallback).
   ============================================================ */
(function () {
  'use strict';
  const {
    loadGuestbook, saveGuestbookOverride, escapeHtml, apiAvailable,
    gbCloud, postGuestbookCloud,
  } = window.Koyome;
  const { t } = window.I18N;
  const esc = escapeHtml;
  const $ = (id) => document.getElementById(id);

  const LS_SENT = 'koyome_gb_last_sent'; /* gentle rate limit */
  const RATE_MS = 20 * 1000;

  let messages = [];
  let canEdit = false; /* owner mode — deleting notes is an admin operation */

  function render() {
    $('gbCount').textContent = String(messages.length).padStart(2, '0') + ' ' + t('items');
    const list = $('gbList');
    list.innerHTML = messages.length
      ? messages.map((m) => `
          <div class="gb-item${m.name === '五更琉璃' ? ' gb-liuli' : ''}" data-id="${esc(m.id)}">
            <div class="gb-meta">
              <span class="gb-name">${esc(m.name)}</span>
              <span class="gb-date">${esc(m.date || '')}</span>
            </div>
            <div class="gb-text">${esc(m.text)}</div>
            ${canEdit ? `<button class="gb-del" data-id="${esc(m.id)}" title="${esc(t('del'))}">${esc(t('del'))}</button>` : ''}
          </div>`).join('')
      : `<div class="empty">${esc(t('gb_empty'))}</div>`;

    list.querySelectorAll('.gb-del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm(t('confirm_gb_del'))) return;
        if (await apiAvailable()) {
          await fetch('api/guestbook?id=' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' });
        } else {
          messages = messages.filter((m) => m.id !== btn.dataset.id);
          saveGuestbookOverride(messages);
        }
        refresh();
      });
    });
  }

  async function refresh() {
    messages = await loadGuestbook();
    /* in cloud mode there is no public delete — the owner removes
       messages from the Supabase dashboard instead */
    try { canEdit = !gbCloud() && await apiAvailable(); } catch (_) { canEdit = false; }
    render();
  }

  $('gbForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('gbMsg');
    const name = $('gbName').value.trim();
    const text = $('gbText').value.trim();

    /* honeypot — bots fill every field; humans never see this one.
       Fail silently so the bot thinks it succeeded. */
    const hp = $('gbSite');
    if (hp && hp.value) { msg.textContent = t('msg_gb_sent'); $('gbForm').reset(); return; }

    if (!name) { msg.textContent = t('msg_name'); return; }
    if (!text) { msg.textContent = t('msg_text'); return; }

    /* one note per 20s per browser — keeps casual spam down */
    const last = Number(localStorage.getItem(LS_SENT) || 0);
    if (Date.now() - last < RATE_MS) { msg.textContent = t('gb_slow'); return; }

    msg.textContent = t('gb_sending');
    const entry = {
      id: 'g' + Date.now().toString(36),
      name, text,
      date: new Date().toISOString().slice(0, 16).replace('T', ' '),
    };

    try {
      if (gbCloud()) {
        await postGuestbookCloud(name, text);
      } else if (await apiAvailable()) {
        const r = await fetch('api/guestbook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, text }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || 'failed');
      } else {
        messages.unshift(entry);
        saveGuestbookOverride(messages);
      }
      try { localStorage.setItem(LS_SENT, String(Date.now())); } catch (_) { /* ignore */ }
      msg.textContent = t('msg_gb_sent');
      $('gbForm').reset();
      refresh();
    } catch {
      msg.textContent = t('msg_gb_fail');
    }
  });

  refresh();
})();
