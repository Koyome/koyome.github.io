/* tools/probe-ua.js — the UA / geo parser's own test set.
   Run: node tools/probe-ua.js
   It requires server.js as a module (no port is opened), feeds one
   representative UA per device family through uaInfo(), and checks the
   answer field by field. It also times the parser, because a table that
   grew heavy enough to slow a page load would be a bad trade. */
const fs = require('fs');
const path = require('path');
const { uaInfo, normIsp, normCountry, normVer, isPrivateIp, appleModel, appleCores,
  applyFacts }
  = require(path.join(__dirname, '..', 'server.js'));

/* Each case: what to expect. Only the fields listed are checked, so a
   case can assert the model without pinning the browser's version. */
const CASES = [
  {
    name: '三星 Galaxy S23 Ultra / 三星浏览器',
    ua: 'Mozilla/5.0 (Linux; Android 14; SM-S918B Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.126 Mobile Safari/537.36 SamsungBrowser/26.0',
    brand: '三星', modelName: 'Galaxy S23 Ultra', modelCode: 'SM-S918B',
    device: '手机', osName: 'Android', osVersion: '14',
    browserName: '三星浏览器', browserVersion: '26',
  },
  {
    name: '小米 14 / 小米浏览器',
    ua: 'Mozilla/5.0 (Linux; U; Android 14; zh-cn; 23127PN0CG Build/UKQ1.230804.001) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/110.0.5481.153 Mobile Safari/537.36 XiaoMi/MiuiBrowser/17.2.10',
    brand: '小米', modelName: '23127PN0CG', modelCode: '23127PN0CG',
    device: '手机', osName: 'Android', osVersion: '14',
    browserName: '小米浏览器', browserVersion: '17.2.10',
  },
  {
    name: '华为（鸿蒙）/ 华为浏览器',
    ua: 'Mozilla/5.0 (Linux; Android 10; HarmonyOS; TAS-AL00; HMSCore 6.13.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/99.0.4844.88 HuaweiBrowser/13.0.5.303 Mobile Safari/537.36',
    brand: '华为', modelName: 'TAS-AL00', modelCode: 'TAS-AL00',
    device: '手机', osName: '鸿蒙',
    browserName: '华为浏览器', browserVersion: '13.0.5',
  },
  {
    name: '荣耀 / Chrome',
    ua: 'Mozilla/5.0 (Linux; Android 14; ANY-AN00 Build/HONORANY-AN00; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/120.0.6099.144 Mobile Safari/537.36',
    brand: '荣耀', modelName: 'ANY-AN00', modelCode: 'ANY-AN00',
    device: '手机', osName: 'Android', osVersion: '14', browserName: 'Chrome',
  },
  {
    name: 'OPPO / OPPO浏览器',
    ua: 'Mozilla/5.0 (Linux; Android 14; PHK110 Build/UKQ1.230917.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.178 Mobile Safari/537.36 HeyTapBrowser/45.10.5.1',
    brand: 'OPPO', modelName: 'PHK110', modelCode: 'PHK110',
    device: '手机', osName: 'Android', osVersion: '14',
    browserName: 'OPPO浏览器', browserVersion: '45.10.5',
  },
  {
    name: 'vivo / vivo浏览器',
    ua: 'Mozilla/5.0 (Linux; Android 14; PD2312 Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.119 Mobile Safari/537.36 VivoBrowser/10.5.0.0',
    brand: 'vivo', modelName: 'PD2312', modelCode: 'PD2312',
    device: '手机', osName: 'Android', osVersion: '14',
    browserName: 'vivo浏览器', browserVersion: '10.5',
  },
  {
    name: 'iQOO / Chrome',
    ua: 'Mozilla/5.0 (Linux; Android 14; I2218A Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.6167.178 Mobile Safari/537.36',
    brand: 'iQOO', modelName: 'I2218A', device: '手机',
    osName: 'Android', osVersion: '14', browserName: 'Chrome', browserVersion: '121',
  },
  {
    name: '一加 / Chrome',
    ua: 'Mozilla/5.0 (Linux; Android 13; LE2123 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.6045.163 Mobile Safari/537.36',
    brand: '一加', modelName: 'LE2123', device: '手机',
    osName: 'Android', osVersion: '13', browserName: 'Chrome', browserVersion: '119',
  },
  {
    name: 'realme / Chrome',
    ua: 'Mozilla/5.0 (Linux; Android 13; RMX3708 Build/TP1A.220624.014) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/117.0.5938.60 Mobile Safari/537.36',
    brand: 'realme', modelName: 'RMX3708', device: '手机',
    osName: 'Android', osVersion: '13', browserName: 'Chrome', browserVersion: '117',
  },
  {
    name: 'Google Pixel 8 Pro / Chrome',
    ua: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro Build/UQ1A.240205.004) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.6261.119 Mobile Safari/537.36',
    brand: 'Google', modelName: 'Pixel 8 Pro', device: '手机',
    osName: 'Android', osVersion: '14', browserName: 'Chrome', browserVersion: '122',
  },
  {
    /* The owner's own iPhone, UA verbatim. Two version statements that
       disagree: the OS token is frozen at 18_7 while Safari — which
       tracks the system and can never be ahead of it — says 26.5. The
       larger one is the truth, and the browser line beside it must not
       contradict the OS line. */
    name: 'iPhone / iOS 26.5（OS 令牌冻结在 18_7）',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1',
    brand: '苹果', modelName: 'iPhone', device: '手机',
    osName: 'iOS', osVersion: '26.5', browserName: 'Safari', browserVersion: '26.5',
  },
  {
    /* Apple moved to year-shaped versions: iOS 26 is a real thing, and
       a parser that assumed two digits would read it as nonsense */
    name: 'iPhone / iOS 26.5 / Safari',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1',
    brand: '苹果', modelName: 'iPhone', device: '手机',
    osName: 'iOS', osVersion: '26.5', browserName: 'Safari', browserVersion: '26.5',
  },
  {
    name: 'iPad / iPadOS 26.5 / Safari',
    ua: 'Mozilla/5.0 (iPad; CPU OS 26_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1',
    brand: '苹果', modelName: 'iPad', device: '平板',
    osName: 'iPadOS', osVersion: '26.5', browserName: 'Safari', browserVersion: '26.5',
  },
  {
    name: 'iPhone / Safari',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    brand: '苹果', modelName: 'iPhone', device: '手机',
    osName: 'iOS', osVersion: '17.5', browserName: 'Safari', browserVersion: '17.5',
  },
  {
    name: 'iPad / Safari',
    ua: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
    brand: '苹果', modelName: 'iPad', device: '平板',
    osName: 'iPadOS', osVersion: '17.5', browserName: 'Safari', browserVersion: '17.5',
  },
  {
    name: '三星 Galaxy Tab S9（外部机型库）/ Chrome',
    ua: 'Mozilla/5.0 (Linux; Android 13; SM-X710 Build/TQ3A.230805.001) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.5845.163 Safari/537.36',
    brand: '三星', modelName: 'Galaxy Tab S9', device: '平板',
    osName: 'Android', osVersion: '13', browserName: 'Chrome', browserVersion: '116',
  },
  {
    name: 'Windows 11 / Edge',
    ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.2592.113',
    brand: '', device: '电脑', osName: 'Windows 10/11',
    browserName: 'Edge', browserVersion: '126',
  },
  {
    name: 'macOS / Safari',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
    brand: 'Apple', modelName: 'Mac', device: '电脑',
    osName: 'macOS', osVersion: '10.15.7', browserName: 'Safari', browserVersion: '17.4',
  },
  {
    name: 'Linux / Firefox',
    ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:126.0) Gecko/20100101 Firefox/126.0',
    brand: '', device: '电脑', osName: 'Linux',
    browserName: 'Firefox', browserVersion: '126',
  },
  {
    name: '微信内置（Android）',
    ua: 'Mozilla/5.0 (Linux; Android 13; 2201123G Build/TKQ1; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/107.0.5304.105 Mobile Safari/537.36 MMWEBID/1234 MicroMessenger/8.0.49.2600(0x28003141) WeChat/arm64 Weixin NetType/WIFI Language/zh_CN ABI/arm64',
    brand: '小米', modelName: '2201123G', device: '手机',
    osName: 'Android', osVersion: '13', app: '微信',
    browserName: '微信', browserVersion: '8.0.49',
  },
  {
    name: '微信内置（iPhone）',
    ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.49(0x18003128) NetType/WIFI Language/zh_CN',
    brand: '苹果', modelName: 'iPhone', device: '手机',
    osName: 'iOS', osVersion: '16.6', app: '微信',
    browserName: '微信', browserVersion: '8.0.49',
  },
  {
    name: '抖音内置（三星 A53）',
    ua: 'Mozilla/5.0 (Linux; Android 12; SM-A536B Build/SP1A.210812.016; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/103.0.5060.129 Mobile Safari/537.36 musical_ly_aweme/27.7.0',
    brand: '三星', modelName: 'Galaxy A53', device: '手机',
    osName: 'Android', osVersion: '12', app: '抖音', browserName: 'Chrome',
  },
  {
    name: 'QQ浏览器（三星 S21）',
    ua: 'Mozilla/5.0 (Linux; U; Android 12; zh-CN; SM-G991B Build/SP1A.210812.016) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/98.0.4758.101 MQQBrowser/13.1.0.1051 Mobile Safari/537.36',
    brand: '三星', modelName: 'Galaxy S21', device: '手机',
    osName: 'Android', osVersion: '12',
    browserName: 'QQ浏览器', browserVersion: '13.1',
  },
  {
    name: '爬虫 Googlebot',
    ua: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
    bot: true, device: '爬虫', osName: '', browserName: '',
  },
];

