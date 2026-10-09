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
/* the visitor-gate password lives ONLY here — server-side, outside docs/ —
   so it is never in the published tree and never reaches the browser. */
const GATE_FILE = path.join(ROOT, 'server-gate.json');
const ASSETS_DIR = path.join(PUBLIC_DIR, 'assets');
const PORT = process.env.PORT || 80;
const BODY_LIMIT = 200 * 1024 * 1024; // 200MB (base64 upload limit)
/* When this file was last saved, as a number. A Node process keeps the
   code it started with, so after an edit the running server is the old
   one until it is restarted — and "I changed it but nothing changed"
   is the single most expensive confusion in this project. Exposing the
   loaded file's own timestamp makes that answerable in one request
   instead of an argument: compare it with the file on disk. */
const BUILD = (() => {
  try { return String(Math.round(fs.statSync(__filename).mtimeMs)); } catch (_) { return ''; }
})();

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
/* ---- the roll, held in memory and flushed to disk ----
   Every recorded visit must survive, so the array the request handler
   pushes into is *the* roll — not a copy re-read from disk each time.
   Reading the file, pushing, and writing it back looks harmless and
   silently loses rows: two page loads arriving together both read the
   same 40 rows, each writes 41, and one visitor is gone. With the
   array held in memory the push cannot be lost (Node runs one handler
   at a time), and the disk write is only a debounced mirror of it.

   The debounce is short (120ms) and there is a flush on process exit,
   so "in memory" never means "lost if the power goes". */
let VISITS = null;
let VISITS_TIMER = null;

const loadVisits = () => {
  if (VISITS) return VISITS;
  const list = readJson(VISITS_FILE, []);
  VISITS = Array.isArray(list) ? list : [];
  return VISITS;
};

function flushVisits() {
  if (VISITS_TIMER) { clearTimeout(VISITS_TIMER); VISITS_TIMER = null; }
  if (!VISITS) return;
  try { writeJson(VISITS_FILE, VISITS); } catch (_) { /* read-only disk */ }
}

/** record the array, and mirror it to disk shortly after */
const saveVisits = (list) => {
  VISITS = Array.isArray(list) ? list : [];
  if (VISITS_TIMER) return;
  VISITS_TIMER = setTimeout(() => { VISITS_TIMER = null; flushVisits(); }, 120);
};

/* a quit must not take the last 120ms of visitors with it */
process.on('exit', flushVisits);
['SIGINT', 'SIGTERM', 'SIGHUP'].forEach((sig) => {
  process.on(sig, () => { flushVisits(); flushGeo(); process.exit(0); });
});

/* ---- rows the owner has dismissed ----
   Cloud rows are read back from the shared table every time. Removing
   one from *there* would erase the record of somebody else's visit —
   not ours to do, and one stray click would do it silently. So instead
   the page's delete writes the row's id into this local list, and the
   roll stops showing it. The row stays in the cloud table; dismissing
   it only means "stop reminding me about this one".

   Local rows are different: they live here, so deleting one really
   deletes it. Two lists, because the two kinds are not the same thing. */
const VISITS_HIDDEN_FILE = path.join(DATA_DIR, 'visits-hidden.json');
const loadHidden = () => {
  const list = readJson(VISITS_HIDDEN_FILE, []);
  return Array.isArray(list) ? list.map(String) : [];
};
const saveHidden = (list) => writeJson(VISITS_HIDDEN_FILE, list);

/* ================= Visitor roll =================
   ONE ROW PER REQUEST. This is the rule the owner asked for, and it
   replaced an earlier one that was quietly wrong for the job:

     · no MERGE. A visitor who opens three pages used to be folded
       into a single row with a counter. That is not a record of
       visits, it is a record of visitors — and the page is called a
       visit log. Every page served to an outside address is a row.
     · no SAMPLE. The cloud half used to be cut to the newest 60
       rows before it was even looked at. Everything read is shown.
     · no CACHE in the write path. The roll used to be re-read from
       disk per request; two requests arriving together overwrote
       each other and one of them simply vanished. See loadVisits().
     · no SILENT DROP for crawlers. A bot hit used to return before
       anything was written. It is now written and flagged — a crawl
       is a real request from a real address, and "who is talking to
       my site" is a question the log exists to answer.

   The one deliberate skip is ours to make: addresses that belong to
   this machine or to the local network are never written at all
   (isPrivateIp). They are not visitors.

   The district-level place comes from ip-api.com / pconline / 高德.
   Lookups happen in the background, never inside a response, and any
   failure leaves the place blank rather than breaking the page. */
const VISIT_MAX = 20000;      /* disk valve, not a sampling rule */
let VISIT_SEQ = 0;            /* makes ids unique inside one millisecond */
const GEO = new Map();        /* ip → { at, ok, data } */

function clientIp(req) {
  const s = (req.socket && req.socket.remoteAddress) || '';
  return s.replace(/^::ffff:/, '');
}

/** this machine, or the network it sits on — never a visitor */
function isPrivateIp(ip) {
  if (!ip || ip === '::1' || ip === '::' || ip === '0.0.0.0') return true;
  if (/^(127|10|192\.168|169\.254)\./.test(ip)) return true;
  const m = /^172\.(\d+)\./.exec(ip);
  if (m && +m[1] >= 16 && +m[1] <= 31) return true;
  if (/^(fc|fd|fe80)/i.test(ip)) return true;
  return false;
}

/* ============================================================
   uaInfo() — what kind of machine knocked, in words.

   The User-Agent is the only thing a page load tells us about the
   device, and most of it is noise, so this reads it in a fixed
   order — in-app shell → crawler → device → OS → model → browser —
   and returns short labels the roll can print.

   Honest limits, kept in the labels rather than papered over:
     · iOS never names its model. "iPhone" is all Safari offers, so
       the model says iPhone and the OS carries the version. Android
       hands over a real model code (SM-S918B, M2102K1C, Pixel 8).
     · a model code is only translated to a shop name when the code
       is unambiguous; otherwise the raw code is kept. A wrong name
       is worse than a number.
   ============================================================ */
const UA_BOT = /bot|crawler|spider|slurp|bingpreview|facebookexternalhit|ia_archiver|applebot|petalbot|bytespider|semrush|ahrefs|dotbot|exabot|seznam|curl|wget|python-requests|axios|node-fetch|got\/|headless|monitor|uptime|scanner|scrapy|feedfetcher|preview|monitoring/i;

/* Chinese apps open links inside themselves; the shell is the more
   useful answer than "Chrome", because it says where the link went */
