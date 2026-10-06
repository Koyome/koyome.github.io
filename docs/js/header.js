/* ============================================================
   header.js — the shared site header.
   Left: brand + language switch.  Right: a "⋯" menu holding all
   page links (opened on click).  Every page only needs
   <header class="site-header" id="siteHeader"></header> plus a
   data-page attribute on <body>.
   ============================================================ */
(function () {
  'use strict';

  const PAGES = [
    { key: 'home', href: 'index.html', label: 'nav_home' },
    { key: 'catalog', href: 'catalog.html', label: 'nav_catalog' },
    { key: 'hobbies', href: 'hobbies.html', label: 'nav_hobbies' },
    { key: 'guestbook', href: 'guestbook.html', label: 'nav_guestbook' },
    { key: 'journal', href: 'journal.html', label: 'nav_journal' },
  ];
  /* admin entry is owner-only — injected later by maybeRevealAdmin()
     once the API check proves this is the management machine */
  const ADMIN_PAGE = { key: 'admin', href: 'admin.html', label: 'nav_admin' };

  const host = document.getElementById('siteHeader');
  if (!host) return;
  const current = document.body.dataset.page || 'home';

  host.innerHTML = `
    <div class="header-left">
      <a class="brand" href="index.html">Koyome<span class="dot">.</span></a>
      <div class="lang-switch" role="group" data-i18n-aria="menu_label">
        <button type="button" data-lang="en">EN</button>
        <span class="sep">·</span>
        <button type="button" data-lang="zh">繁中</button>
        <span class="sep">·</span>
        <button type="button" data-lang="zhcn">简体</button>
      </div>
    </div>
    <div class="header-right">
      <button class="theme-btn" id="themeBtn" type="button" data-i18n-aria="theme_aria">
        <svg class="icon-sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
          <circle cx="12" cy="12" r="4.4"/>
          <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9L19 19M19 5l-2.1 2.1M7.1 16.9L5 19"/>
        </svg>
        <svg class="icon-moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
          <path d="M20 13.2A8.2 8.2 0 1 1 10.8 4 6.6 6.6 0 0 0 20 13.2Z"/>
        </svg>
      </button>
      <div class="menu" id="menu">
        <button class="menu-btn" id="menuBtn" type="button"
                aria-haspopup="true" aria-expanded="false" aria-controls="menuPanel"
                data-i18n-aria="menu_label">
          <i></i><i></i><i></i>
        </button>
        <nav class="menu-panel" id="menuPanel" data-i18n-aria="menu_label">
          ${PAGES.map((p, i) => `
            <a href="${p.href}" class="${p.key === current ? 'active' : ''}" data-page="${p.key}">
              <span class="no">${String(i + 1).padStart(2, '0')}</span>
              <span data-i18n="${p.label}">${p.key}</span>
            </a>`).join('')}
        </nav>
      </div>
    </div>`;

  /* architect's-plate corner marks on the viewport — the quiet frame
     that holds every page together */
  if (!document.querySelector('.page-frame')) {
    const frame = document.createElement('div');
    frame.className = 'page-frame';
    frame.setAttribute('aria-hidden', 'true');
    frame.innerHTML = '<i></i><i></i><i></i><i></i>';
    document.body.appendChild(frame);
  }

  /* ---------- night / day toggle ---------- */
  const LS_THEME = 'koyome_theme';
  const themeBtn = document.getElementById('themeBtn');

  /* Theme-aware cutout swap. iOS WebKit does NOT reliably repaint an
     element that combines an ongoing transform animation (compositor
     layer) + mix-blend-mode + a filter that changes when [data-theme]
     flips — the old filter stays baked into the stale layer (portrait
     turned blue + blurry after dark->light). So themed images never use
     a runtime invert(); dark mode swaps src to a pre-baked *_dark.webp
     instead. Any <img data-dark-src="..."> participates automatically. */
  function swapCutouts() {
    const dark = document.documentElement.dataset.theme === 'dark';
    document.querySelectorAll('img[data-dark-src]').forEach((img) => {
      /* explicit data-light-src wins — a dynamically inserted img may
         already carry the dark variant as its src (see entry.js t2).
         Never cache a src that already IS the dark variant as "light"
         (index.html's first-paint inline guard hits exactly this case). */
      if (!img.dataset.lightSrc) {
        const cur = img.getAttribute('src');
        if (cur && cur !== img.dataset.darkSrc) img.dataset.lightSrc = cur;
      }
      img.src = dark ? img.dataset.darkSrc : (img.dataset.lightSrc || img.getAttribute('src'));
    });
  }
  window.KoyomeSwapCutouts = swapCutouts;

  function setTheme(mode) {
    const dark = mode === 'dark';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    try { localStorage.setItem(LS_THEME, dark ? 'dark' : 'light'); } catch (_) { /* ignore */ }
    swapCutouts();
  }
  themeBtn.addEventListener('click', () => {
    setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });

  /* initial pass (covers every static <img data-dark-src> on the page)
     + preload the dark variants so the first toggle never flashes */
  swapCutouts();
  document.querySelectorAll('img[data-dark-src]').forEach((img) => {
    const pre = new Image();
    pre.src = img.dataset.darkSrc;
  });

  const menu = document.getElementById('menu');
  const btn = document.getElementById('menuBtn');

  function setOpen(open) {
    menu.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    setOpen(!menu.classList.contains('open'));
  });

  document.addEventListener('click', (e) => {
    if (!menu.contains(e.target)) setOpen(false);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });

  /* localize the markup we just injected (and mark the switch active) */
  if (window.I18N) {
    window.I18N.applyStatic();
    window.I18N.bind();
  }

  /* ---------- owner-only admin entry ----------
     data.js loads after this script, so poll briefly for Koyome,
     then ask the API: only the management machine gets the link. */
  (async function maybeRevealAdmin() {
    const panel = document.getElementById('menuPanel');
    if (!panel) return;
    let K = window.Koyome;
    for (let i = 0; i < 50 && !K; i++) {
      await new Promise((r) => setTimeout(r, 100));
      K = window.Koyome;
    }
    if (!K || !K.apiAvailable) return;
    let owner = false;
    try { owner = await K.apiAvailable(); } catch (_) { owner = false; }
    if (!owner) return;
    const a = document.createElement('a');
    a.href = ADMIN_PAGE.href;
    a.dataset.page = ADMIN_PAGE.key;
    if (ADMIN_PAGE.key === current) a.className = 'active';
    a.innerHTML = `<span class="no">${String(PAGES.length + 1).padStart(2, '0')}</span><span data-i18n="${ADMIN_PAGE.label}">${ADMIN_PAGE.key}</span>`;
    panel.appendChild(a);
    if (window.I18N) window.I18N.applyStatic();
  })();
})();