const FIELDS = ['device', 'brand', 'modelName', 'modelCode', 'osName', 'osVersion',
  'browserName', 'browserVersion', 'app', 'bot'];

let pass = 0;
let fail = 0;
const failures = [];

for (const c of CASES) {
  const got = uaInfo(c.ua);
  for (const f of FIELDS) {
    if (!(f in c)) continue;
    const want = c[f];
    if (got[f] === want) { pass++; continue; }
    fail++;
    failures.push(`  ✗ ${c.name} · ${f}: 期望 "${want}"，实际 "${got[f]}"`);
  }
  if (process.env.VERBOSE) {
    console.log(`${c.name}\n   → ${got.device} | ${got.model || '-'} | ${got.os || '-'} | ${got.browser || '-'}${got.app ? ' | app=' + got.app : ''}\n   → brand=${got.brand || '-'} code=${got.modelCode || '-'}`);
  }
}

/* the label fields must stay consistent with the split ones — they are
   what the old rows and the admin table actually print */
for (const c of CASES) {
  const g = uaInfo(c.ua);
  const wantOs = g.osVersion ? g.osName + ' ' + g.osVersion : g.osName;
  if (g.os !== wantOs) { fail++; failures.push(`  ✗ ${c.name} · os 拼接不一致: "${g.os}"`); } else pass++;
  const wantBr = g.browserVersion ? g.browserName + ' ' + g.browserVersion : g.browserName;
  if (g.browser !== wantBr) { fail++; failures.push(`  ✗ ${c.name} · browser 拼接不一致: "${g.browser}"`); } else pass++;
  /* brand must never be repeated inside the model label */
  if (g.brand && g.model && g.model.indexOf(g.brand) === 0
    && g.model.slice(g.brand.length + 1).indexOf(g.brand) === 0) {
    fail++; failures.push(`  ✗ ${c.name} · 型号里重复了品牌: "${g.model}"`);
  } else pass++;
}