const UA_APPS = [
  [/MicroMessenger/i, '微信'], [/WeChat/i, '微信'],
  [/wxwork|WeCom/i, '企业微信'], [/\bQQ\/|QQTheme/i, 'QQ'],
  [/Alipay|AliApp/i, '支付宝'], [/Douyin|aweme/i, '抖音'],
  [/Weibo/i, '微博'], [/baiduboxapp|baiduhaokan/i, '百度'],
  [/DingTalk/i, '钉钉'], [/Feishu|Lark/i, '飞书'],
  [/Taobao|AliApp\(TB/i, '淘宝'], [/Xiaohongshu/i, '小红书'],
  [/Kuaishou|kwai/i, '快手'], [/Zhihu/i, '知乎'], [/Toutiao/i, '今日头条'],
  /* the shells a link gets opened in outside China */
  [/Line\//i, 'LINE'], [/FBAN|FBAV|FBIOS|FB_IAB/i, 'Facebook'],
  [/Instagram/i, 'Instagram'], [/Twitter/i, 'X'],
  [/Snapchat/i, 'Snapchat'], [/Pinterest/i, 'Pinterest'],
  [/bilibili/i, '哔哩哔哩'], [/jdapp|Jingdong/i, '京东'],
];

/** trim a UA version into something a human reads:
    126.0.0.0 → 126 (Chrome-family pads with zeros), 17.5.1 → 17.5
    (Safari and iOS carry a real second number), 14 → 14. */
function normVer(v) {
  let p = String(v == null ? '' : v).split('.').filter((x) => x !== '');
  while (p.length && p[p.length - 1] === '0') p.pop();
  if (!p.length) return '';
  /* Four-number versions are the Chrome family's padded build string
     (126.0.6478.126) — the third field there is a build number in the
     thousands, and only the major means anything to a reader. But the
     same shape is also 微信 8.0.49.2600, where 49 is a real minor, so
     the build number's SIZE is what separates the two cases. */
  if (p.length >= 4) {
    p = (p[1] === '0' && String(p[2]).length >= 3) ? [p[0]] : p.slice(0, 3);
  }
  while (p.length > 1 && p[p.length - 1] === '0') p.pop();
  return p.join('.');
}

/* "Windows NT 6.1" is a version token, not a product: NT 6.1 IS Windows 7.
   Windows 10 and 11 both answer 10.0 and no header separates them, so
   the label says both rather than guessing one. */
const WIN_NT = {
  '10.0': 'Windows 10/11', '6.3': 'Windows 8.1', '6.2': 'Windows 8',
  '6.1': 'Windows 7', '6.0': 'Windows Vista', '5.2': 'Windows XP',
  '5.1': 'Windows XP',
};

const UA_OS = [
  [/iPhone|iPad|iPod/i, (ua) => {
    /* An Apple UA carries TWO independent version statements and they
       can disagree. Real example, straight off the owner's iPhone:

         CPU iPhone OS 18_7 ... Version/26.5

       The OS token ("CPU iPhone OS x_y") is the one Apple freezes for
       compatibility in some browsing modes; Safari's own "Version/x.y"
       tracks the operating system and is never ahead of it. So the true
       system is the LARGER of the two: either token can lag, and
       neither can lead. Reading the OS token alone reported an iOS 26.5
       phone as iOS 18.7 — and worse, it disagreed with the browser line
       right next to it, which said Safari 26.5. */
    const osTok = /OS (\d+)[_.](\d+)/.exec(ua);
    const sVer = /Version\/(\d+)[.](\d+)/.exec(ua);
    const rank = (m) => (m ? Number(m[1]) * 1000 + Number(m[2]) : -1);
    const pick = rank(sVer) > rank(osTok) ? sVer : osTok;
    /* iPadOS 13+ is branded iPadOS, not iOS — same numbers, different
       product, and the roll should be able to tell the two apart. */
    return {
      name: /\biPad\b/i.test(ua) ? 'iPadOS' : 'iOS',
      ver: pick ? normVer(pick[1] + '.' + pick[2]) : '',
    };
  }],
  [/HarmonyOS|OpenHarmony/i, (ua) => {
    const v = /HarmonyOS[ /]?([\d.]+)/i.exec(ua);
    return { name: '鸿蒙', ver: v ? normVer(v[1]) : '' };
  }],
  [/Android ([\d.]+)/i, (ua, m) => ({ name: 'Android', ver: normVer(m[1]) })],
  [/Windows Phone(?: OS)? ([\d.]+)/i, (ua, m) => ({ name: 'Windows Phone', ver: normVer(m[1]) })],
  [/Windows NT ([\d.]+)/, (ua, m) => {
    const label = WIN_NT[m[1]];
    return label ? { name: label, ver: '' } : { name: 'Windows NT', ver: m[1] };
  }],
  [/Mac OS X ([\d_.]+)/, (ua, m) => ({ name: 'macOS', ver: normVer(m[1].replace(/_/g, '.')) })],
  [/CrOS/i, () => ({ name: 'ChromeOS', ver: '' })],
  [/\bLinux\b/i, () => ({ name: 'Linux', ver: '' })],
];

/* browser detection. Order is the whole trick: every shell below
   borrows someone else's engine token, so the specific ones have to be
   read before the generic "Chrome"/"Safari" they are standing on.
   Each entry returns [name, version]. */
const UA_BROWSERS = [
  [/MicroMessenger\/([\d.]+)/i, (m) => ['微信', normVer(m[1])]],
  [/QQBrowser\/([\d.]+)/i, (m) => ['QQ浏览器', normVer(m[1])]],
  [/baiduboxapp\/([\d.]+)/i, (m) => ['百度', normVer(m[1])]],
  [/Quark\/([\d.]+)/i, (m) => ['夸克', normVer(m[1])]],
  [/UCBrowser\/([\d.]+)/i, (m) => ['UC', normVer(m[1])]],
  [/HeyTapBrowser\/([\d.]+)/i, (m) => ['OPPO浏览器', normVer(m[1])]],
  [/VivoBrowser\/([\d.]+)/i, (m) => ['vivo浏览器', normVer(m[1])]],
  [/HuaweiBrowser\/([\d.]+)/i, (m) => ['华为浏览器', normVer(m[1])]],
  [/MiuiBrowser\/([\d.]+)/i, (m) => ['小米浏览器', normVer(m[1])]],
  [/MZBrowser\/([\d.]+)/i, (m) => ['魅族', normVer(m[1])]],
  [/SogouMobileBrowser\/([\d.]+)/i, (m) => ['搜狗', normVer(m[1])]],
  /* the Chinese shells that hide behind Chrome: each carries its own
     token, and all of them must be read before the Chrome line */
  [/360SE|360EE|QIHU\s?360|QihooBrowser/i, () => ['360浏览器', '']],
  [/LieBaoFast|LieBao/i, () => ['猎豹', '']],
  [/Maxthon|MxBrowser/i, () => ['傲游', '']],
  [/2345Explorer|2345chrome/i, () => ['2345浏览器', '']],
  [/LBBROWSER/i, () => ['猎豹安全浏览器', '']],
  [/TheWorld/i, () => ['世界之窗', '']],
  [/YandexBrowser\/([\d.]+)/i, (m) => ['Yandex', normVer(m[1])]],
  [/Vivaldi\/([\d.]+)/i, (m) => ['Vivaldi', normVer(m[1])]],
  [/Whale\/([\d.]+)/i, (m) => ['Whale', normVer(m[1])]],
  [/Brave/i, () => ['Brave', '']],
  [/Edg(?:e|A|iOS)?\/([\d.]+)/i, (m) => ['Edge', normVer(m[1])]],
  [/OPR\/([\d.]+)/i, (m) => ['Opera', normVer(m[1])]],
  [/OPT\/([\d.]+)/i, (m) => ['Opera Touch', normVer(m[1])]],
  [/SamsungBrowser\/([\d.]+)/i, (m) => ['三星浏览器', normVer(m[1])]],
  [/CriOS\/([\d.]+)/i, (m) => ['Chrome', normVer(m[1])]],
  [/FxiOS\/([\d.]+)/i, (m) => ['Firefox', normVer(m[1])]],
  [/Firefox\/([\d.]+)/i, (m) => ['Firefox', normVer(m[1])]],
  [/Chrome\/([\d.]+)/i, (m) => ['Chrome', normVer(m[1])]],
  [/Version\/([\d.]+).*Safari/i, (m) => ['Safari', normVer(m[1])]],
  [/Safari\/([\d.]+)/i, () => ['Safari', '']],
];

/* A model code is only renamed when the mapping is certain — and it is
   matched as a PREFIX, because Samsung ships one phone under a family
   of codes: SM-S918B / -U / -N / -0 are all one Galaxy S23 Ultra in
   different markets. Matching exactly would rename none of them.

   Scope, deliberately: this table names Samsung (whose codes are public
   and stable) and nothing else. Xiaomi, Huawei, OPPO and vivo ship
   codes we cannot map to a shop name with confidence, and a wrong name
   is worse than a code — those fall through to "brand + raw code". */
const MODEL_DB = [
  ['SM-G970', 'Galaxy S10'], ['SM-G975', 'Galaxy S10+'], ['SM-G977', 'Galaxy S10 Lite'],
  ['SM-G980', 'Galaxy S20'], ['SM-G985', 'Galaxy S20+'], ['SM-G988', 'Galaxy S20 Ultra'],
  ['SM-G781', 'Galaxy S20 FE'], ['SM-G990', 'Galaxy S21 FE'],
  ['SM-G991', 'Galaxy S21'], ['SM-G996', 'Galaxy S21+'], ['SM-G998', 'Galaxy S21 Ultra'],
  ['SM-S901', 'Galaxy S22'], ['SM-S906', 'Galaxy S22+'], ['SM-S908', 'Galaxy S22 Ultra'],
  ['SM-S911', 'Galaxy S23'], ['SM-S916', 'Galaxy S23+'], ['SM-S918', 'Galaxy S23 Ultra'],
  ['SM-S921', 'Galaxy S24'], ['SM-S926', 'Galaxy S24+'], ['SM-S928', 'Galaxy S24 Ultra'],
  ['SM-S931', 'Galaxy S25'], ['SM-S936', 'Galaxy S25+'], ['SM-S938', 'Galaxy S25 Ultra'],
  ['SM-N970', 'Galaxy Note10'], ['SM-N975', 'Galaxy Note10+'], ['SM-N976', 'Galaxy Note10+ 5G'],
  ['SM-N980', 'Galaxy Note20'], ['SM-N986', 'Galaxy Note20 Ultra'],
  ['SM-F700', 'Galaxy Z Flip'], ['SM-F707', 'Galaxy Z Flip 5G'],
  ['SM-F711', 'Galaxy Z Flip3'], ['SM-F721', 'Galaxy Z Flip4'], ['SM-F731', 'Galaxy Z Flip5'],
  ['SM-F741', 'Galaxy Z Flip6'], ['SM-F916', 'Galaxy Z Fold2'],
  ['SM-F926', 'Galaxy Z Fold3'], ['SM-F936', 'Galaxy Z Fold4'],
  ['SM-F946', 'Galaxy Z Fold5'], ['SM-F956', 'Galaxy Z Fold6'],
  ['SM-A125', 'Galaxy A12'], ['SM-A146', 'Galaxy A14'], ['SM-A155', 'Galaxy A15'],
  ['SM-A255', 'Galaxy A25'], ['SM-A346', 'Galaxy A34'], ['SM-A356', 'Galaxy A35'],
  ['SM-A505', 'Galaxy A50'], ['SM-A515', 'Galaxy A51'], ['SM-A525', 'Galaxy A52'],
  ['SM-A528', 'Galaxy A52s'], ['SM-A536', 'Galaxy A53'], ['SM-A546', 'Galaxy A54'],
  ['SM-A556', 'Galaxy A55'], ['SM-A705', 'Galaxy A70'], ['SM-A736', 'Galaxy A73'],
  ['SM-T870', 'Galaxy Tab S7'],
];

/* ---- the updatable part ----
   Everything above is the built-in floor. tools/device-db.json, when
   present, is merged IN FRONT of it, so a new handset can be named
   without touching this file — that is what keeps the parser current
   without pulling in a dependency. Shape:
     { "models": [["SM-X710", "Galaxy Tab S9"], ...],
       "brands": [["^XX", "品牌"], ...] }
   It is read once at startup, defensively: a missing or malformed
   library must never break a page load. */
const DEVICE_DB_FILE = path.join(ROOT, 'tools', 'device-db.json');
let EXTRA_MODELS = [];
let EXTRA_BRANDS = [];
try {
  if (fs.existsSync(DEVICE_DB_FILE)) {
    const db = JSON.parse(fs.readFileSync(DEVICE_DB_FILE, 'utf8'));
    if (db && Array.isArray(db.models)) {
      EXTRA_MODELS = db.models.filter((e) => Array.isArray(e) && e.length === 2
        && typeof e[0] === 'string' && typeof e[1] === 'string');
    }
    if (db && Array.isArray(db.brands)) {
      /* the file holds pattern source strings, so they become regexes
         here — one bad pattern is dropped, not fatal */
      EXTRA_BRANDS = db.brands
        .filter((e) => Array.isArray(e) && e.length === 2
          && typeof e[0] === 'string' && typeof e[1] === 'string')
        .map((e) => { try { return [new RegExp(e[0], 'i'), e[1]]; } catch (_) { return null; } })
        .filter(Boolean);
    }
  }
} catch (_) { /* unreadable library — the built-in tables carry on */ }

/* brand from a model code. Prefixes, not guesses: these are the
   manufacturers' own device-code namespaces. Order matters — the
   specific letter prefixes run before the loose numeric ones, because
   "V" alone would also swallow a carrier string while "V2" is vivo's. */
const BRAND_BY_CODE = [
  [/^Pixel/i, 'Google'],
  [/^(SM|SC|SHV|SCH|SPH|GT)-/i, '三星'],
  [/^(ELS|ALN|JEF|LIO|ANA|TAS|NOH|COL|BAL|MAR|JLN|DUA|BRA|FOA|OCE|VOG|EVR|LYA|PCT|YAL|WKG|HKD|CFE|BRM|GLA|LEM)-/i, '华为'],
  [/^(ANY|FNE|NTN|RNA|ALI|BVL|MAA|LLY|SDY|MAG|REA|CRR|HONOR)-/i, '荣耀'],
  [/^(RMX|RE5)/i, 'realme'],
  [/^(CPH|PHK|PGT|PKH|PEM|PHB|PEH|PJD|OPD|OPC)/i, 'OPPO'],
  [/^(V\d|PD\d|PD2\d|V2\d)/i, 'vivo'],
  [/^(I\d{4}|IQ(00|\d))/i, 'iQOO'],
  [/^(KB|DN|IN|AC|GM|NE|LE21)\d/i, '一加'],
  [/^(XT|moto)/i, '摩托罗拉'],
  [/^(SO-|SOG|XQ|H8|G84)/i, '索尼'],
  [/^(Nokia|TA-|HMD)/i, '诺基亚'],
  [/^(NX7|NX6|NU)/i, '努比亚'],
  [/^(M08|JNY|MRD|MOA)/i, '魅族'],
  [/^(A0\d|Nothing)/i, 'Nothing'],
  [/^(ZTE|ZA|NX5)/i, '中兴'],
  [/^(ASUS|ZenFone)/i, '华硕'],
  [/^(Lenovo|TB-|LAVI|Y70)/i, '联想'],
  /* last, because it is the loosest: Xiaomi and Redmi ship bare codes
     built as 年月 + 流水号 and ending in a letter (23127PN0CG,
     2201123G) — a shape no other maker uses. Matching \d{8} alone
     missed every one of them, which is why so many Xiaomi visits
     arrived with no brand at all. */
  [/^(M\d{4}|MI\s?\d|Redmi|POCO|\d{4}[0-9A-Z]{2,8})/i, '小米'],
];
const BRAND_BY_UA = [
  [/\biPhone\b|\biPad\b|\biPod\b/i, '苹果'], [/\bMacintosh\b/i, 'Apple'],
  [/\bSamsung\b/i, '三星'], [/\bXiaomi\b/i, '小米'], [/\bRedmi\b/i, 'Redmi'],
  [/\bPOCO\b/i, 'POCO'], [/\bHUAWEI\b/i, '华为'], [/\bHONOR\b/i, '荣耀'],
  [/\bOPPO\b/i, 'OPPO'], [/\brealme\b/i, 'realme'], [/\bvivo\b/i, 'vivo'],
  [/\biQOO\b/i, 'iQOO'], [/\bOnePlus\b/i, '一加'], [/\bNokia\b/i, '诺基亚'],
  [/\bSony\b|\bXperia\b/i, '索尼'], [/\bmoto\b|\bMotorola\b/i, '摩托罗拉'],
  [/\bLenovo\b/i, '联想'], [/\bMeizu\b/i, '魅族'], [/\bZTE\b/i, '中兴'],
  [/\bASUS\b/i, '华硕'], [/\bNothing\b/i, 'Nothing'], [/\bNubia\b/i, '努比亚'],
  [/\bRedMagic\b/i, '红魔'], [/\bBlack\s?Shark\b/i, '黑鲨'],
  [/\bTecno\b/i, 'Tecno'], [/\bInfinix\b/i, 'Infinix'], [/\bItel\b/i, 'Itel'],
  [/\bHTC\b/i, 'HTC'], [/\bLG[- ]?[A-Z]/i, 'LG'], [/\bPixel\b/i, 'Google'],
];

/** pull the Android model code out of the parenthesised block */
function androidModel(ua) {
  const open = ua.indexOf('(');
  if (open < 0) return '';
  const rest = ua.slice(open + 1);
  const close = rest.indexOf(')');
  const seg = close < 0 ? rest : rest.slice(0, close);
  const parts = seg.split(';').map((s) => s.trim()).filter(Boolean);
  const at = parts.findIndex((p) => /^Android\b/i.test(p));
  if (at < 0) return '';
  /* step past the Android version; locale / "wv" / "Mobile" tags sit
     between it and the model on Xiaomi and some WebView shells */
  for (let i = at + 1; i < parts.length; i++) {
    let p = parts[i].replace(/\s+Build\/.*$/, '').trim();
    if (!p) continue;
    if (/^([a-z]{2,3}(-[a-zA-Z]{2,6})?)$/.test(p)) continue;   /* zh-cn */
    if (/^wv$/i.test(p) || /^Mobile$/i.test(p) || /^Tablet$/i.test(p)) continue;
    if (/^Build\//i.test(p)) continue;
    /* HarmonyOS sits in this slot on Huawei phones and is an OS name,
       not a handset — without this it would be reported as the model */
    if (/^(Linux|U|Android|Windows|Macintosh|X11|iPhone|CPU|Harmony|HMSCore)/i.test(p)) continue;
    /* "SM-S918B Build/TP1A.220624.014" → "SM-S918B"; keep a two-word
       name like "Pixel 8" or "Moto G Power" intact */
    p = p.replace(/\s+Build.*$/, '');
    if (p.length < 3) continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9 ._\-]{2,30}$/.test(p)) continue;
    return p;
  }
  return '';
}

function uaInfo(ua) {
  const s = String(ua || '');
  const out = {
    device: '电脑', model: '', os: '', browser: '', app: '', bot: false,
    /* the same facts, split apart, so a row can be printed or filtered
       on one half without parsing it back out of a label. These are
       additions: every field above keeps its old meaning and shape. */
    brand: '', modelName: '', modelCode: '',
    osName: '', osVersion: '', browserName: '', browserVersion: '',
  };

  for (const [re, name] of UA_APPS) { if (re.test(s)) { out.app = name; break; } }
  out.bot = UA_BOT.test(s) && !out.app;

  /* device class — tablet before phone, because every tablet UA also
     carries "Mobile" or "Android" */
  /* SM-X is the Galaxy Tab S9/S10 family, which unlike the older
     SM-T tablets carries no "Tablet" tag of its own */
  if (/iPad|Tablet|SM-T\d|SM-X\d|Lenovo TB|MatePad|Nexus 7|Pixel C|\bTab\b|Pad\d/i.test(s)) out.device = '平板';
  else if (/Mobile|Android|iPhone|iPod|Windows Phone|HarmonyOS/i.test(s)) out.device = '手机';
  if (out.bot) out.device = '爬虫';
  if (!s) out.device = '未知';

  /* OS — first matching pattern wins; each answers {name, ver} */
  for (const [re, make] of UA_OS) {
    const m = re.exec(s);
    if (m) { const r = make(s, m); out.osName = r.name; out.osVersion = r.ver || ''; break; }
  }
  out.os = out.osVersion ? out.osName + ' ' + out.osVersion : out.osName;

  /* ---------- model ----------
     Fallback chain, most specific first:
       1. a code the model library can name   (SM-S918B → Galaxy S23 Ultra)
       2. a name the UA states outright       (Pixel 8, Moto G Power, Nokia G22)
       3. iOS: "iPhone" / "iPad" — the model is all Apple ever sends
       4. Android: the raw code, prefixed by the brand we could prove
       5. nothing provable: the brand alone, or blank
     Each step is honest about what it knows; none of them guesses. */
  let model = '', code = '';
  if (/\biPod\b/i.test(s)) model = 'iPod touch';
  else if (/\biPad\b/i.test(s)) {
    model = /iPad Pro/i.test(s) ? 'iPad Pro' : /iPad Air/i.test(s) ? 'iPad Air'
      : /iPad Mini/i.test(s) ? 'iPad mini' : 'iPad';
  } else if (/\biPhone\b/i.test(s)) model = 'iPhone';
  else if (/Android/i.test(s)) { code = androidModel(s); model = code; }
  else if (/Macintosh/i.test(s)) model = 'Mac';
  else if (/Windows/i.test(s)) model = '';

  /* brand — the manufacturer's own word in the UA beats a code prefix,
     because the word is them stating it and the prefix is us inferring */
  let brand = '';
  for (const [re, name] of BRAND_BY_UA) { if (re.test(s)) { brand = name; break; } }
  if (!brand && model) {
    for (const [re, name] of EXTRA_BRANDS.concat(BRAND_BY_CODE)) {
      if (re.test(model)) { brand = name; break; }
    }
  }

  /* rename a code only on a certain hit — external library first */
  let named = '';
  for (const [pre, name] of EXTRA_MODELS.concat(MODEL_DB)) {
    if (model && model.indexOf(pre) === 0) { named = name; break; }
  }
  if (named) {
    out.modelName = named;
    /* a named code still has to be branded. Samsung is by far the most
       common case here, but the external library can name anything, so
       the code prefix decides and 三星 is only the last resort. */
    if (!brand) {
      brand = /^(SM|SC|SHV|SCH|SPH|GT)-/i.test(model) ? '三星' : '';
    }
  } else {
    out.modelName = model;
  }
  /* a code that resolves to a name can still reveal the class: the
     tablet families are named "…Tab…" / "…Pad…" but their codes are not */
  if (/Pad\b|Tab\b|Tablet/i.test(out.modelName)) out.device = '平板';

  out.brand = brand;
  out.modelCode = code;
  /* the label joins brand + name, but never twice: a UA that already
     says "Redmi Note 11" would otherwise read "Redmi Redmi Note 11" */
  out.model = out.modelName
    ? (brand && out.modelName.indexOf(brand) !== 0 ? brand + ' ' + out.modelName : out.modelName)
    : (brand || '');

  /* browser — specific shells before the engine they borrow */
  for (const [re, make] of UA_BROWSERS) {
    const m = re.exec(s);
    if (m) { const r = make(m, s); out.browserName = r[0]; out.browserVersion = r[1] || ''; break; }
  }
  out.browser = out.browserVersion
    ? out.browserName + ' ' + out.browserVersion
    : out.browserName;
  if (!out.browser && out.app) { out.browser = out.app + '内置'; out.browserName = out.app; }
  return out;
}

/* ---------- what a screen knows that a UA does not ----------
   Apple stopped naming the handset in the UA years ago: every iPhone
   answers as plain "iPhone". But each one still reports an exact
   physical resolution, and those numbers are distinctive enough to say
   which family it belongs to.

   Honest about the limits: where two generations share one panel the
   answer names both (iPhone 15/16), because separating them would be a
   guess. And "Display Zoom" on iOS changes the logical size, which
   changes the physical product too — so a miss returns nothing at all
   rather than naming the wrong phone.

   Entries are [dpr, short side, long side, name], physical pixels. */
const APPLE_SCREENS = [
  [2, 750, 1334, 'iPhone SE / 6 / 7 / 8'],
  [3, 1080, 1920, 'iPhone 7 / 8 Plus'],
  [3, 1125, 2436, 'iPhone X / XS / 11 Pro'],
  [3, 1242, 2688, 'iPhone XS Max / 11 Pro Max'],
  [2, 828, 1792, 'iPhone XR / 11'],
  [3, 1080, 2340, 'iPhone 12 mini / 13 mini'],
  [3, 1170, 2532, 'iPhone 12 / 13 / 14'],
  [3, 1179, 2556, 'iPhone 14 Pro / 15 / 16'],
  [3, 1284, 2778, 'iPhone 12 / 13 Pro Max · 14 Plus'],
  [3, 1290, 2796, 'iPhone 15 Plus / 16 Plus · 15 / 16 Pro Max'],
  [3, 1206, 2622, 'iPhone 16 Pro / 17 / 17 Pro'],
  [3, 1320, 2868, 'iPhone 16 / 17 Pro Max'],
  [3, 1260, 2736, 'iPhone Air'],
  [2, 1488, 2266, 'iPad mini 6 / 7'],
  [2, 1536, 2048, 'iPad 9.7 英寸 / Air 1·2 / mini 2–5'],
  [2, 1620, 2160, 'iPad 7 / 8 / 9'],
  [2, 1640, 2360, 'iPad Air 4·5 / iPad 10'],
  [2, 1668, 2224, 'iPad Pro 10.5 / Air 3'],
  [2, 1668, 2388, 'iPad Pro 11 英寸'],
  [2, 1668, 2420, 'iPad Air 11 英寸 (M2/M3)'],
  [2, 2048, 2732, 'iPad Pro 12.9 英寸'],
  [2, 2064, 2752, 'iPad Air 13 / Pro 13 英寸'],
];

/* Core counts, from the chip each family ships. This table exists
   because navigator.hardwareConcurrency LIES on iOS: Safari reports 4
   on an iPhone 15 Pro Max whose A17 Pro has six cores. It is not a
   bug — it is deliberate fingerprinting resistance — but it makes the
   number useless for describing the machine, so where the family is
   known the published core count is used instead, and what the browser
   said is kept beside it.

   Only families whose members all ship the same core count are listed.
   Where they differ (iPhone SE/6/7/8 spans 2, 4 and 6 cores) there is
   no honest single number, so nothing is claimed. */
const APPLE_CORES = {
  'iPhone X / XS / 11 Pro': 6,
  'iPhone XS Max / 11 Pro Max': 6,
  'iPhone XR / 11': 6,
  'iPhone 12 mini / 13 mini': 6,
  'iPhone 12 / 13 / 14': 6,
  'iPhone 14 Pro / 15 / 16': 6,
  'iPhone 12 / 13 Pro Max · 14 Plus': 6,
  'iPhone 15 Plus / 16 Plus · 15 / 16 Pro Max': 6,
  'iPhone 16 Pro / 17 / 17 Pro': 6,
  'iPhone 16 / 17 Pro Max': 6,
  'iPhone Air': 6,
  'iPad mini 6 / 7': 6,
  'iPad Pro 10.5 / Air 3': 6,
};

/** the published core count for a family we could name, or 0 for "unknown" */
function appleCores(name) {
  return (name && APPLE_CORES[name]) || 0;
}

/** name the Apple handset from its physical panel, or say nothing */
function appleModel(sw, sh, dpr) {
  const w = Number(sw), h = Number(sh), d = Number(dpr);
  if (!w || !h || !d) return '';
  const long = Math.round(Math.max(w, h) * d);
  const short = Math.round(Math.min(w, h) * d);
  for (const [ed, es, el, name] of APPLE_SCREENS) {
    if (Math.abs(ed - d) > 0.01) continue;
    if (Math.abs(es - short) <= 2 && Math.abs(el - long) <= 2) return name;
  }
  return '';
}

/* ---------- the guest card ----------
   A UA is a statement a device makes about itself; everything below is
   a fact the browser measured, and the two disagree often enough that
   keeping them apart matters. The card is additive: every field it
   fills is new, and when the browser told us nothing the row simply
   has no card rather than a card full of guesses.

   Two of these facts beat the UA outright:
     · Chromium's Client Hints name the real Android model AND give
       Windows' real platform version, which is the only way to tell
       Windows 11 from Windows 10 (both answer "NT 10.0").
     · screen × devicePixelRatio names the iPhone/iPad.
   Anything still unknown is left blank, never invented. */
function applyFacts(row, caps) {
  if (!row || !caps || typeof caps !== 'object') return row;

  const dpr = Number(caps.dpr);
  const sw = Number(caps.sw), sh = Number(caps.sh);
  if (sw && sh && dpr) row.screen = sw + '×' + sh + ' @' + dpr + 'x';
  if (Number(caps.vw) > 0 && Number(caps.vh) > 0) row.vp = Number(caps.vw) + '×' + Number(caps.vh);
  /* two facts worth more than the panel size they come from: how many
     pixels the screen actually is, and how tall it is relative to its
     width — both exact, both just arithmetic on what was measured */
  if (sw && sh && dpr) {
    row.mp = (Math.round((sw * dpr * sh * dpr) / 1e5) / 10).toFixed(1);
    row.ratio = (Math.max(sw, sh) / Math.min(sw, sh)).toFixed(2);
  }

  if (Number(caps.hz) > 0) {
    /* A measured rate, and it stays measured. Naming a "120Hz panel"
       from a reading of 95 would be a claim the measurement does not
       support, so a standard rate is only used when the reading is
       within 8% of it; otherwise the raw number is shown. Either way
       the raw reading is kept, because it is the evidence. */
    const hz = Number(caps.hz);
    row.hzMeasured = hz;
    const STD = [30, 60, 90, 120, 144, 165];
    let near = 0;
    for (const s of STD) { if (Math.abs(hz - s) / s <= 0.08) near = s; }
    row.hz = near || hz;
  }
  if (Number(caps.depth) > 0) row.depth = Number(caps.depth);
  if (caps.gamut) row.gamut = String(caps.gamut).slice(0, 10);
  if (caps.hdr === true || caps.hdr === 'true') row.hdr = true;
  if (Number(caps.quota) > 0) row.quota = Number(caps.quota);
  if (Array.isArray(caps.feat)) {
    row.feat = caps.feat.slice(0, 8).map((x) => str(x, 16)).filter(Boolean);
  }
  if (Number(caps.fcp) > 0) row.fcp = Number(caps.fcp);

  let named = '';
  if (/iPhone|iPad|iPod/i.test(row.ua || '')) named = appleModel(sw, sh, dpr);
  else if (/\bMacintosh\b/i.test(row.ua || '')) {
    /* Safari's "Request Desktop Website" makes an iPad claim to be a
       Mac — and its UA then carries a frozen "Mac OS X 10_15_7" that is
       several systems out of date. The screen gives it away: no Mac has
       ever shipped an iPad panel, so a match there is an iPad, and the
       Safari version token is the real iPadOS version. */
    const m = appleModel(sw, sh, dpr);
    if (/^iPad/.test(m)) {
      named = m;
      row.device = '平板';
      const sv = /Version\/(\d+)[.](\d+)/.exec(row.ua || '');
      row.osName = 'iPadOS';
      row.osVersion = sv ? normVer(sv[1] + '.' + sv[2]) : '';
      row.os = row.osVersion ? 'iPadOS ' + row.osVersion : 'iPadOS';
      row.osSrc = 'screen';
    }
  }
  if (named) {
    row.modelName = named;
    row.model = '苹果 ' + named;
    row.device = /iPad/.test(named) ? '平板' : '手机';
    row.modelSrc = 'screen';
  }

  const ch = caps.ch || {};
  /* Client Hints are the device's own answer and beat the UA's, but
     a screen match already named an Apple handset and is just as good */
  if (!named && ch.model) {
    row.modelName = String(ch.model).slice(0, 40);
    row.model = (row.brand ? row.brand + ' ' : '') + row.modelName;
    row.modelSrc = 'hints';
  }
  /* Windows 10 and 11 are indistinguishable in a UA; platformVersion's
     major is ≥ 13 only on 11 */
  if (ch.platv && /^Windows/i.test(row.osName || '')) {
    const major = parseInt(String(ch.platv).split('.')[0], 10);
    if (Number.isFinite(major) && major > 0) {
      row.osName = major >= 13 ? 'Windows 11' : 'Windows 10';
      row.os = row.osName;
      row.osSrc = 'hints';
    }
  }
  if (ch.uafull && row.browserName) {
    row.browserVersion = normVer(ch.uafull);
    row.browser = row.browserVersion ? row.browserName + ' ' + row.browserVersion : row.browserName;
  }
  if (ch.arch) row.arch = String(ch.arch).slice(0, 16);
  if (ch.bit) row.bit = String(ch.bit).slice(0, 8);

  /* Cores: the browser's own number is the starting point, but iOS
     under-reports it on purpose (an A17 Pro answers 4 for its six
     cores), so where the handset has been named the published count
     replaces it — and what the browser actually said is kept alongside,
     because the gap between the two is itself the interesting fact. */
  const reported = Number(caps.cores) > 0 ? Number(caps.cores) : 0;
  const bySpec = appleCores(row.modelName || '');
  row.cores = Math.max(reported, bySpec) || 0;
  if (row.cores && reported && reported !== row.cores) {
    row.coresReported = reported;
    row.coresSrc = 'spec';
  } else if (row.cores) {
    row.coresSrc = 'measured';
  }
  /* navigator.deviceMemory is Chromium-only, rounded DOWN to a power of
     two and capped at 8 for fingerprinting resistance — so it is a
     floor, never a figure. Showing "8 GB" as though it were the amount
     would be wrong on a 32GB machine; "≥ 8 GB" is exactly right, and
     that marker is carried in memMin so the page cannot lose it. */
  if (Number(caps.mem) > 0) { row.mem = Number(caps.mem); row.memMin = true; }
  if (caps.tz) row.tz = String(caps.tz).slice(0, 48);
  if (caps.theme) row.theme = String(caps.theme).slice(0, 8);
  if (caps.motion) row.motion = String(caps.motion).slice(0, 12);
  if (caps.touch) row.touch = String(caps.touch).slice(0, 12);
  if (caps.net) row.net = String(caps.net).slice(0, 16);
  if (Number(caps.rtt) >= 0) row.rtt = Number(caps.rtt);
  if (Number(caps.down) > 0) row.down = Number(caps.down);
  if (Number(caps.visits) > 0) row.visits = Number(caps.visits);
  if (caps.first) row.first = String(caps.first).slice(0, 24);
  if (caps.sid) row.sid = String(caps.sid).slice(0, 24);
  if (Number(caps.dwell) > 0) row.dwell = Number(caps.dwell);
  if (Number(caps.scroll) >= 0) row.scroll = Number(caps.scroll);
  /* a row is written when a page opens, so the time spent on a page
     can only ride along with the page that followed it */
  if (Number(caps.lastDwell) > 0) {
    row.lastDwell = Number(caps.lastDwell);
    row.lastPage = str(caps.lastPage, 120);
    if (Number(caps.lastScroll) >= 0) row.lastScroll = Number(caps.lastScroll);
  }

  /* the visitor's own clock: an address tells you where they are, this
     tells you what time it was for them, which is the more human fact */
  if (row.tz) {
    try {
      /* formatted from parts, not from toLocaleString: the string it
         returns shifts with the build's ICU data, and a clock that
         reads differently depending on which Node is running is worse
         than no clock at all */
      const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: row.tz, hour12: false, hourCycle: 'h23',
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      }).formatToParts(new Date());
      const at = (t) => (parts.find((p) => p.type === t) || {}).value || '';
      row.local = at('month') + '-' + at('day') + ' ' + at('hour') + ':' + at('minute');
    } catch (_) { /* a timezone this build cannot resolve — leave it out */ }
  }
  return row;
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

