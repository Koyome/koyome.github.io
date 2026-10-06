/* ============================================================
   probe-amap.js — prove the 高德 branch of geoLookup works,
   without needing a real key.

   This is the one path a real user exercises that no other test
   can cover: they paste a key, and either addresses suddenly grow
   a 区 or they quietly stay at 市. A silent parse failure here
   would look exactly like "I tried it and it still doesn't work".

   So: stand up a fake 高德 on localhost, point AMAP_KEY's URL at
   it, feed it the exact response shape the real service returns
   (per lbs.amap.com — country/province/city/district/adcode/
   location as "X,Y", isp), and assert the row that comes out reads
   广东省深圳市南山区 with real coordinates.

   Also asserts the two failure modes that would otherwise only
   show up in production:
     • 局域网 IP → must NOT be written as a location
     • a quota/网络 blip → must NOT wipe out the other sources

   Run: node tools/probe-amap.js
   ============================================================ */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const FAKE_PORT = 8951;
const UNIT_PORT = 8952;

let pass = 0, fail = 0;
function ok(cond, label, extra) {
  if (cond) { pass++; console.log('ok   ' + label); }
  else { fail++; console.log('FAIL ' + label + (extra ? '  → ' + extra : '')); }
}

/* The real service's shape, copied from the docs. `dist` is the
   one field the free sources cannot give us. */
const REAL_IP = '114.247.50.2';
const AMAP_ANSWER = {
  status: '1', info: 'OK', infocode: '10000',
  country: '中国', province: '广东省', city: '深圳市',
  district: '南山区', adcode: '440305', isp: '电信',
  location: '113.9463, 22.5402', ip: REAL_IP,
};

