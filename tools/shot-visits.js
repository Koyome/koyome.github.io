/* ============================================================
   shot-visits.js — screenshot the visit log so it can be looked at.

   A neon treatment that passes every geometry assertion can still
   look like a toy, so this renders it with a roll that reads like a
   real one: phones and tablets and desktops, a couple of crawlers,
   places resolved down to 区, and one address from this machine's
   own network sitting behind its filter.

   It runs against a sandbox copy (never the owner's real roll) and
   writes into tools/_shots-visits/.

   Run: node tools/shot-visits.js
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SANDBOX = fs.mkdtempSync(path.join(os.tmpdir(), 'koyome-vshot-'));
const OUT = path.join(__dirname, '_shots-visits');
const PORT = 8972;
const CDP = 9351;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function copyTree(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const name of fs.readdirSync(from)) {
    const src = path.join(from, name), dst = path.join(to, name);
    const st = fs.statSync(src);
    if (st.isDirectory()) copyTree(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

const SB_DOCS = path.join(SANDBOX, 'docs');
fs.mkdirSync(SB_DOCS, { recursive: true });
for (const f of ['index.html', 'visits.html']) {
  fs.copyFileSync(path.join(ROOT, 'docs', f), path.join(SB_DOCS, f));
}
for (const d of ['css', 'js', 'data', 'components']) {
  copyTree(path.join(ROOT, 'docs', d), path.join(SB_DOCS, d));
}
/* the login gate wears the owner's portrait. Without the real avatar
   bytes in the sandbox the shot shows an empty ring, so copy just the
   avatar files (the full assets/ tree is tens of MB of gallery images
   the console never draws). */
const SB_ASSETS = path.join(SB_DOCS, 'assets');
fs.mkdirSync(SB_ASSETS, { recursive: true });
for (const f of ['avatar.jpg', 'avatar_cutout.webp', 'avatar_cutout_dark.webp']) {
  const src = path.join(ROOT, 'docs', 'assets', f);
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(SB_ASSETS, f));
}

/* ---------- a roll that looks like one ---------- */
const UA_IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const UA_IPAD = 'Mozilla/5.0 (iPad; CPU OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';
const UA_SAMSUNG = 'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.0.0 Mobile Safari/537.36';
const UA_XIAOMI = 'Mozilla/5.0 (Linux; U; Android 13; zh-cn; M2102K1C Build/TKQ1.221114.001) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.0.0 Mobile Safari/537.36';
const UA_HUAWEI = 'Mozilla/5.0 (Linux; Android 12; ELS-AN00; HMSCore 6.11.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.88 HuaweiBrowser/13.0.5.303 Mobile Safari/537.36';
const UA_WECHAT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.41(0x18002928) NetType/WIFI Language/zh_CN';
const UA_WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const UA_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
const UA_EDGE = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0';
const UA_BOT = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const UA_BOT2 = 'Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)';

function row(n, o) {
  const at = new Date(Date.now() - n * 7 * 60000).toISOString();
  const p = (x) => String(x).padStart(2, '0');
  const d = new Date(at);
  const stamp = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  return Object.assign({
    id: 'vshot' + p(n), at, last: at, time: stamp,
    pages: [o.page], count: 1, lan: false, bot: false, ref: '', lang: 'zh-CN',
  }, o);
}

/* A row carrying a full guest card, so the shots show what the card
   looks like when a browser has actually answered: the iPhone named
   from its panel, its own timezone, how far down the last page was
   read, and how many times it has been here. */