/* Carriers answer under a dozen names — 电信, Chinanet, China Telecom,
   中国电信集团公司 — and three sources means three spellings of one
   company. The roll prints one name per carrier. Anything we do not
   recognise is kept exactly as the service gave it, never invented. */
const ISP_NAMES = [
  [/电信|chinanet|telecom/i, '中国电信'],
  [/联通|unicom/i, '中国联通'],
  [/移动|cmcc|mobile/i, '中国移动'],
  [/铁通|railtel/i, '中国铁通'],
  [/教育网|cernet/i, '中国教育网'],
  [/科技网|cstnet/i, '中国科技网'],
  [/广电|broadnet/i, '中国广电'],
  [/长城宽带|greatwall/i, '长城宽带'],
  [/阿里云|aliyun|alibaba/i, '阿里云'],
  [/腾讯云|tencent/i, '腾讯云'],
];
function normIsp(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  for (const [re, name] of ISP_NAMES) { if (re.test(s)) return name; }
  return str(s, 40);
}

/* The same country arrives as "CN", "China" and "中国" depending on the
   source and the ?lang flag. One spelling each — and Hong Kong, Macao
   and Taiwan are always written as parts of China. */
const COUNTRY_NAMES = [
  [/^(CN|China|中国)$/i, '中国'],
  [/^(US|USA|United States|美国)$/i, '美国'],
  [/^(JP|Japan|日本)$/i, '日本'],
  [/^(KR|Korea|South Korea|韩国)$/i, '韩国'],
  [/^(GB|UK|United Kingdom|英国)$/i, '英国'],
  [/^(HK|Hong Kong|香港)$/i, '中国香港'],
  [/^(MO|Macau|Macao|澳门)$/i, '中国澳门'],
  [/^(TW|Taiwan|台湾)$/i, '中国台湾'],
];
function normCountry(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  for (const [re, name] of COUNTRY_NAMES) { if (re.test(s)) return name; }
  return str(s, 40);
}

