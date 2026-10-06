/* ============================================================
   Koyome.me — a quiet corner of the web
   Pure Node.js: static hosting + content / media / guestbook /
   profile APIs (zero dependencies)
   Run: node server.js  →  http://localhost:8080
   ============================================================ */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'docs'); /* 'docs' so GitHub Pages can serve the same tree */
const DATA_DIR = path.join(PUBLIC_DIR, 'data');
const DATA_FILE = path.join(DATA_DIR, 'content.json');
const GUESTBOOK_FILE = path.join(DATA_DIR, 'guestbook.json');
const PROFILE_FILE = path.join(DATA_DIR, 'profile.json');
const HOBBIES_FILE = path.join(DATA_DIR, 'hobbies.json');
const VISITS_FILE = path.join(DATA_DIR, 'visits.json');
const ASSETS_DIR = path.join(PUBLIC_DIR, 'assets');
const PORT = process.env.PORT || 80;
const BODY_LIMIT = 200 * 1024 * 1024; // 200MB (base64 upload limit)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.ogg': 'video/ogg',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
};

const DEFAULT_PROFILE = {
  name: 'Koyome',
  nameZh: 'Koyome',
  tagline: 'welcome — make yourself at home.',
  taglineZh: '歡迎——就把這裡當成自己的家。',
  intro: "Koyome here — this is my own small corner of the internet.\n\nI keep the words worth re-reading, the pictures worth looking at twice, and the videos I don't want to forget. Nothing here is finished, and nothing here is in a hurry.\n\nHave a look around — stay as long as you like.",
  introZh: '我是 Koyome，這裡是我在網路上的一小塊地。\n\n值得重讀的文字、值得多看兩眼的畫面，還有不想忘記的影片，我都放在這裡。這裡的東西都還沒完成，也沒有任何東西在趕路。\n\n隨便逛逛——想待多久都可以。',
  armNote: '',
  armNoteZh: '',
  /* 首页浑天仪的默认展示视角："yaw,pitch,dist"（站长在页面上保存，随内容推送） */
  orreryView: '',
  avatar: '/assets/avatar.jpg',
};

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
}

const loadContent = () => {
  const list = readJson(DATA_FILE, []);
  return Array.isArray(list) ? list : [];
};
const saveContent = (list) => writeJson(DATA_FILE, list);
const loadGuestbook = () => {
  const list = readJson(GUESTBOOK_FILE, []);
  return Array.isArray(list) ? list : [];
};
const saveGuestbook = (list) => writeJson(GUESTBOOK_FILE, list);
const loadProfile = () => ({ ...DEFAULT_PROFILE, ...readJson(PROFILE_FILE, {}) });
const saveProfile = (p) => writeJson(PROFILE_FILE, p);
const loadHobbies = () => readJson(HOBBIES_FILE, { intro: '', introZh: '', items: [] });
const saveHobbies = (h) => writeJson(HOBBIES_FILE, h);
const loadVisits = () => {
  const list = readJson(VISITS_FILE, []);
  return Array.isArray(list) ? list : [];
};
const saveVisits = (list) => writeJson(VISITS_FILE, list);

/* ================= Visitor roll =================
   One row per visitor. Repeat page-views by the same address inside
   VISIT_MERGE_MS fold into the same row and bump its counter, so a
   person walking around the site is still one visitor.
   The district-level place comes from ip-api.com (free, no key,
   ?lang=zh-CN, `district` field). It is looked up AFTER the response
   is served, and any failure just leaves the place blank — the site
   never waits on the network, and never breaks because of it. */
const VISIT_MERGE_MS = 30 * 60 * 1000;
const VISIT_MAX = 500;
const GEO = new Map();

function clientIp(req) {
  const s = (req.socket && req.socket.remoteAddress) || '';
  return s.replace(/^::ffff:/, '');
}

function isPrivateIp(ip) {
  if (!ip || ip === '::1' || ip === '127.0.0.1') return true;
  if (/^(10|192\.168|169\.254)\./.test(ip)) return true;
  const m = /^172\.(\d+)\./.exec(ip);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  if (/^(fc|fd|fe80)/i.test(ip)) return true;
  return false;
}

/* GBK decoder for the Chinese fallback source (full-ICU builds only) */
let GBK = null;
try { GBK = new TextDecoder('gbk'); } catch (_) { GBK = null; }

/* An optional 高德 (Amap) web-service key turns "best effort" into a
   true district: drop the key in tools/geo-key.txt (or set AMAP_KEY)
   and Chinese addresses resolve down to 区/县. Without it the two
   free sources below still answer — just one level less precise. */
let AMAP_KEY = (process.env.AMAP_KEY || '').trim();
if (!AMAP_KEY) {
  try {
    const kf = path.join(ROOT, 'tools', 'geo-key.txt');
    if (fs.existsSync(kf)) AMAP_KEY = fs.readFileSync(kf, 'utf8').trim();
  } catch (_) { /* no key — the free sources carry on alone */ }
}