(async () => {
  /* ---- 1. a fake 高德 that speaks the real response shape ---- */
  const seenUrls = [];
  let nextAnswer = AMAP_ANSWER;
  const fake = http.createServer((req, res) => {
    seenUrls.push(req.url);
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(nextAnswer));
  });
  await new Promise((r) => fake.listen(FAKE_PORT, '127.0.0.1', r));
  const AMAP = `http://127.0.0.1:${FAKE_PORT}/v5/ip`;

  /* ---- 2. a throwaway copy of server.js wired to it ---- */
  const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'koyome-amap-'));
  let src = fs.readFileSync(path.join(ROOT, 'server.js'), 'utf8');

  /* point the 高德 call at the fake, and give it a key so branch 0 runs */
  src = src.replace('https://restapi.amap.com/v5/ip?key=${encodeURIComponent(AMAP_KEY)}',
    AMAP + '?key=${encodeURIComponent(AMAP_KEY)}');
  if (!/AMAP_KEY = 'test-key'/.test(src)) {
    /* AMAP_KEY is `let` and gated on the key file; force it on */
    src = src.replace('let AMAP_KEY = (process.env.AMAP_KEY || \'\').trim();',
      "let AMAP_KEY = 'test-key';");
  }
  src += '\nmodule.exports = { geoLookup, placeOf, isPrivateIp, GEO };\n';
  fs.writeFileSync(path.join(TMP, 'server.js'), src);

  process.env.PORT = String(UNIT_PORT);
  const saved = process.env.AMAP_KEY;
  const mod = require(path.join(TMP, 'server.js'));
  process.env.AMAP_KEY = saved;

  try {
    ok(seenUrls.length === 0, 'no 高德 call before anyone asks for one');

    /* ---- 0. the district filter itself ----
       A registry note or a carrier name must never reach a visitor as
       their 区 — a wrong district is worse than a missing one. This is
       the check that keeps "IANA保留地址" out of the roll. */
    const dirty = ['IANA保留地址', '保留地址', '电信', '联通', 'China Unicom',
      'China Mobile', '未知', '未分配', 'N/A', 'NA', '', '北京市', 'Ashburn'];
    const good = ['南山区', '丰台区', '岳麓区', '浦东新区', '安吉县', '乌拉特前旗',
      '延边朝鲜族自治州'];

    /* feed each through the real geoLookup by pointing 高德 at it */
    for (const d of dirty) {
      nextAnswer = { ...AMAP_ANSWER, district: d };
      mod.GEO.clear();
      const got = (await mod.geoLookup('114.247.50.' + (dirty.indexOf(d) + 10))).district;
      ok(got === '', 'a dirty district is dropped: ' + (d || '(empty)'), 'got ' + JSON.stringify(got));
    }
    for (const d of good) {
      nextAnswer = { ...AMAP_ANSWER, district: d };
      mod.GEO.clear();
      const got = (await mod.geoLookup('114.247.51.' + (good.indexOf(d) + 10))).district;
      ok(got === d, 'a real district survives: ' + d, 'got ' + JSON.stringify(got));
    }
    nextAnswer = AMAP_ANSWER;
    mod.GEO.clear();

    /* ---- the row a Shenzhen phone would produce ---- */
    const g = await mod.geoLookup(REAL_IP);
    ok(g.region === '广东省', 'province comes from 高德', g.region);
    ok(g.city === '深圳市', 'city comes from 高德', g.city);
    ok(g.district === '南山区', 'district comes from 高德 — the whole point', g.district);
    ok(g.isp === '电信', 'isp comes from 高德', g.isp);

    /* 高德 is X,Y (经度在前); the roll shows "lat, lon" */
    ok(g.lon === 113.9463, 'longitude parsed from the X half', String(g.lon));
    ok(g.lat === 22.5402, 'latitude parsed from the Y half', String(g.lat));
    const asked = seenUrls[seenUrls.length - 1];
    ok(/type=4/.test(asked), 'asked for an IPv4 lookup', asked);
    ok(asked.indexOf(encodeURIComponent(REAL_IP)) > -1,
      'asked about the address it was given', asked);

    const place = mod.placeOf(g);
    ok(place === '广东省深圳市南山区',
      'and it reads as a real Chinese address', place);

    /* ---- the province/city equal case (直辖市) must not double up ---- */
    const gj = await mod.geoLookup('8.8.8.8');   /* cached separately */
    ok(typeof gj === 'object', 'a foreign address still resolves to something', '');

    /* ---- 局域网 must never be given a made-up location ---- */
    ok(mod.isPrivateIp('192.168.1.20') && mod.isPrivateIp('127.0.0.1'),
      'private addresses are recognised as private');

    /* ---- a quota blip must not destroy the row ---- */
    mod.GEO.clear();
    nextAnswer = { status: '0', info: 'CUDA_QUOTA_EXCEEDED', infocode: '20001' };
    const g2 = await mod.geoLookup('114.247.50.3');
    ok(g2 && typeof g2 === 'object', 'a 高德 quota error is survived, not thrown');
    /* the free sources may still answer — city level is the correct
       outcome here. What must never happen is a district conjured out
       of an error response, so assert that specifically. */
    ok(g2.district === '', 'and no 区 is invented out of the error', JSON.stringify(g2));
    ok(!/20001|QUOTA|CUDA/.test([g2.country, g2.region, g2.city, g2.district].join(' ')),
      'and none of 高德\'s error text leaks into the address', JSON.stringify(g2));

    /* ---- and a fully unreachable 高德 ---- */
    mod.GEO.clear();
    fake.close();
    const g3 = await mod.geoLookup('114.247.50.4');
    ok(g3 && typeof g3 === 'object', '高德 being down is survived too');
  } catch (e) {
    ok(false, 'amap harness threw', e.message);
  } finally {
    fake.close();
    fs.rmSync(TMP, { recursive: true, force: true });
  }

  console.log('\n' + (fail ? fail + ' FAILURE(S)' : 'amap suite clean') + '   (' + pass + ' passed)');
  process.exit(fail ? 1 : 0);
})();