/* ---- a lookup cache that outlives the process ----
   Three services, all rate-limited, all queried for the same addresses
   over and over: the roll asked hundreds of times a minute, and every
   uncached row meant up to three network calls before the page could
   draw. Keeping the answers in memory only meant the whole roll went
   cold each time the site restarted, and the oldest rows — the ones
   you most want located — were re-queried forever.

   So the cache is a file. A good answer is trusted for 30 days, a
   failure for six hours (long enough to ride out a quota, short
   enough that a later retry can still succeed). */
const GEO_FILE = path.join(DATA_DIR, 'geo-cache.json');
const GEO_TTL_OK = 30 * 24 * 3600 * 1000;
const GEO_TTL_FAIL = 6 * 3600 * 1000;
const GEO_MAX = 8000;
let GEO_TIMER = null;

function flushGeo() {
  if (GEO_TIMER) { clearTimeout(GEO_TIMER); GEO_TIMER = null; }
  const out = {};
  GEO.forEach((v, k) => { out[k] = v; });
  try { writeJson(GEO_FILE, out); } catch (_) { /* read-only disk */ }
}

(function loadGeo() {
  try {
    const raw = readJson(GEO_FILE, {});
    if (raw && typeof raw === 'object') {
      Object.keys(raw).forEach((ip) => {
        const e = raw[ip];
        if (e && typeof e === 'object' && e.data) GEO.set(ip, e);
      });
    }
  } catch (_) { /* first run — nothing cached yet */ }
})();