/** words that mean "this is not a district name" — carriers on one side
    (pconline ends its addr with the ISP), registries on the other */
const NOT_A_DISTRICT = /电信|联通|移动|铁通|网通|教育网|科技网|宽带|通信|数据|网络|信息|公司|机房|数据中心|保留地址|保留|未分配|未知|N\/A|NA|IANA/;

/* A real Chinese district is short and ends in one of these. Requiring the
   suffix — rather than merely rejecting a list of known-bad words — means a
   new carrier name or registry note cannot slip through unchallenged. */
const PLAUSIBLE_PLACE = /[区县旗州]$/;

async function geoLookup(ip) {
  if (GEO.has(ip)) return GEO.get(ip);
  const g = { country: '', region: '', city: '', district: '', isp: '', lat: null, lon: null };

  /* 0) 高德 — only when a key is present, and it is the one source that
        answers with a real 区/县 for Chinese addresses. */
  if (AMAP_KEY) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 3500);
      const r = await fetch(
        `https://restapi.amap.com/v5/ip?key=${encodeURIComponent(AMAP_KEY)}` +
        `&ip=${encodeURIComponent(ip)}&type=4`, { signal: ctl.signal });
      clearTimeout(timer);
      const j = await r.json();
      if (j && j.status === '1' && !/局域网/.test(String(j.province || ''))) {
        if (j.country) g.country = str(j.country, 60);
        if (j.province) g.region = str(j.province, 60);
        if (j.city) g.city = str(j.city, 60);
        if (j.district) g.district = str(j.district, 60);
        if (j.isp) g.isp = str(j.isp, 80);
        const ll = String(j.location || '').split(',');
        if (ll.length === 2) {
          const lo = Number(ll[0]), la = Number(ll[1]);   /* Amap is X,Y */
          if (Number.isFinite(lo)) g.lon = lo;
          if (Number.isFinite(la)) g.lat = la;
        }
      }
    } catch (_) { /* bad key, quota, offline — the free sources take over */ }
  }

  /* 1) ip-api.com — worldwide, ?lang=zh-CN, carries a `district` field.
        Its district coverage is patchy, so a second source follows. */
  if (!g.city) {
  try {
    if (GEO.size > 400) GEO.clear();
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 3500);
    const r = await fetch(
      `http://ip-api.com/json/${encodeURIComponent(ip)}` +
      '?fields=status,message,country,regionName,city,district,isp,lat,lon&lang=zh-CN',
      { signal: ctl.signal });
    clearTimeout(timer);
    const j = await r.json();
    if (j && j.status === 'success') {
      g.country = str(j.country, 60);
      g.region = str(j.regionName, 60);
      g.city = str(j.city, 60);
      g.district = str(j.district, 60);
      g.isp = str(j.isp, 80);
      g.lat = Number.isFinite(j.lat) ? j.lat : null;
      g.lon = Number.isFinite(j.lon) ? j.lon : null;
    }
  } catch (_) { /* offline or rate-limited — the row simply stays blank */ }
  }

  /* 2) pconline — the district-level backstop for Chinese addresses.
        It answers GBK, and puts "省 市 区" (or "省 市 运营商") in `addr`. */
  if (!g.district && GBK) {
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 3500);
      const r = await fetch(
        `https://whois.pconline.com.cn/ipJson.jsp?ip=${encodeURIComponent(ip)}&json=true`,
        { signal: ctl.signal });
      clearTimeout(timer);
      const txt = GBK.decode(Buffer.from(await r.arrayBuffer()));
      const m = /\{[\s\S]*\}/.exec(txt);
      if (m) {
        const j = JSON.parse(m[0]);
        const region = String(j.region || '').trim();
        const tail = String(j.addr || '').trim().split(/\s+/).pop() || '';
        const dist = region || (tail && !NOT_A_DISTRICT.test(tail) ? tail : '');
        if (dist) g.district = str(dist, 60);
        if (!g.region && j.pro) g.region = str(String(j.pro).replace(/[省市自治区]+$/, ''), 60);
        if (!g.city && j.city) g.city = str(j.city, 60);
        if (!g.country && (j.pro || j.city)) g.country = '中国';
      }
    } catch (_) { /* non-Chinese addresses simply 503 here — harmless */ }
  }

  GEO.set(ip, g);
  /* Last line of defence. No source may put a carrier name, a registry
     note, or an empty-ish string in front of a visitor as their 区.
     A Chinese district ends in one of the suffixes below. Anything
     else is dropped — deliberately including half-translated notes
     like "IANA保留地址" and bare English fragments, because a wrong
     district is worse than a missing one. */
  if (g.district && !PLAUSIBLE_PLACE.test(g.district)) g.district = '';
  return g;
}