const CARD = {
  screen: '393×852 @3x', vp: '393×659', cores: 6, mem: 8, tz: 'Asia/Shanghai',
  local: '10-09 04:12', theme: 'dark', motion: 'no', touch: 'touch',
  net: '4g', rtt: 50, down: 9.2, visits: 7, first: Date.now() - 38 * 86400000,
  sessN: 3, sessMs: 262000, lastDwell: 74000, lastPage: '/index.html', lastScroll: 62,
};
const SEED = [
  row(0, Object.assign({ ip: '223.104.3.7', page: '/index.html', ua: UA_IPHONE,
    country: '中国', region: '广东省', city: '深圳市', district: '南山区',
    isp: '中国移动', lat: 22.5402, lon: 113.9463, ref: 'https://koyome.github.io/',
    model: '苹果 iPhone 14 Pro / 15 / 16', modelSrc: 'screen' }, CARD)),
  row(1, { ip: '223.104.3.88', page: '/index.html', ua: UA_SAMSUNG,
    country: '中国', region: '广东省', city: '深圳市', district: '南山区',
    isp: '中国移动', lat: 22.5402, lon: 113.9463, ref: 'https://www.google.com/' }),
  row(2, { ip: '117.136.40.19', page: '/catalog.html', ua: UA_IPHONE,
    country: '中国', region: '浙江省', city: '杭州市', district: '西湖区',
    isp: '中国电信', lat: 30.2594, lon: 120.1301, ref: 'https://koyome.github.io/' }),
  row(3, { ip: '101.86.102.44', page: '/hobbies.html', ua: UA_WECHAT,
    country: '中国', region: '上海市', city: '上海市', district: '徐汇区',
    isp: '中国联通', lat: 31.1882, lon: 121.4365, ref: 'https://mp.weixin.qq.com/' }),
  row(4, { ip: '36.110.233.6', page: '/index.html', ua: UA_XIAOMI,
    country: '中国', region: '北京市', city: '北京市', district: '海淀区',
    isp: '中国联通', lat: 39.9593, lon: 116.298 }),
  row(5, { ip: '113.66.8.201', page: '/guestbook.html', ua: UA_WIN,
    country: '中国', region: '广东省', city: '广州市', district: '天河区',
    isp: '中国电信', lat: 23.1247, lon: 113.3611, ref: 'https://www.bing.com/' }),
  row(6, { ip: '27.115.124.9', page: '/index.html', ua: UA_IPAD,
    country: '日本', region: 'Tokyo', city: 'Tokyo', district: '',
    isp: 'KDDI', lat: 35.6895, lon: 139.6917, lang: 'ja-JP' }),
  row(7, { ip: '203.0.113.77', page: '/catalog.html', ua: UA_HUAWEI,
    country: '中国', region: '四川省', city: '成都市', district: '武侯区',
    isp: '中国移动', lat: 30.6415, lon: 104.0435 }),
  row(8, { ip: '99.245.18.6', page: '/index.html', ua: UA_MAC,
    country: '加拿大', region: 'Ontario', city: 'Toronto', district: '',
    isp: 'Bell Canada', lat: 43.6532, lon: -79.3832, lang: 'en-CA' }),
  row(9, { ip: '80.187.102.4', page: '/hobbies.html', ua: UA_EDGE,
    country: '德国', region: 'Bayern', city: 'München', district: '',
    isp: 'Deutsche Telekom', lat: 48.1351, lon: 11.582, lang: 'de-DE' }),
  row(10, { ip: '66.249.66.1', page: '/index.html', ua: UA_BOT, bot: true,
    country: '美国', region: 'California', city: 'Mountain View', district: '',
    isp: 'Googlebot', lat: 37.4056, lon: -122.0775 }),
  row(11, { ip: '157.55.39.41', page: '/catalog.html', ua: UA_BOT2, bot: true,
    country: '美国', region: 'Washington', city: 'Redmond', district: '',
    isp: 'Bingbot', lat: 47.674, lon: -122.1215 }),
  row(12, { ip: '192.168.1.23', page: '/visits.html', ua: UA_WIN, lan: true,
    country: '', region: '', city: '', district: '', isp: '', lat: null, lon: null }),
];
fs.writeFileSync(path.join(SB_DOCS, 'data', 'visits.json'), JSON.stringify(SEED, null, 2));
fs.copyFileSync(path.join(ROOT, 'server.js'), path.join(SANDBOX, 'server.js'));