/** the cached answer for an address, or null when it must be asked for */
function geoCached(ip) {
  const hit = GEO.get(ip);
  if (!hit || !hit.data) return null;
  const ttl = hit.ok ? GEO_TTL_OK : GEO_TTL_FAIL;
  return Date.now() - (hit.at || 0) < ttl ? hit.data : null;
}

function markGeo(ip, g, ok) {
  if (GEO.size > GEO_MAX) {
    /* drop the half that was answered longest ago — a roll that has
       run for months must not grow without bound */
    const old = [...GEO.entries()].sort((a, b) => (a[1].at || 0) - (b[1].at || 0));
    old.slice(0, Math.floor(old.length / 2)).forEach((e) => GEO.delete(e[0]));
  }
  GEO.set(ip, { at: Date.now(), ok: !!ok, data: g });
  if (GEO_TIMER) return;
  GEO_TIMER = setTimeout(() => { GEO_TIMER = null; flushGeo(); }, 1500);
}

function clearGeo() { GEO.clear(); flushGeo(); }

async function geoLookup(ip) {
  const held = geoCached(ip);
  if (held) return held;
  /* A private address has no place to find: this machine, or one on the
     same network. Saying so beats spending three services on it — and
     beats letting a source answer "IANA保留地址" for it. */
  if (isPrivateIp(ip)) {
    const lan = { country: '局域网', region: '', city: '', district: '', isp: '', lat: null, lon: null };
    markGeo(ip, lan, true);
    return lan;
  }
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
        /* pconline ends its addr with the carrier when there is no
           district to give — "广东省深圳市 联通". That tail is an ISP,
           not a place, so it belongs in the ISP field and never in the
           district, which is why NOT_A_DISTRICT rejects it above. */
        if (!g.isp && tail && /电信|联通|移动|铁通|教育网|科技网|广电|宽带/.test(tail)) {
          g.isp = normIsp(tail);
        }
        if (!g.region && j.pro) g.region = str(String(j.pro).replace(/[省市自治区]+$/, ''), 60);
        if (!g.city && j.city) g.city = str(j.city, 60);
        if (!g.country && (j.pro || j.city)) g.country = '中国';
      }
    } catch (_) { /* non-Chinese addresses simply 503 here — harmless */ }
  }

  /* an answer with no city and no country is not an answer — remember
     it briefly so a rate-limited service is not hammered, but let a
     later pass try again. Anything real is trusted for a month. */
  markGeo(ip, g, !!(g.city || g.district || g.country));
  /* Last line of defence. No source may put a carrier name, a registry
     note, or an empty-ish string in front of a visitor as their 区.
     A Chinese district ends in one of the suffixes below. Anything
     else is dropped — deliberately including half-translated notes
     like "IANA保留地址" and bare English fragments, because a wrong
     district is worse than a missing one. */
  if (g.district && !PLAUSIBLE_PLACE.test(g.district)) g.district = '';
  /* three sources, three spellings — normalise on the way out so the
     roll never shows two names for one carrier or one country */
  if (g.isp) g.isp = normIsp(g.isp);
  if (g.country) g.country = normCountry(g.country);
  return g;
}