/* geo helpers */
const GEO = [
  ['normIsp', () => normIsp('CHINA UNICOM China169 Backbone'), '中国联通'],
  ['normIsp', () => normIsp('China Telecom'), '中国电信'],
  ['normIsp', () => normIsp('China Mobile Communications Corporation'), '中国移动'],
  ['normIsp', () => normIsp('Alibaba Cloud'), '阿里云'],
  ['normCountry', () => normCountry('CN'), '中国'],
  ['normCountry', () => normCountry('China'), '中国'],
  ['normCountry', () => normCountry('HK'), '中国香港'],
  ['normCountry', () => normCountry('TW'), '中国台湾'],
  ['normVer', () => normVer('126.0.6478.126'), '126'],
  ['normVer', () => normVer('8.0.49.2600'), '8.0.49'],
  ['normVer', () => normVer('10.15.7'), '10.15.7'],
  ['normVer', () => normVer('26.0'), '26'],
  ['normVer', () => normVer('13.1.0.1051'), '13.1'],
  ['isPrivateIp', () => isPrivateIp('192.168.1.7'), true],
  ['isPrivateIp', () => isPrivateIp('8.8.8.8'), false],
];
for (const [label, fn, want] of GEO) {
  const got = fn();
  if (got === want) pass++;
  else { fail++; failures.push(`  ✗ ${label}: 期望 "${want}"，实际 "${got}"`); }
}