let mid = 0;
function send(ws, method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++mid;
    const onMsg = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id === id) {
        ws.removeEventListener('message', onMsg);
        m.error ? reject(new Error(method + ': ' + m.error.message)) : resolve(m.result);
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });
}
function evalJs(ws, sessionId, expr) {
  return send(ws, 'Runtime.evaluate',
    { expression: expr, returnByValue: true, awaitPromise: true }, sessionId)
    .then((r) => (r.result && r.result.value));
}

const EDGE = 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: SANDBOX, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
  });
  for (let i = 0; i < 40; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/api/visits`, { cache: 'no-store' }); break; }
    catch (_) { await sleep(250); }
  }

  const edge = spawn(EDGE, ['--headless=new', `--remote-debugging-port=${CDP}`,
    '--no-first-run', '--disable-extensions', 'about:blank'], { stdio: 'ignore' });

  try {
    let wsUrl;
    for (let i = 0; i < 40; i++) {
      try { wsUrl = (await (await fetch(`http://127.0.0.1:${CDP}/json/version`)).json()).webSocketDebuggerUrl; break; }
      catch (_) { await sleep(300); }
    }
    const ws = new WebSocket(wsUrl);
    await new Promise((r) => (ws.onopen = r));

    const { targetId } = await send(ws, 'Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send(ws, 'Target.attachToTarget', { targetId, flatten: true });
    await send(ws, 'Page.enable', {}, sessionId);
    await send(ws, 'Network.setCacheDisabled', { cacheDisabled: true }, sessionId);

    /* The first one is taken mid-boot: the splash runs for about 1.3s
       and then deletes itself, so that shot navigates and grabs the
       screen instead of waiting for the roll to settle. */
    const shots = [
      { name: '1-boot-splash', w: 1440, h: 900, theme: 'dark', early: 850 },
      { name: '2-desktop', w: 1440, h: 1280, theme: 'dark' },
      /* the two fields worth looking at: the storm throws pulses and
         tilts the whole screen, the trace has every column spelling
         something out of the roll */
      { name: '3-desktop-storm', w: 1440, h: 1280, theme: 'dark', rain: 'STORM' },
      { name: '4-desktop-trace', w: 1440, h: 1280, theme: 'dark', rain: 'TRACE' },
      { name: '5-desktop-override-and-panels', w: 1440, h: 1450, theme: 'dark', over: true, panels: true },
      { name: '6-desktop-everything-shown', w: 1440, h: 1400, theme: 'dark', both: true },
      { name: '7-terminal', w: 1440, h: 1600, theme: 'dark', term: true },
      { name: '8-phone', w: 390, h: 1200, theme: 'dark', mobile: true },
    ];

    for (const s of shots) {
      await send(ws, 'Emulation.setDeviceMetricsOverride',
        { width: s.w, height: s.h, deviceScaleFactor: 2, mobile: !!s.mobile }, sessionId);
      await send(ws, 'Page.navigate', { url: `http://127.0.0.1:${PORT}/visits.html` }, sessionId);

      if (s.early) {
        await sleep(s.early);
      } else {
        await sleep(1200);
        await evalJs(ws, sessionId,
          `try{localStorage.setItem('koyome_theme',${JSON.stringify(s.theme)});
               localStorage.setItem('koyome_lang','zhcn');}catch(_){}`);
        await send(ws, 'Page.reload', {}, sessionId);
        await sleep(4200);
        /* the visitor log now opens behind the cute login gate. The gate
           is shown (s.early, shot 1) so we can capture it, but every other
           shot wants the console, so we neutralize the gate here: drop the
           blur lock and hide the panel the same way visits.js does on unlock. */
        if (!s.early) {
          await evalJs(ws, sessionId,
            `(function(){ document.body.classList.remove('is-locked');
               var l=document.getElementById('vsLogin'); if(l) l.classList.remove('is-on');
               var w=document.getElementById('vsWelcome'); if(w){ w.classList.remove('is-on'); w.hidden=true; }
               return 1; })()`);
        }
        if (s.over) {
          await evalJs(ws, sessionId, `(function(){
            ['ArrowUp','ArrowUp','ArrowDown','ArrowDown','ArrowLeft','ArrowRight','ArrowLeft','ArrowRight','b','a']
              .forEach(function(k){ document.dispatchEvent(new KeyboardEvent('keydown',{key:k,bubbles:true})); });
            return 1; })()`);
        }
        if (s.panels) {
          await evalJs(ws, sessionId, `document.getElementById('vsLogBtn').click();
            document.getElementById('vsKeysBtn').click(); 1`);
        }
        if (s.both) {
          /* show the three rows the filters are holding back */
          await evalJs(ws, sessionId, `document.getElementById('vsFBots').click();
            document.getElementById('vsFLan').click(); 1`);
        }
        /* open the first row so the full record is in the picture too */
        await evalJs(ws, sessionId,
          `(function(){ var td = document.querySelector('#vsBody .vs-row td:nth-child(4)');
             if (td) td.click(); return 1; })()`);
        await sleep(900);

        if (s.rain) {
          await evalJs(ws, sessionId, `(function(){
            var guard = 0;
            while (window.VSFX.rain.mode !== ${JSON.stringify(s.rain)} && guard++ < 8) {
              document.getElementById('vsRainBtn').click();
            }
            return window.VSFX.rain.mode; })()`);
          if (s.rain === 'STORM') {
            /* a pulse lives for about a second, so the shutter goes
               off while the rings are still crossing the screen */
            await sleep(1200);
            await evalJs(ws, sessionId,
              `window.VSFX.rainBlast(640, 470); window.VSFX.rainBlast(1080, 300); 1`);
            await sleep(220);
          } else {
            /* the trace: point the field at one row and let the
               columns pick up words out of the roll */
            await evalJs(ws, sessionId, `(function(){
              var tr = document.querySelector('#vsBody .vs-row');
              if (tr) tr.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
              return 1; })()`);
            await sleep(2200);
          }
        }
        if (s.term) {
          await evalJs(ws, sessionId, `document.getElementById('vsTermBtn').click(); 1`);
          await sleep(200);
          await evalJs(ws, sessionId, `(function(){ var i=document.getElementById('vsTermIn'); i.value='help'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); })()`);
          await sleep(150);
          await evalJs(ws, sessionId, `(function(){ var i=document.getElementById('vsTermIn'); i.value='ls'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); })()`);
          await sleep(150);
          await evalJs(ws, sessionId, `(function(){ var i=document.getElementById('vsTermIn'); i.value='scan'; i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true})); })()`);
          await sleep(300);
          await evalJs(ws, sessionId, `(function(){ var t=document.getElementById('vsTerm'); if(t){ window.scrollTo(0, t.getBoundingClientRect().top + window.scrollY - 24); } return 1; })()`);
          await sleep(300);
        }
      }
      const { data } = await send(ws, 'Page.captureScreenshot', { format: 'png' }, sessionId);
      fs.writeFileSync(path.join(OUT, s.name + '.png'), Buffer.from(data, 'base64'));
      console.log('shot ' + s.name);
    }

    ws.close();
  } catch (e) {
    console.log('shot threw — ' + e.message);
  } finally {
    edge.kill();
    srv.kill();
    await sleep(400);
    for (let i = 0; i < 6; i++) {
      try { fs.rmSync(SANDBOX, { recursive: true, force: true }); break; }
      catch (_) { await sleep(300); }
    }
  }
  console.log('\n→ ' + OUT);
  process.exit(0);
})();