/** fill the place fields of an existing row once the lookup lands */
async function enrichVisit(id, ip) {
  if (isPrivateIp(ip)) return;
  const g = await geoLookup(ip);
  const list = loadVisits();
  const row = list.find((x) => x.id === id);
  if (!row) return;
  row.country = g.country; row.region = g.region; row.city = g.city;
  row.district = g.district; row.isp = g.isp; row.lat = g.lat; row.lon = g.lon;
  saveVisits(list);
}

function recordVisit(req, page) {
  const ip = clientIp(req);
  const ua = str(req.headers['user-agent'] || '', 200);
  /* crawlers and our own headless probes are not visitors */
  if (/bot|crawler|spider|slurp|curl|wget|python-requests|headless/i.test(ua)) return;

  const now = Date.now();
  const iso = new Date().toISOString();
  const stamp = iso.slice(0, 16).replace('T', ' ');
  const list = loadVisits();

  const prev = list.find((v) => v.ip === ip && now - Date.parse(v.last || v.at) < VISIT_MERGE_MS);
  if (prev) {
    prev.count = (prev.count || 1) + 1;
    prev.last = iso;
    if (page) {
      if (!Array.isArray(prev.pages)) prev.pages = page ? [page] : [];
      if (!prev.pages.includes(page)) prev.pages.push(page);
      prev.page = page;
    }
    saveVisits(list);
    enrichVisit(prev.id, ip);
    return;
  }

  const row = {
    id: 'v' + now.toString(36) + Math.random().toString(36).slice(2, 5),
    ip, at: iso, last: iso, time: stamp,
    page: page || '', pages: page ? [page] : [], ua,
    country: '', region: '', city: '', district: '', isp: '',
    lat: null, lon: null,
    lan: isPrivateIp(ip),
    count: 1,
  };
  list.unshift(row);
  if (list.length > VISIT_MAX) list.length = VISIT_MAX;
  saveVisits(list);
  enrichVisit(row.id, ip);
}

/* ---------- the cloud half of the roll ----------
   The public site is static: a phone opening koyome.github.io never
   reaches this machine. Those visitors register themselves into the
   shared table (docs/js/visit-beacon.js) and are read back here, then
   put through the very same lookup the local rows get — so a phone on
   the far side of the country still reads 省 / 市 / 区 with coordinates. */
const SB_KEY_FILE = path.join(ROOT, 'tools', 'sb-key.txt');
let SB_SECRET = (process.env.SB_KEY || '').trim();
if (!SB_SECRET) {
  try { if (fs.existsSync(SB_KEY_FILE)) SB_SECRET = fs.readFileSync(SB_KEY_FILE, 'utf8').trim(); }
  catch (_) { /* no secret — the anon key alone may still be enough */ }
}
const SB_CFG = (() => {
  try {
    const s = fs.readFileSync(path.join(PUBLIC_DIR, 'js', 'gb-config.js'), 'utf8');
    const u = /url:\s*'([^']+)'/.exec(s);
    const k = /anonKey:\s*'([^']+)'/.exec(s);
    return { url: u ? u[1] : '', anonKey: k ? k[1] : '' };
  } catch (_) { return { url: '', anonKey: '' }; }
})();
let cloudCache = { at: 0, rows: [], state: 'no-config' };

function sbHeaders() {
  const h = { apikey: SB_CFG.anonKey, Authorization: 'Bearer ' + SB_CFG.anonKey };
  /* a JWT in the local file is a service-role key — use it as the bearer;
     anything else is the read secret checked by the SQL policy */
  if (SB_SECRET) {
    if (/^ey/.test(SB_SECRET)) h.Authorization = 'Bearer ' + SB_SECRET;
    else h['x-koyome-key'] = SB_SECRET;
  }
  return h;
}

async function fetchCloudVisits() {
  if (!SB_CFG.url || !SB_CFG.anonKey) {
    cloudCache = { at: Date.now(), rows: [], state: 'no-config' };
    return cloudCache;
  }
  if (Date.now() - cloudCache.at < 15000) return cloudCache;   /* 15s cache */
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    const r = await fetch(`${SB_CFG.url}/rest/v1/visits?select=*&order=ts.desc&limit=200`,
      { headers: sbHeaders(), signal: ctl.signal });
    clearTimeout(timer);
    if (r.ok) {
      const rows = await r.json();
      cloudCache = { at: Date.now(), rows: Array.isArray(rows) ? rows : [], state: 'ok' };
    } else {
      const t = await r.text();
      const missing = /PGRST205|Could not find the table/i.test(t);
      cloudCache = {
        at: Date.now(), rows: [],
        state: missing ? 'no-table' : (r.status === 401 || r.status === 403 ? 'denied' : 'error'),
      };
    }
  } catch (_) { cloudCache = { at: Date.now(), rows: [], state: 'error' }; }
  return cloudCache;
}