/* ---------- core counts ----------
   navigator.hardwareConcurrency answers 4 on an iPhone 15 Pro Max whose
   A17 Pro has six cores — deliberate fingerprinting resistance, and
   useless for describing the machine. Where the family is known the
   published count is used; where the family spans several chips
   (iPhone SE/6/7/8 is 2, 4 and 6 cores) nothing is claimed. */
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1';
const proMax = applyFacts({ ua: IPHONE_UA, osName: 'iOS' },
  { sw: 430, sh: 932, dpr: 3, cores: 4 });
if (proMax.cores === 6 && proMax.coresReported === 4 && proMax.coresSrc === 'spec') pass++;
else {
  fail++;
  failures.push(`  ✗ iPhone 15 Pro Max: 期望 6 核（浏览器自报 4），实际 ${proMax.cores}/${proMax.coresReported}`);
}
/* a machine we cannot name keeps whatever the browser said */
const plain = applyFacts({ ua: 'Mozilla/5.0 (X11; Linux x86_64)' }, { sw: 1920, sh: 1080, dpr: 1, cores: 8 });
if (plain.cores === 8 && !plain.coresReported) pass++;
else { fail++; failures.push(`  ✗ 未命名机型应保留浏览器上报的核数: ${plain.cores}`); }
/* a family whose members ship different chips must not be given a number */
const oldSE = applyFacts({ ua: IPHONE_UA, osName: 'iOS' }, { sw: 375, sh: 667, dpr: 2, cores: 2 });
if (oldSE.cores === 2 && !oldSE.coresReported && appleCores('iPhone SE / 6 / 7 / 8') === 0) pass++;
else { fail++; failures.push(`  ✗ 多芯片家族不应编造核数: ${oldSE.cores}`); }

/* ---------- the fun half: measured, not guessed ---------- */
/* the WASM SIMD byte string that lives in the beacon must really be a
   valid module. The previous one was not — its code section claimed 21
   bytes and had 22 — so it answered false on every engine and SIMD was
   never once detected. This reads the bytes out of the browser file and
   builds them here, where the answer is known. */
const beacon = fs.readFileSync(path.join(__dirname, '..', 'docs', 'js', 'visit-beacon.js'), 'utf8');
const lit = /var simd = \[([\s\S]*?)\];/.exec(beacon);
if (!lit) { fail++; failures.push('  ✗ 信标里的 WASM SIMD 字节串没找到（检测已丢失？）'); }
else {
  const bytes = lit[1]
    .replace(/\/\*[\s\S]*?\*\//g, ' ')      /* strip the inline notes */
    .replace(/\/\/[^\n]*/g, ' ')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x !== '')
    .map(Number);
  if (bytes.some((x) => !Number.isInteger(x) || x < 0 || x > 255)) {
    fail++; failures.push('  ✗ WASM SIMD 字节串里有非法字节');
  } else if (WebAssembly.validate(new Uint8Array(bytes))) {
    pass++;
  } else {
    fail++; failures.push(`  ✗ 信标里的 WASM SIMD 模块不是合法模块（${bytes.length} 字节）`);
  }
}

