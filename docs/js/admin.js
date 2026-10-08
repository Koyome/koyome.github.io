/* ============================================================
   admin.js — Content manager.
   1) Homepage profile: portrait + name + welcome line + intro
      (each text field has an optional 繁體中文 twin).
   2) Library: add text / images / videos (multiple files at once),
      EDIT existing entries (title, category, body, description…),
      and delete. Server mode writes the json files; static mode
      (GitHub Pages / offline) uses localStorage.
   ============================================================ */
(function () {
  'use strict';
  const {
    loadContent, saveOverride, loadProfile, saveProfileOverride,
    escapeHtml, typeLabel, apiAvailable, loc,
  } = window.Koyome;
  const { t } = window.I18N;
  const esc = escapeHtml;
  const $ = (id) => document.getElementById(id);

  let library = [];
  let editingId = null; /* when set, the form edits this entry instead of adding */

  /* ================= access gate =================
     This page is owner-only. Visitors (static hosting / no local
     API) are redirected home and never see the forms — the two
     .admin-wrap sections stay `hidden` until the check passes. */
  (async function gate() {
    let owner = false;
    try { owner = await apiAvailable(); } catch (_) { owner = false; }
    if (!owner) {
      location.replace('index.html');
      return;
    }
    document.querySelectorAll('.admin-wrap').forEach((s) => { s.hidden = false; });
  })();

  /* ================= 1. Homepage profile ================= */
  let avatarData = null; /* a freshly picked file, as a dataURL */

  loadProfile().then((p) => {
    $('pName').value = p.name || '';
    $('pNameZh').value = p.nameZh || '';
    $('pTagline').value = p.tagline || '';
    $('pTaglineZh').value = p.taglineZh || '';
    $('pIntro').value = p.intro || '';
    $('pIntroZh').value = p.introZh || '';
    if (p.avatar) $('avatarPreview').src = p.avatar;
  });

  $('pAvatar').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    try {
      avatarData = await readAsDataURL(file);
      $('avatarPreview').src = avatarData;
    } catch {
      $('profMsg').textContent = t('msg_read_fail');
    }
  });

  $('profileForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('profMsg');
    msg.textContent = t('msg_saving');

    const payload = {
      name: $('pName').value.trim(),
      nameZh: $('pNameZh').value.trim(),
      tagline: $('pTagline').value.trim(),
      taglineZh: $('pTaglineZh').value.trim(),
      intro: $('pIntro').value,
      introZh: $('pIntroZh').value,
    };

    try {
      if (await apiAvailable()) {
        if (avatarData) payload.avatarFile = avatarData;
        const r = await fetch('api/profile', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || t('msg_prof_fail'));
        if (data.profile && data.profile.avatar) $('avatarPreview').src = data.profile.avatar;
      } else {
        const current = await loadProfile();
        if (avatarData) {
          if (avatarData.length > 3 * 1024 * 1024) { msg.textContent = t('msg_static_big'); return; }
          payload.avatar = avatarData;
        } else {
          payload.avatar = current.avatar;
        }
        saveProfileOverride({ ...current, ...payload });
      }
      avatarData = null;
      $('pAvatar').value = '';
      msg.textContent = t('msg_prof_saved');
    } catch (err) {
      msg.textContent = '✕ ' + err.message;
    }
  });

  /* ================= Visitor Gate =================
     Lets the owner set the password + welcome lines in front of the
     visitor log. The password is stored server-side only (see
     /api/gate) — nothing here is written into a browser-readable
     static file. A blank password turns the gate off. */
  (function gateAdmin() {
    const form = document.getElementById('gateForm');
    if (!form) return;
    const pw = document.getElementById('gPassword');
    const wel = document.getElementById('gWelcome');
    const msg = document.getElementById('gateMsg');
    /* the face on the door — picked here, uploaded with the form */
    const avaInput = document.getElementById('gAvatar');
    const avaPreview = document.getElementById('gAvatarPreview');
    let gateAvatarData = null; /* a freshly picked image, as a dataURL */

    if (avaInput) {
      avaInput.addEventListener('change', async (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;
        try {
          gateAvatarData = await readAsDataURL(file);
          if (avaPreview) avaPreview.src = gateAvatarData;
        } catch {
          msg.textContent = t('msg_read_fail');
        }
      });
    }

    if (apiAvailable()) {
      fetch('api/gate', { cache: 'no-store' })
        .then((r) => (r.ok ? r.json() : null))
        .then((g) => {
          if (g && g.welcome && g.welcome.length) wel.value = g.welcome.join('\n');
          if (g && g.avatar && avaPreview) avaPreview.src = g.avatar;
        })
        .catch(() => {});
    }

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      msg.textContent = t('msg_saving') || 'saving…';
      const payload = {
        password: pw.value,
        welcome: wel.value.split('\n').map((s) => s.trim()).filter(Boolean),
      };
      try {
        if (await apiAvailable()) {
          const r = await fetch('api/gate', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const j = await r.json();
          msg.textContent = (j && j.locked)
            ? '✓ ' + t('admin_gate_status_on')
            : '✓ ' + t('admin_gate_status_off');
        } else {
          msg.textContent = t('admin_gate_noserver');
        }
      } catch (err) {
        msg.textContent = '✕ ' + err.message;
      }
    });

    /* the portrait is uploaded on its own: this request carries ONLY the
       image, so it can never blank the password by accident (an empty
       password box in the form above means "gate off"), and the server
       keeps the picture in the gate's own field, never profile.json. */
    const avaForm = document.getElementById('gateAvatarForm');
    const avaMsg = document.getElementById('gateAvatarMsg');
    if (avaForm) {
      avaForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (!gateAvatarData) {
          avaMsg.textContent = t('admin_gate_avatar_pick');
          return;
        }
        avaMsg.textContent = t('msg_saving') || 'saving…';
        try {
          if (await apiAvailable()) {
            const r = await fetch('api/gate', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ avatarFile: gateAvatarData }),
            });
            const j = await r.json();
            if (!r.ok) throw new Error(j.error || 'upload failed');
            if (j && j.avatar && avaPreview) avaPreview.src = j.avatar;
            avaMsg.textContent = '✓ ' + t('admin_gate_avatar_done');
          } else {
            avaMsg.textContent = t('admin_gate_noserver');
          }
          gateAvatarData = null;
          if (avaInput) avaInput.value = '';
        } catch (err) {
          avaMsg.textContent = '✕ ' + err.message;
        }
      });
    }
  })();

  /* ================= 2. Library ================= */
  $('adminNote').innerHTML = t('admin_note');

  const fType = $('fType');
  function syncTypeUI() {
    const isText = fType.value === 'text';
    /* body text is available for every type — required for text
       entries, an optional accompanying note for media entries */
    $('fBodyWrap').style.display = '';
    $('fBodyZh').style.display = '';
    const lbl = $('fBodyLabel');
    lbl.removeAttribute('data-i18n');
    lbl.textContent = isText ? t('f_body') : t('f_body_media');
    $('fFileWrap').style.display = isText ? 'none' : '';
    $('fSrcWrap').style.display = isText ? 'none' : '';
  }
  fType.addEventListener('change', syncTypeUI);
  syncTypeUI();

  $('fDate').value = new Date().toISOString().slice(0, 10);

  $('entryForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = $('formMsg');
    msg.textContent = t('msg_saving');

    const entry = {
      type: fType.value,
      title: $('fTitle').value.trim() || t('untitled'),
      category: $('fCategory').value.trim() || t('uncategorized'),
      date: $('fDate').value,
      featured: $('fFeatured').checked,
      desc: $('fDesc').value.trim(),
      titleZh: $('fTitleZh').value.trim(),
      categoryZh: $('fCategoryZh').value.trim(),
      descZh: $('fDescZh').value.trim(),
    };

    const editing = editingId ? library.find((it) => it.id === editingId) : null;

    /* body text is collected for every type; only text entries require it */
    entry.body = $('fBody').value;
    entry.bodyZh = $('fBodyZh').value;

    if (entry.type === 'text') {
      if (!entry.body.trim() && !entry.bodyZh.trim()) {
        msg.textContent = t('msg_body_empty');
        return;
      }
    } else {
      const files = $('fFile').files;
      const srcInput = $('fSrc').value.trim();
      /* when editing, existing media is kept — new files are appended */
      if (!editing && (!files || !files.length) && !srcInput) { msg.textContent = t('msg_no_media'); return; }
      if (files && files.length) {
        entry.files = [];
        try {
          for (const f of files) {
            entry.files.push({ file: await readAsDataURL(f), filename: f.name });
          }
        } catch {
          msg.textContent = t('msg_read_fail');
          return;
        }
      }
      if (srcInput) entry.src = srcInput;
    }

    try {
      const api = await apiAvailable();
      if (editing) {
        /* ---------- update an existing entry ---------- */
        if (api) {
          const r = await fetch('api/content?id=' + encodeURIComponent(editingId), {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry),
          });
          const data = await r.json();
          if (!r.ok) throw new Error(data.error || t('msg_submit_fail'));
          /* files / url picked during edit → append as media */
          if ((entry.files && entry.files.length) || entry.src) {
            const mr = await fetch('api/media', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ id: editingId, files: entry.files, src: entry.src }),
            });
            if (!mr.ok) throw new Error(t('msg_media_fail'));
          }
        } else {
          const i = library.findIndex((it) => it.id === editingId);
          if (i >= 0) {
            const prev = library[i];
            const media = (prev.media || []).slice();
            (entry.files || []).forEach((f) => {
              if (f.file.length <= 3 * 1024 * 1024) {
                media.push({ type: f.file.startsWith('data:video/') ? 'video' : 'image', src: f.file });
              }
            });
            if (entry.src) media.push({ type: prev.type === 'video' ? 'video' : 'image', src: entry.src });
            delete entry.files;
            library[i] = {
              ...prev, ...entry, type: prev.type,
              media, src: media.length ? media[0].src : prev.src,
            };
            saveOverride(library);
          }
        }
        msg.textContent = t('msg_updated');
        exitEditMode();
      } else {
        /* ---------- add a new entry ---------- */
        if (api) {
          const r = await fetch('api/content', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(entry),
          });
          const data = await r.json();
          if (!r.ok) throw new Error(data.error || t('msg_submit_fail'));
        } else {
          /* static mode: localStorage can't hold large files */
          const big = (entry.files || []).some((f) => f.file.length > 3 * 1024 * 1024);
          if (big) { msg.textContent = t('msg_static_big'); return; }
          const media = (entry.files || []).map((f) => ({
            type: f.file.startsWith('data:video/') ? 'video' : 'image',
            src: f.file,
          }));
          if (entry.src) media.push({ type: entry.type, src: entry.src });
          delete entry.files;
          library.unshift({
            ...entry,
            media,
            src: media.length ? media[0].src : '',
            id: 'l' + Date.now().toString(36),
          });
          saveOverride(library);
        }
        msg.textContent = t('msg_saved');
      }
      $('entryForm').reset();
      $('fDate').value = new Date().toISOString().slice(0, 10);
      syncTypeUI();
      refresh();
    } catch (err) {
      msg.textContent = '✕ ' + err.message;
    }
  });

  /* ---------- edit mode ---------- */
  function enterEditMode(item) {
    editingId = item.id;
    fType.value = item.type;
    fType.disabled = true; /* type stays; media itself is managed on the entry page */
    $('fTitle').value = item.title || '';
    $('fCategory').value = item.category || '';
    $('fDate').value = item.date || '';
    $('fFeatured').checked = !!item.featured;
    $('fDesc').value = item.desc || '';
    $('fTitleZh').value = item.titleZh || '';
    $('fCategoryZh').value = item.categoryZh || '';
    $('fDescZh').value = item.descZh || '';
    $('fBody').value = item.body || '';
    $('fBodyZh').value = item.bodyZh || '';
    $('fSrc').value = '';
    $('fFile').value = '';
    syncTypeUI();

    const banner = $('editBanner');
    banner.textContent = '✎ ' + t('msg_editing') + ' — ' + (item.title || item.id);
    banner.style.display = '';
    const submit = $('btnSubmit');
    submit.removeAttribute('data-i18n');
    submit.textContent = t('btn_save_changes');
    $('btnCancelEdit').style.display = '';
    if (banner.scrollIntoView) banner.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function exitEditMode() {
    editingId = null;
    fType.disabled = false;
    $('editBanner').style.display = 'none';
    const submit = $('btnSubmit');
    submit.setAttribute('data-i18n', 'btn_add');
    submit.textContent = t('btn_add');
    $('btnCancelEdit').style.display = 'none';
    $('entryForm').reset();
    $('fDate').value = new Date().toISOString().slice(0, 10);
    syncTypeUI();
  }

  $('btnCancelEdit').addEventListener('click', exitEditMode);

  function readAsDataURL(file) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = reject;
      fr.readAsDataURL(file);
    });
  }

  /* ---------- library list ---------- */
  async function refresh() {
    library = await loadContent();
    $('libCount').textContent = String(library.length).padStart(2, '0') + ' ' + t('items');

    const cats = new Set();
    library.forEach((it) => { if (it.category) cats.add(it.category); if (it.categoryZh) cats.add(it.categoryZh); });
    $('catList').innerHTML = [...cats].map((c) => `<option value="${esc(c)}">`).join('');

    const wrap = $('libList');
    wrap.innerHTML = library.length
      ? library.map((it, i) => `
          <div class="admin-item">
            <span class="idx">${String(i + 1).padStart(2, '0')}</span>
            <span class="tag ${it.featured ? 'accent' : ''}">${esc(typeLabel(it.type))}</span>
            <span class="t">
              <a href="entry.html?id=${encodeURIComponent(it.id)}">${esc(loc(it, 'title') || t('untitled'))}</a>
              ${it.titleZh ? '<span class="zh-flag" title="繁體中文">繁</span>' : ''}
            </span>
            <span class="d">${(it.media || []).length ? (it.media.length + ' ' + t('media_label')) + ' · ' : ''}${esc(it.date || '')}</span>
            <button class="edit" data-id="${esc(it.id)}">${esc(t('btn_edit'))}</button>
            <button class="del" data-id="${esc(it.id)}">${esc(t('del'))}</button>
          </div>`).join('')
      : `<div class="empty">${esc(t('empty_admin'))}</div>`;

    wrap.querySelectorAll('.edit').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = library.find((it) => it.id === btn.dataset.id);
        if (item) enterEditMode(item);
      });
    });

    wrap.querySelectorAll('.del').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm(t('confirm_del'))) return;
        if (editingId === btn.dataset.id) exitEditMode();
        if (await apiAvailable()) {
          await fetch('api/content?id=' + encodeURIComponent(btn.dataset.id), { method: 'DELETE' });
        } else {
          library = library.filter((it) => it.id !== btn.dataset.id);
          saveOverride(library);
        }
        refresh();
      });
    });
  }

  refresh();
})();