/* Does this row read the way a Chinese address reads? A 美国/日本 row
   must NOT come back as "弗吉尼亚州省Ashburn市" — the suffixes are
   Chinese administrative words and only belong on Chinese rows. */
const CN_COUNTRY = /中国|中华人民共和国|^CN$|\bChina\b/i;
const ADMIN_SUFFIX = /(省|市|区|县|盟|旗|自治州|自治区|特别行政区|地区)$/;

function placeOf(v) {
  const region = v.region || '', city = v.city || '', dist = v.district || '';
  const country = v.country || '';
  const isCn = CN_COUNTRY.test(country) || (!country && !/[A-Za-z]/.test(region + city));
  if (!isCn) return [country, region, city, dist].filter(Boolean).join(' · ');

  /* 杭州 → 杭州市, but 延边朝鲜族自治州 keeps its own ending */
  const r = region && !ADMIN_SUFFIX.test(region) ? region + '省' : region;
  const c = city && !ADMIN_SUFFIX.test(city) ? city + '市' : city;
  const d = dist && !ADMIN_SUFFIX.test(dist) ? dist + '区' : dist;
  /* 北京市 / 北京市 — a 直辖市 has no separate 省 layer, so collapse it */
  const cOut = (c && c !== r) ? c : '';
  return [r, cOut, d].filter(Boolean).join('');
}
const latlonOf = (v) => (Number.isFinite(v.lat) && Number.isFinite(v.lon))
  ? v.lat.toFixed(4) + ', ' + v.lon.toFixed(4) : '';

function stampOf(ts) {
  const d = new Date(ts);
  if (isNaN(d.getTime())) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** local rows + cloud rows, newest first, both fully located */
async function mergedVisits() {
  const local = loadVisits().map((v) => ({
    ...v, src: 'local', place: placeOf(v), latlon: latlonOf(v),
  }));

  const cloud = await fetchCloudVisits();
  const rows = cloud.rows.slice(0, 60);        /* the recent few — lookups are rate-limited */
  const out = [];
  for (let i = 0; i < rows.length; i += 5) {   /* five at a time, not sixty */
    const slice = rows.slice(i, i + 5);
    const done = await Promise.all(slice.map(async (c) => {
      const ip = String(c.ip || '');
      const row = {
        id: 'c' + c.id, ip, src: 'cloud', time: stampOf(c.ts), at: c.ts, last: c.ts,
        page: c.page || '', pages: [], ua: c.ua || '', count: 1,
        country: '', region: '', city: '', district: '', isp: '', lat: null, lon: null,
        lan: isPrivateIp(ip),
      };
      if (!row.lan) {
        const g = await geoLookup(ip);
        row.country = g.country; row.region = g.region; row.city = g.city;
        row.district = g.district; row.isp = g.isp; row.lat = g.lat; row.lon = g.lon;
        /* the phone told us its own coordinates on the way in — keep them
           if every lookup service was unreachable from this machine */
        if (!Number.isFinite(row.lat) && Number.isFinite(Number(c.lat))) {
          row.lat = Number(c.lat); row.lon = Number(c.lon);
        }
      }
      row.place = placeOf(row);
      row.latlon = latlonOf(row);
      return row;
    }));
    out.push(...done);
  }

  const all = local.concat(out);
  all.sort((a, b) => String(b.last || b.at || '').localeCompare(String(a.last || a.at || '')));
  return all;
}

/** is the cloud half healthy, and why not if it isn't */
async function cloudStatus() {
  const c = await fetchCloudVisits();
  return { cloud: c.state, rows: c.rows.length };
}

const str = (v, n) => String(v == null ? '' : v).slice(0, n);

/** Save a dataURL as a real file under assets/, return its public path */
function saveDataUrl(dataUrl, originalName) {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/.exec(dataUrl || '');
  if (!m) return null;
  const extMap = {
    'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif',
    'image/webp': '.webp', 'image/avif': '.avif', 'image/svg+xml': '.svg',
    'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
    'audio/mpeg': '.mp3', 'audio/mp3': '.mp3', 'audio/wav': '.wav',
    'audio/x-wav': '.wav', 'audio/ogg': '.ogg', 'audio/flac': '.flac',
    'audio/x-flac': '.flac', 'audio/mp4': '.m4a', 'audio/x-m4a': '.m4a',
  };
  const ext = extMap[m[1]] || path.extname(originalName || '').toLowerCase() || '.bin';
  const safe = String(originalName || 'file')
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, '_')
    .replace(/\.[^.]*$/, '');
  const name = `${Date.now()}_${(safe || 'file').slice(0, 40)}${ext}`;
  const buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]), 'utf8');
  fs.mkdirSync(ASSETS_DIR, { recursive: true });
  fs.writeFileSync(path.join(ASSETS_DIR, name), buf);
  return `assets/${name}`;
}