const FUN = [
  ['120Hz 面板', { hz: 118 }, 'hz', 120],
  ['90Hz 面板', { hz: 88 }, 'hz', 90],
  ['60Hz 面板', { hz: 59 }, 'hz', 60],
  /* 100 is within 8% of no standard rate, so no rate may be claimed */
  ['非标准帧率不冒认档位', { hz: 100 }, 'hz', 100],
  ['色深', { depth: 24 }, 'depth', 24],
  ['广色域', { gamut: 'p3' }, 'gamut', 'p3'],
  ['HDR', { hdr: true }, 'hdr', true],
  ['首屏绘制', { fcp: 312 }, 'fcp', 312],
  ['存储配额', { quota: 238 }, 'quota', 238],
];
for (const [label, caps, field, want] of FUN) {
  const got = applyFacts({ ua: '' }, caps)[field];
  if (got === want) pass++;
  else { fail++; failures.push(`  ✗ ${label} · ${field}: 期望 "${want}"，实际 "${got}"`); }
}
/* panel arithmetic: 393×852 @3x is 3.0 megapixels and 2.17:1 */
const panel = applyFacts({ ua: IPHONE_UA, osName: 'iOS' }, { sw: 393, sh: 852, dpr: 3 });
if (panel.mp === '3.0' && panel.ratio === '2.17') pass++;
else { fail++; failures.push(`  ✗ 屏幕算术: ${panel.mp} MP / ${panel.ratio}:1`); }
/* the raw reading is kept even when a standard rate is named */
const hzRow = applyFacts({ ua: '' }, { hz: 118 });
if (hzRow.hz === 120 && hzRow.hzMeasured === 118) pass++;
else { fail++; failures.push(`  ✗ 刷新率应保留原始读数: ${hzRow.hz}/${hzRow.hzMeasured}`); }
/* deviceMemory is a floor — the marker must survive */
const memRow = applyFacts({ ua: '' }, { mem: 8 });
if (memRow.mem === 8 && memRow.memMin === true) pass++;
else { fail++; failures.push('  ✗ 内存应标记为下限（≥）'); }
/* capabilities arrive as a list and are capped, never trusted blindly */
const eng = applyFacts({ ua: '' }, { feat: ['WebGPU', 'WebGL2', 'WASM', 'x'.repeat(80)] });
if (Array.isArray(eng.feat) && eng.feat.length === 4 && eng.feat[3].length === 16) pass++;
else { fail++; failures.push(`  ✗ 能力清单应被截断到 16 字符: ${JSON.stringify(eng.feat)}`); }
/* and capped, so a hostile payload cannot bloat a row */
const many = [];
for (let i = 0; i < 40; i++) many.push('f' + i);
if (applyFacts({ ua: '' }, { feat: many }).feat.length === 8) pass++;
else { fail++; failures.push('  ✗ 能力清单应最多 8 项'); }

/* ---------- the guest card: what a screen knows that a UA does not ----------
   Apple stopped naming the handset in the UA, so the only way to say
   which iPhone it is comes from the panel it reports. Two generations
   sharing one panel are named together — splitting them would be a
   guess — and a resolution nothing matches returns nothing at all. */
const SCREENS = [
  ['iPhone 15 / 16', 393, 852, 3, 'iPhone 14 Pro / 15 / 16'],
  ['iPhone 16 Pro Max', 440, 956, 3, 'iPhone 16 / 17 Pro Max'],
  ['iPhone SE', 375, 667, 2, 'iPhone SE / 6 / 7 / 8'],
  ['iPad Pro 11', 1194, 834, 2, 'iPad Pro 11 英寸'],
  ['iPad Pro 12.9', 1366, 1024, 2, 'iPad Pro 12.9 英寸'],
  ['a size no Apple panel has', 401, 900, 3, ''],
  ['nothing measured', 0, 0, 0, ''],
];
for (const [label, w, h, dpr, want] of SCREENS) {
  const got = appleModel(w, h, dpr);
  if (got === want) pass++;
  else { fail++; failures.push(`  ✗ appleModel ${label}: 期望 "${want}"，实际 "${got}"`); }
}
/* the same phone measured sideways must name the same phone */
if (appleModel(852, 393, 3) === appleModel(393, 852, 3)) pass++;
else { fail++; failures.push('  ✗ appleModel 横竖屏应给出同一机型'); }