/* ---------- the background locator ----------
   The place is the only field that needs the network, so it is the
   only one allowed to lag. A row is written the instant the page is
   served — with the address, the device and the path known for
   certain — and its place is filled in afterwards by this queue,
   five addresses at a time, with a quarter second between batches so
   the free services are not hammered.

   So a lookup that is slow, rate-limited or offline costs the roll a
   missing 区. It never costs it a visitor, and it never makes a page
   wait. Anything that fails stays queued and is retried. */
const geoQueue = [];
let geoBusy = false;

/** write a resolved place onto every local row holding this address */
function applyGeo(ip, g) {
  const list = loadVisits();
  let touched = false;
  list.forEach((row) => {
    if (row.ip !== ip) return;
    row.country = g.country; row.region = g.region; row.city = g.city;
    row.district = g.district; row.isp = g.isp;
    row.lat = g.lat; row.lon = g.lon;
    touched = true;
  });
  if (touched) saveVisits(list);
}

async function drainGeo() {
  if (geoBusy) return;
  geoBusy = true;
  try {
    while (geoQueue.length) {
      const batch = geoQueue.splice(0, 5);
      await Promise.all(batch.map(async (ip) => {
        try { applyGeo(ip, await geoLookup(ip)); } catch (_) { /* keep the rest */ }
      }));
      if (geoQueue.length) await new Promise((r) => setTimeout(r, 250));
    }
    flushGeo();
  } finally { geoBusy = false; }
}