/** media type from a dataURL mime prefix */
function mediaTypeOf(dataUrl) {
  if (/^data:video\//.test(dataUrl || '')) return 'video';
  if (/^data:audio\//.test(dataUrl || '')) return 'audio';
  return 'image';
}

/** normalize an entry: always carry a media array */
function normalizeEntry(entry) {
  if (!Array.isArray(entry.media)) {
    entry.media = (entry.type === 'image' || entry.type === 'video') && entry.src
      ? [{ type: entry.type, src: entry.src }]
      : [];
  }
  if (entry.media.length && !entry.src) entry.src = entry.media[0].src;
  return entry;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  /* CORS preflight. The owner's desk pages (file:// kstage-preview.html,
     or a dev server on another port) call DELETE/POST cross-origin, and
     anything but GET/POST/HEAD makes the browser ask first. This server
     only listens on the loopback, so answering permissively costs
     nothing — the published site is on GitHub Pages and never here. */
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': req.headers['access-control-request-headers'] || '*',
      'Access-Control-Max-Age': '86400',
    });
    return res.end();
  }

  /* ================= Content API ================= */
  if (url.pathname === '/api/content' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(loadContent().map(normalizeEntry)));
  }

  if (url.pathname === '/api/content' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req, BODY_LIMIT)).toString('utf8'));
      const entry = {
        id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        type: ['text', 'image', 'video'].includes(body.type) ? body.type : 'text',
        title: str(body.title, 120) || 'Untitled',
        titleZh: str(body.titleZh, 120),
        category: str(body.category, 40) || 'Uncategorized',
        categoryZh: str(body.categoryZh, 40),
        date: str(body.date, 20) || new Date().toISOString().slice(0, 10),
        featured: !!body.featured,
        desc: str(body.desc, 300),
        descZh: str(body.descZh, 300),
        media: [],
      };

      if (entry.type === 'text') {
        entry.body = str(body.body, 200000);
        entry.bodyZh = str(body.bodyZh, 200000);
        if (!entry.body.trim() && !entry.bodyZh.trim()) {
          return send(res, 400, { error: 'Body text cannot be empty' });
        }
      } else {
        /* multiple uploaded files, or a single source URL */
        if (Array.isArray(body.files) && body.files.length) {
          body.files.forEach((f) => {
            const src = saveDataUrl(f.file, f.filename);
            if (src) entry.media.push({ type: mediaTypeOf(f.file), src });
          });
        }
        const src = String(body.src || '').trim();
        if (src && !entry.media.length) entry.media.push({ type: entry.type, src });
        if (!entry.media.length) return send(res, 400, { error: 'Upload a file or provide a source URL' });
        entry.src = entry.media[0].src;
      }

      const list = loadContent();
      list.unshift(entry);
      saveContent(list);
      return send(res, 200, { ok: true, entry });
    } catch (e) {
      return send(res, e.message === 'payload too large' ? 413 : 400, { error: e.message });
    }
  }

  if (url.pathname === '/api/content' && req.method === 'PUT') {
    /* update an existing entry's text fields; media is managed via /api/media */
    try {
      const id = url.searchParams.get('id');
      const body = JSON.parse((await readBody(req, BODY_LIMIT)).toString('utf8'));
      const list = loadContent();
      const entry = list.find((it) => it.id === id);
      if (!entry) return send(res, 404, { error: 'Entry not found' });

      if (body.title != null) entry.title = str(body.title, 120) || 'Untitled';
      if (body.titleZh != null) entry.titleZh = str(body.titleZh, 120);
      if (body.category != null) entry.category = str(body.category, 40) || 'Uncategorized';
      if (body.categoryZh != null) entry.categoryZh = str(body.categoryZh, 40);
      if (body.date != null) entry.date = str(body.date, 20);
      if (body.featured != null) entry.featured = !!body.featured;
      if (body.desc != null) entry.desc = str(body.desc, 300);
      if (body.descZh != null) entry.descZh = str(body.descZh, 300);
      /* body text is editable for every entry type — required only for text entries */
      const nextBody = body.body != null ? str(body.body, 200000) : entry.body;
      const nextBodyZh = body.bodyZh != null ? str(body.bodyZh, 200000) : entry.bodyZh;
      if (entry.type === 'text' && !String(nextBody || '').trim() && !String(nextBodyZh || '').trim()) {
        return send(res, 400, { error: 'Body text cannot be empty' });
      }
      entry.body = nextBody;
      entry.bodyZh = nextBodyZh;

      /* travel-map landmark pins: { tokyo: [{x,y,zh,en}], jeju: [...] }
         — owner drops them on the map UI; validated & capped here */
      if (body.mapPins != null) {
        const clean = {};
        if (body.mapPins && typeof body.mapPins === 'object') {
          for (const mapId of ['tokyo', 'jeju']) {
            const arr = body.mapPins[mapId];
            if (!Array.isArray(arr)) continue;
            clean[mapId] = arr.slice(0, 60).map((p) => ({
              x: Math.max(0, Math.min(560, Math.round(Number(p.x) || 0))),
              y: Math.max(0, Math.min(400, Math.round(Number(p.y) || 0))),
              zh: str(p.zh, 60),
              en: str(p.en, 60),
              /* landmark sigil key (R13) — lowercase letters/dashes only */
              icon: /^[a-z-]{1,20}$/.test(String(p.icon || '')) ? String(p.icon) : '',
            })).filter((p) => p.zh || p.en);
          }
        }
        entry.mapPins = clean;
      }

      saveContent(list);
      return send(res, 200, { ok: true, entry: normalizeEntry(entry) });
    } catch (e) {
      return send(res, e.message === 'payload too large' ? 413 : 400, { error: e.message });
    }
  }

  if (url.pathname === '/api/content' && req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    saveContent(loadContent().filter((it) => it.id !== id));
    return send(res, 200, { ok: true });
  }

  /* ================= Media API (per-entry, multiple) ================= */
  if (url.pathname === '/api/media' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req, BODY_LIMIT)).toString('utf8'));
      const list = loadContent();
      const entry = list.find((it) => it.id === body.id);
      if (!entry) return send(res, 404, { error: 'Entry not found' });
      normalizeEntry(entry);
      if (Array.isArray(body.files)) {
        body.files.forEach((f) => {
          const src = saveDataUrl(f.file, f.filename);
          if (!src) return;
          const item = { type: mediaTypeOf(f.file), src };
          if (item.type === 'audio') {
            /* tracks may carry a title and a cover image */
            if (f.title) item.title = str(f.title, 120);
            if (f.coverFile) {
              const cover = saveDataUrl(f.coverFile, (f.filename || 'track') + '.cover');
              if (cover) item.cover = cover;
            }
          }
          entry.media.push(item);
        });
      }
      if (body.src) {
        const src = String(body.src).trim();
        if (src) entry.media.push({ type: entry.type === 'video' ? 'video' : 'image', src });
      }
      if (!entry.media.length) return send(res, 400, { error: 'Upload a file or provide a source URL' });
      entry.src = entry.media[0].src;
      saveContent(list);
      return send(res, 200, { ok: true, media: entry.media });
    } catch (e) {
      return send(res, e.message === 'payload too large' ? 413 : 400, { error: e.message });
    }
  }

  /* update one media item's editable text — the caption that
     describes the piece (bilingual like every text field) */
  if (url.pathname === '/api/media' && req.method === 'PUT') {
    try {
      const id = url.searchParams.get('id');
      const index = parseInt(url.searchParams.get('index'), 10);
      const body = JSON.parse((await readBody(req, BODY_LIMIT)).toString('utf8'));
      const list = loadContent();
      const entry = list.find((it) => it.id === id);
      if (!entry || Number.isNaN(index) || !entry.media || !entry.media[index]) {
        return send(res, 404, { error: 'Media not found' });
      }
      if (body.caption != null) entry.media[index].caption = str(body.caption, 2000);
      if (body.captionZh != null) entry.media[index].captionZh = str(body.captionZh, 2000);
      if (body.title != null && entry.media[index].type === 'audio') {
        entry.media[index].title = str(body.title, 120);
      }
      saveContent(list);
      return send(res, 200, { ok: true, media: entry.media });
    } catch (e) {
      return send(res, e.message === 'payload too large' ? 413 : 400, { error: e.message });
    }
  }

  if (url.pathname === '/api/media' && req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    const index = parseInt(url.searchParams.get('index'), 10);
    const list = loadContent();
    const entry = list.find((it) => it.id === id);
    if (!entry || Number.isNaN(index) || !entry.media || !entry.media[index]) {
      return send(res, 404, { error: 'Media not found' });
    }
    entry.media.splice(index, 1);
    entry.src = entry.media.length ? entry.media[0].src : '';
    saveContent(list);
    return send(res, 200, { ok: true, media: entry.media });
  }

  /* ================= Profile API (homepage) ================= */
  if (url.pathname === '/api/profile' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(loadProfile()));
  }

  if (url.pathname === '/api/profile' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req, BODY_LIMIT)).toString('utf8'));
      const current = loadProfile();
      const next = {
        name: body.name != null ? str(body.name, 80) : current.name,
        nameZh: body.nameZh != null ? str(body.nameZh, 80) : current.nameZh,
        tagline: body.tagline != null ? str(body.tagline, 200) : current.tagline,
        taglineZh: body.taglineZh != null ? str(body.taglineZh, 200) : current.taglineZh,
        intro: body.intro != null ? str(body.intro, 20000) : current.intro,
        introZh: body.introZh != null ? str(body.introZh, 20000) : current.introZh,
        figNote: body.figNote != null ? str(body.figNote, 200) : current.figNote,
        figNoteZh: body.figNoteZh != null ? str(body.figNoteZh, 200) : current.figNoteZh,
        armNote: body.armNote != null ? str(body.armNote, 1000) : current.armNote,
        armNoteZh: body.armNoteZh != null ? str(body.armNoteZh, 1000) : current.armNoteZh,
      orreryView: body.orreryView != null ? str(body.orreryView, 60) : current.orreryView,
        avatar: current.avatar,
      };
      if (body.avatarFile) {
        const src = saveDataUrl(body.avatarFile, 'avatar');
        if (src) next.avatar = src;
      } else if (body.avatar) {
        next.avatar = str(body.avatar, 300);
      }
      saveProfile(next);
      return send(res, 200, { ok: true, profile: next });
    } catch (e) {
      return send(res, e.message === 'payload too large' ? 413 : 400, { error: e.message });
    }
  }

  /* ================= Hobbies API ================= */
  if (url.pathname === '/api/hobbies' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(loadHobbies()));
  }

  if (url.pathname === '/api/hobbies' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req, 4 * 1024 * 1024)).toString('utf8'));
      const doc = {
        intro: str(body.intro, 5000),
        introZh: str(body.introZh, 5000),
        /* fixed sections — anime, characters & galgame — each holding
           free-form image + text items */
        sections: (Array.isArray(body.sections) ? body.sections : []).slice(0, 4).map((sec) => ({
          id: str(sec.id, 40) || 'sec' + Date.now().toString(36),
          items: (Array.isArray(sec.items) ? sec.items : []).slice(0, 40).map((it) => ({
            id: str(it.id, 40) || 'h' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
            name: str(it.name, 120),
            nameZh: str(it.nameZh, 120),
            text: str(it.text, 3000),
            textZh: str(it.textZh, 3000),
            src: /^assets\/[\w.\-\u4e00-\u9fa5]+$/i.test(String(it.src || '')) ? String(it.src) : '',
            /* five-axis anime ratings [animation, character, story, pacing,
               sound] — 0..10 in half steps; absent = unrated (key dropped) */
            ...(Array.isArray(it.ratings) ? {
              ratings: [0, 1, 2, 3, 4].map((i) => {
                const v = Math.round(Number(it.ratings[i]) * 2) / 2;
                return Number.isFinite(v) ? Math.max(0, Math.min(10, v)) : 0;
              }),
            } : {}),
          })),
        })),
        /* chibi decoration slots scattered around the page */
        deco: (Array.isArray(body.deco) ? body.deco : []).slice(0, 6).map((d) => ({
          id: str(d.id, 40) || 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
          src: /^assets\/[\w.\-\u4e00-\u9fa5]+$/i.test(String(d.src || '')) ? String(d.src) : '',
        })),
      };
      saveHobbies(doc);
      return send(res, 200, { ok: true, hobbies: doc });
    } catch (e) {
      return send(res, e.message === 'payload too large' ? 413 : 400, { error: e.message });
    }
  }

  /* upload one image for a hobbies item or a chibi deco slot —
     saves into docs/assets and returns its src */
  if (url.pathname === '/api/hobbies/upload' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req, BODY_LIMIT)).toString('utf8'));
      const src = saveDataUrl(body.file, body.filename);
      if (!src || !/^data:image\//.test(String(body.file || ''))) {
        return send(res, 400, { error: 'image file required' });
      }
      return send(res, 200, { ok: true, src });
    } catch (e) {
      return send(res, e.message === 'payload too large' ? 413 : 400, { error: e.message });
    }
  }

  /* ================= Guestbook API ================= */
  if (url.pathname === '/api/guestbook' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify(loadGuestbook()));
  }

  if (url.pathname === '/api/guestbook' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req, 1024 * 1024)).toString('utf8'));
      const name = str(body.name, 40).trim();
      const text = str(body.text, 2000).trim();
      if (!name || !text) return send(res, 400, { error: 'Name and message are required' });
      const msg = {
        id: 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        name, text,
        date: new Date().toISOString().slice(0, 16).replace('T', ' '),
      };
      const list = loadGuestbook();
      list.unshift(msg);
      saveGuestbook(list);
      return send(res, 200, { ok: true, msg });
    } catch (e) {
      return send(res, 400, { error: e.message });
    }
  }

  if (url.pathname === '/api/guestbook' && req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    saveGuestbook(loadGuestbook().filter((it) => it.id !== id));
    return send(res, 200, { ok: true });
  }

  /* ================= Visitor roll API ================= */
  if (url.pathname === '/api/visits' && req.method === 'GET') {
    return send(res, 200, await mergedVisits());
  }

  /* how the cloud half is doing — the page shows a hint when it is off */
  if (url.pathname === '/api/visits/status' && req.method === 'GET') {
    const st = await cloudStatus();
    return send(res, 200, st);
  }

  if (url.pathname === '/api/visits' && req.method === 'DELETE') {
    const id = url.searchParams.get('id');
    saveVisits(id ? loadVisits().filter((it) => it.id !== id) : []);
    return send(res, 200, { ok: true });
  }

  /* ================= the 高德 key =================
     Applying for one needs a phone number and a real name, so it can
     only be done by hand — but "has one, now use it" must not mean
     editing a file and restarting. Drop it in here, it is verified
     against the real service, written to disk, and live immediately. */
  if (url.pathname === '/api/geo-key' && req.method === 'GET') {
    return send(res, 200, {
      configured: !!AMAP_KEY,
      masked: AMAP_KEY ? AMAP_KEY.slice(0, 4) + '••••' + AMAP_KEY.slice(-3) : '',
    });
  }

  if (url.pathname === '/api/geo-key' && req.method === 'POST') {
    let key = '';
    try {
      key = String((JSON.parse((await readBody(req, BODY_LIMIT)).toString('utf8')) || {}).key || '').trim();
    } catch (_) { /* malformed body */ }

    if (!key) {                                  /* an empty body clears it */
      try { fs.writeFileSync(path.join(ROOT, 'tools', 'geo-key.txt'), ''); } catch (_) { /* read-only disk */ }
      AMAP_KEY = ''; GEO.clear();
      return send(res, 200, { ok: true, configured: false, verified: false });
    }

    /* ask Amap once with the caller's own address — a bad key says so */
    let verified = false, fatal = false, info = '';
    try {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), 6000);
      const r = await fetch(`https://restapi.amap.com/v5/ip?key=${encodeURIComponent(key)}&type=4`,
        { signal: ctl.signal });
      clearTimeout(timer);
      const j = await r.json();
      verified = !!(j && j.status === '1');
      info = String((j && j.info) || (verified ? 'OK' : ''));
      /* these three mean the key itself is wrong or the wrong service is
         enabled — saving it would only produce permanently blank districts.
         Anything else (quota, network, server hiccup) is a good key. */
      fatal = /INVALID_USER_KEY|USERKEY_PLAT_NOMATCH|SERVICE_NOT_ENABLED/i.test(info);
    } catch (_) { info = '暂时连不上高德（不影响 Key 本身）'; }

    if (fatal) {
      return send(res, 200, { ok: false, configured: !!AMAP_KEY, verified: false, info,
        hint: '这个 Key 高德不认。请确认申请时「服务平台」勾的是 Web 服务（不是 Android/iOS），Key 没被删。' });
    }

    try {
      fs.mkdirSync(path.join(ROOT, 'tools'), { recursive: true });
      fs.writeFileSync(path.join(ROOT, 'tools', 'geo-key.txt'), key + '\n');
    } catch (_) { /* read-only disk — still use it for this session */ }
    AMAP_KEY = key;
    GEO.clear();                                 /* cached city-level rows get re-resolved */
    return send(res, 200, { ok: true, configured: true, verified, info });
  }

  /* ================= Static files ================= */
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403); return res.end('Forbidden');
  }
  /* a real page load = one visitor. assets, api and 404s are not people. */
  if (req.method === 'GET' && pathname.endsWith('.html')) {
    recordVisit(req, pathname);
  }
  fs.readFile(filePath, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
      return res.end('<meta charset="utf-8">404 · nothing has grown here yet · 這裡還沒長出東西來 · <a href="/">back home / 回到首頁</a>');
    }
    /* 本地开发用：允许桌面测试页（file:// 或 127.0.0.1 其他端口）跨域取静态资源。
       本机服务只监听本机，风险可忽略；线上是 GitHub Pages，不涉及。 */
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(buf);
  });
});

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
  res.end(JSON.stringify(obj));
}

fs.mkdirSync(ASSETS_DIR, { recursive: true });
fs.mkdirSync(DATA_DIR, { recursive: true });

function listen(port, isFallback) {
  server.once('error', (err) => {
    if (!isFallback && (err.code === 'EACCES' || err.code === 'EADDRINUSE')) {
      console.log(`  port ${port} unavailable (${err.code}) — falling back to 8080`);
      listen(8080, true);
      return;
    }
    throw err;
  });
  server.listen(port, () => {
    console.log('----------------------------------------');
    console.log('  Koyome.me — served from this computer');
    if (port === 80) {
      console.log('  http://Koyome.me            home (add "127.0.0.1 Koyome.me" to your hosts file once)');
      console.log('  http://Koyome.me/admin.html site manager');
    } else {
      console.log(`  http://Koyome.me:${port}            home`);
      console.log(`  http://Koyome.me:${port}/admin.html  site manager`);
    }
    console.log('----------------------------------------');
  });
}

listen(PORT, false);