/* Client Hints: the one source that separates Windows 11 from 10 and
   names an Android handset outright */
const HINTS = [
  ['Windows 11', { osName: 'Windows 10/11', browserName: 'Chrome' },
    { ch: { platv: '15.0.0', uafull: '126.0.6478.126' } }, 'osName', 'Windows 11'],
  ['Windows 10', { osName: 'Windows 10/11', browserName: 'Chrome' },
    { ch: { platv: '10.0.0' } }, 'osName', 'Windows 10'],
  ['Android 真机型', { brand: '三星', modelName: 'SM-S918B', browserName: 'Chrome' },
    { ch: { model: 'SM-S918B' } }, 'modelName', 'SM-S918B'],
  ['完整浏览器版本', { browserName: 'Chrome', browserVersion: '126' },
    { ch: { uafull: '126.0.6478.126' } }, 'browserVersion', '126'],
];
for (const [label, row, caps, field, want] of HINTS) {
  const got = applyFacts(Object.assign({ ua: '' }, row), caps)[field];
  if (got === want) pass++;
  else { fail++; failures.push(`  ✗ applyFacts ${label} · ${field}: 期望 "${want}"，实际 "${got}"`); }
}
/* an iPad asking for the desktop site calls itself a Mac and dates its
   own system to 10.15.7; the panel says otherwise */
const deskPad = applyFacts({
  ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.5 Safari/605.1.15',
  osName: 'macOS', osVersion: '10.15.7', os: 'macOS 10.15.7', device: '电脑',
}, { sw: 1194, sh: 834, dpr: 2 });
if (deskPad.device === '平板' && /^iPad/.test(deskPad.modelName) && deskPad.osVersion === '26.5') pass++;
else {
  fail++;
  failures.push(`  ✗ 桌面模式 iPad 应被识别为平板: device=${deskPad.device} model=${deskPad.modelName} os=${deskPad.os}`);
}
/* …and a real Mac, whose panel matches nothing Apple ever put in an
   iPad, must be left alone */
const realMac = applyFacts({
  ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15',
  osName: 'macOS', device: '电脑',
}, { sw: 1512, sh: 982, dpr: 2 });
if (realMac.device === '电脑' && !realMac.modelName) pass++;
else { fail++; failures.push(`  ✗ 真 Mac 不该被认成平板: ${realMac.modelName}`); }

/* a screen match wins over the hints' model, and never overwrites a
   blank card with one */
const merged = applyFacts({ ua: 'Mozilla/5.0 (iPhone) AppleWebKit', osName: 'iOS' },
  { sw: 393, sh: 852, dpr: 3, ch: { model: 'nonsense' } });
if (merged.model === '苹果 iPhone 14 Pro / 15 / 16') pass++;
else { fail++; failures.push(`  ✗ 屏幕识别应优先于 hints: "${merged.model}"`); }
if (applyFacts({ ua: '' }, null).model === undefined) pass++;
else { fail++; failures.push('  ✗ 没有测量数据时不应凭空造字段'); }

/* performance: the parser runs per visit, so it must stay cheap */
const t0 = process.hrtime.bigint();
const N = 20000;
for (let i = 0; i < N; i++) uaInfo(CASES[i % CASES.length].ua);
const t1 = process.hrtime.bigint();
const perMs = Number(t1 - t0) / 1e6 / N;
const perUs = (perMs * 1000).toFixed(2);
if (perMs * 1000 > 60) { fail++; failures.push(`  ✗ 性能：单次解析 ${perUs}µs，超过 60µs 上限`); } else pass++;

console.log('=========================================');
console.log(' UA / 归属地 解析校验');
console.log('=========================================');
console.log(` 用例 ${CASES.length} 组 · 断言 ${pass + fail} 条 · 通过 ${pass} · 失败 ${fail}`);
console.log(` 解析耗时 ${perUs}µs / 次（${N} 次平均）`);
if (failures.length) {
  console.log('-----------------------------------------');
  failures.forEach((f) => console.log(f));
}
console.log(fail ? '\n 结果：FAIL\n' : '\n 结果：PASS\n');
process.exit(fail ? 1 : 0);