function queueGeo(ip) {
  if (!ip || isPrivateIp(ip) || geoCached(ip) || geoQueue.includes(ip)) return;
  geoQueue.push(ip);
  drainGeo();                     /* starts itself; a no-op while running */
}
/* the retry clock is started by listen(), not at load time: a module
   that merely requires this file for its parser must not inherit a
   timer that keeps the event loop alive */
let GEO_CLOCK = null;
function startGeoClock() {
  if (GEO_CLOCK) return;
  GEO_CLOCK = setInterval(() => { if (geoQueue.length) drainGeo(); }, 5000);
}

/* a new 高德 key, or no key at all: every resolved place is now
   suspect, so drop the cache, blank the rows, and ask again */
function regeoAll() {
  clearGeo();
  const list = loadVisits();
  list.forEach((row) => {
    row.country = ''; row.region = ''; row.city = ''; row.district = '';
    row.isp = ''; row.lat = null; row.lon = null;
    if (!isPrivateIp(row.ip)) queueGeo(row.ip);
  });
  saveVisits(list);
}

function recordVisit(req, page) {
  const ip = clientIp(req);
  /* Not a visitor: this machine, or a machine on the same network.
     The owner asked for these to be skipped outright, so they are —
     no row, and no place lookup spent on them either. */
  if (isPrivateIp(ip)) return;

  const ua = str(req.headers['user-agent'] || '', 400);
  const info = uaInfo(ua);
  const now = Date.now();
  const iso = new Date(now).toISOString();
  const seq = ++VISIT_SEQ;

  const row = {
    /* the counter, not Math.random: ten requests inside the same
       millisecond must still get ten different ids */
    id: 'v' + now.toString(36) + '-' + seq.toString(36),
    /* stampOf, not iso.slice(): `at` is UTC and always will be, but the
       page has to show one clock. This used to write the UTC wall clock
       into `time` while cloud rows rendered local time, so the same
       roll mixed two timezones and two rows minutes apart could be
       eight hours apart. `at` stays canonical; `time` is display. */
    ip, at: iso, last: iso, time: stampOf(iso),
    page: page || '', pages: page ? [page] : [],
    ua, device: info.device, model: info.model, os: info.os,
    browser: info.browser, app: info.app, bot: info.bot,
    /* the structured halves of the same facts, kept alongside the
       labels: a roll can be sorted or filtered on a brand or an OS
       without parsing a string back apart. Old readers only ever look
       at the six fields above, so this adds without breaking. */
    brand: info.brand, modelName: info.modelName, modelCode: info.modelCode,
    osName: info.osName, osVersion: info.osVersion,
    browserName: info.browserName, browserVersion: info.browserVersion,
    /* where the link came from, and what language the browser asked
       for — the two things that turn an address into a story */
    ref: str(req.headers.referer || '', 200),
    lang: str(String(req.headers['accept-language'] || '').split(',')[0] || '', 24),
    country: '', region: '', city: '', district: '', isp: '',
    lat: null, lon: null,
    lan: false,
    count: 1,                     /* kept for the shape: one row, one visit */
    src: 'local',                 /* filled again below — see mergedVisits */
  };

  const list = loadVisits();
  list.unshift(row);
  if (list.length > VISIT_MAX) list.length = VISIT_MAX;
  saveVisits(list);
  queueGeo(ip);
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
  /* 2.5s, not 15s: the page polls for changes, and a quarter-minute
     of staleness is long enough to make a live log look broken. The
     cache exists so one repaint cannot hammer the table, not to save
     traffic — and never on the write path, where nothing is cached. */
  if (Date.now() - cloudCache.at < 2500) return cloudCache;
  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 5000);
    /* every row that is in the table, not a token sample of it */
    const r = await fetch(`${SB_CFG.url}/rest/v1/visits?select=*&order=ts.desc&limit=1000`,
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
  const local = loadVisits().map((v) => {
    const info = v.device ? null : uaInfo(v.ua);   /* rows written before the parser */
    return {
      /* re-stamped from `at`, not from `time`: rows written before the
         timezone fix carry a UTC wall clock in `time`, and the roll is
         read far more often than it is written. `at` is the canonical
         field, so anything derived for display is derived from it here
         rather than trusted from disk. */
      ...v, time: stampOf(v.at || v.time) || String(v.time || ''), src: 'local', place: placeOf(v), latlon: latlonOf(v),
      device: v.device || (info && info.device) || '',
      model: v.model || (info && info.model) || '',
      os: v.os || (info && info.os) || '',
      browser: v.browser || (info && info.browser) || '',
      app: v.app || (info && info.app) || '',
      bot: !!v.bot,
    };
  });

  const cloud = await fetchCloudVisits();
  /* rows the owner dismissed from this page. They are still in the cloud
     table — they are simply not shown. Filtering *before* anything else
     also keeps their addresses out of the lookup queue entirely. */
  const dismissed = new Set(loadHidden());
  const rows = cloud.rows.filter((c) => !dismissed.has('c' + c.id));

  /* Every row, and no lookup inside the response. A place is taken
     from the cache when it is there; when it is not, the address is
     queued and the row is drawn blank, then filled in on a later
     poll. This is what lets the page refresh every few seconds even
     with a thousand registrations sitting in the table: an uncached
     row costs nothing to draw. */
  const out = rows.map((c) => {
    const ip = String(c.ip || '');
    const info = uaInfo(c.ua || '');
    const row = {
      id: 'c' + c.id, ip, src: 'cloud', time: stampOf(c.ts), at: c.ts, last: c.ts,
      page: c.page || '', pages: [], ua: c.ua || '', count: 1,
      device: info.device, model: info.model, os: info.os,
      browser: info.browser, app: info.app, bot: info.bot,
      ref: '', lang: '',
      country: '', region: '', city: '', district: '', isp: '', lat: null, lon: null,
      /* a registration can arrive with no address at all — the beacon
         writes one rather than lose the visit when every lookup service
         is down. That is not a local address, so it must not be flagged
         as one and filtered out of view. */
      lan: !!ip && isPrivateIp(ip),
    };
    applyFacts(row, c.caps);
    if (!row.lan) {
      const g = geoCached(ip);
      if (g) {
        row.country = g.country; row.region = g.region; row.city = g.city;
        row.district = g.district; row.isp = g.isp; row.lat = g.lat; row.lon = g.lon;
      } else {
        queueGeo(ip);               /* blank for now, located on the next pass */
      }
      /* the phone told us its own coordinates on the way in — keep them
         if no lookup service was reachable from this machine */
      if (!Number.isFinite(row.lat) && Number.isFinite(Number(c.lat))) {
        row.lat = Number(c.lat); row.lon = Number(c.lon);
      }
    }
    row.place = placeOf(row);
    row.latlon = latlonOf(row);
    return row;
  });

  /* One session id is worth more than the rows that carry it: rows
     sharing one belong to a single visit, so together they can say how
     many pages were opened and how long the visit lasted. The duration
     is a floor, not a total — it spans the first page load to the
     last, and a visitor who read the last page for ten minutes still
     shows the time up to that load. Better an honest "at least" than
     a number invented from a guess about when they left. */
  const sess = new Map();
  out.forEach((r) => {
    if (!r.sid) return;
    const s = sess.get(r.sid) || { n: 0, first: r.at, last: r.at, pages: [] };
    s.n++;
    if (String(r.at) < String(s.first)) s.first = r.at;
    if (String(r.at) > String(s.last)) s.last = r.at;
    if (r.page && s.pages.indexOf(r.page) < 0) s.pages.push(r.page);
    sess.set(r.sid, s);
  });
  out.forEach((r) => {
    const s = sess.get(r.sid);
    if (!s || s.n < 1) return;
    r.sessN = s.n;
    r.sessPages = s.pages.slice(0, 12);
    /* the newest row of a session is the one worth reading it on */
    r.sessMs = String(r.at) === String(s.last)
      ? Math.max(0, Date.parse(s.last) - Date.parse(s.first)) : 0;
  });

  const all = local.concat(out);
  all.sort((a, b) => String(b.last || b.at || '').localeCompare(String(a.last || a.at || '')));
  return all;
}

/** is the cloud half healthy, and why not if it isn't */
async function cloudStatus() {
  const c = await fetchCloudVisits();
  const local = loadVisits();
  const cut = Date.now() - 24 * 3600 * 1000;
  return {
    cloud: c.state, rows: c.rows.length,
    /* the numbers the page's header bar reads */
    local: local.length,
    bots: local.filter((v) => v.bot).length,
    today: local.filter((v) => Date.parse(v.at) > cut).length,
    queue: geoQueue.length,
    cached: GEO.size,
    hidden: loadHidden().length,
  };
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
        /* the homepage portrait has its own field now, so a visitor-gate
           upload can never repaint the homepage — and neither can this
           form change the door. */
        homeAvatar: current.homeAvatar,
      };
      if (body.avatarFile) {
        const src = saveDataUrl(body.avatarFile, 'avatar');
        if (src) { next.avatar = src; next.homeAvatar = src; }
      } else if (body.avatar) {
        next.avatar = str(body.avatar, 300);
      }
      saveProfile(next);
      return send(res, 200, { ok: true, profile: next });
    } catch (e) {
      return send(res, e.message === 'payload too large' ? 413 : 400, { error: e.message });
    }
  }

  /* ================= Visitor Gate (page lock) =================
     A soft, client-checked door in front of visits.html. The password
     is kept ONLY here (server-side, outside docs/), is never written to
     the page or to any browser-readable static file, and is compared on
     the server: the browser sends the typed password, the server answers
     ok/fail. It is "soft" by nature (the page is local-only and never
     published), not a cryptographic control — the real confidentiality
     is that visits.html itself is never pushed. */
  function loadGate() {
    try { return JSON.parse(fs.readFileSync(GATE_FILE, 'utf8')); }
    catch (_) { return { password: 'koyome' }; }
  }
  function saveGate(g) {
    try { fs.writeFileSync(GATE_FILE, JSON.stringify(g, null, 2)); } catch (_) { /* read-only disk */ }
  }

  if (url.pathname === '/api/gate' && req.method === 'GET') {
    const g = loadGate();
    const prof = loadProfile();
    res.writeHead(200, { 'Content-Type': MIME['.json'], 'Access-Control-Allow-Origin': '*' });
    return res.end(JSON.stringify({
      ok: true,
      /* "locked" is true whenever a password is set — the page then
         shows the gate. An empty password means the gate is off. */
      locked: !!(g.password && g.password.length),
      welcome: Array.isArray(g.welcome) && g.welcome.length ? g.welcome : null,
      /* the door's OWN portrait if the owner uploaded one, else fall
         back to the site portrait. These must stay separate fields:
         profile.json is the homepage's face, and writing the door over
         it once changed the whole site. */
      avatar: g.avatar || (prof && prof.avatar) || 'assets/avatar.jpg',
      name: (prof && prof.name) || 'Koyome',
    }));
  }

  if (url.pathname === '/api/gate/verify' && req.method === 'POST') {
    try {
      const body = JSON.parse((await readBody(req, 4096)).toString('utf8'));
      const g = loadGate();
      const ok = typeof body.password === 'string' && body.password === g.password;
      return send(res, ok ? 200 : 401, { ok: ok });
    } catch (e) {
      return send(res, 400, { ok: false });
    }
  }

  if (url.pathname === '/api/gate' && req.method === 'PUT') {
    try {
      /* BODY_LIMIT, not 16KB: this call also carries an uploaded
         portrait (a base64 dataURL) whenever the owner changes the
         face on the door. */
      const body = JSON.parse((await readBody(req, BODY_LIMIT)).toString('utf8'));
      const g = loadGate();
      if (body.password !== undefined) g.password = str(body.password == null ? '' : body.password, 80);
      if (body.welcome !== undefined) {
        g.welcome = Array.isArray(body.welcome)
          ? body.welcome.slice(0, 40).map(function (x) { return str(x, 120); })
          : (body.welcome ? str(body.welcome, 4000) : null);
      }
      /* the face on the door is the gate's own field (server-gate.json),
         NOT profile.json — profile.json is the homepage portrait, and
         overwriting it from here changed the whole site. Uploading
         (avatarFile) sets it; sending avatar:'' clears it back to the
         site portrait. */
      let avatar = null;
      if (body.avatarFile) {
        const src = saveDataUrl(body.avatarFile, 'gate-avatar');
        if (src) { g.avatar = src; avatar = src; }
      } else if (body.avatar === '') {
        g.avatar = '';
        avatar = '';
      }
      saveGate(g);
      return send(res, 200, {
        ok: true,
        locked: !!(g.password && g.password.length),
        avatar: avatar,
      });
    } catch (e) {
      return send(res, e.message === 'payload too large' ? 413 : 400, { ok: false, error: e.message });
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
    st.build = BUILD;
    return send(res, 200, st);
  }

  /* Remove visits from this page — one row, several, or everything.
     Accepts:
       ?id=<id>      one row (repeatable: ?id=a&id=b)
       ?ids=a,b,c    the same, comma-separated
       ?all=1        everything on this machine

     Two different acts behind one button, because the two halves of the
     roll are two different things:

       local rows (id "v…")  live in docs/data/visits.json — deleting
                              really deletes them.
       cloud rows (id "c42") live in Supabase, where other people's
                              phones write them. Deleting there would
                              erase a record of somebody else's visit,
                              so instead the id goes into
                              docs/data/visits-hidden.json and the roll
                              stops showing it. The cloud row is left
                              exactly as it was.

     `?restore=1` takes the cloud ids back off the dismissed list, so a
     mistaken dismissal is always one click from being undone.
     Nothing about this ever writes to the cloud table. */
  if (url.pathname === '/api/visits' && req.method === 'DELETE') {
    const ids = new Set([
      ...url.searchParams.getAll('id'),
      ...(url.searchParams.get('ids') || '').split(','),
    ].map((s) => String(s || '').trim()).filter(Boolean));
    const all = url.searchParams.get('all') === '1' || ids.size === 0;
    const restore = url.searchParams.get('restore') === '1';

    /* ---------- cloud rows: dismissed here, untouched there ---------- */
    const cloudIds = [...ids].filter((i) => /^c\d+$/.test(i));
    let hidden = loadHidden();
    if (cloudIds.length) {
      const next = new Set(hidden);
      cloudIds.forEach((i) => (restore ? next.delete(i) : next.add(i)));
      hidden = [...next];
      saveHidden(hidden);
    } else if (all && !restore) {
      /* "remove everything" should also clear the view of cloud rows */
      const c = await fetchCloudVisits();
      const next = new Set(hidden);
      c.rows.forEach((r) => next.add('c' + r.id));
      hidden = [...next];
      saveHidden(hidden);
    }

    /* ---------- local rows: actually deleted ---------- */
    const before = loadVisits();
    const kept = all && !restore ? [] : before.filter((it) => !ids.has(it.id));
    const deleted = before.length - kept.length;
    if (deleted) { saveVisits(kept); flushVisits(); }   /* deleting must be durable now */

    return send(res, 200, {
      ok: true, deleted, hidden: cloudIds.length, all, restore,
    });
  }

  /* bring every dismissed cloud row back */
  if (url.pathname === '/api/visits/restore' && req.method === 'POST') {
    saveHidden([]);
    return send(res, 200, { ok: true });
  }

  /* how many cloud rows are currently dismissed */
  /* ---------- the guest card arrives after its row ----------
     A page cannot know its own row id at load time, so the browser
     measures itself and posts the measurements back afterwards; the
     newest row from the same address and agent is the one it belongs
     to. Nothing here is required — a browser that posts nothing simply
     leaves the row as the UA alone described it. */
  if (url.pathname === '/api/visit/caps' && req.method === 'POST') {
    let body = {};
    try { body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8')) || {}; }
    catch (_) { body = {}; }
    const ip = clientIp(req);
    const ua = str(req.headers['user-agent'] || '', 400);
    const list = loadVisits();
    const now = Date.now();
    let hit = null;
    for (const r of list) {                      /* newest first */
      if (r.ip !== ip || r.ua !== ua) continue;
      const at = Date.parse(r.at || '');
      if (!Number.isFinite(at) || now - at > 10 * 60 * 1000) continue;
      hit = r; break;
    }
    if (hit) { applyFacts(hit, body); saveVisits(list); }
    return send(res, 200, { ok: !!hit });
  }

  if (url.pathname === '/api/visits/hidden' && req.method === 'GET') {
    return send(res, 200, loadHidden());
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
      AMAP_KEY = ''; regeoAll();
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
    /* every place already on the roll was resolved without this key,
       so drop the cache, blank the rows, and let the queue re-ask */
    regeoAll();
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

/* Run as a program it serves. Required as a module it must stay quiet —
   tools/probe-ua.js pulls it in to exercise the UA parser, and opening
   a port on the way would collide with the real site. So the socket is
   only opened when this file is the entry point. */
if (require.main === module) {
  startGeoClock();
  listen(PORT, false);
}

module.exports = {
  uaInfo, normIsp, normCountry, normVer, isPrivateIp, appleModel, appleCores,
  applyFacts,
};
