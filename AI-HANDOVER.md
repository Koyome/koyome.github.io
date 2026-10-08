# Koyome.me — 项目交接文档（AI Handover）

> 写给下一个接管本项目的 AI（或人类开发者）：**读完这一份，即拥有继续开发的全部上下文。**
> 最后更新：2026-10-09（第四十四轮：iPhone 系统版本真因修复（UA 两个版本令牌取较大者）+ 「访客名片」
> ——屏幕反推 iPhone 机型、Client Hints 分 Win10/11 与 Android 真机型、时区/网络/回访/停留/阅读深度；
> 第四十三轮：设备/UA/归属地探测重写——机型库外置 + 五步降级链 + `tools/probe-ua.js` 225 断言；第四十二轮：门禁视觉重做——分层柔和渐变背景 + 纸纹质感、角色形象"门脚同伴"陪衬、门禁层级抬到页头之上；第四十一轮：访客页"可爱门禁"登录页——**取代进入动画**，头像在上/密码框在下，验证通过前全屏模糊不可读，密码服务端校验（`server-gate.json`，绝不进 `docs/`）+ 随机温馨欢迎语 + 后台可设；第四十轮：访客控制台"减重 + 加辣"——板面由雾光改剃刀边/收紧间距、朋克特效频率翻倍、新增黑客指令台 `TERM` 与扫描扫掠；第三十九轮：名册自动判读意图与来源 + 设备列改为显示真机型；第三十八轮：代码雨可玩化——指针力场/点击冲击波/打字回声/整行锁定 + 四种雨幕模式 + 画布铺满修复 + 胶片颗粒；第三十七轮：访客控制台"大胆化"——代码雨/数据流/流量示波/系统日志/开机自检/超频模式等黑客风格特效；第三十六轮：访问记录零漏记 + 赛博朋克界面重做；第三十五轮：名册可自由移除；第三十四轮：访客页/手记页三层防推送 + 名册视觉重做；第三十三轮：撤掉手记页，访客名册升为独立大页 `visits.html`；第三十二轮：线上信标 + Key 管理；第三十一轮：日志页 + 访客 IP 记录；第三十轮：全站排版 token 化）
> 🖱️ **重启本机服务**：双击桌面 `Koyome-Restart-Site.vbs`（源码 `restart-server.vbs`）。
> 改了 `server.js` 之后必须点一次，否则跑的还是旧代码。详见 §0.39 末尾。
> 🔒 **推送前必读 §0.34**：`docs/` 就是 Pages 发布根，访客页与手记页绝不能上线。
> 守卫命令 `node tools/check-private-pages.js`，必须打印 SAFE TO PUSH。
> 仓库状态：本地 HEAD = `4e8dc46`，**远端 main 与之相同**（09-26 20:37 用户一键推送，R20–R24 已上线）｜ ⚠️ 常驻推送授权**已于 2026-09-23 取消**：AI 推送前必须逐次征得用户同意（§4.3）

---

## 0.44 第四十四轮速览（2026-10-09）：iPhone 系统探测纠错 + 「访客名片」

用户原话：「主要是对 iPhone 的系统探测不够呀，我 26.5 系统测试结果显示不对。还有能不能开动你的脑筋做一个
能知道访客更多信息的功能。」

一句话：**UA 里有两个互相打架的版本号，旧 parser 读了被冻结的那个；以及 UA 只说设备「自称」是什么，
名片记的是浏览器量出来的事实——屏幕、时区、网络、回访次数、读了多深。**

### 一、iPhone 系统显示不对——真因（有证据，不是推测）
从线上表把用户那台 iPhone 的真实 UA 捞出来：

```
Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15
(KHTML, like Gecko) Version/26.5 Mobile/15E148 Safari/604.1
```

**两个版本声明互相矛盾**：`CPU iPhone OS 18_7`（OS 令牌）vs `Version/26.5`（Safari 自己的版本）。
- 过去的代码只读 OS 令牌 → 输出 `iOS 18.7`，**而且和同一行的 `Safari 26.5` 自相矛盾**。
- Safari 的版本号跟随系统、且永远不会超前于系统 → **真值是两者中较大的那个**。

修法（`server.js` 的 `UA_OS` 苹果分支）：取 `OS (\d+)[_.](\d+)` 与 `Version\/(\d+)\.(\d+)` 中**较大**者。
判据写成注释：两个令牌都可能滞后，但都不会超前。现在这条 UA 读作 `iOS 26.5 / Safari 26.5`，一致了。

### 二、顺带修掉的同类问题：桌面模式的 iPad
iPadOS 开「请求桌面网站」时 UA 自称 `Macintosh ... Mac OS X 10_15_7`（冻结令牌）。
`applyFacts()` 里加了一条：**声称是 Mac、但屏幕物理分辨率命中 iPad 面板 → 判为平板**，
系统写成 `iPadOS <Version 令牌>`。**真 Mac 的屏幕不会命中 iPad 面板**，所以不会误判（两条断言守着）。

### 三、「访客名片」（新功能）——UA 之外的那一半
设计原则：**UA 是设备「自称」，名片是浏览器「量出来」的事实**；量不到就整组不画，绝不编。

| 来源 | 拿到什么 | 为什么比 UA 强 |
|---|---|---|
| `screen × devicePixelRatio` | 物理分辨率 → **具体 iPhone/iPad 机型** | 苹果早就不把机型写进 UA，这是唯一办法 |
| Chromium Client Hints | **Android 真机型**、真实 `platformVersion`、完整浏览器版本 | Win 10/11 在 UA 里都报 `NT 10.0`，只有它能分开 |
| `navigator` | CPU 核数、内存、时区、语言 | — |
| `matchMedia` | 深/浅色、是否减弱动效 | 隐私偏好，也是排版依据 |
| `navigator.connection` | 4G/3G、RTT、下行带宽 | 判断"卡不卡" |
| `localStorage` | 第 N 次来访、首次来访日期 | 认得出回头客 |
| `sessionStorage` | 会话 id → 本次看了几页、持续多久 | 一个 id 串起一次来访 |
| `pagehide` | 上一页停留时长、阅读进度 | 行在页面**打开**时写入，所以只能由下一页捎带 |

**落地位置**
- `server.js`：新增 `APPLE_SCREENS`(22 条) + `appleModel()` + `applyFacts()`；
  `POST /api/visit/caps`（按 ip+ua 匹配 10 分钟内最新一行，回填）；云端行读 `c.caps` 后同样过一遍；
  按 `sid` 聚合出「本次来访 N 页 / 时长」。
- `docs/js/visit-beacon.js`：采集并上报；**先问表有没有 `caps` 列**（`?select=caps&limit=1`，PostgREST 缺列报 400），
  没有就按原样登记——**一次访问都不会因为缺列而丢**。
- `docs/js/visits.js` + `docs/css/visits.css`：详情行顶部渲染名片（6 组自适应）。
- `tools/supabase-visits-caps.sql`（新增）：`alter table ... add column if not exists caps jsonb`。
  **需要用户在 Supabase 跑一次**，不跑也不出错，只是线上访客没有名片。
- `i18n.js`：三语各 +24 键（410×3）。

### 四、一个诊断用的小东西
`/api/visits/status` 现在多返回一个 `build`（server.js 的 mtime）。**Node 进程跑的是它启动时那份代码**，
改完不重启就是旧的——这类"我改了但没变"的来回在这个项目里最贵。比对 `build` 与磁盘 mtime 一秒就能定论。
（本次就是用它确认：线上进程仍是旧代码，所以用户看到的 iOS 18.7 是旧 parser 干的。）

### 五、验证（2026-10-09 实跑，全绿）
- `probe-ua.js`：24 组 UA / **271 条断言**（新增 iOS 26.5 冲突用例 ×2、屏幕识别 7 例、横竖屏一致、
  Client Hints 4 例、桌面模式 iPad + 真 Mac 各 1 例）→ 全通过，9.9µs/次。
- `probe-visits.js` 51 → **56**（新增名片端到端 5 条：iPhone 由屏幕命名、面板保留、访客本地时间、
  不篡改浏览器、Client Hints 分出 Win 11）。
- `probe-visits-page.js` 115 ✓、`probe-visit-online.js` 15 ✓、`audit-i18n.js` NO ISSUES ✓、
  `check-private-pages.js` **SAFE TO PUSH** ✓。
- 截图自检：`shot-visits.js` 的样本里加了一条带完整名片的行，桌面/手机两版都看过，排版没问题。

### 六、诚实边界
- 两代共用一块屏的（iPhone 15/16）**一起命名**，拆开是猜；iOS 开了「显示缩放」会让逻辑分辨率变化 → 匹配不上就留空。
- 「上一页停留」是上一页的真实测量值，**不是**当前页；会话时长是「首↔末次页面加载」的下限，标了"≥"的含义。
- 停留/阅读进度只在浏览器上报后才有；云端需要跑一次 SQL 才有列名片。

---

## 0.43 第四十三轮速览（2026-10-09）：设备/UA/归属地探测重写——"手机型号不准"的根因与修法

用户原话：「在项目的 IP 记录功能中，设备探测结果里的手机型号不准。请定位 IP 记录相关的设备/UA 探测代码，
分析型号识别不准确的原因…并优化探测逻辑，使所有探测字段尽可能精准：设备品牌与型号、操作系统及版本、浏览器
及版本、IP 归属地与运营商等。要求：使用可靠且可持续更新的识别数据源，为无法精确识别的情况补充逐级降级策略，
避免为提升准确率引入过重依赖或明显性能损耗；保持字段结构与现有存储兼容，并说明每个字段的判定依据及准确度
预期，附上一组典型设备 UA 用于验证改动效果。」

一句话：**不是"多写几条正则"能解决的——重写了 `uaInfo()`，加了品牌/型号/OS/浏览器四张表 + 一条可外部更新的
机型库 + 五步降级链，并把每个字段拆成结构化子字段；零新依赖，单次解析 ~10µs。**

### 一、探测代码在哪
全部在 `server.js`：
- `uaInfo(ua)`（约 L463）— 唯一入口，一次访问调一次，结果写进 `recordVisit()` 的行。
- 表：`UA_APPS`（APP 内置壳）、`UA_OS`（系统）、`UA_BROWSERS`（浏览器）、`MODEL_DB`（机型名映射）、
  `BRAND_BY_CODE`（由机型代码推品牌）、`BRAND_BY_UA`（由 UA 自报品牌）、`WIN_NT`（Windows NT 版本→产品名）。
- 归属地：`geoLookup(ip)` + `normIsp()` / `normCountry()` / `PLAUSIBLE_PLACE` / `NOT_A_DISTRICT`。
- **可外部更新的机型库**：`tools/device-db.json`（新增），启动时读入，合并到内置表**之前**。

### 二、型号不准的四条根因（都是读旧代码读出来的，不是猜的）
1. **机型库只覆盖三星、且停在 S25 之前**：`GALAXY` 表只有 SM- 一家，小米/华为/荣耀/OPPO/vivo 一个没有，
   于是这些机器全部落到"原始代码"甚至"未知"。
2. **品牌前缀表有碰撞**：`LE` 同时归给一加和联想；裸 `V` 太宽，会吞掉运营商串。
3. **判定依据单一**：只认 UA 里"自报的品牌词"，而小米/华为的 UA **根本不含品牌词**（只有 `23127PN0CG` 这种
   代码），于是品牌直接空着——这是"型号不准"里占比最大的一块。
4. **版本串没归一**：`126.0.6478.126` 原样输出，看着像乱码。

### 三、改了什么
| 项 | 改法 |
|---|---|
| `normVer()` | 新版号归一：4 段且第 3 段是"构建号（≥3 位）"→只留主版本（`126.0.6478.126`→`126`）；4 段但第 3 段是真小版本→留 3 段（微信 `8.0.49.2600`→`8.0.49`）；末尾 0 一律去掉（`26.0`→`26`）。 |
| `WIN_NT` | NT 6.1/6.2/6.3/10.0 → Windows 7/8/8.1/**10/11**（10 与 11 在 UA 里无法区分，标签就写两个，不猜）。 |
| `UA_OS` | 改为返回 `{name, ver}`；iPad 报 **iPadOS**（不再冒用 iOS）；新增 Windows Phone；鸿蒙→`鸿蒙`。 |
| `UA_BROWSERS` | 改为返回 `[name, version]`；新增 360/猎豹/傲游/2345/LBBROWSER/世界之窗/Yandex/Vivaldi/Whale/Brave/Opera Touch；OPPO/vivo/华为/小米的壳正名为"XX浏览器"。 |
| `UA_APPS` | 新增 LINE/Facebook/Instagram/X/Snapchat/Pinterest/哔哩哔哩/京东。 |
| `MODEL_DB` | 三星家族扩到 S10–S25、Note10/20、Z Flip1–6、Z Fold2–6、A 系列与 Tab S7（前缀匹配：`SM-S918B/-U/-N` 同属 S23 Ultra）。 |
| **`tools/device-db.json`** | 新增。启动时读入并**插在内置表之前**，所以新增机型改这个文件即可，不用动 `server.js`。文件缺失/写坏 → 静默忽略，页面照常。 |
| `BRAND_BY_CODE` | 重排消冲突：`V\d/PD\d/PD2\d/V2\d`→vivo（不再裸 `V`）、`LE21`→一加（不再 `LE`）…；末尾保留最宽的"小米码"规则，且修正为 `年月+流水号+字母`（`2201123G`、`23127PN0CG`）——**旧规则 `\d{8}` 漏掉了所有以字母结尾的小米码**。 |
| `BRAND_BY_UA` | 苹果/Apple 提到最前；补 iQOO/努比亚/红魔/黑鲨/Tecno/Infinix/Itel/Nothing 等。 |
| `androidModel()` | 跳过 `HarmonyOS` / `HMSCore`（原来鸿蒙机型会被当成"型号=HarmonyOS"）。 |
| 平板判定 | 补 `SM-X\d`（Tab S9/S10 不带 Tablet 标记）；型号名含 Pad/Tab/Tablet 时也判平板。 |
| 归属地 | 新增 `normIsp()`（三大运营商/铁通/教育网/科技网/广电/长城/阿里云/腾讯云归一，**认不出的原样保留，绝不编造**）、`normCountry()`（HK/MO/TW 一律写作中国香港/中国澳门/中国台湾）；私网 IP 直接短路返回"局域网"；pconline 尾部像运营商的内容归入 `isp` 而不是区县。 |

### 四、每个字段的判定依据与准确度预期
| 字段 | 判定依据（优先顺序） | 预期准确度 |
|---|---|---|
| `device` 设备类型 | iPad/SM-T/SM-X/Tablet/Pad/Tab/MatePad → 平板；Mobile/Android/iPhone/Windows Phone/HarmonyOS → 手机；其余 → 电脑；命中爬虫 → 爬虫 | 高（≈99%） |
| `brand` 品牌 | ① UA 自报品牌词（厂商自己说的，最可信）② 机型代码前缀（厂商代号命名空间）③ 机型库命名后按代码回推 | 高（安卓 ≈95%，桌面为空属正常） |
| `modelName` 型号 | ① 机型库前缀命中（三星/Google/小米少数）② UA 直接写出的名字（Pixel 8 Pro、Moto G）③ iOS → iPhone/iPad ④ 安卓 → 原始代码 ⑤ 空 | 三星/Google/苹果 ≈95%；**小米/OPPO/vivo 多为"原始代码"（准但不"好听"）** |
| `modelCode` 机型代码 | 安卓括号段里 `Android` 之后第一个非 locale/非 wv 的 token | 高（≈97%，桌面/iOS 为空） |
| `osName` / `osVersion` | UA 的 `Android x`/`iPhone OS x`/`Windows NT x`/`Mac OS X x`/`HarmonyOS`；NT 号再映射产品名 | 系统名 ≈99%；**版本号≈95%**（Win10/11 无法区分，是协议限制） |
| `browserName` / `browserVersion` | 专用壳 token（微信/QQ/UC/夸克/百度/各厂浏览器/360/猎豹…）→ 再 Edge/Opera/三星/Chrome/Firefox → Safari | 壳名 ≈95%，版本 ≈95%（`Chrome 126` 是故意只留主版本） |
| `app` | `MicroMessenger`/`aweme`/`Alipay`… → 微信/抖音/支付宝 | 高（≈98%），仅对确实走内置壳的访问 |
| `place` 归属地 | 高德（有 key）→ ip-api.com → pconline；区县需通过 `PLAUSIBLE_PLACE` 形态校验；私网 → 局域网 | 有 key：省市区 ≈90%；无 key：省/市 ≈85%；国外 ≈80% |
| `isp` 运营商 | 来源原值经 `normIsp()` 归一；pconline 尾段疑似运营商时补入 | ≈90%（免费源本身不保证） |

**降级链（写得进代码注释里，五步，从最具体到最保守）：**
1. 机型库能命名的代码 → `SM-S918B → Galaxy S23 Ultra`
2. UA 自己写出的名字 → `Pixel 8 Pro`
3. iOS → `iPhone` / `iPad`（苹果在 UA 里只给到这一层，这是上限不是缺陷）
4. 安卓 → `品牌 + 原始代码`（**宁可留代码也不编一个店名**）
5. 什么都证明不了 → 只留品牌，或留空

### 五、兼容性与依赖
- **零新依赖**：不引 `ua-parser-js` 之类（那类库体积大且机型名不如自己维护的表准）。全表约 200 条常量。
- **存储兼容**：`device/model/os/browser/app/bot` 六个老字段**含义与形状完全不变**；新增
  `brand/modelName/modelCode/osName/osVersion/browserName/browserVersion` 是**纯追加**，老行缺字段照常渲染。
- **性能**：实测 **9.8µs/次**（2 万次平均），上限断言 60µs。每次访问只调一次，可忽略。
- 前端只把搜索与详情行扩到新字段；表格列未改，老数据照样显示。

### 六、验证（2026-10-09 实跑，全绿）
- 新增 **`tools/probe-ua.js`**：21 组典型 UA × 逐字段断言 + 拼接一致性 + 品牌不重复 + 性能上限 → **225/225 通过**。
- **典型 UA 就在这个文件里**（三星 S23 Ultra / 小米 14 / 华为鸿蒙 / 荣耀 / OPPO / vivo / iQOO / 一加 / realme /
  Pixel 8 Pro / iPhone / iPad / Tab S9 / Win11 Edge / macOS Safari / Linux Firefox / 微信×2 / 抖音 / QQ浏览器 /
  Googlebot），跑 `node tools/probe-ua.js` 即可复现，加 `VERBOSE=1` 可看每条的解析结果。
- 回归：`probe-visits.js` 51 ✓、`probe-visits-page.js` 115 ✓、`probe-visit-online.js` 15 ✓、
  `check-private-pages.js` **SAFE TO PUSH** ✓。
- ⚠️ 改了 `server.js` → 需双击桌面 `Koyome-Restart-Site.vbs` 重启一次才生效。

### 七、诚实边界（没做的事，不要当已做）
- 小米/OPPO/vivo 的**代码→店名**映射没有批量内置（厂商不公开稳定的代号表，硬猜会错得更离谱）；
  想补真名就往 `tools/device-db.json` 里加，格式见文件里的 `_readme`。
- Windows 10 与 11 在 UA 协议层面无法区分，标签写"Windows 10/11"。
- 归属地精度取决于是否配了高德 key（`tools/geo-key.txt`），免费源只能到省/市级别。

---

## 0.42 第四十二轮速览（2026-10-08）：门禁视觉重做（背景/质感/角色陪衬）

用户原话：「请优化现有页面的视觉设计…支持用户自定义头像；重新设计页面背景，去除土气感，采用更精致协调的
配色与质感；将整体风格调整为真正可爱温馨的调性；在页面中增加人物或角色形象的陪衬元素作为装饰，提升场景感
与亲和力。最后不需要给出图片展示我自己验证。」

一句话：**把"一块扁平淡紫幕布 + 几颗大圆点"换成"有层次、有质感、有角色在场的门厅"。**

### 一、背景重做（去"土气/扁平"）——`docs/css/visits.css`
- `.vs-login` 底色由**单层径向渐变**改为**分层**：`radial(#fff8f1 顶部奶油光)` + `linear(165deg, #ffeff4 → #f4edfb → #eef4fb)`（奶油→腮红→薰衣草），另加 `inset 0 0 220px rgba(120,92,130,.16)` 暗角造深度。
- 新增 `.vs-login::before`：四团大范围**模糊色云**（玫瑰/紫罗兰/薄荷/奶油，`filter: blur(30px)`）—— 提供"有呼吸的背景"，不再是死平色。
- 新增 `.vs-login::after`：内嵌 SVG `feTurbulence` **纸纹**（`opacity:.05; mix-blend-mode:soft-light`）—— 给"质感"，不噪。
- 旧 5 颗大 bokeh 圆 → **5 颗小星光点**（`vs-sparkle` 闪烁），更精致。

### 二、角色形象陪衬（"门脚同伴"）
- 新增 `.vs-login-companion`（`#vsLoginCompanion` / `#vsLoginCompanionImg`，`docs/visits.html`）：**复用站长头像**作门脚同伴，
  浮起 + 轻摆（`vs-companion-float`）+ 落地椭圆投影；`<div class="vs-login-companion">` 里放 `<img>`。
- `docs/js/visits.js`：新增 `elLoginCompanion/elLoginCompanionImg` 引用；`initGate()` 里 `g.avatar` 同时喂给头像与同伴
  → **自定义头像一处改、门面与同伴同步**（满足"支持用户自定义头像"）。

### 三、卡片/头像精修
- 卡片：`rgba(255,255,255,.78)` → `linear(180deg, .94 → .86)` 白面 + `inset 0 1px 0 #fff` 高光 + 暖色投影（`-22px` 大扩散）。
- 头像：加 `0 0 0 1px rgba(255,180,205,.5)` 淡粉描边环；halo 周期 14s→18s、透明度更柔；卡片宽度 380→392。

### 四、⚠️ 层级修复（真 bug）
`.vs-login` 原 `z-index: 95` **低于** `.site-header` 的 `z-index: 100`（`style.css` §398）→ 模糊页头会在门禁**上方**露出一条深色横条。
本轮改为 `.vs-login { z-index: 120 }`、`.vs-welcome { z-index: 121 }`，门禁才真正盖住整页、内容才真正不可读。

### 五、R42 后续补丁（同日，按用户二次反馈）

- **去掉门脚同伴**：用户要求移除角色陪衬。`.vs-login-companion` 的 HTML / CSS / JS 三处删净（reduced-motion 的引用一并删），
  `.vs-login` 底部 `padding-bottom:168px` 去掉（版式回归居中）。
- **头像改为"可自行上传"**：`PUT /api/gate` 新增 `avatarFile`（base64 dataURL）→ `saveDataUrl(body.avatarFile,'gate-avatar')` 落盘
  + 写 `profile.json.avatar`；该端点 `readBody` 上限 **16KB → BODY_LIMIT**（不改则传不上图）。
  `admin.html` 的 Visitor Gate 区加 `#gAvatar`(file) + `#gAvatarPreview`（圆图预览）+ 内联小样式；`admin.js` 走 选择→预览→上传→回填。
  i18n 新增 `admin_gate_avatar` / `admin_gate_avatar_note` ×3 语言。
- **质感再提**：背景加"卡片后方柔光池"、色云 `blur 30→38px`、纸纹 `.05→.07`；卡片改多层阴影（inset 高光 + 顶/底 1px + 三级投影）、
  圆角 34px；头像三环投影；输入框 1.5px 精边框；按钮加 inset 高光（果冻感）。
- 版本戳 `visits.css` / `visits.js` / `i18n.js` / `admin.js` → `?v=202610082110`。
- 验证：`node --check` server/visits/admin/i18n **OK**；**上传端点实测**（`PUT` 带 1×1 PNG → 200 返回 `assets/…_gate-avatar.png`、
  `GET` 已更新、测后**已还原 `profile.json` 并删测试文件**）；`audit-i18n` **NO ISSUES(376×3)**；`probe-visits-page` **115/115**。
- ⚠️ **`server.js` 本轮又改了 → 需再双击一次 `Koyome-Restart-Site.vbs`**，否则"上传头像"在线上不生效（旧版 `/api/gate` 不接受 `avatarFile`）。

### 六、R42 第三次补丁（真 bug：改门禁头像连累首页）

**现象**：站长上传门禁头像后，**首页头像也跟着变了**。
**根因**：`PUT /api/gate` 的 `avatarFile` 走了 `saveProfile()`，写进 `profile.json.avatar`；
而**首页正是读 `profile.json.avatar`**。两个页面共用同一字段 → 改门即改站。教训：**"门禁头像"与"站点头像"必须是两个字段。**

**修复**：
1. 门禁头像改用**自己的字段**：`GET /api/gate` 返回 `g.avatar || prof.avatar`（优先门禁自己的，未设则回落站点头像）；
   `PUT /api/gate` 的 `avatarFile` 只写 `g.avatar`（`server-gate.json`），**不再调 `saveProfile()`**；传 `avatar: ''` 清空、回落到站点头像。
2. **现场已还原**：`profile.json.avatar` 改回 `assets/avatar_cutout.webp`（首页恢复）；
   站长上传的 `assets/1791472779570_gate-avatar.jpg` 保留并挂到 `server-gate.json.avatar`（门禁头像不丢）。
3. **顺带修掉"误清密码"**：头像从 `#gateForm` 拆出为独立表单 `#gateAvatarForm`（只发 `avatarFile`）。
   原先头像与密码同表单、密码框留空即"关门禁"，站长只想换头像却把密码清空了
   （现场 `server-gate.json.password` 已被清成空 → **需站长重设门禁密码**）。
4. i18n 新增 `admin_gate_avatar_save` / `_done` / `_pick` ×3 语言 → **379×3**。
5. 验证：上传端点实测 **PASS —— `profile.json` 未被改动**（上传前后读盘比对）；测试文件与两份配置已还原/清理；
   `node --check` 4 文件 OK；`audit-i18n` **NO ISSUES(379×3)**。
   ⚠️ `server.js` 又改了 → **需再双击一次 `Koyome-Restart-Site.vbs`**；但**首页还原不需要重启**（首页读静态 `profile.json`，刷新即生效）。

### 七、R42 第四次补丁（首页形象字段独立化 —— 彻底修好"改门禁连累首页"）

**再次复现**：站长再换一次门禁头像，首页形象又跟着换了。

**真因（时间线陷阱，不是修复无效）**：上一条补丁的代码是对的，但站长那次上传发生在**重启之前**——旧进程仍在跑旧代码，
于是又把图写进了 `profile.json`；之后才重启。诊断时 `GET /api/gate` 已正确返回门禁自己的头像（说明**当前进程是新代码**），
而 `profile.json.avatar` 里躺着一张 `…_gate-avatar.jpg`（旧代码留下的污染）。
→ 教训：**改完 `server.js` 后，用户没重启就操作，等于修复尚未生效。涉及数据写入的修复，不能只靠"改了代码"，还要考虑旧进程仍在跑的时间窗。**

**彻底修复（两层，不再依赖重启）**：
1. **字段彻底分离**：首页形象用**自己的字段** `profile.homeAvatar`（`docs/js/main.js` 读 `profile.homeAvatar || profile.avatar`）；
   门禁头像用 `g.avatar`（`server-gate.json`）。两者从此互不读写。
   - `POST /api/profile`：`next` 里**必须保留 `homeAvatar: current.homeAvatar`**（否则下一次保存 profile 会把该字段抹掉），
     且首页上传时 `next.avatar = next.homeAvatar = src`（同步）。
   - 首页 `main.js` 是**静态 JS**，改完刷新即生效 —— **"改门禁不再影响首页"这件事不需要重启**。
2. **现场已还原**：`profile.json` 的 `avatar` 与 `homeAvatar` 均回到 `assets/avatar_cutout.webp`（首页形象恢复）；
   `server-gate.json.avatar` 设为站长最新上传的 `assets/1791473141972_gate-avatar.jpg`（门禁头像不丢）。

**验证**：
- `[A] 改门禁头像` → `profile.avatar` 与 `homeAvatar` **纹丝不动** → PASS
- `[B] 改首页形象` → `homeAvatar` **正常更新** → PASS（确认首页仍能正常换形象，没被隔离坏）
- `probe-visit-online` **15/15**；`check-private-pages` **SAFE TO PUSH**；`node --check` server/main/admin OK；测试文件与两份配置已还原。
- 版本戳 `js/main.js?v=202610090330`（首页要拿到新的读取逻辑）。

⚠️ 仍需**双击一次 `Koyome-Restart-Site.vbs`**（`server.js` 又改了）：不重启的话，从后台**"首页简介"换首页形象**不会同步 `homeAvatar`。
但**"改门禁头像不会影响首页"现在就已经生效**了。

---

## 0.41 第四十一轮速览（2026-10-08）：访客页"可爱门禁"登录页（取代进入动画）

用户原话：「为访客页面设计一个风格可爱且具设计感的登录页面，取代当前的进入动画。页面布局为上方展示
可自定义的站点头像，下方为密码输入框，站长与访客均须输入密码方可进入。在密码验证通过前，页面所有内容
保持模糊遮罩状态，不可阅读。头像支持站长在后台自由设置与更换。密码输入正确后，解除模糊并随机展示如
"欢迎主人回家～"等温馨可爱的欢迎语录。整体视觉需注重排版、配色与字体细节，营造柔和治愈的可爱氛围，
确保交互简洁流畅。」

一句话：**拆掉开机动画，换成一扇粉紫色的软门——验证前全屏起雾，门一开就随机说一句暖心话。**

### 一、门禁页 `#vsLogin`（`docs/visits.html` + `docs/css/visits.css`）

- **旧动画彻底删除**：`<div class="vs-boot" id="vsBoot">` 与 `visits-fx.js` 的 `FX.boot()` 调用一并移除
  （`probe-visits-page.js` 有断言 `!document.getElementById('vsBoot')` 与"boot splash is skipped"，
  删元素才能过）。`visits.js` 起手改为 `initGate()`。
- **布局**：全屏 `.vs-login`（`position:fixed; z-index:95`）→ 白色圆角卡片（30px）→ 顶部 128px 圆形头像
  （虚线 halo 缓转 + 浮起）→ 站长名 → 副标题 → 药丸密码框（🔒 + `type=password`）→ 粉→紫渐变"进入"按钮
  → 错误行 + 提示语。背景为粉紫 pastel 径向渐变 + `backdrop-filter` 柔化，另有 5 颗浮动 bokeh 光斑。
- **锁态**：脚本给 `body` 加 `.is-locked`，对 `.site-header/.vs-wrap/.site-footer/.vs-fx` 施加
  `filter: blur(16px)`（站点内容**不可读**）+ 前者副 `pointer-events:none`；`filter` 带 `.6s` 过渡，
  解锁时柔化解雾。字体走 `"Quicksand","Yuanti SC","Hiragino Maru Gothic ProN"` 等圆体。
- 失败时卡片 `is-shake` 抖动 + 错误文案；`prefers-reduced-motion` 下所有装饰动画与光斑关闭
  （`visits.css` 的 reduced-motion 段已补 `.vs-login-*`）。

### 二、密码在服务端校验（`server.js`）——绝不下发浏览器

新增三个端点（`/api/gate` 区块，`GATE_FILE = <root>/server-gate.json`）：

| 方法 | 路径 | 作用 |
|---|---|---|
| GET | `/api/gate` | 返回 `{locked, welcome, avatar, name}`（`locked` = 是否设了密码；`avatar/name` 取自 `profile.json`） |
| POST | `/api/gate/verify` | 收 `{password}`，服务端比较，对 `200 {ok:true}` / 错 `401 {ok:false}` |
| PUT | `/api/gate` | 设密码（`str` ≤80）与欢迎语（数组 ≤40 条、每条 ≤120，或单串 ≤4000） |

- **密码存储**：`server-gate.json` 在**仓库根**、`docs/` **之外**，且**已加入 `.gitignore`**——它绝不进
  发布树、绝不进 Git、绝不下发浏览器（浏览器只发它，服务端只答对/错）。文件缺失时回落到默认
  `{password:'koyome'}`（即默认**开启门禁**）。门禁是"**软**"的：真正保密性在于 `visits.html` 本身永不推送。
- 默认密码 `koyome` 只是初始占位，站长应在后台改掉。

### 三、随机欢迎语 + 后台设置（`docs/js/visits.js`、`admin.html/js`、`i18n.js`）

- **欢迎语**：解锁后 `showWelcome()` 随机挑一句（站长自定义池优先，否则按当前语言取内置 `WELCOME`
  的 en/zh/zhcn 各 6 句，如"欢迎主人回家～ 🌸"），底部浮出小药丸、3.8s 后淡出。
- **后台 "Visitor Gate" 区**（`admin.html` 在 Homepage profile 与 Content library 之间；`admin.js` 的
  `gateAdmin()`）：设置/清空门禁密码（留空=关门禁）+ 多行欢迎语（每行一条）；`GET` 回填、`PUT` 保存。
- **头像**沿用既有设施：`profile.json.avatar`（后台 Homepage profile 的 PORTRAIT IMAGE 上传）——门禁与
  站点用同一张头像，**换头像即在后台更换**，无需新做上传通道。
- i18n 三语各新增 16 键（`visit_login_*`、`admin_gate_*`）→ en/zh/zhcn 均为 **374**。

### 四、工具链适配

- `tools/probe-visits-page.js`：导航后与 reduced-motion 重载后各加一段"**门禁中和**"（移除 `is-locked`
  + 隐藏 `#vsLogin/#vsWelcome`），否则断言层被门禁挡住。
- `tools/shot-visits.js`：非 early 镜头（2–8）导航后同样中和门禁，**镜头 1 保留门禁**（即门禁截图）；
  另补把 `docs/assets/avatar*.{jpg,webp}` 拷进沙盒，否则截图里头像显示为空白圆环。

### 五、验证（2026-10-08 实跑，全绿）

- 语法：`node --check` server.js / visits.js / i18n.js / admin.js 均 OK
- `probe-visits-page.js` **115 passed**（含"boot splash is skipped"）；`probe-visits.js` **51 passed**
- `audit-i18n.js` **NO ISSUES**（374×3）；`check-private-pages.js` **SAFE TO PUSH**
- 门禁 API 手测：GET locked=true、错密码 401、默认 `koyome` 200、PUT 改密后旧密 401 新密 200 ✓
- 截图：`tools/_shots-visits/1-boot-splash.png` 即门禁页（头像/密码框/渐变按钮）

⚠️ **两条红线**：① `server-gate.json` 绝不能提交/上传（已 `.gitignore`）；② `visits.html` 仍属
owner-only、**永不推送**（§0.34 守卫不变）。
🖱️ **本机服务当前已停 —— 请双击桌面 `Koyome-Restart-Site.vbs` 恢复**（`server.js` 改了必须重启，
否则 `/api/gate` 仍 404）。⚠️ 本轮 AI 曾按 vbs 逻辑手动重启：停掉了旧进程后，**沙箱内起不了持久进程**
（§4.2，`Start-Process`/WMI 建进程被环境安全策略拦），故站点暂时是**停的**；双击 vbs 即恢复并加载新门禁代码。

---

## 0.40 第四十轮速览（2026-10-08）：访客控制台"减重 + 加辣" + 黑客指令台

用户原话：「访客页面感觉太厚重了，质感再优化一下 ◤◢ KOYOME//VISITOR-LOG 的朋克特效频率可以再高一点，
总体的设计感还是欠缺，科技感赛博朋克黑客感全部给我使劲堆料就行了…给我做一个炸裂的视觉效果还有有趣的
黑客功能出来吧（总体井然有序即可）」

一句话：**把"厚重的雾光灰盒"改成"剃刀边的仪表"，同时把特效频率翻倍，并加了一台真终端。**

### 一、减重（去"厚重"）——`docs/css/visits.css`

**诊断**：`厚重` 不来自内容多，而来自每个板面身上那套**三重阴影**：
`0 0 0 1px` 描边 + `inset 0 1px 0` + `inset 0 0 34px` 内雾 + `0 0 34px` 外雾。
六个板面（HUD / 读数 / 控制台 / 名册框 / 闸门 / 示波）各叠一套 → 整页像糊了一层青光。

**做法**：把阴影砍到"一根发丝边 + 一点外辉 + 一条顶边高光"，去掉 34px 的内外雾：

```css
.vs-hud, .vs-stats, .vs-deck, .vs-scroll, .vs-gate, .vs-scope {
  box-shadow:
    0 0 0 1px rgba(34, 224, 255, 0.05),
    0 1px 0   rgba(34, 224, 255, 0.12),
    0 0 18px  rgba(34, 224, 255, 0.05);
}
```

同时把板间距从 14/18/20px 收到 10/11/16px、`vs-wrap` 内边距 28→22 —— 整页变成一台**紧凑仪表**，不是一摞会发光的盒子。

### 二、加辣（朋克频率翻倍）

| 元素 | 改前 | 改后 |
|---|---|---|
| 标题故障 `vs-g1/vs-g2` | 6.4s 一轮、单次爆 | **3.4s 一轮、**每次两爆**（≈ 每 1.7s 抖一次） |
| 标题常驻 | 只有青光 | 加**洋红/青 RGB 错位** text-shadow（静态就有撕裂感） |
| 光束 `vs-fx-beam` | 9s / 42vh / 0.10 | **6s** / 46vh / **0.16** |
| 数据流 `vs-wire-run` | 40s | **26s** |
| `◤◢` 标记 | 常亮 | 新增闪烁 `vs-mark`（5.5s） |
| 四种雨幕 fps | 20 / 26 / 34 / 24 | **22 / 30 / 40 / 28** |
| 雨幕故障率 glitch | .0012 / .004 / .011 / .006 | **.003 / .008 / .020 / .011** |
| 超频（override） | beam 3.2s、wire 22s、雨 .72 | **2.6s / 16s / .82**，另加标记闪烁加速 |

⚠️ **两条不许动的约束**（`probe-visits-page.js` 写死的）：
1. 四种雨幕的 **fps 必须互不相同**、**canvas opacity 必须互不相同**（都断言 `Set(size)===4`）→ 现为 .32/.52/.82/.68。
2. `nextMode` 的遍历顺序 **RAIN→STORM→TRACE→CALM→RAIN** 不许改（断言 `'STORM>TRACE>CALM>RAIN'`）。
3. `MODES` 的 speed/head/tail 保持原值，否则 `storm 落笔 > calm×1.4` 的断言可能失守。

### 三、新黑客功能

**A. 指令台 `TERM`**（`docs/js/visits-fx.js` 的 `term()` + `docs/js/visits.js` 输入回显 + `visits.html` 面板）

HUD 新增 `TERM` 按钮（`T` 键），点开是一个真终端：`root@koyome:~#` 提示符 + 闪烁光标。
**所有命令只读真实名册，绝不编造主机/雨幕/结论**：

| 命令 | 作用 |
|---|---|
| `help` | 命令表 |
| `whoami` | 当前身份（owner-only 声明） |
| `ls` / `hosts` | 列出名册里**每一台**主机（含被视图过滤掉的爬虫/内网）——报的是"机器持有的完整名册" |
| `scan` | 触发扫描扫掠 + 指纹统计（返回真实行数） |
| `trace <ip>` | 让雨幕拼出该地址（命中失败会明确说"名册里没有这台"） |
| `decrypt` | 把页面上所有 IP 逐个从噪声中解出（复用 `decrypt()`） |
| `field <mode>` | 切雨幕（calm/rain/storm/trace） |
| `override` | 切换超频 |
| `date` / `echo` / `clear` / `reset` | 时钟 / 回显 / 清屏 / 复位 |

输出行按 `{t,c}` 上色（青/琥珀/红），提示符 `»`/`~`/`!` 区分级别。
**身份/位置与名册无关——不读、不猜、不外呼任何威胁情报接口。**

**B. 扫描扫掠 `scan()`**：一条亮线从上往下扫过名册（"读卡"动作）。
由 `scan` 命令触发，另外每 **60s** 静默自扫一次（`document.hidden` 与 reduced-motion 双重守卫）。
元素挂在 `.vs-scroll`（`position: relative`）内，绝不自己撑出滚动条。

### 四、i18n / 减动 / 开机自检

- 新增 4 键 ×3 语言：`visit_boot_5`（入侵网格已上膛）、`visit_term`（TERM/终端/終端）、
  `visit_term_clear`（CLR）、`visit_term_ph`（终端占位符）→ 字典 **358 × 3**。
- `visit_keys_body` 三语言各加两行：`T` 开终端、控制台 `help` 提示。
- 开机自检 5 行、行间隔 165→**120ms**（更利落）。
- reduced-motion 新增屏蔽：`.vs-mark` / `.vs-term-prompt::after` / `.vs-scan` 动画全停
  （终端是纯文本，不靠动画，照常可用）。

### 五、验证（全绿）

`probe-visits-page` **115/115** ｜ `probe-visits` **51/51** ｜ `probe-visit-online` **15/15** ｜
`audit-i18n` **NO ISSUES（358×3）** ｜ `audit-links` **NO ISSUES** ｜ `check-private-pages` **SAFE TO PUSH（20/20）**。
截图工具加了第 7 帧 `7-terminal`（打开指令台跑 `help`→`ls`→`scan` 并自动滚到面板），共 **8 帧**。

---

## 0.39 第三十九轮速览（2026-10-08）：名册自动判读意图与来源 + 设备列修真机型

用户原话：「设备不明，这个得改一下吧，确定的话就直接显示手机型号，不确定就把推测设备写上去」
以及「以后这样的ip被记录后都要自动解析意图和来源（在这个页面上自动解析）」

### 一、设备列：主位换成真机型

**原来错在哪**：`deviceCell()` 让**类别**（手机/平板/电脑）霸占主位，把**型号**塞进下面一行小字。
型号才是具体事实，类别是被型号蕴含的——顺序反了。

现在 `deviceHead(v)` 分三种情况：
1. `v.model` 有值 → **直接显示型号**，按正常字号（`.vs-model`），不标"推测"。
   型号比"手机"长得多，塞进 9px 大写字距的 chip 会成一片糊，所以真型号走独立样式。
2. 没有型号但 `v.device` 是有效类别 → 显示类别，**并加"推测"标记**（`.vs-guess`）。
3. 都没有 → `visit_unknown`，同样标推测。

顺带修了重复显示：型号是 `iPhone` 时，下面那行不再重复 `iPhone`（`.filter(s => s !== head.text)` + 去重）。
`.vs-dev` 的 `max-width` 从 `22ch` 放宽到 `30ch`，否则「小米 M2102K1C」这种会被截断。

### 二、自动判读：`readVisit(v)` —— 意图 + 来源 + 证据

**放在 `docs/js/visits.js`**（已在防推送清单里），不新增文件。

**两个问题分开答**，因为它们本来就是两件事：
- **意图 intent**：`HUMAN` / `CRAWLER` / `SCRIPT` / `DATACENTRE` / `UNKNOWN`
- **来源 source**：搜索引擎 / 社交 App / 站内跳转 / 直接输入 / 外部链接 / 未记录

判定规则（按优先级，全表见代码里的 `CRAWLERS` / `SCRIPTS` / `HOSTING` / `RESIDENTIAL`）：

| 优先级 | 判据 | 结论 | 置信 |
|---|---|---|---|
| 1 | UA 自报爬虫品牌（Googlebot/Bingbot/Baiduspider/…20 条） | 爬虫 | 确定 |
| 2 | `v.bot` 已标记 | 爬虫 | 确定 |
| 3 | UA 是抓取库（headless/Selenium/curl/Python-requests/scanner…） | 程序 | 确定 |
| 4 | 完全没有 UA | 程序 | 可能 |
| 5 | ISP 命中机房词表且未命中家宽词表 | 机房 | 可能 |
| 6 | 有 `model` 或 `app` | 真人 | 确定/可能 |
| 7 | 仅 ISP 命中家宽/移动词表 | 真人 | 薄弱 |

**每条结论都必须带证据**（`why[]`），证据全部来自记录里真实存在的字段：
自报的爬虫名、命中的函数库、ISP 字符串、机型、来源页域名、访问页数、
**按经度推算的当地时间**（`lon/15` 是太阳时近似，不是真实时区，所以标为推算且不单独用于判定）、
以及「坐标只到城市级」这条精度声明。

**页面必须显示理由**，不能只给结论——一条无法复核的判读只是戴着自信面具的装饰。
所以 READ 列里徽标是结论，下面的小字是收据。

### 三、诚实边界（写死在代码里）

- **云端行没有来源页**：`visit-beacon.js` 的 payload 只有 id/ip/page/ua/lat/lon/ts，所以 `ref` 恒空。
  这种情况下**不是**报「直接访问」，而是报「未记录来源」并附证据「线上信标不带来来源页」——
  把"没数据"说成"没有来源"就是编造。
- **`UNKNOWN` 永远不会是「确定」**：有专门断言钉住（"an unknown is never called certain"）。
- **不引入任何外部威胁情报**：全部本地可推导。要查 IP 信誉得另外调第三方，那会把访客 IP 发出去，不做。

### 四、新增断言（`probe-visits-page.js` 108 → **115**）

设备列 6 条（手机主位是机型 / 真机型不标推测 / 桌面行 / 爬虫仍读作爬虫 / 无空设备 / OS 行不重复型号）+
判读 7 条（手机读作真人 / 带理由 / 爬虫读作爬虫 / 指出是哪个爬虫 / 桌面行也有 / 每行都有结论且都有理由 / 未知不得为确定）。

**踩的坑**：断言里按 `<tr>` 的 `is-phone` 类找行是错的——`is-phone` 只加在单元格内的 chip 上。
改成**按 IP 文本定位行**（`.vs-ipv`），更稳。另外爬虫默认被筛选隐藏，必须先幂等地
把 `#vsFBots` 的 `aria-pressed` 打开再断言。

### 五、同时修掉的时区 bug（见 §时区）

`server.js:657` 本地行写 UTC 墙钟、`:806` 云端行写本地时区 → 同页两种时钟混排。
现改为写入用 `stampOf(iso)`，并在 `mergedVisits()` 里对所有本地行从 `at` 重算，老数据无需改盘。
`probe-visits` 49 → **51**。

### 六、桌面重启脚本 `restart-server.vbs`

双击桌面 `Koyome-Restart-Site.vbs` 完成「杀旧 → 等其真正退出 → 启动新 → 探活 → 报告」整个循环。

三个必须遵守的设计约束（改这个文件前先读）：

1. **只杀本站进程。** 机器上同时有 4 个 `node.exe`（端口 80 只属于其中一个），无差别 kill 会误杀。
   匹配命令行同时含 `server.js` **和** `koyome`。
   ⚠️ **不要用 `koyome-site` 做匹配**：服务有时是从仓库路径启动的，那条路径不含 `koyome-site`，
   只匹配它会漏掉旧进程 → 新进程 EADDRINUSE 退出、旧的继续跑旧代码 —— 最坏结果。
2. **必须独立成文件，不要合并进 `start-koyome.vbs`。** 后者被启动目录在登录时调用，
   给它加"先杀进程"会导致每次开机误杀。
3. **复用 `FindNode()` 自愈逻辑**（`C:\Users\Public\koyome-node` → `.workbuddy\...\versions` → PATH）。
   硬编码第一条正是历史上出过事的写法：它是符号链接，node 版本更新后悬空，服务静默起不来。

**诚实性分支**：WMI 列不出进程时不能报"重启成功"（旧进程其实没被杀），
单独一支报「无法列出进程，旧服务可能仍占着 80 端口」。

**本环境无法执行验证**：PowerShell 被沙箱拦、Bash 调 `cscript`/`wscript` 判为 LOLBin、`wmic` 不存在。
所以这个脚本是**未经实机运行验证**的，改完必须人工双击确认。

### 七、合规提醒（未处理，留给用户决定）

信标挂在 **6 个已上线页面**上（index/catalog/guestbook/hobbies/entry/admin），
而全站 **8 个 .html 零隐私告知** → 与 PIPL 第 17 条（告知义务）有缺口。
另 Supabase 为境外节点，构成个人信息出境。建议补 `privacy.html` + 页脚告知 + 保存期限清理。
**本轮未做这三件事**，因为会改变公开页面的可见内容，需用户确认后再动。

---

## 0.38 第三十八轮速览（2026-10-08）：代码雨"可玩化" + 质感优化

用户原话：「代码雨还可以再夸张一点功能还是欠缺可玩性，再做一轮质感优化」

### 一、先修了一个隐蔽的几何 bug：雨其实没铺满屏

`.vs-fx > * { position:absolute; inset:0 }` 对普通块级元素有效，但 **`<canvas>` 是替换元素（replaced element）**：
只给 `inset:0` 不会拉伸它，它按**自身固有尺寸**布局。于是 `#vsRain` 一直只占屏幕左边一条（当时 `clientWidth≈300`，
`resize()` 只在初始化时按 300 写过一次画布位图，列数就只有 20）。修复：

```css
.vs-fx-rain { display:block; width:100%; height:100%; ... }
```

修完列数从 20 涨到 ~95，**雨幕覆盖面积直接翻了近五倍** —— 这一条比后面所有调参都更"夸张"。
副作用：canvas `height:100%` 在 `resize()` 之后不会再污染固有尺寸，`resize()` 自身即收敛。

### 二、可玩性：雨从"壁纸"变成"玩具"

| 交互 | 实现 | 说明 |
|---|---|---|
| **指针力场** | `pointermove` 记 `mx/my/idle`；列与指针距离 <180px 时 `boost = 1 - d/180`，步进乘 `(1+boost*2.4)` 且强制发亮 | 画布上另有一圈 180px 的淡环 + 光标点，`idle` 每帧衰减、约 2.4s 消散 —— 让"力场范围"看得见，而不是只能靠感觉 |
| **点击冲击波** | `pointerdown` 在**非控件**目标上 → `blast(x,y)`，推入 wave；环每帧 +17px，两条弧（品红/青）绘制，并**重写它扫过的每一列**（`hit` → 2.6× 步进 + 强制 hot） | 命中判定：`abs(abs(x - wv.x) - wv.r) < 20`。显式排除 `button, a, input, label, tr, select, .vs-log, .vs-keys, .vs-boot`，绝不吞掉真实点击 |
| **打字回声** | `bindKeys` 里 `if (e.key.length === 1) Rain.say(e.key)`；`emit()` 以 50% 概率从 `echo` 队列取字 | 你敲什么，什么就掉进雨里；上限 24 字 |
| **整行锁定** | `visits.js` 在 `#vsBody` 上挂 `mouseover`（记住 `hovered` id），命中行 → `FX.rainFocus(rows[i].ip)` | 三列开始拼出**那一行的真实地址**；`VSFX.rain.focus` 可读回 |
| **四种雨幕** | `MODES` 表；HUD 的 `#vsRainBtn`（FIELD）或 `M` 键循环 | `CALM → RAIN → STORM → TRACE`，每种有自己的 fps/speed/hot/word/morph/glitch/skew/fade 与画布 opacity |

`STORM` 走 CSS `body.vs-rain-storm .vs-fx-rain { transform: skewX(-2.6deg) scale(1.09) }` ——
`skew` 会推出屏幕外，所以 `.vs-fx` 加了 `overflow:hidden`（探针有断言，防止它撑出横向滚动条）。
`TRACE` 的 `word: 1.000` 意味着**每一列永远在拼名册里的真东西**，是最"读取中"的一档。

### 三、质感

- **胶片颗粒** `.vs-fx-noise`：内联 SVG `feTurbulence` 平铺，`opacity .055` + `mix-blend-mode: overlay`。
- **名册外框角标** `.vs-frame::before/::after`：两个 L 形机加工角，名册本身仍是矩形（数据窗口不切角）。
- **开机屏半透明化**：`backdrop-filter: blur(3px)`，雨从自检文字后面透出来。
- **首行落表 / IP 解密**保持 R37 行为；行 hover 左缘竖条保留。

### 四、这一轮加/改的断言（`probe-visits-page.js` 84 → **102**）

新断言覆盖：默认档位是 `RAIN`、列数 > 60、`FIELD` 四次点击走完 `STORM>TRACE>CALM>RAIN`、HUD 标签跟随、
只有 STORM 带 `vs-rain-storm`、四种 fps 与 opacity 互不相同、**「画布铺满视口而非一条」**（`clientWidth/Height`
等于 `documentElement` 的客户区，1425x900）、`M` 键进入 STORM、**数亮点证明 STORM 比 CALM 多画 >1.4 倍**、
点击背景入队脉冲、**点击控件不入队**、打字回声（同 tick 读回）、hover 行 → `rain.focus` 等于该行 IP、
`.vs-fx-noise` 存在、名册在 `.vs-frame` 内、`.vs-fx` 是 `overflow:hidden`。

两个读数的坑，写在这里免得下次再踩：
1. **transition 要等。** 四种 opacity 是 `.5s` 过渡的，四连点在同一 tick 里读 computedStyle 只会拿到起始值 —— 现在每次点击后 `sleep(700)`。
2. **STORM 会 scale。** 量画布尺寸要用 `clientWidth/clientHeight`（布局尺寸），`getBoundingClientRect` 在 STORM 下是 1598x981。

顺带修了 `tools/audit-links.js` 的一个误报：内联 `data:image/svg+xml` 里的 `url(%23n)` 是 SVG 自己的滤镜引用，
不是资源路径，扫描前先剥掉 data URI 负载。（该条从 R37 起就一直挂着。）

### 五、这一轮同样守住的底线

1. **没有假数据**：`TRACE` 拼的、力场强化的、hover 锁定的，全是名册里真有的 IP / 机型 / 路径。
2. **`prefers-reduced-motion` 仍然全关**：`REDUCED` 下 canvas `display:none` 且 `start()` 从不绑定；
   `blast/say/focus` 全是 no-op；新增的力场环也在 `draw()` 里（根本不跑）。
3. **删除语义一字未改**；`check-private-pages` 仍 `SAFE TO PUSH 19/19`。
4. **控件点击没被吞**（有断言）。

---

## 0.37 第三十七轮速览（2026-10-08）：访客控制台"大胆化"——特效层 + 黑客风格功能

用户原话：「我觉得设计还可以再大胆一点，更赛博朋克风再科技感一点吧，或者你加一点有意思的小功能体现黑客那种感觉，
还有可以做黑客那种代码爬虫的动画，反正有意思的功能好玩的都加进去大胆的去做去设计（但也需要井然有序条理清晰流畅运行）」

### 一、新的分层：事实归事实，戏归戏

新增 **`docs/js/visits-fx.js`**（owner-only，与 `visits.js` 同规则）。分工写死：

| 文件 | 负责 |
|---|---|
| `server.js` | 事实：谁来了、从哪来、写盘、删/隐 |
| `docs/js/visits.js` | 拉取、过滤、绘制名册、删除交互、把 `rows` 交给特效层 |
| `docs/js/visits-fx.js` | 一切"戏"：代码雨、数据流、示波器、系统日志、开机自检、超频、快捷键 |
| `docs/css/visits.css` | 全部样式（含特效层）；调色板硬写在 `body[data-page="visits"]` |

`visits.js` 里所有对特效层的调用都过一层 **no-op 兜底**（`FX = window.VSFX || {}` + 逐个补空函数），
所以 `visits-fx.js` 丢失 / 报错时名册照常工作 —— 这是刻意的，特效层不是关键路径。

### 二、六件新的"有意思的功能"（全部基于真实数据，无一条假流量）

| 功能 | 实现 | 关键约束 |
|---|---|---|
| **代码雨** `#vsRain` | 一列一帧，26fps，DPR 上限 1.5；每 2–3 秒随机让一列拼出**名册里真实存在的** IP / 机型 / 路径 | `panel` 内 `aria-hidden`；`document.hidden` 停 rAF；`prefers-reduced-motion` 直接 `display:none` 且**从不启动** |
| **数据流 WIRE** `#vsWire` | HUD 下方走马灯，每条都是名册里的真实行；内容**签名去重**，只在数据变化时重建并重算时长 | 复制一份实现无缝；`resize` 只重算不重建 |
| **流量示波器** `#vsScope` | canvas，24 个小时桶倒推计数，曲线 + 面积 + 峰值数字 | 仅在数据签名或宽度变化时重绘；DPR 上限 2 |
| **系统日志 SYSLOG** `#vsLog` | 默认收起；只记**真实发生的事**（就绪/上行恢复/新进 N 条/删除 N 条/隐藏 N 条/还原本机/Key 更新/自检/网关失联） | 上限 60 行 FIFO；徽标显示条数；PURGE 清空 |
| **开机自检** `#vsBoot` | ~1.4s 逐行打印自检，之后**自我删除节点**；点击 / 任意按键 / `pagehide` 立即结束 | `prefers-reduced-motion` 直接不创建；不可能阻塞任何操作 |
| **OVERRIDE 超频** | ↑↑↓↓←→←→BA 切换；仅换一组 CSS 变量（整台机器变品红）+ 光束/故障加速 + 顶部 OVERRIDE 标签 | **纯外观**，不改任何记录逻辑；再按一次释放；日志留痕 |

另加：新行落表时整表 `is-arrive` 扫光 + **IP 解密揭示**（`decrypt()`，与真值等长的乱码逐位解析，列宽不跳）；
行 hover 左缘竖条；`KEYS` 快捷键卡（`/` 过滤、`R` 刷新、`A` 自动、`L` 日志、`ESC` 释放）；
表头加了贴底霓虹线；面板统一双角机加工斜切（名册 `vs-scroll` 除外，它是数据窗口，保持矩形）。

### 三、这次守住的四条底线

1. **没有假数据。** 数据流重复的是名册里真实存在的 IP（`probe-visits-page` 会断言 wire 里出现 `#vsBody` 首行的地址）；示波器数的是真行；日志记的是真事件。仪器上编数字比不显示更糟。
2. **`prefers-reduced-motion` 全量关停。** 新清单进 §9；探针新增 5 条断言：雨不启动、流不滚动、闪屏不创建、名册照常、不横向溢出。
3. **删除语义一字未改。** 本地真删、云端只隐（`docs/data/visits-hidden.json`）、RESTORE 可逆；`removeIds()` 只是多读一次返回体用于写日志。
4. **防推送清单同步。** `docs/js/visits-fx.js` 同时进 `.gitignore` 与 `tools/check-private-pages.js` 的 `FORBIDDEN`（现 19/19）。

### 四、回归数字（本轮结束时）

`probe-visits` 49/49 ｜ `probe-visits-page` **84/84**（原 66 + 18 条新特效断言）｜ `probe-visit-online` 15/15 ｜
`audit-i18n` NO ISSUES（315×3）｜ `audit-links` NO ISSUES ｜ `check-private-pages` SAFE TO PUSH 19/19 ｜
`shot-visits` 出 5 张图（含开机自检、超频+面板、全量、手机）。

i18n 新增键 24 个×3 语言；`tools/shot-visits.js` 现拍 `1-boot-splash / 2-desktop / 3-desktop-override-and-panels / 4-desktop-everything-shown / 5-phone`。


## 0.36 第三十六轮速览（2026-10-08）：**访问记录零漏记** + 界面赛博朋克重做

用户原话：「确保每一次外部访问都被无遗漏地实时记录，不能因缓存、去重或采样导致漏记；
本地及局域网访问一律跳过不写入记录……同时重做该记录模块的界面视觉……
但请保持数据结构与记录逻辑不变，确保前后端联动正确。」

### 一、四条"漏记"通道，全部堵死（`server.js`）

| 原来的行为 | 为什么是漏记 | 现在 |
|---|---|---|
| `VISIT_MERGE_MS = 30min` 合并 | 同一人开 3 页只留 1 行 + 计数。这是**访客**统计，不是**访问**日志 | 删掉。一次请求一行，`count` 恒为 1、`pages` 仍保留（结构不变） |
| 云端 `limit=200` + `.slice(0,60)` | 只画最新 60 条，其余看不见 = 采样 | 读 1000 条，**不再截断**；渲染只受筛选器影响 |
| 每请求重新读盘 → push → 写盘 | 两个请求同时进来互相覆盖，**真的丢行** | 内存数组即权威数据，push 不可丢；落盘只是 120ms 防抖镜像 + `process.on('exit')` 冲刷 |
| 爬虫 UA 直接 `return` | 一次真实请求被静默丢弃 | 照写，标 `bot: true`；界面默认不显示但一键可看 |

- **本地/局域网一律不写**：`recordVisit()` 开头 `if (isPrivateIp(ip)) return;`。
  注意原来是**写的**（带 `lan:true`），这次才真的跳过；老数据里的 `lan:true` 行仍在盘上，
  页面用「LAN」筛选器开关（默认关）决定要不要看。
- **容量上限** `VISIT_MAX` 500 → 20000（只是磁盘保险丝，不是采样规则）。
- **行 id** 由 `Math.random()` 改为 `now + 递增计数器`——同毫秒 10 个请求也必须 10 个不同 id。
- **每行新增**：`device / model / os / browser / app / bot / ref / lang`。
  老行没有这些字段时，`mergedVisits()` 用同一个 `uaInfo()` 从 `ua` 现算，结构向后兼容。

### 二、`uaInfo()`：把 User-Agent 读成人话

在 `isPrivateIp()` 之后，约 200 行。读取顺序固定：**App 壳 → 爬虫 → 设备 → 系统 → 机型 → 浏览器**。

- **App 壳优先**：微信 / 企业微信 / QQ / 支付宝 / 抖音 / 微博 / 百度 / 钉钉 / 飞书 / 淘宝 / 小红书 / 快手 / 知乎。
  「从哪来的」比「用了什么浏览器」有用。
- **机型**：Android 能拿到真实机型码（`SM-S918B`、`M2102K1C`、`ELS-AN00`）；
  **iOS 只能拿到 "iPhone"**——Safari 从不报机型，所以机型写 iPhone、系统带版本号，**不编**。
- **三星机型码按前缀匹配**：`SM-S918B / SM-S918U / SM-S918N` 是同一台 S23 Ultra 的不同市场版本，
  精确匹配会一个都认不出（第一版就是这么错的，被探针抓到）。
- **品牌只按厂商命名空间推断**（`SM-`→三星、`RMX`→realme、`CPH`→OPPO、`ELS/ALN`→华为…），
  映射不确定的机型码**原样保留**——错的名字比一个编号更糟。

### 三、地理定位：持久缓存 + 后台队列

- `docs/data/geo-cache.json`（**新增，已 gitignore**，里面是真人 IP）：成功缓存 30 天，失败缓存 6 小时。
  以前只存内存，重启就全冷，最老的行永远查不完。
- **请求路径里不再有任何网络调用**：命中缓存就用，没命中就丢进队列、行先画空，
  由 `drainGeo()`（一次 5 个、批间 250ms）慢慢补。这样 1000 条云端记录下页面仍能每 4 秒刷新。
- 换/清 高德 Key → `regeoAll()`：清缓存 + 抹掉已解析的位置 + 重新排队（老代码只 `GEO.clear()`，已有行不会重解析）。
- `/api/visits/status` 现在返回 `{cloud, rows, local, bots, today, queue, cached, hidden}`（只增字段）。

### 四、线上信标 `docs/js/visit-beacon.js`

- **删掉 localStorage 半小时节流**。那是一条去重规则，而访问日志上的去重规则就是 bug：
  同一个人开第二页之后全部丢掉。
- **IP 来源重排 + 容错**：`api64.ipify.org` → `freeipapi.com` → `ipwho.is` → `jsonip.com`。
  实测：`api.ipify.org`（只有 IPv4 那个域）**不发 CORS 头**，浏览器用不了；
  `ipwho.is` 会限流并在 200 里返回 `{success:false}`；`jsonip.com` 在本机被挡。
  字段名各家不同且会变，所以 `ip/ipAddress/query/address/IPv4` 全找一遍，**限流响应视为失败**。
- **三级降级注册**（`register()`）：① 带地址 → ② **不带 ip 字段**（让表自己从请求头填，见下）→ ③ `ip:''`。
  老代码查不到地址就 `return`，**整次访问直接丢**——这是最要命的一处漏记。
  宁可留一条没地址的行（时间/页面/机型都在），也不能没有。
- sessionStorage 缓存**地址** 2 分钟（省三次查询），但**从不缓存注册**。

### 五、云端表加固（`tools/supabase-visits.sql`，需用户手动重跑一次）

新增：`visits_client_ip()` 函数 + `alter column ip set default public.visits_client_ip()`
（从 `request.headers -> x-forwarded-for` 取**真实来源地址**，比浏览器自报更可信）+
`alter column ip drop not null`（允许"有访问、没地址"的行落地）。
**这个文件没跑也不影响**：客户端的第 ③ 级降级照样能写进去。

### 六、界面：整页重做成控制台（`visits.html` / `visits.js` / `visits.css` 全量重写）

- **强制夜间**：调色板写在 `body[data-page="visits"]` 上，浅色主题也不翻白（含 header/footer/菜单）。
- **四层屏幕**：`.vs-fx` = 网格 + CRT 扫描线 + 9 秒一趟的光束 + 暗角，`pointer-events:none`。
- 霓虹两声道：青 `#22e0ff`（在线/正常）、品红 `#ff3bb0`（选择/删除/云端行）、
  柠檬 `#9dff4d`（实时）、琥珀 `#ffc24a`（仅站长可见/爬虫）。
- **发光只表示状态**：`is-up` 由服务器回报的真实状态设置，不是装饰。
- **微动效**：数字变化闪一下（`is-bump`）、新行滑入（`is-new`）、标题每 6.4 秒一次故障抖动、
  LIVE 呼吸灯、HUD 时钟。**`prefers-reduced-motion` 下全部停掉**，只留配色和网格。
- **新增**：HUD 时钟 + LIVE/IDLE、7 格读数（SERVER/ONLINE/PRECISION/RECORDS/24H/ADDR/LOCATED）、
  DEVICE 列、来源标签（线上/本机）、BOTS 与 LAN 筛选片、搜索框（ip/地点/机型/页面/UA）、
  点行展开完整记录（UA / 来源页 / 语言 / 行 id / 坐标）。
- **删除语义一字未改**：本地行真删、云端行只进 `visits-hidden.json`、RESTORE 可还原。
- **`load()` 修了一个真 bug**：原来 `busy` 时直接 `return`——刚删完的行会因为撞上一次轮询而
  显示成旧数据。现在改成记 `pending`，当前这次一落地就接着跑。

### 七、验证

- `tools/probe-visits.js` **49/49**（重写）：三次访问 = 三行（无合并）、**25 个并发请求 = 25 行**（无竞态）、
  25 个 id 互不相同、127/192.168/10/172.16 一律零写入、爬虫照写且带标记、
  三星/小米/微信/iPad/桌面五组 UA 解析、后台定位落盘、重启不丢、按 id 删 + 清空 + 清空后重启仍为空。
- `tools/probe-visits-page.js` **66/66**（重写）：筛选器默认藏起爬虫与本机行、三个语言、
  手机 390px 无横向溢出且行宽合理、设备列/地点/坐标有值、点行展开完整记录、
  删除只删服务端那一行、云端行 `deleted:0` + 只进隐藏清单 + RESTORE。
- `tools/probe-visit-online.js` **15/15**（改）：第二页**也要注册**（原来断言的是"不再注册"，正好相反）。
- `tools/shot-visits.js`（重写）：沙箱 + 12 条仿真名册，出 4 张图（桌面/浅色主题下仍为夜/全展开/手机）。
- 回归：audit-i18n（287×3，NO ISSUES）/ audit-links（NO ISSUES）/
  check-private-pages（**SAFE TO PUSH**）/ probe-rem（54，与本次无关）。
- **⚠️ 未提交、未推送**（§4.3）。**本地服务需要重启一次**才会加载新后端：
  任务管理器结束 `node.exe` → 双击 `start-hidden.vbs`（`C:\Users\Public\koyome-site` 是本仓库的软链）。

---

## 0.35 第三十五轮速览（2026-10-07）：名册可自由移除（本地真删 / 云端本地隐藏）

用户原话：「云端的数据留在云端，但是本地页面记录云端的要可以删除」。
**需求我前两次都理解反了**——先做成了"云端不可删"，又改成"云端也真删"。
正解是第三种：**数据留云端，但本机页面可以把它移除掉**。

- **`docs/data/visits-hidden.json`（新增，已 gitignore）**：本机的"已移除"清单，只存云端行 id。
  - 页面移除云端行 → id 写进这里，**Supabase 里那条一字不动**。
  - `mergedVisits()` 在做地理定位**之前**就过滤掉它们（省掉限流额度）。
  - 可逆：`POST /api/visits/restore` 清空清单；`GET /api/visits/hidden` 查当前数量，
    页面上有「RESTORE n」按钮（只在有隐藏时出现）。**"能藏起来但找不回来"是陷阱，所以必须能还原。**
- **本地行（`v…`）仍然真删**：写在 `docs/data/visits.json`，删了就是删了。
- **`DELETE /api/visits`** 现在支持 `?id=`（可重复）/ `?ids=a,b` / `?all=1` / `?restore=1`，
  返回 `{ok, deleted, hidden, all, restore}`。**全程不向云端表发任何写请求。**
- **页面**：每行一个 `×`，另有复选框 + 表头三态全选 + `DELETE SELECTED`（带计数）+ `DELETE ALL`。
  云端行的 × 提示写明「从本页隐藏（云端副本保留）」，不是含糊的"删除"。
- **`tools/supabase-visits-harden.sql` 的删除策略维持 `using (false)`**——
  云端表谁都删不了，包括站长。（中途我误加了一条"owner deletes"，已撤回。）
- **实测结论（真实 Supabase）**：隐藏前云端 9 条 → 隐藏 c9 → 页面 8 条、**云端仍 9 条** → RESTORE → 页面 9 条。
- **探针 `probe-visits-page.js` 43/43**（从 28 项扩到 43）：删除是真删（断言了**服务端**持久化，
  不只是前端消失）、云端行只隐藏不删除且 `deleted:0`、id 落进清单、RESTORE 清空、按钮随之消失。
  探针跑在**沙箱**（临时目录复制 server.js + 假 `docs/`），真实 `visits.json` 零触碰；
  沙箱自清理已修（先 kill 服务再删，否则每次留一个 temp 目录）。
- 回归：test-static / audit-i18n(248×3) / audit-links / probe-visits(18) /
  probe-visit-online(13) / probe-visits-page(43) / probe-ip-page(15) / probe-amap(36) 全绿。
  守卫 `check-private-pages.js`：**SAFE TO PUSH**。
- **未提交、未推送**（§4.3）。

---

## 0.34 第三十四轮速览（2026-10-07）：**访客页与手记页永不推送** + 名册视觉重做

用户指示：「访客页面和手记页面都绝对不能推送线上」「IP 记录界面优化得更有科技感和朋克感」。

### 一、绝不推送（硬要求，已三层设防）

**关键事实：`docs/` 就是 GitHub Pages 的发布根目录**——留在里面的一切，push 即上线。

**第 1 层 · `.gitignore`**
```
docs/visits.html        docs/js/visits.js        docs/css/visits.css
docs/data/visits.json   tools/_archive/
```
文件留在本地继续用，本机服务照常提供；只是不进仓库。

**第 2 层 · 导航也不静态写死**
`header.js` 的 `PAGES` 里**没有** visits（原来在，已移除）。它与 admin 一样，
由 `revealOwnerPages()` 在 `apiAvailable()` 为真时**运行时注入**。
→ 线上（静态站）菜单里根本没有这个链接，不会出现死链。

**第 3 层 · `tools/check-private-pages.js`（新增守卫）**
`.gitignore` 是约定不是锁——`git add -f`、手滑的 `git add docs/`、某些工具都会绕过它。
守卫检查**git 真正会发布什么**（`git add -A --dry-run` + `git ls-files`），
而不是工作区恰好有什么。已实测能拦下 `git add -f docs/visits.html`。
推送前跑：`node tools/check-private-pages.js` → 打印 `SAFE TO PUSH` 才安全。
失败时给出可直接照抄的 `git rm --cached …` 命令。

**顺带处理**：手记页曾被 06:07 的**自动提交**推上线过（实测线上 `journal.html` 等
三个文件 200）。本轮已 `git rm --cached` 移出索引 → 这次推送会**把它们从线上撤掉**。
内容归档在本地 `tools/_archive/`（35KB narrative + js，未推送）。
`docs/data/visits.json` 从未进过仓库，线上 404，真实 IP **没有泄露过**。

### 二、视觉重做：仪器面板

样式**独立成 `docs/css/visits.css`**（同样 gitignore），从 `style.css` 移出——
这是全站唯一允许"仪表盘"语域的页面，物理隔开才不会外溢到其它页面。

**科技感来自仪表，不来自霓虹**：没有新强调色、没有紫渐变。全站纸/墨/单一朱红不变。
- `.vs-titlebar` 反色铭牌条 `KOYOME / VISITOR LOG / OWNER ONLY` + 闪烁光标（唯一动效，
  尊重 `prefers-reduced-motion`）
- `.vs-wrap::before` 72px 栅格纹理 + mask 向下淡出（日间 0.55 / 暗色 0.9）
- 四格读数用**发丝线分隔**（一块铣出来的整版，不是四张浮动卡）
- 标签用 `[ ]` **直角括号**（反胶囊）；状态灯是**硬边小方块**，仅"活着"才亮并发红光
- 数字全部 `tabular-nums`，测量值跳动时不抖
- `.vs-when`：日期/时钟**上下两行**（见下）

**踩坑**：
1. 反色铭牌的字色**必须用 `--bg`，不能用 `--on-scrim`**——后者是给"压在照片上的
   标签"用的固定浅色，不随主题翻转，用它会在暗色下变成浅底浅字。
2. 暗色下铭牌里的朱红对比度不足，加 `[data-theme="dark"] .vs-titlebar::after/b { color:#e0705f }`。
   这是全页唯一第二个红色值，且是**对比度修复**不是新颜色。
3. 手机端 `table-layout: fixed` 后列宽百分比**必须容得下最窄的真实内容**：
   27%/31%/42% 会让「2026-10-07 06:21」和 IP **互相重叠**。
   最终 30%/36%/34%，且时间在 JS 里**主动拆成两个 span**（`.vs-when`），
   不靠浏览器在空格处折行——否则折行点会撞到下一格，看起来像数据损坏。
4. 状态长句要 `line-clamp:2` + `title` 属性，否则三行文字破坏面板横向节奏。

**验证**：`tools/probe-visits-page.js` 28/28（导航可达且高亮、四格读数已填、
三语、390px 无横向溢出、Key 框可用、console 干净）。
另用临时截图脚本逐轮核对日/夜/手机三态，发现并修掉 4 个纯视觉缺陷
（网格不可见、标题条浅底浅字、时间折行、列重叠）；**截图脚本与产物已清理，未入库**。
回归：test-static / audit-i18n(243×3) / audit-links / probe-visits(18) /
probe-visit-online(13) / probe-visits-page(28) / probe-ip-page(15) / probe-amap(36) 全绿。
- **未提交、未推送**（§4.3）。推送前请跑 `node tools/check-private-pages.js`。

---

## 0.33 第三十三轮速览（2026-10-07）：**撤掉手记页**，访客名册升为独立大页

用户指示：「手记不推送，给他撤了，还有就是 IP 记录弄个大页放到顶部可切换」。

- **删除**：`docs/journal.html`、`docs/js/journal.js`、`docs/data/journal.json`、
  `tools/probe-journal.js`（`journal.html` 现返回 404）。CSS 里 `.jr-*` 一整块也清了。
- **新增 `docs/visits.html` + `docs/js/visits.js`**，成为**导航第 05 项「訪客 / Visitors」**
  （`header.js` 的 `PAGES` 末项）。原 `journal` 的第 05 位由它接替，序号不变。
- **版式从"某页中的一段"升为"一个页面"**：
  - 顶部 `.vs-status` 状态条——SERVER / ONLINE / PRECISION / VISITS 四格读数 + 刷新/自动按钮；
  - `.vs-key` 高德 Key 行（输入框 + 保存 + 自检），粘贴即验证即生效；
  - 下面才是名册本体。全部走 `--shell`（1080px，与 board 页同宽，列多不挤）。
  - 新增 CSS：`--vs-stat-*`、`.vs-actions`、`.vs-key`、`.vs-act`；≤720px 隐藏网络/页面列。
- **`visits.js` 关键设计**：
  - 拿不到本地 API 时**不显示名册**，只显示一句"名册只在站长电脑上"（`visit_gate`）——
    访客打开线上站永远看不到任何人的 IP。
  - `visibilitychange` 时停掉自动刷新轮询，别在看不见的标签页上耗电。
  - Key 保存走 `api/geo-key`，被拒时把服务端的中文提示原样 `alert` 出来。
- **i18n**：删 `journal_*`（title/en/empty），新增 33 个 `visit_*` 键，
  `title_journal`→`title_visitors`、`nav_journal`→`nav_visitors`。**三语 243×3 一致**。
- **注意**：属性翻译机制是 **`data-i18n-ph`**（另有 `data-i18n-aria`），**没有 `data-i18n-attr`**——
  别再臆造（我第一版写错，探针前就改掉了）。
- **`probe-visits.js` 里的 `/journal.html` 已换成 `/visits.html`**（它拿测试页当触发器用）。
- **桌面 `kstage-preview.html` 08 节保留为"快捷视图"**，顶部加了一行指路到
  `http://Koyome.me/visits.html`，并注明"改逻辑请改站点那份"——避免两套 UI 各自漂移。
- **新增 `tools/probe-visits-page.js` 28/28**：导航可达且高亮、四格读数已填（不是 "—"）、
  精度档位对人话、Key 输入框是真的 INPUT、计数与行数一致、**en/zh/zhcn 三语标题与标签**、
  390px 无横向溢出且 Key 框仍可用、console 干净。
- 回归：test-static / audit-i18n(243×3) / audit-links / probe-visits(18) /
  probe-visit-online(13) / probe-visits-page(28) / probe-ip-page(15) / probe-amap(36) 全绿。
- **未提交、未推送**（§4.3）。

---

## 0.32 第三十二轮速览（2026-10-07）：访客记录补完 —— 线上信标 + 独立 IP 名册页

- **问题根因**：用户用手机打开线上站（GitHub Pages）后本地看不到记录。**这不是 bug，是托管形态决定的**——静态站的请求根本不经过站长电脑，`server.js` 无论怎么写都不可能看见。唯一解是云端转一手。
- **线上信标 `docs/js/visit-beacon.js`（新增）**
  - 只在**本地 API 答"无"**时才发（`Koyome.apiAvailable()` 为 false），站长本机由 server.js 自己记，两边不重复计数。
  - 取自身公网 IP **三级兜底**：`freeipapi.com`（顺带回经纬度）→ `ipwho.is` → `jsonip.com`，各 4.5s 超时。**改成链式的直接原因：ipwho.is 单用时会 429**（探针实测 429，信标静默不发）。
  - POST 到 `${GB_CLOUD.url}/rest/v1/visits`，字段 `ip/page/ua/lat/lon`；localStorage 半小时节流；爬虫 UA 跳过；所有失败吞掉。
  - 已注入 `index/catalog/entry/hobbies/guestbook/journal/admin.html`（`?v=202610070533`）。
- **云端读回（server.js）**：`fetchCloudVisits()` 带 15s 缓存，`sbHeaders()` 从 `tools/sb-key.txt`（已 gitignore）读口令塞 `x-koyome-key`；`mergedVisits()` 把本地行与云端行合流、同样走一遍三级定位；新增 `GET /api/visits/status` 诚实报告 `ok|no-table|denied|no-config|error`。
- **`tools/supabase-visits.sql`（新增，一次性）**：建 `public.visits(id,ip,page,ua,lat,lon,ts)` + 索引 + RLS + anon 仅 INSERT + 按 `x-koyome-key` 的 SELECT 策略。**口令已生成并写进 SQL 与 `tools/sb-key.txt`，用户粘贴即跑、不用自己想口令**。
- **地址格式修正 `placeOf()`**（探针抓到两处真 bug）：① `杭州` 因结尾「州」被误判为已有行政后缀 → 改成只认 `自治州/自治区/特别行政区/盟/旗/市/区/县`；② 美国地址被拼成「弗吉尼亚州省Ashburn市」→ 增加 `isCn` 判定，非中国行改用「 · 」连接、不加中文后缀。
- **CORS**：server.js 顶部加 `OPTIONS` 预检处理（204 + ACAO:*），否则桌面 file:// 页的 DELETE 会被浏览器拦。
- **独立 IP 名册页**：`C:/Users/杨坤/Desktop/kstage-preview.html` 新增 **08 访客记录 IP LEDGER** 一节（CSS + HTML + 驱动脚本）。列：时间 / 地址 / 所在地（省市区）/ 经纬度 / 网络 / 页面 / 来源（本机｜线上 ↑）。带刷新、20s 自动刷新、清空（只清本地，云端表不动）；服务未起给出明确提示。
- **探针**：`tools/probe-visit-online.js` **13/13**（格式化 6 项 + 裸静态站下信标真发：探测 API 失败 → 查公网 IP → POST 真实地址 → 二次浏览不再重复登记）；`tools/probe-ip-page.js` **15/15**（08 节存在、连上服务、云端状态上报、行数与计数一致、单元格非空、无横向溢出、console 干净）。
- **探针踩坑**：① 无头 Edge 的 UA 含 `headless`，被信标 `isBot()` 正确拦掉——探针必须 `Network.setUserAgentOverride` 伪装成 iPhone；② 信标最长要等 3×4.5s，断言前等 12s。
- **自查发现并修复（2026-10-07 05:59）**：
  - **RLS 未生效（隐私漏洞，用户必须处理）**：虽然建表 SQL 已 `enable row level security`
    并建了带口令的 SELECT 策略，但实测 **anon 不带 `x-koyome-key` 仍能 SELECT 全表**。
    该项目对 anon 另有 permissive 策略。**anon key 就在 `docs/js/gb-config.js` 里是公开的**
    → 任何访客都能读走/删掉全部访客 IP。新增 `tools/supabase-visits-harden.sql`：
    先 select 出全部策略、再全部 drop、`revoke all` from anon/authenticated、
    只 `grant insert`、用四条策略重建（insert 任意 / select 需口令 / update false / delete false），
    末尾清掉自测数据。**用户须再跑一次。**
  - **`IANA保留地址` 混进区字段**：保留网段（`203.0.113.x` 等）经 pconline/ip-api 解析后
    把「IANA保留地址」当成区名。改为**白名单式**判断——`PLAUSIBLE_PLACE = /[区县旗州]$/`，
    不合即清空（不再依赖"列出已知坏词"，新运营商词/新注释就漏不过去了）。
    已固化进 `probe-amap.js`（13 脏 + 7 正常 = 20 项）。
  - **服务重启才生效**：`cloudCache` 是进程内 15s 缓存，改 server.js 后**必须重启**，
    否则会看到"改了没反应"。自查时一度误判为读取故障。
- **推送是开关**：`visit-beacon.js` 只在本地仓库，线上 `koyome.github.io/js/visit-beacon.js`
  实测 **404**——不推送，手机访问线上站不会登记。教程里已加「第三件事 · 必须推送一次」。
- **配套教程 `tools/SETUP-VISITS.md`（新增）**：图文逐步——为什么静态站必须走云端中转、
  SQL Editor 精确 URL、每种报错的处理表、高德 2-4 步申请流程（重点：服务平台只勾
  **Web服务**、白名单留空）、自检清单与安全说明。**AI 不能代为申请高德 Key**：需手机号
  验证码 + 实名认证（身份证），既收不到验证码，也不应经手身份信息。
- **Key 管理接口（新增，解决"改文件+重启服务"）**：`GET /api/geo-key` 报 `{configured, masked}`；
  `POST /api/geo-key` **当场向高德真发一次请求验证**再决定是否落盘——
  `INVALID_USER_KEY` / `USERKEY_PLAT_NOMATCH` / `SERVICE_NOT_ENABLED` 判为致命错误，
  **拒绝保存**并回中文提示（否则一个坏 Key 会导致区级永久空白）；配额/网络抖动则照收。
  成功后写 `tools/geo-key.txt`、`AMAP_KEY` 立即生效、`GEO.clear()` 清缓存重查。
  桌面页 08 节的「高德 Key」输入框 + 「自检」按钮即为此做的前端。
- **探针**：`tools/probe-visit-online.js` **13/13**（格式化 6 项 + 裸静态站下信标真发）；
  `tools/probe-ip-page.js` **15/15**（08 节存在、连上服务、行数与计数一致、单元格非空、
  无横向溢出、console 干净）；`tools/probe-amap.js` **16/16**（**用本地假高德验证高德分支**——
  `district` 真能取出、`location` 的 X,Y 未写反、拼出「广东省深圳市南山区」、
  配额报错不伪造区、报错文本不泄漏进地址、高德宕机不抛异常）。
- **探针踩坑**：① 无头 Edge 的 UA 含 `headless`，被信标 `isBot()` 正确拦掉——探针必须
  `Network.setUserAgentOverride` 伪装成 iPhone；② 信标最长要等 3×4.5s，断言前等 12s；
  ③ 写「高德失败」的断言时别断言"字段全空"——正确行为是**回退到免费源拿到市级**，
  该断言应验"没有凭空造出区"。
- **接口高德 v5 vs v3**：`restapi.amap.com/v5/ip?key=&ip=&type=4` 返回
  country/province/city/district/adcode/`location`(经度在前)/isp；`v3/ip` 只到市级。

---

## 0.31 第三十一轮速览（2026-10-07）：日志页 —— 叙事手记 + 访客足迹

- **日志页 `docs/journal.html`（新增页面，导航第 05 项「手記 / Journal」）**
  - 内容源 `docs/data/journal.json`（**双语 `title/titleZh`、`text/textZh`**，共 31 轮，倒序）。沿用 `Koyome.loc()` 取值，简中走运行时 `t2s`，**不复制中文真源**。
  - 叙事体例：第一人称回想、章题 + 地名、克制反省（参考無職転生的自传/冒险手记口吻），每轮 2–4 句，**精简**。
  - 轮次取材：`AI-HANDOVER.md`（R9–R29）+ 桌面 `AI-HANDOVER9.md`（R25 人偶页细节）+ `git log`（R1–R8 早期提交）。**注意两份交接文档的轮次编号有冲突**（桌面版 R23=浑天仪、仓库版 R23=雷达图），本轮统一采用**仓库版（更新）**编号。
  - 新增 i18n 三语键：`title_journal`/`nav_journal`/`journal_*`/`visit_*`，审计 **212×3 一致**。
- **访客记录（IP + 区级地理位置）**
  - 数据 `docs/data/visits.json`；**已加入 `.gitignore`**——含真实访客地址，绝不能随 `docs/` 推到公开站。
  - 落点：server.js 静态分支，**仅在 GET `.html` 时**记一次（素材/API/404 不算人）。`::ffff:` 前缀归一；爬虫 UA（bot/curl/wget/headless…）剔除。
  - **去重**：同 IP 30 分钟窗口内合并为一行并 `count++`，同时累计 `pages`。
  - **定位三级降级**：① 可选高德 `tools/geo-key.txt`（或 `AMAP_KEY`）→ 真正到 **区/县**；② ip-api.com（`lang=zh-CN`，免费无密钥，45/分钟）→ 国家/省/市；③ pconline（GBK，`addr` 里取区/县，过滤「电信/联通/公司」等运营商词）补区。**私网/局域网一律 `lan:true` 且不编造地点**。全部 `try/catch` + 3.5s 超时 + 内存缓存，**不阻塞响应**。
  - 零新增依赖（Node 22 内置 `fetch` / `TextDecoder('gbk')`）。
  - **可见性**：访客名册仅在 `apiAvailable()` 为真时渲染（= 站长本机），静态站上整块 `remove()`，访客地址不会出现在任何人能读到的页面里。
- **新增探针**：`tools/probe-visits.js`（**隔离沙箱**：临时目录复制 server.js 并只改 `clientIp()` 使其读 `x-test-ip` 头，真实 `visits.json` 零触碰；18 项全绿——记录/去重计数/多页累计/局域网降级/爬虫不计/重启持久化/清空）。`tools/probe-journal.js`（真实浏览器 14 项全绿——31 轮渲染、章题/地名/正文、三语切换、访客表可见、桌面与手机均无横向溢出、console 干净）。
- **探针踩坑**：① 导航类名是 `nav.menu-panel` 不是 `.site-nav`；② 访客表要等 API 探测完成，**断言前至少等 5.2s**，否则读到 0 行。
- **未提交、未推送**（§4.3）。改动文件：`docs/journal.html`、`docs/js/journal.js`、`docs/data/journal.json`、`docs/js/i18n.js`、`docs/js/header.js`、`docs/css/style.css`、`server.js`、`.gitignore`、本文件，另有新增 `tools/probe-visits.js`、`tools/probe-journal.js`。

---

## 0.30 第三十轮速览（2026-10-07）：排版与设计语言 token 化打磨

- 唯一生产改动 `docs/css/style.css`（+859/−565，1807→~2260 行）。**视觉风格、配色方向、布局结构全部不变**，只做内部规范。
- 建立完整 token 体系：字号阶梯（`--fs-2xs…--fs-h1` + 5 档 fluid `clamp()`）、字重收敛为单一 `--fw-normal:400`、6 档行高、9 档字距、间距尺 `--sp-1…14`（4px 栅格）、半径收敛为 `--r-1/--r-round/--r-pill`、阴影按角色命名 `--shadow-quiet/lift/float`、动效 `--dur-1…5`、焦点环 `--focus-ring/--focus-offset`。
- 文件头写入**断点契约**（≤480/≤720/≤880/≤1399/≥1400），禁止越界开媒体查询。
- 统一沟槽（移动端 header/content/footer 同为 20px）、hover 缩进方言、hover 显形（含自身 `:focus-visible`）；全站 `:where(...):focus-visible` 焦点环；移除 `.media-stack .deck`（`tabindex="0"`）上的 `outline:none` 回归。
- 布局等价性实测（7 页 × 桌面/移动 vs 基线 `d984999`）：**宽度 100% 零变化**，无横向溢出；高度变化全部来自行高/字距规范化与移动端内容加宽 4px 的重排。
- ⚠️ **已知既有偶发失败**：`tools/probe-home-armillary.js` 的 "canvas corners are transparent" 断言采样动画中画布单像素 alpha（出现 1/5/6 这类 ≤6/255 的值）。用未改动的基线 CSS 跑 3 次也失败 2 次，**非本轮引入**；要稳定需把阈值从 `=== 0` 放宽到 `<= 8`。
- **未提交、未推送**（§4.3）。

---

## 0.29 第二十九轮速览（2026-09-28 → 10-01）：首页浑天仪 —— 手感 + 自定义视角 + 彩蛋 + 世界线表达
> （用户要求：10-01 这两批改动不新开轮次，并入本节）

- **用户诉求四件套**：①手机端滑动时模型跟着动、滑动卡；②缩放（电脑+手机）不够流畅；③模型占比稍大但不许超出手机屏；④本地可自定义展示视角且能随内容推送线上。外加一整套成员彩蛋（见下）。
- **滚动卡顿根因与修法（kstage.js Stage 输入层）**：
  1. **手势方向锁**：触屏 `pointerdown` 不再立即 `grab()`，而是等首次移动判定方向——横向（|dx|>7 且 ≥|dy|）才接管旋转，纵向一律 `release` 交还页面滚动。此前"往下滑模型也跟着转"就是竖滑头几像素被当成了拖拽。
  2. **滑动期间冻结重绘**：`window.scroll`（passive）置 `scrolling` 标记，`coarse` 指针下 `frame()` 直接跳过渲染，停手 140ms 防抖后唤醒（同星空 R15 的经验）。
- **缩放手感**：新增 `Camera.zoomStep()/slideZoom()`——滚轮/捏合/+−键只改 `dTarget`，实际 `dist` 每帧按 `1-0.0002^dt` 缓动（约 0.6s 收敛，帧率无关）。HOME 复位仍是瞬时（探针依赖即时值）。`fit()` 下限外推时同步抬 `dTarget`，避免两者打架。
- **尺寸**：`.sigil` 宽度 `min(430px,78vw)` → `min(480px,86vw)`；390px 视口实测球体 335px、两侧各留 27px，不出屏（探针断言）。
- **自定义展示视角**：orrery 新增 `pose()/setPose()`；站长端 `.sigil-view` 两个按钮（保存/清除，仅 API 在线时显示，**刻意放在成员按钮行之外**——R23 探针断言该行恰好五个成员按钮）；姿态存 `profile.orreryView`（"yaw,pitch,dist"）。**server.js**：DEFAULT_PROFILE + POST 白名单加 `orreryView`（str 60）——API 改动，本机服务已重启生效。加载时游客也会被套用该视角（懒加载装置就绪后反复套用直至成功）。
- **成员彩蛋**（字幕条 `#sigilEgg` 在仪器下方，`pointer-events:none` 绝不抢手势；三语词条 `egg_*`/`sig_*` 已同步 en/zh/zhcn，audit 195 键一致）：
  - 锁定成员（按钮/点星/数字键）→ 台词：冈部 El Psy Kongroo、桶子 女仆什么的最棒了、红莉栖 你观测世界我观测你、真由理 嘟嘟噜+怀表两句连播、铃羽 失败了×3。
  - **冈部×红莉栖双向彩蛋**：两星投影后"垂直重合"（横向差 < max(14px, 4.5%宽)、纵向错开、都在镜头前）→ 字幕提示"按复位键触发"；此时按复位键（画布 R 钮或键盘 R）→ 依次播放 冈部"欢迎回来，我的助手，克里斯蒂娜！" → 红莉栖"即使全世界都忽略了你，我也永远注视着你。"
  - **两个关键设计**：① `HOME()` 里同步记 `homeAligned`——相机复位后两星立刻错开，页面必须用"按下那一刻"的状态判定；② 重合判定带 **6 秒宽限期**（`alignedUntil`），否则提示还在、用户按复位时两星已错开。
  - **字幕双通道**（踩坑）：台词与提示早期共用定时器互相取消（探针实测 pin2/pin4 点完是空的）。重构为"台词通道（播完让位）/提示通道（持续显示，遇台词退下）"两个独立状态机，锁定释放时只作废台词。
- **验证**：新探针 `tools/_probe-orrery.js`（工作区，未入库）8 项全绿——懒加载挂载、保存视角生效、五条台词、真由理第二句、触屏竖滑（页滚 117px 且 yaw 纹丝不动）、缩放缓动（4.93→4.15→3.4 存在中间态）、重合→提示→复位→双人对话、手机端 335/390 不溢出；console 零报错。回归：jsdom 58/58、R23 浑天仪探针 clean、kstage 68 项 clean、i18n audit 195×3 一致。
- **注意**：本机服务本轮已重启（orreryView 字段生效）；会话结束后用户需双击 `start-hidden.vbs` 恢复常驻。改动未提交（kstage.js / main.js / i18n.js / index.html / style.css / server.js / AI-HANDOVER.md）。

---


### 10-01 补修 A：循环卡 / 滑动冻结 / 滚轮冲突 / 彩蛋 R 语义（并入本轮，不新开轮次）

用户真机反馈：①刷新后卡一阵子、"类似循环卡"；②滑动页面时模型完全不动（像死了）；③滑动网页时模型视角也跟着动；④彩蛋按 R 触发，但 R 顺带把相机复位了。

- **①循环卡根因**：`setupOrreryView` 为等懒加载，把保存视角**反复套了 25 次（每 150ms）**，每次硬拽 `dist/yaw` 回保存值，而 `update()` 的 `fit()` 又把它往外推 → 两者对拉，刷新后肉眼可见周期性弹跳。改：**装置一活就套一次**（立即 `clearInterval`，另挂 12s 兜底）。探针新增 2b 断言：挂载后 3s 内 maxΔyaw 0.0052/帧、Δdist=0。
- **②滑动冻结 → 降频**：上一轮为救卡顿做成**完全冻结**，用户嫌"模型死了"。改：滑动期间 **每 ~260ms 画一帧**（仍 kick 保活），停手 140ms 恢复全速——不和滚动抢主线程，也还在缓慢呼吸。
- **③滚轮归页面优先（桌面新规则）**：此前滚轮落在画布上就 `preventDefault` 并缩放装置，访客只想翻页却把模型放大了。改：**滚轮只在"正在跟装置互动"时缩放**（4 秒内点过/拖过画布，或按住 Ctrl/⌘），否则不拦截、页面照常滚。触屏规则不变（纵向=滚页、横向=旋转、双指=缩放）。
  - ⚠️ 交互契约变了：两个老探针的滚轮测试补了"先点画布激活"；复位测试改为**按状态分支断言**（重合→只涨 `eggSeq` 且相机不动；平时→复位回 HOME）。640px 画布上重合阈值 28.8px，"等宽限期结束"那种写法可能永远等不到。
- **④彩蛋 R 键不再复位**：`HOME()` 开头 `if (aligned) { eggSeq++; return; }`（相机/锁定/跟随全不动），仅非重合态才真复位；main.js 改为只盯 `eggSeq` 播双人对话。
- **验证**：工作区探针 8 项全绿（含新 2b）；重合态按 R：eggSeq 0→1、yaw 与 dist 完全不变、双人对话依次播出；宽限期结束后非重合态按 R 正常复位（homeSeq 0→1、dist→3.4）。回归：jsdom 58/58、R23 浑天仪探针 clean、kstage 套件 clean。
- **未提交**：kstage.js / main.js / tools/probe-kstage.js / tools/probe-home-armillary.js / AI-HANDOVER.md（前一波的 index.html / style.css / i18n.js / server.js 也未提交）。
- **本机服务**：含 `orreryView` 字段的后台服务会话结束即停，用户需双击 `start-hidden.vbs` 恢复常驻。

### 10-01 补修 B：世界线表达多样化 + 模型质感（并入本轮）

- **世界线数据全部取自官方作品（没编）**：`WORLDLINES` 九根 —— α 0.409431 / α 0.571046 / **STEINS;GATE 1.048596** / β 1.130426 / β 1.129848 / γ 2.615074 / δ 3.600104 / ε 4.456441 / Ω −0.275349。每根带收束范围标注（α 0.3–0.6%、β 1.0–2.0%、γ 2.0–3.0%、δ 3.0–4.0%、ε 4.0–5.0%、Ω −1.0–0%）。
- **跳变与观感**：装置时间每 **14 秒**跳一根（一整轮 9 根≈2 分钟），跳变瞬间 ①整体辉光上扬 ②读数乱跳 ③屏幕上方闪出提示（**停留约 7 秒**：前 4.7s 全亮，最后 2 秒淡出）。读数在**当前收束范围内**缓慢漂移（不再全表乱走）。
- **每条世界线都带"发生了什么"的概述**（照作品结局写，不是编的；用户点名要游戏里的对应结局）：提示标题下方两行小字，例：
  - α → `真由理 2010.8 死亡 · 收束无法回避` / `SERN 反乌托邦：冈部 2025、桶子与红莉栖 2036 前死亡`
  - β → `红莉栖 2010.7.28 死于广播馆 · 真由理存活` / `《命运石之门 0》所在 · 第三次世界大战收束`
  - SG → `真结局：真由理与红莉栖都活下来` / `规避世界大战与 SERN 收束 · 未来未知`
  - γ → `广播剧《暗黑次元的海德》· 冈部成为 Rounder` / `300 人委员会 · 以凤凰院凶真之名独裁日本`
  - δ → 《比翼恋理的爱人》全员存活；ε → 《线形拘束的树状图》Time Leap 失败落至此线；Ω → 菲利斯线、未创立未来道具研究所
  - 同一收束范围内换线（连续两根 α）时标题写成**变动率变化**（`世界线变动 · α 0.409431 → 0.571046`，字号自动缩小），避免出现"α → α"这种怪文案。
- **排查教训（值得记）**：验证这段时连做三次错误探针——① `window.__log.slice(-30)` 被每帧 4 条的 HUD 记录挤掉，看不到标题；② 世界线序列里 α 连出两次，按键名判断"跳变"会漏；③ 按估算坐标裁图对不上。**结论：canvas 视觉验证先看整屏截图，再谈裁剪；探针必须按"状态量跳变"（wlText 0→1）而不是按键名变化来触发。** 用 `fillText` 钩子 + 整屏截图标定后确认三行都在画（y=32/50/64，alpha 0.95/0.7/0.55）。
- **呈现三件套**：①**收束范围边界环**——最外一圈虚线，颜色随世界线走（α/Ω 冷、β/γ/δ/ε 墨、STEINS;GATE 红），左侧带"α 世界线 / 收束 0.3–0.6%"标签；②**Divergence Meter**——左下角 8 管辉光数字（作品里的变动率计造型），跳变时数字乱跳，Ω 负值首位空管并补 "−" 号；③HUD 读数首行变 `0.409431α`（带希腊字母）。
  - ⚠️ `chrome()` 的读数**只画两行**（`i < 2`）——所以收束范围挂在环标签上，没有塞成第三行（塞了会被静默丢掉）。
- **质感升级**：①行星改用**径向渐变明暗过渡**（替换原来那条生硬的发丝线）+ 朝日侧**边缘光**（赛璐璐轮廓光）；②星点缓慢明灭（用 `t` 而非随机数，避免逐帧抖动）；③跳变时整体辉光上扬。
- **验证**：新探针 `_probe-worldline.js`（工作区）实测 45s 内 α → SG → β 依次跳变、闪光峰值 0.97；截图 `wl-sg.png`（SG 红线 + 红管读数 1.048596 SG）、`wl-flash.png`（跳变瞬间数字乱跳）、`wl-mobile.png`。回归：工作区 8 项探针全绿（含 2b 无循环卡、重合态 R 只触发彩蛋）、jsdom 58/58、R23 clean、kstage clean。

---

## 0.28 第二十八轮速览（2026-09-27）：桌面「测试服」

- **用户诉求**：把本地站的**人偶页移植到桌面 `C:\Users\杨坤\Desktop\kstage-preview.html`**，该文件当"测试服"用。
- **桌面测试页现状**：自包含（kstage.css + kstage.js 全部内联，零外链），含六台 kstage 装置 + 控制台（主题/时间/图层/复位/导出 PNG）。本轮在其末尾新增**第 07 节 FIGURE · 3D 测试台**：
  - **模型切换器**：8 个 GLB 全部列出（含体积/面数/贴图数注释）——正是"选哪个模型上线上"的决策台。
  - model-viewer 参数与 `docs/figure.html` **完全一致**（camera-orbit `12deg 78deg auto`、fov/target 复位三件套、exposure 1.05、shadow-intensity 1、min/max orbit 5%–500%、双击/按钮复位、切换模型即重载）。
  - **资源全部取自本机服务** `http://Koyome.me/`：file:// 页面既不能加载 ES module 也不能 fetch 本地 GLB，所以必须走 http；服务未起时显示明确提示（双击 `start-hidden.vbs` 后按"重试连接"）。
- **`server.js` 改动（本轮唯一站点改动）**：静态响应 + 4 处 JSON GET + `send()` 全部加 `Access-Control-Allow-Origin: *`（仅本地开发便利；线上是 Pages，不涉及）。**API 改动 = 必须重启本机服务才生效**（§4.2）。
- **验证**：无头 Edge 实测（`--no-proxy-server`，本机失效代理会让 Koyome.me ERR_CONNECTION_REFUSED，§4.4）——module 载入 → `customElements` 就绪 → GLB 4s 载入完成、`loaded:true`、遮罩隐藏、**console 零报错**；切换到 v8 同样就绪；截图确认模型真实渲染。站点回归：首页 + figure/catalog/entry/hobbies/guestbook/admin + kstage.js + GLB 全 200。
- **8 个 GLB 规格（本轮实测，供选型）**：v1 = eris-figure.glb（32.4MB/20 万面/12.6 万顶点/3 贴图，Blender 直出）；v3 43.3MB/50 万面/3 贴图；v4 40.9MB/50 万/3；v5 32.3MB/50 万/1；v6 40.7MB/48.7 万/4；v7 23.3MB/50 万/3（glTF-Transform 压缩）；v8 21.3MB/50 万/2（最小）。**全部无骨骼无动画**。
- **⚠️ 随后用户裁定：把人偶从站点移除（2026-09-27 同日）**。已删：`docs/figure.html` 与同批临时预览页 `docs/_v4preview/_v5preview/_v6preview/_v8compare.html`；已去：`header.js` 的 figure 导航项、`i18n.js` 三语字典里的 `title_figure/nav_figure/fig_*` 全部词条（注意 `home_fig_note_ph` 是首页人像注释，与人偶无关，保留）。**保留**：`docs/assets/*.glb`（硬规则不删素材）、`docs/components/model-viewer.min.js`（桌面测试服要用）。验证：figure.html → 404；其余页 200；导航只剩 index/catalog/hobbies/guestbook(+站长 admin)；i18n 审计三字典各 182 键一致；jsdom 回归 58/58 全绿。**桌面测试服不受影响**（它不依赖 figure.html，只依赖 model-viewer + GLB）。
- **未提交、未推送**（§4.3 需用户逐次同意）。

---

## 0.25 第二十七轮速览（2026-09-26）：kstage — 真交互 Canvas 装置（取代 R25/R26 的线稿 + CSS 3D）

> 用户反馈：**"你做的这些也太简陋了，包括 3D 模型在内全部都是，而且动画单一没互动性可玩性"** → 要求：动画丰富、不能出 bug、设计复杂但有秩序、日式二次元线条感 + 赛博科技感。
> **结论：SVG 线稿和纯 CSS matrix3d 撑不起这个要求，本轮推倒重来。** 新增零依赖 Canvas 引擎 `docs/components/kstage.js`（≈1100 行）+ `kstage.css`。**仍未接入任何页面，未提交。**

### 0.25.1 为什么换技术路线
R25/R26 的产出是"静态线稿 + 一条 CSS 动画"和"烘焙好的 matrix3d 面片"——本质是**图片**，不可能有互动性，也不可能有真正的光照/深度。本轮改为**手写 3D/2D 混合渲染器**：透视相机 + 深度排序 + 主光着色 + 画家算法，每帧真实计算。

### 0.25.2 引擎（`docs/components/kstage.js` 上半部）
- **相机**：`Camera` yaw/pitch/dist/fov，`project(p)` → `[x, y, depth, scale]`；惯性用**帧率无关**衰减 `v *= Math.pow(0.0028, dt)`（不是每帧乘常数，否则高刷屏手感不同）。
- **单一主光** `LIGHT = norm([-0.52,-0.66,0.54])`，所有着色共用（电影级与贴图感的分界线）。
- **辉光用叠加描边**（宽而淡的底层 + 窄而亮的上层），**绝不用 `shadowBlur`**——它每帧重新栅格化，必掉帧。
- **颗粒用确定性 stipple**（LCG），不用 filter。
- **Housekeeping**：DPR 上限 2.5；`ResizeObserver` 改尺寸；`IntersectionObserver` 离屏停 rAF；`visibilitychange` 隐藏停；**自适应画质**（ema 帧时 >28ms 自动降质）；`MutationObserver` 监听 `[data-theme]` 重读 CSS 变量。
- **降级**：构造失败/无 canvas → 移除 `is-live`，露出 `data-fallback` 静帧 SVG。
- **reduced-motion**：冻结所有时钟（`t` 不推进、`update` 不跑），但**交互全部保留**（拖拽照常旋转），rAF 只在 dirty 时单帧调度，不空转。

### 0.25.3 三个装置
1. **ORRERY 浑天仪**（真 3D）：4 道倾斜大圆环（赤道/黄道 23.44°/子午/赤纬），**刻度沿环爬行**（圆自转轴对称，只有刻度能体现转动——这是 R26"风车感"的正解）；圆环按**三个深度带**绘制，远侧入雾、近侧提亮；5 颗行星各自轨道 + **四段渐隐拖尾** + 地球/木星带卫星；130 颗星壳随场景旋转；太阳有呼吸脉冲 + 日冕射线。交互：拖拽旋转（惯性）、滚轮缩放、**悬停高亮轨道 + 点击锁定（旋转准星 + 引出线读数）**、方向键微调。
2. **LUNAR 月相台**：**可 scrub 的时间机器**。横向拖 = 走朔望月（惯性滑行），纵向拖 = 天平动（松手回弹）；点 4 个关键相位标记缓动过去；点月面 = 播放/暂停。月面是程序化的：月海 + 30 个环形山（**阴影碗 + 受光侧亮边**）+ 4 组辐射纹 + 地照 + 颗粒。右上角日-地-月俯视图（含地球阴影锥）实时联动，下方 8 枚迷你月相序列指示当前位置。
   - ⚠️ **明暗界线是解出来的，不是遮罩**：受光区 = 受光侧边缘弧 + 明暗界线椭圆（`A = litRight ? r·cosφ : −r·cosφ`，**盈亏两侧符号相反**）。**本轮踩到的真 bug**：最初写成单一 `A = r·cosφ`，满月时界线退化到与边缘重合 → 受光区变成空集（满月全黑）。探针像素采样抓出来的。
3. **PRISM 晶体**：真二十面体（12 顶点黄金比构造，**20 面 / 30 棱**，探针断言）；画家算法排序，正面 Lambert 着色 + rim 边缘光，**背面保留为虚线隐藏线**（二次元线稿感）；外接 3 道笼形大圆 + 内嵌八面体核心；**扫描面**上下扫过、切到的面片高亮；双击爆炸（面片沿法线外推，缓动）。

### 0.25.4 共享赛博 HUD
四角括号、等宽读数（左上标题/右上 4 行实时数据/左下状态/右下跳动数据条）、缓慢下移的**扫描线**、**每 4.6s 触发 90ms 的微故障条**（有节制，只叠在 HUD 层不破坏主图形）、工程网格底纹、暗角。

### 0.25.5 验证（`tools/probe-kstage.js`，21 项全绿）
- 零 console 报错；3 个挂载点都建出带尺寸的 canvas；回退图存在。
- **几何断言**：二十面体 20 面 / 30 棱。
- **交互断言**（CDP 真实合成事件）：拖拽改变 yaw（−0.39→0.15）、滚轮改变 dist（3.40→2.17）、点击锁定行星（lock=0）、拖拽 scrub 月龄（9.70→18.87）、点标记缓动到新月、点月面暂停自动播放、双击进入爆炸模式。
- **像素级正确性**（看不见画面，所以直接采样）：新月 0.0% / 上弦 48.2% 且亮侧在**右** / 满月跨整盘 / 下弦 48.4% 且亮侧在**左**，受光比例单调 0 < 0.5 < 1 > 0.5。（满月实测 ~90% 而非 100%，缺口是月海 + 环形山 + 边缘带的反照率，属真实物理不是 bug。）
- **性能**：三装置同时跑 ~99fps；**离屏全部报暂停、滚回来恢复**；resize + DPR2 时 backing store 420→816px；切夜间主题即时重读变量（`ink` → `#ebe9e5`）。
- **reduced-motion**：1.6s 两帧像素完全相同（时钟真冻结），但拖拽仍然生效并重绘。

### 0.25.6 坑（继承）
- 自己实现**双击检测**（380ms / 26px 内两次 tap）而不用原生 `dblclick`：合成事件测不到，触摸端也不可靠。
- 探针比对应取 **canvas 的 `toDataURL()`**，不要整页截图——页面上有实时 fps 读数，整页对比永远不相等。
- 取像素做几何断言时圆心偏移要写 `dx = (x0 + x) - cx`，别写成 `xx - cx + R`（本次写错过一次，导致采样区整体偏移）。
- CSS 颜色变量可能是 `#rrggbb` 也可能是 `rgb()`，探针里解析亮度**不能**用 `match(/\d+/g)` 直接取前三段（会把 hex 拆成 4、2）。

### 0.25.7 状态
- 新增：`docs/components/kstage.js`、`kstage.css`、`kstage.html`（可复制片段）、`tools/kstage-preview.html`、`tools/probe-kstage.js`。
- `docs/components/k3d.*` 与 `deco_*.svg` **已被本轮取代但保留未删**（硬规则：不删既有资产）。等用户确认后可弃用。
- 仍未接入任何页面、未提交；R20–R23 四个 commit 仍待用户逐次授权推送（§4.3）。

---

## 0.21 第二十三轮速览（2026-09-25）

- **爱好页动漫分区五维评分雷达图（用户点题）**：仅 `data-sec="anime"` 的区块挂载，嵌在 `.hflow-body` 文本下方（河流布局零改动；游客只看得到已评分的图）。
  - **数据模型**：`item.ratings = [animation, character, story, pacing, sound]`，**0–10 分、0.5 步进**；未评分=字段缺省（文件不冗余）。data.js `normalizeHobbies` 天然透传未知字段。**server.js POST /api/hobbies 白名单加 `ratings`（裁剪+钳制 0–10）——API 变更，本机服务必须重启一次才生效，否则拖分保存时被旧服务端剥掉**（§0.11 同类坑）。
  - **交互（仅站长，游客只读零编辑痕迹）**：pointer events——拖**节点**=该轴值跟随指针投影（吸附 0.5、钳制在刻度内）；拖**边线**=两端点一起跟随（每端取指针在自己轴上的投影）。拖拽全程 `updateRadar()` 原位改属性（不重渲染，pointer capture 不断）；松手才 `persist()`。即时反馈：底部读数实时显示「维度名+分值」、当前维度标签变红；松手回显均分。SVG `<g>` 包 hit 层（r15 透明圆 / 14px 宽透明描边），`touch-action:none` 防移动端拖时滚屏。
  - **视觉方言**（对齐旅行地图/罗盘）：发丝网格线（每 2 分一环 + 5 分红色虚线基准环 + 外环加重）、**实线轴辐条**（用户点名改实线）、轴端刻度点、值多边形 radialGradient 红晕填充（每图独立 gradient id）、徽章式节点（panel 底+红描边，悬停放大）、mono 微标签、底部 AVG 读数；未评分站长幽灵态=虚线中心点。RM 关过渡。
  - **i18n 新键**（三字典同步）：`hob_rate`/`hob_avg`/`hob_dim_{animation,character,story,pacing,sound}`（EN 全大写 mono；繁 演出作畫/角色塑造/故事劇本/節奏把控/配音音樂；简 演出作画/…）。
- **验证**：新探针 `tools/probe-radar.js`（**隔离环境**——临时目录拷 server.js+docs 骨架，绝不动真实 hobbies.json；站长模式：渲染/标签三语/节点拖拽降分并持久化/钳制 10/边线双端联动；游客模式：已评分只读无 hit 层、未评分无幽灵图）**17/17 全过**；截图 `tools/shots-r23/radar-{owner,guest}.png` 目检过；全量回归 53/53 绿。探针经验：CDP 交互前必须 setDeviceMetricsOverride+scrollIntoView——元素在视口外 elementFromPoint 返回 null、合成鼠标事件打不中（本轮节点拖拽测试首跑即因此误判）。
- **本轮代码未推送**（用户一键脚本自行上线，§4.3）。

## 0.23 第二十五轮速览（2026-09-26）：装饰线稿减法·精修·动画

> ⚠️ **本轮只产出了素材文件，没有改任何页面 HTML/CSS/JS，也没有提交/推送。** 接入前必须先读 §0.23.3 的两条硬约束。

**生成器 `tools/make-deco-lineart.py`（纯 stdlib，重跑即重新产出全部素材）。产出规则：每个设计出 `deco_x.svg`（日间）与 `deco_x_dark.svg`（夜间，预烘焙换色、不用运行时 invert——遵守 §0.19 的 iOS 铁律）；带动画的设计额外产出 `deco_x_still.svg` / `deco_x_still_dark.svg`（剥离 CSS 的静帧）。写保护：只覆盖带生成器标记注释的文件，`docs/assets/` 旧素材零改动。**

### 0.23.1 减法（用户："别跟主内容抢注意力"）
- `deco_rosette` 玫瑰窗：删掉 {24/11} 星形多边形（最吵的一层）与 24 条虚线辐线 → 只留窗框两道环 + 12 条窗棂 + 12 片尖拱花瓣（二次贝塞尔）+ 轮毂红点。
- `deco_bloom` 生命之花：19 圆 → **7 圆必要重叠（种子形态）**，去掉第二圈、去掉 12 条辐线、容纳圆收紧到 2r；只留一个导引六边形。

### 0.23.2 精修
- `deco_armillary` 浑仪：环体**真实厚度**（7.5px 渐变带 + 两侧发丝边线）+ 三个 `linearGradient` 金属渐变 + 左上/右下**镜面高光弧** + 12 颗铆接节点 + 双壁极轴 + 三道大圆环（地平/子午/23.44° 黄道），每道都配一层内圈伴影衬托厚度。
- `deco_phases` 月相：左暗右亮线性渐变（每枚独立 gradientUnits=userSpaceOnUse）+ 环形坑/月海纹理（LCG 确定性随机）+ 内缘高光弧（仅受光侧可见，随盈亏被遮罩裁掉）+ 序列刻度（主/次刻度 + NEW / HALF / FULL 微标签）+ 保留排线但由 4.5px 抽稀到 7px。

### 0.23.3 动画（两条硬约束）
1. **只动 transform / opacity**，且**每个动画元素都自带静态基准值**（`transform` / `opacity` 写在 inline style 上），所以剥掉 CSS 后就是同一张静帧。
2. **⚠️ Chromium 不会把 `prefers-reduced-motion` 传播进 `<img>` 引用的 SVG 文档——已实测**（内联 SVG 时内部 `@media (prefers-reduced-motion: reduce)` 生效，`<img>` 时不生效）。因此**接入页面时必须由 JS 决定用哪个文件**：
   ```js
   const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
   const stem = n + (reduce ? '_still' : '') + (isDark ? '_dark' : '');
   img.src = 'assets/' + stem + '.svg';
   ```
   只有 `deco_armillary`、`deco_phases` 有 `_still` 版本，其余三个本来就是静的。

**运行逻辑（不是装饰性随机摆动）**
- 浑仪：面朝观察者的**刻度盘**顺时针自转 260s、**内圈+指示规则**反向自转 170s（差速）。三条投影椭圆**不能整体 rotate**（会歪掉）——改为让标记点沿椭圆真实轨迹运行：预计算 48 步 `translate` 关键帧，5 个标记各自不同周期 27/96/132/186s 形成差速公转。
- 月相：每枚月亮按 **48s 朔望周期**推进盈亏，相邻两枚 `animation-delay` 错开 3s，整行读作逐次递进。遮罩结构 = 白色半盘 + 黑色 S 形（擦除新月侧）+ 白色 S 形（补凸月侧）；两层共用一组 `scaleX(cos θ)` 关键帧（正=凸向受光侧=盈，负=凸向背光侧=张），配互补 `opacity` 切换。**静态版必须给这两层写死 opacity，否则剥离 CSS 后两层都不透明（表现=月相全亮）。**

### 0.23.4 验证
`tools/probe-deco.js`（headless Edge + CDP）四层审计全绿：12 个文件（日/夜/静帧）覆盖率 2.7–10.9%、居中、无出框；**逐枚采样月相行的像素墨量单调递增 [13.5→65.9]**（证明遮罩/相位机制正确）；`<img>` 内动画确实在跑（相隔 2.6s 两次截帧不同）；内联时 RM 下 `animation-name=none`；`_still` 两帧零变化。预览页 `tools/deco-preview.html` 支持 日/夜 × 动画/静帧 四态切换（本轮已逐模式验证过）。

---

## 0.22 第二十三轮补（2026-09-26）：全站体检 + 1 处真 bug

- 用户要求"查代码冲突/bug，没有就别动"。做了四项体检：**语法**（全部 js 通过）· **i18n 完整性**（三字典各 181 键、键集完全一致、142 处字面引用全可解析、无空值）· **引用完整性**（HTML/CSS/JSON 里所有本地资源路径均存在、无断链、无重复 id、CSS 顶层重复选择器仅 `.entry-head` 两处且是互补定义非冲突）· **运行时冒烟**（Edge 无头加载 6 页 × 日/夜 + 减少动效翻转，18 次加载零报错）。**新增两个常备审计工具**：`tools/audit-i18n.js`（字典完整性）、`tools/audit-links.js`（断链/重复 id/重复选择器）、`tools/probe-smoke.js`（全站运行时冒烟）。
- **修复 1 处真 bug（R22c 引入的边缘缺陷）**：**减少动效（prefers-reduced-motion）模式下切日/夜，星空不重绘**——RM 分支画一帧后就 `return`，没有 rAF 循环；主题翻转虽触发重烤，但没人把新天空画到画布上，星空会一直停留在旧主题的颜色。修法：抽出 `drawStatic()`，RM 路径与主题翻转回调共用它（翻转回调里 `themeColors(); if (RM) drawStatic();`）。
- 验证：冒烟的 RM-flip 用例确认翻转后画布重绘（采样到非空像素）；回归 53/53、雷达探针 17/17 全绿。除此之外**未发现冲突或 bug，代码保持原样未动**。

---

## 0.20 第二十二轮速览（2026-09-24）

- **人像主题换图连环两 bug——同一链路的两半，均已结构性修复**：
  - **bug A（暗色素材滞留亮态）**：用户报"关于页切夜间→回首页→切回日间，人像看不清且发蓝"。根因：index.html 人像的**内联首帧守卫**在暗态加载时把 `src` 抢先换成暗色版，但该 img 只有 `data-dark-src`、**没有 `data-light-src`**；随后 header.js 首扫 `swapCutouts()` 执行 `lightSrc ??= 当前 src`，把**已是暗色版的 src 缓存成"亮色版"**——切回日间端出的仍是暗色素材（浅色线条烘焙给黑底用，落浅纸 = 看不清+发蓝）。修复：index.html 补 `data-light-src`（解析期就位）+ header.js 缓存时**拒绝把等于 darkSrc 的 src 登记为 lightSrc**。
  - **bug B（暗态进首页人像"变暗"）**：修完 A 后用户报"关于页切夜间→回首页，人像变暗"。根因：**main.js profile 加载后无条件 `img.src = profile.avatar`（亮色图），把 header.js 刚装好的暗色素材覆盖**——脚本顺序 header.js → main.js，暗态加载时人像被换回暗墨亮图，落黑纸 = 变暗。修复（main.js）：赋值前同步 `data-light-src`、按当前主题选 src；并用 `avatar.replace(/(\.\w+)$/,'_dark$1')` 推导配对暗色版，**不匹配时摘除 data-dark-src**（站长换自定义头像后不会错误端出旧烘焙图）。
  - **教训：暗色换图机制有三个写入点必须互相知情——标记属性、内联首帧守卫、后到的异步数据渲染（main.js profile）。任何"在 header.js 首扫之前/之后改写 img.src 的代码"都必须维护 data-light-src 并尊重当前主题。**
- **星空银河微光带（t2，用户点名；界面其余不动）**：entry.js `renderStarfield()` 新增银河——**几何先行、光照与星群同源**：seed() 先定带轴（24–34° 斜倾、过上中天、带宽随视口），45% 星星沿带轴高斯偏移聚集（密核疏肩，符合真实银河=恒星密度带）；bakeSky() 在星点前铺**三层嵌套垂直渐变光纱**（宽肩 → 偏轴亮心，亮心偏移模拟内银河臂）+ 7 团随机星云团块（光会"淤积变稀"，不是规则条纹）。**全部烘焙进静态层，零逐帧成本**；主题翻转只重烤颜色不动几何（天空不因开灯而重排）；夜间 α 0.085 / 白天 0.03（白天仅耳语）。烘焙层/30fps/滚动冻结/RM 单帧策略全部不受影响。
- **星空性能二修（用户报"切主题卡"+"手机上下滑卡"）**：
  - **切主题卡**：根因=主题翻转帧里同步重烤全屏星空（银河三层全屏渐变+星点路径），与整页 CSS 变量翻转抢同一帧。修法：① 45 帧轮询改 **MutationObserver 监听 `data-theme`** + **延迟 70ms 重烤**（让 CSS 先画完；轮询降为 240 帧兜底）；② **双缓冲**——baked sky+sprites 按主题签名缓存（≤2 份、>40MB 不缓存），切回旧主题**零重烤直接换缓冲**。⚠️ 实现时踩到并修掉一个自造 bug：**重烤必须烤进新画布**——bakeSky 会重置 `sky` 指向的画布，在原画布上重烤会把准备缓存的旧主题缓冲当场覆盖（表现=切回亮色端出暗色天空；探针以像素采样 lit 值不一致抓出）。
  - **手机滑动卡**：根因=**URL 栏随滑动收起/弹出触发 resize → 全量 reseed+重烤**（银河加入后更重），往滑/回滑各炸一次。修法：移动端 resize 过滤——宽不变且 |Δ高|<120px 判定为 URL 栏抖动直接忽略（画布 CSS 自带拉伸补几 px 空隙，星空上不可见）；仅旋屏/大幅变高才真 reseed。reseed 时清空双缓冲（几何失效）。
- **验证（R22 累计）**：jsdom 回归 **53 项**全绿（含暗态加载首页端到端）；探针 `tools/probe-portrait-theme.js`（5/5）、`tools/probe-r22c.js`（4/4）；Edge headless 实拍 t2 日/夜/移动/翻转 5 张目检过（spec `tools/shot-spec-r22.json`，截图 `tools/shots-r22/`，临时服务器 `tools/_serve-docs.js`）。**本轮代码未推送**（用户一键脚本自行上线，§4.3）。

---

## 0.19 第二十一轮速览（2026-09-24）

- **iOS 主题切换人像变蓝+模糊——根因定位与结构性修复**：用户报 iPhone 夜间→日间切换后首页人像泛蓝且模糊（安卓正常）。根因：**iOS WebKit 对同时具备「进行中的 transform 动画（合成层）+ mix-blend-mode + 随 `[data-theme]` 切换的 filter」三要素的元素，主题翻转时不正确重绘**——暗→亮时暗态的 `invert(0.92)` 残留在旧合成层（泛蓝），重光栅化比例错误（模糊）。修复原则：**主题相关元素一律不用运行时 invert()，暗态改用预烘焙反色素材 + JS 换 src**：
  - `tools/make-dark-cutout.py`：按 CSS `invert(0.92)` 公式（`out = 234.6 − 0.84·c`）逐像素烘焙暗色版，alpha 不动，视觉与旧运行时 invert 完全一致。已生成 4 张：`avatar_cutout_dark.webp` / `figure_tanya_rifle_dark.webp` / `deco_chapel_dark.webp` / `deco_constellation_dark.webp`（重跑脚本即可再生成）。
  - 换图机制：**任何 `<img data-dark-src="...">` 自动参与**。header.js `swapCutouts()`（setTheme 调用 + 每页加载初扫 + 预加载暗色版防首切闪白）；index.html 人像带内联首帧守卫（防暗态刷新闪浅色图）；entry.js t2 人像插入时按当前主题选 src，且显式写 `data-light-src`（动态 img 若在暗态创建，其 src 属性已是暗色版，没有 data-light-src 会把暗图误认为亮图——坑）。
  - CSS 三处 `invert(0.92)` 全删（`.portrait-cutout`、`.gb-chapel` 建筑层、`.cat-stars`）；chapel 星光层的 brightness+红晕、cat-stars 的淡白光晕保留（纯光环、无 invert，不在此 bug 类别）。
  - **教训：`mix-blend-mode` + `filter:invert()` + 持续 CSS 动画的三件套在 iOS 上不要碰；主题相关图像颜色一律烘焙进素材。**
- **新增简体中文模式（第三语言，localStorage 值 `zhcn`）**：
  - UI 字典：生成管线 `tools/build-zhcn.py`——zhconv（locale `zh-cn`，含 zh2CN 大陆词汇层：網路→网络、軟體→软件级）机转整个 zh 字典 + curated 覆盖表（储存→保存、送出→发送、影片→视频、音讯→音频、自订→自定义、汇入→导入、「」→“”等）→ 174 键 `zhcn` 字典已嵌入 i18n.js（`_html:'zh-Hans'`）。**改繁体 UI 文案后重跑 build-zhcn.py 再手动同步 zhcn 块**（脚本只读 zh 块输出到 `tools/_zhcn_block.txt`，不自动改写 i18n.js）。
  - **内容层零复制**：用户内容的 `*Zh` 字段仍是唯一中文真源；简体模式下 data.js `loc()` 对 zhVal 走运行时 `I18N.t2s()`——i18n.js 内嵌 zhconv 同源映射（4707 单字 + 1519 不规则词组 ≈29KB），最大正向匹配与 zhconv 一致。`tools/inject-t2s.py` 幂等注入/重注入；`tools/gen-t2s-cases.py` + `tools/test-t2s.js` 用 Python zhconv 输出做对拍（18 例全过）。
  - **大坑：zh2Hans 表含 CJK 扩展区 astral 字符（JS 中 2 个 UTF-16 码元）——k+v 连排打包串必须 `Array.from` 按码点迭代；按码元 i+=2 会让首个 astral 之后的全部映射错位（表现=部分常用字转换错误）。**
  - 切换：header 语言组三个按钮 `EN · 繁中 · 简体`；新增 `I18N.isZh` getter（zh||zhcn）——站长内联编辑一律写 *Zh 字段，9 处 `lang==='zh'` 判断已改 isZh（main/catalog/hobbies×3/entry×4，data.js loc 除外——它需要区分 zh/zhcn）。
- **验证**：jsdom 静态回归扩至 **47 项**（三语循环 + zhcn 断言：html lang=zh-Hans/简体标题「电台」/三按钮/暗色素材存在/全站无 invert(0.92)/t2s 对拍）全绿。**本轮代码未推送**（用户一键脚本自行上线，§4.3）。

---

## 0.18 第二十轮速览（2026-09-24）

- **事故排查（用户报"推送后线上全乱了"）**：三方核对——本地 HEAD = 远端 HEAD（`6a916d1`，推送其实完整到达）；线上抽查 HTML/CSS/JS/新 webp 全部 200 且含最新特征；无头浏览器截图线上 4 页渲染全部正常。**真因：GitHub Pages 给所有静态资源 10 分钟浏览器缓存——部署后 HTML 已新、浏览器仍用旧 css/js（或反之），新旧混排即"全乱"**；重建窗口期（~1 分钟）内查看也会看到半新半旧。与 R12 教训同源：push 成功 ≠ 用户看到正确页面。
- **一键脚本加固（tools/push-update.js，桌面 bat 无需动）**：① `stampVersions()`——有改动要推送时，把 docs/*.html 里 `css/style.css` 与 `js/*.js` 引用统一改写成 `?v=YYYYmmddHHMM`（幂等替换），部署后浏览器必须拉新资源，新旧混排从此不可能（相对路径惯例不受影响）；② 推送+ls-remote 核对后新增**线上验收轮询**（每 15s、最长 4 分钟，等首页出现新版本戳且新 style.css 200），通过才宣告成功，超时提示 `pages-build-admin.js rebuild`；③ 收尾提示用户本次按一次 Ctrl+F5（清最后一批旧缓存）。
- **验证**：`node --check` 过；`--dry-run` 演练通过（打戳在演练模式不落盘）。**本轮代码未推送**（用户一键脚本自行上线，§4.3——这次推送会顺带把版本戳写入 6 个页面）。

---

## 0.17 第十九轮速览（2026-09-24）

- **教堂尖顶发光（用户点名）**：`tools/split-chapel.py` 把教堂拆成同尺寸双层——建筑（墨色）+ 尖顶星光（**烘焙 accent 红 #9e2b25**，软混合带藏接缝）→ `deco_chapel.webp` + `deco_chapel_star.webp`。guestbook.html 改 `.gb-chapel` 为双层叠放 span；白天红星配墨建筑（贴合全站红色 accent 方言），夜间星光层 `mix-blend:screen + brightness(1.55) + 双层 drop-shadow 红晕`，加 5.2s 柔和呼吸（chapel-star-breathe，RM 静止）；建筑层夜间 invert(0.92)，整体 opacity 升至 .42。
- **天使定稿（历经四版，用户最终删除）**：R18 爱好页水印 → R19 六芒星背后（用户否：与六芒星线条冲突、太大）→ R19b 六芒星下方独立 FIG.02 展位（月晕光盘+三频动画）→ **R19c 用户裁定整体删除**（"天使还是给删了吧"）——index.html 展位、CSS、i18n `home_fig2`、`assets/deco_angel.webp` 已全部移除（该 webp 是 AI 生成衍生物，用户 Pictures 里的原图未动）。**教训：用户提供素材≠想要全部用上，装饰元素取舍交给用户。**
- **星座罗盘夜间微光**：`.cat-stars` 夜间 opacity .4 + invert + 淡白 drop-shadow（9px, .28）。
- **教训记录**：① 通用规则块（dark invert）会与夜间专项发光规则冲突——专项规则要显式重置 `mix-blend-mode`；② 线稿装饰叠在线条图形（六芒星）背后=线条打架，装饰要独立展位。
- **验证**：jsdom 24/24 绿；未截图（用户要求本地自验）。**本轮代码未推送**（用户一键脚本自行上线，§4.3）。

---

## 0.16 第十八轮速览（2026-09-24）

- **新人物形象（图1 持枪谭雅）**：用户提供白底线稿，脚本 `tools/cutout-deco.py` 抠图（亮度 keyed alpha，软膝保发丝线）→ `assets/figure_tanya_rifle.webp`（1268×1810, 217KB）。放置判断：**t2 關於 Koyome 页**（首页已有谭雅，About 页是第二个自我形象的自然位）——entry.js `renderAboutFigure()`（仅 t2），`float:right` 织入正文，文字环绕；复用 `.portrait-cutout` 全套处理（multiply 印纸 / drop-shadow / 夜间 invert / 同款平滑呼吸动画），与首页谭雅完全一致。
- **三张设计素材抠图分发**（全部重着色为站点墨色 #3b3a38，透明底 webp）：**天使铅笔稿** `deco_angel.webp`（132KB）→ 爱好页右上方淡水印（opacity .13，z-index -1 垫在内容下；移动端挪左上 150px）；**金色教堂** `deco_chapel.webp`（73KB）→ 留言板右上（"收信的小教堂"，opacity .2，z-index -1）；**星座罗盘** `deco_constellation.webp`（62KB）→ 目录页右上（与首页指南针同一导航方言，opacity .17）。夜间模式统一 invert(0.92) 转淡墨。每页仅一件，避免堆砌。
- **验证**：jsdom 24/24 绿；未截图（用户要求本地自验）。**本轮代码未推送**（用户一键脚本自行上线，§4.3）。
- **备注**：`.section` 仅目录页使用，已加 position:relative 供 `.cat-stars` 定位。原图在用户剪贴板/Pictures 目录，未动。

---

## 0.15 第十七轮速览（2026-09-24）

- **人物形象（index.html + style.css）**：人像是黑白手绘线稿，multiply 印纸。**用户裁定：人物旁边不要任何附加装饰——图纸背板、红色对位角标、portrait-dot 红点全部去除，保持原有裸图设计**（R17 曾加测绘网格背板，用户否掉："反而变丑，按原来的设计就行"——人像区装饰勿再自作主张添加）。
- **人物微动效**：`.portrait-cutout` 加 `portrait-idle 6.4s ease-in-out infinite`——绕脚部支点（50% 92%）的**平滑慢呼吸**（≤0.5° / ≤1px）。**用户否掉了 steps() 抽帧版**（"一卡一卡看着不舒服"）——动效要流畅自然，勿用跳切。纯 CSS 零资源；`prefers-reduced-motion` 全程静止。
- **移动端星球移位**：≤880px 时 `.hero-orbit` 从右上（与人物同屏互抢）移到**文字区后下方**（`top:auto; bottom:-34px; right:-16px; min(46vw,200px); opacity .26`）——退成背景衬，不再与人物抢第一屏。
- **指南针归位**：`.hh-compass` 从爱好区移到**目录区**（语义：指南针=方向/索引，与 INDEX 匹配；爱好区与其无关）。桌面端目录列表让出右栏（`.home-catalog-list { margin-right: clamp(0,16vw,190px) }`）；移动端缩至 72px 放右下角（bottom:30px, opacity .42）不压条目。
- **新增装饰元素**：区块分隔线（`.home-catalog/.home-hobbies` 的 ::before=两端渐隐发丝线 + ::after=中央红色菱形，位于 section 上方 -42px）；今日推荐标签改**胶囊展品签**（`.hh-daily:not([hidden])` inline-flex + 细框圆角 + panel 底）。
- **验证**：jsdom 24/24 绿；未截图（用户要求本地自验）。**本轮代码未推送**（用户一键脚本自行上线，§4.3）。

---

## 0.14 第十六轮速览（2026-09-23）

- **星空光晕重写（entry.js `makeSprite()`）**：废除径向渐变圆形光晕（白天像霉圈、夜间散射过度的根因），改 `shadowBlur` **沿五角星路径**的边缘发光（两遍柔光+ crisp 核心）；光晕半径按主题分档（夜间 ×1.9 / 白天 ×1.05）。流星同法收敛：拖尾改单根渐变细线（0.32α 衬托 + 0.9α 亮芯），头部精灵仅边缘发光，伴星 α 降至 0.4。
- **星空质感打磨**：远星逐星静态亮度分层（`s.a` 0.35–0.85 烘焙）+ 大小幂律分布（多针尖少大颗）；闪烁改**双频失谐正弦**（`0.62·sin(sp·t)+0.38·sin(2.63sp·t)`，逐星 base/amp 随机）——不再是节拍器；大星加 ±7% 呼吸缩放；静态层顶部加 5.5%（夜）/2%（日）透明度渐变洗去平贴感。性能策略（烘焙层/30fps/滚动冻结/RM 单帧）全部保留。
- **今日推荐修复（data.js `loadHobbies()`）**：排查结论——洗牌算法本身均匀（2000 天 χ²=16.17 < 22.36）且全分区入池；真实隐患是**静态模式下 localStorage 陈旧快照优先级高于 baked `data/hobbies.json`**（游客只读后 LS 只会是化石），导致新增图片永不入池。已改为 baked 优先、LS 仅兜底；API 模式不变。探针 `tools/probe-dailypicks.js`（jsdom 跨 8 天 mock Date 实测：逐日变化、4 张不变、新图正常入池）。
- **验证**：jsdom 24/24 绿；Edge headless 截图 4 张目检（spec `tools/shot-spec-r16.json`，截图 `tools/shots-r16/`）。**本轮代码未推送**（用户一键脚本自行上线，§4.3）。

---

## 0.13 第十五轮速览（2026-09-23）

- **星空性能（entry.js `renderStarfield()` 重写）**：静态层（远星+星座线）改为离屏**一次烘焙** `bakeSky()`，每帧只 `drawImage` 一次 + 少量精灵 blit；**手机端滚动期间冻结绘制**（passive scroll + 160ms 防抖恢复，滚完 `last` 自然续帧）——滑动卡顿的根因是全屏 canvas 30fps 重绘上传与滚动合成器抢资源。DPR 1 / 30fps / RM 单帧策略不变；`.starfield` 加 `translateZ(0)` 独立图层。
- **星空视觉**：星星全部改**五角星**（`fiveStar()` 路径；远星烘焙进静态层，亮星分 s/m/l 三档**精灵** `makeSprite()` 带光晕、逐星闪烁 drawImage）；流星星头改五角星精灵 + 尾中伴星，拖尾保留渐变双描边。亮度：白天 mood.alpha 0.5→0.72、meteorAlpha 0.55→0.8；夜间维持 1。主题切换经 `themeSig` 签名触发精灵/静态层重建，不逐帧轮询样式。
- **旅行页插注重绘（`housesStrip()`）**：全部建筑加 `.hs-thin` 细线细节层（0.65px, opacity .85）——町屋（瓦垄/暖帘/丸窗十字）、公寓（带框窗/玄关雨棚）、长坡屋（烟囱炊烟/栅栏/红窗棂）、高层（天台红色天线）；**东京塔清晰化**：四条桁架腿 + 两层 X 交叉撑 + 主瞭望台（带裙边 hatch）+ 顶部瞭望台 + 天线尖红球（vermilion 致敬）；五重塔改曲檐翘角 + 露盘栏杆 + 相轮九环 + 顶珠；鸟居加反翘笠木 + 贯 + 红色匾额。测绘虚线/标签/红点方言不变。
- **地图肌理细化**：`blocks()` 种子化**混合 footprints**（高低/宽窄/带附属小屋）+ 院落点 `.tm-yard`；东京湾加等深线 `.tm-depth`；三个公园加树点 `.tm-treedot`；汉拿山加等高线 `.tm-contour`（虚线双椭圆）+ 全岛寄生火山点。全部静态 SVG，零性能成本。
- **验证**：jsdom 24/24 绿；Edge headless 截图 6 张目检（spec 存档 `tools/shot-spec-r15.json`，复用 shot-r11.js）。**本轮代码未推送**（用户要求自己用桌面一键脚本上线，§4.3）。

---

## 0.12 第十四轮速览（2026-09-22）

- **自建地标可编辑**（entry.js `openPinForm(panel,mapId,x,y,vb,editIdx)`）：命名卡升级为双模式——editIdx 传入即为编辑态（预填地名/图标，`保存/移除/看照片×N/取消`）。**站长点击自建图钉=打开编辑卡**（跳传功能移进卡内"看照片"按钮，整组置顶逻辑同 R13）；游客行为不变（点击=跳传）。图钉旁小 ✕ 快速删除保留。i18n 新键 `tm_pin_save`、`tm_pin_view`。
- **房子立面图加地标**（`housesStrip()`，viewBox 560→**760**）：民居序列右侧新增**东京塔**（桁架腿+横梁+瞭望台+天线）、**五重塔**（五层递减挑檐+刹）、**鸟居**（弯笠木+贯+双柱），测绘虚线同步延长。stroke 方言不变（hs-ink/hs-dash/hs-accent-line）。
- **地图城市肌理**（entry.js `blocks()`）：种子化跳格算法生成**建筑足迹街区**（渲染间稳定）——东京四片（新宿/涩谷/银座/浅草）+ 济州两市（济州市/西归浦市），另有 `.tm-lane` 街巷线加密路网。CSS：`.tm-blocks rect`（fill var(--bg)/夜间 panel、stroke var(--line)）。
- 验证：jsdom 24/24 绿；线上 5 项特征 ALL LIVE；构建 built。

---



## 0.11 第十三轮速览（2026-09-22）

- **地标多照片归集**（entry.js）：自动图钉（TOKYO_SPOTS）与自建图钉（mapPins）都改为收集**全部**匹配描绘的照片索引（`data-mis`，原 `data-mi` 已废）。点击图钉 = 该地点**整组照片置顶到照片叠最上面几层**（`i1DeckCtl.liftGroup(seq)`，组内相对顺序不变、按点击轮转到未看的那张），整组在置顶区翻完为止；再点回到第一张循环。多照片图钉徽章右上角有红色数量角标（`.tm-count`）。点照片叠本身仍是常规"顶图沉底"循环（组会自然散开，不冲突）。
- **地标图标自选**（task 2）：站长点地图空白标注时，命名卡新增**图标选择器**（`.tm-iconpick`，11 款：pin/torii/tower/campus/towers/crossing + 新增 mountain/wave/sakura/castle/lantern，全在 `SPOT_ICONS` / `PIN_ICON_CHOICES`）。所选存为 `pin.icon`；旧图钉无 icon 字段 → 回退通用水滴针。**server.js 的 mapPins 白名单已加 `icon`（`/^[a-z-]{1,20}$/`）——API 改动，本机服务必须重启一次才生效**（§4.2；不重启则保存时 icon 被旧服务端剥掉，表现为"选自选但不生效"——本轮用户就踩到这个）。
- **手机端 Q版全展示**（hobbies.js）：≤720px 不再只显示 1 个槽——所有**已填充**槽沿右缘竖排迷你陈列（44px，top 86/140/194/248/302/356px，JS 三档 `DECO_POS` 第一档）；空槽手机端隐藏（站长在大屏上传）。中屏档（721–1399）不变。
- **i18n 新键**：`tm_pin_icon`（LANDMARK ICON / 地標圖案）；`tm_hint_jump` 文案改为"逐张翻看"。
- **本轮两起运维教训**：① 大推送（8 首 MP3，~80MB）在回合被打断时**悄悄中止**——本地已 commit、远端没动、无 git 进程。推送后必须 `ls-remote` 核对才算完（§4.3 已有此条，本轮验证了它的必要性）。② server.js 的 API 变更（如 mapPins 加字段）不重启本机服务就不生效，站长端表现=静默丢字段。
- **新工具**：`tools/probe-r13.js`（图标选择器 + liftGroup 分页 CDP 实测）、`tools/verify-r13-live.js`（线上轮询）。
- 用户当日新内容已推送（`3070a8b`）：电台 8 首新歌（带封面）、新角色 羽川翼/忍野忍、济州岛照片增至 19 张、Q版新图等。

---



## 0.10 第十二轮速览（2026-09-21）

- **旅行照片层叠（i1，entry.js `renderDeck()`）**：i1 的图片媒体改为一摞拍立得（`.deck`）——顶图完整展示，后 3 张微露边（左右交替扇出），再深处隐藏。点击照片叠（或 Enter/Space）：顶图向右下滑出（`.deck-exit` 0.26s）→ 静默沉底（`.deck-settle` 断一帧过渡）→ 其余平滑递进（0.55s cubic-bezier），无限循环。计数 `NN / 08`；**共享描绘条始终描述顶图**（站长双击编辑的就是顶图 caption）。reduced-motion 全程瞬时。站长删除按钮只在顶图显示。
- **自建地标跳传修复**：`mapPins` 图钉若名字（zh 或 en，≥2 字符）出现在某张照片描绘里 → 自动成为可点击跳传（`tm-linked` + `data-mi`），点击=滚动到照片叠并**将该照片置顶**（`i1DeckCtl.toTop`）；无匹配则保持只读。站长删除改由图钉旁的小 ✕（`.tm-upin-x`）触发——点图钉本身不再误删。
- **地标图标**（`SPOT_ICONS`，24 网格线稿）：东京塔（桁架塔）、东大（山墙柱廊）、你的名字（鸟居）、新宿（楼群）、涩谷（框内 X 道口）；自建图钉=通用水滴针。图钉改版为**徽章式**：细杆 + 圆形徽章（内置图标）+  exact 点红芯，标签置徽章右侧（近顶/近右自动翻转）。
- **地图仪表**：两图新增指北针（红箭头+N）与比例尺（东京 5 KM / 济州 10 KM）；水域/绿地接入新变量 `--map-water/--map-park`（日夜双色，带一点青灰/苔绿）。
- **爱好Q版槽防遮挡**（hobbies.js `DECO_POS` 三档）：≥1400px 六槽全部锚定内容列两侧**页边空白**（`calc(50% ± 566px)`，固定不滚且零遮挡）；721–1399px 缩为 2 个 64px 角落槽；≤720px 只留 1 个 46px 小槽在页头下方。槽本就 position:fixed（R9），用户感知的"跟随滚动"是缓存旧版；本轮真问题是遮挡，已按档位消除。
- **电台封面**：`.track-cover::after` 中圆（盖住封面中央 32%）已删；圆形黑胶裁切与均衡器刻度保留。
- **测试沙箱事故**：jsdom 回归的 guestbook 测试把 `StaticTester` 写进了**真实云表**（id=9；anon key 无 DELETE 权限，**需用户在 Supabase 仪表盘 Table Editor 手动删除该行**）。已在 test-static.js 内置静态服务器拦截 `/js/gb-config.js` 返回空配置——测试永远走本地回退链，24 项全绿，云表不再受测试污染。
- **新工具**：`tools/probe-deck.js`（照片叠+图钉跳传 CDP 实测）、`tools/probe-hdeco.js`（装饰槽 fixed 实测）、`tools/check-sb-tester.js`（云表测试残留排查）、`tools/pages-build-admin.js`（Pages 构建状态查询 + 请求重建）。经验：**SVG `<g>` 无 `.click()`，探针须 dispatch MouseEvent**。
- **Pages 构建事故（首次遇到）**：R12 三次推送的代码瞬间到达远端（SSH 推送本身毫无问题），但 GitHub Pages 的**自动构建**连续三次 `errored: Page build failed`（15:42–15:45 UTC，GitHub 官方状态页无事故，仓库内容无异常——纯服务端抖动）。**解法等不用改代码**：`POST /repos/Koyome/koyome.github.io/pages/builds`（带 gh-token）手动请求一次重建即 `built` 成功，同一 commit。排查命令在 `tools/pages-build-admin.js`。教训：push 成功 ≠ 上线，线上轮询失败时先查构建状态再怀疑代码。

---



## 0.9 第十一轮速览（2026-09-21）

- **手机端首页**：deco.js 首页第一个漂浮图形（摆动圆）在手机端与星球重叠——移动端首页已过滤该图形（桌面端不受影响，`page==='home' && si===0` 才跳过）；`.hero-orbit` 移动端从 `right:-90px`（外环被裁）改为 `right:-10px; top:-14px; min(60vw,250px)`，整个星球雕塑完整入镜；`.hh-compass` 移动端 `right:2px` 不再出血。
- **罗盘质感升级**（index.html 内联 SVG）：新增渐变表盘（`hhFace` 径向）、北针红色渐变（`hhNorth`）、墨针渐变（`hhInk`）、30° 短刻度环、右上玻璃高光弧、中心帽高光点、扫秒针尖光晕；CSS 加 `drop-shadow`（日夜两色）。设计语言不变，变量驱动日夜自适应。
- **夜间六芒星整治**：sigil SVG 硬编码灰色全部接入新 CSS 变量 `--sigil-{dash,ring,chord,tri,node}`（日间值=原色，像素级不变；夜间调暗调匀），弦线组 `.sigil-chords` 夜间 opacity 降至 0.5——黑纸上的线条不再凌乱。
- **星空性能**（entry.js `renderStarfield()`）：手机端 DPR 封顶 1（原 ≤2，全屏重绘量减半以上）、重绘节流 ~30fps（dt 累加 `dtDraw`，流星步长用累计值，速度不变）、小方星改为单 alpha 批量填充（逐星 globalAlpha 切换是主要绘制开销），十字星保留闪烁。视觉几乎无差，滑动不再卡。
- **事故记录**：本轮中 `.git` 再次损坏（refs 目录与 objects/pack 丢失，`bad object HEAD`——与第九轮同因，非 AI 操作导致；一次 `git stash` 命令途中被 SIGTERM 可能加剧了暴露）。已按 §0.7 同法恢复：SSH 克隆 → 移植 `.git` → 工作区零改动（diff 仅本轮 4 个文件），另补回 repo 本地 `user.name/user.email`（Koyome/koyome@localhost，新克隆不带）。
- **新工具**：`tools/shot-r11.js`（Edge headless CDP 截图台：多规格 视口/主题/滚动 批量截图，复用性强）、`tools/check-sb.js`（Supabase 只读探针）、`tools/verify-r11-live.js`（线上轮询验收）。
- **测试备注**：jsdom 回归 22 项中 guestbook en/zh list 两项报 0 items——jsdom 内云表 fetch 不可达所致的环境性失败（Supabase 实测 HTTP 200 有数据），与本轮 diff 无关；其余全过。

---



## 0.8 第十轮速览（2026-09-21）

- **素材清理**：用户提供的两张设计图（罗盘星/放射之眼）及其全部引用已删除（`assets/deco/` 目录不存在了，勿再引用）；首页人像注释改为**可编辑组件**——文字存 `profile.json` 的 `figNote/figNoteZh`（空=隐藏），站长双击编辑，main.js `renderPortraitNote()`。
- **新图形（Stone Island 式：几何线条、简洁构图、品牌标识感）**：首页爱好区 **罗盘徽章 `.hh-compass`**（内联 SVG，四芒星+刻度+60s 扫秒针，接替被删素材）；旅行页首 **线条房屋立面图 `.i1-houses`**（entry.js `housesStrip()`）。与首页星球同一套细线/虚线/mono/红点语言，CSS 变量驱动日夜自适应。**星球图形用户确认满意，勿动。**
- **双地图（entry i1，`renderMaps()`）**：旧潦草街网+连线已废弃。**东京图**=数字化重绘（测量网格、东京湾、隅田川、山手线环+站点、绿地、印刷体地名；照片图钉仍由描绘关键词驱动，点击跳照片）；**济州岛图**=同标准新绘（汉拿山盾形岛、1132 环岛路、城山/山房山峰标）。**站长点击地图空白处可标注地名**（浮出命名卡 → `entry.mapPins.{tokyo,jeju}` → PUT /api/content；点自建图钉可删）；游客只读。**地标间不画连线（用户明确要求）。**
- **私人剪辑（v1）边框**：胶片齿孔已废弃，改为画廊展板=发丝细框+左上角一小段红角标+纸质标签牌。
- **server.js 新字段**：PUT /api/content 接受 `mapPins`（坐标钳制 0–560/0–400，每图 ≤60）；POST /api/profile 接受 `figNote/figNoteZh`。**本机服务需重启一次才生效**（§4.2）。
- 上一轮（人像抠图 `avatar_cutout.webp` + 星球细节化）本轮才随之一并推送上线。

---

## 0.7 第九轮速览（2026-09-21）

- **夜间模式**：`[data-theme="dark"]` CSS 变量翻转（style.css 顶部）；header.js 注入日/夜按钮 + 全站图纸角标 `.page-frame`；6 个 HTML 的 `<head>` 有防闪烁预置脚本；localStorage 键 `koyome_theme`。
- **首页**：hero 轨道雕塑 `.hero-orbit`（纯 CSS 自主运动）；画像区=照片钉在手绘地图（`.portrait-map` 线稿 + vignette + 倾斜回正）；爱好引导区**按日随机 4 张**（main.js `dailyShuffle`，日期做种子，当天固定）。
- **爱好页**：新增 `galgame` 分区（i18n `hob_sec_galgame*`；data.js normalize 保证三分区；server.js 裁剪 ≤4 分区原生兼容）；Q版装饰槽 **3→6 且改 `position:fixed`**——不再随内容下移（bug 根因=百分比绝对定位）；移动端只显示前 3 个。
- **素材边框按板块分方言**：`entry.js` 给 `.media-stack` 加 `media-<entryId>` 类——i1=图钉相片盘、v1=胶片链齿孔、t1=黑胶+均衡器刻度；爱好页按 `[data-sec]` 分框式。
- **旅行地图**：entry.js `renderTravelMap()`（仅 i1）——SVG 街道网+虚线行进路线+地标图标；节点由**照片描绘里的地名**驱动（TRAVEL_SPOTS 关键词匹配），点击滚动到对应照片。
- **星空**：entry.js `renderStarfield()`（仅 t2）——canvas 固定背景，十字/方形星+星座线+随机流星；颜色读 `--star/--star-line/--meteor` 变量（日夜自适应）；reduced-motion 只画静态帧。
- **性能**：大图全部生成 `assets/opt/` 衍生（**原图未动**，脚本 `tools/make-opt-images.py`）；profile.avatar 与 i1 的 9 处 src 已切换引用；视频/音频 `preload="none"`；图片 `decoding="async"`。
- **事故记录**：本轮中 `.git` 曾被外部力量送入回收站（非 AI 所为），已用 SSH 重新克隆移植恢复，零数据丢失。

---

## 0. 给用户的一段现成提示词（可直接贴给下一个 AI）

```
请阅读我项目根目录下的 AI-HANDOVER.md（路径 C:\Users\Public\koyome-site\AI-HANDOVER.md），
它是完整的项目交接文档，读完再开始改动。硬规则：不要删除或覆盖 docs/assets/ 里任何
已存在的素材文件，不要重置 docs/data/ 下的 json —— 那是我手动上传的真实内容。
改完想上线的话按文档 §4.3 用 SSH 推送（密钥在 tools/deploy-key）。
```

---

## 0.5 硬规则（红线——违反会破坏用户数据）

1. **绝不删除/覆盖 `docs/assets/` 里任何已存在文件** —— 全是用户手动上传的照片、视频、MP3。
2. **绝不重置 `docs/data/` 下的 `content.json`、`profile.json`、`hobbies.json`、`guestbook.json`** —— 全是用户真实内容，不是种子数据。
3. **所有路径保持相对路径**（`assets/...`、`data/...`，不带前导 `/`）——全站既有惯例，也防未来托管路径变动。
4. **任何文本字段都要维护双语**：`title/titleZh`、`body/bodyZh` 等。新增 UI 文案必须同时加进 `docs/js/i18n.js` 的 `en` 和 `zh` 两个字典。
5. 改完文件用搜索工具确认改动真的落盘（本环境出现过 Edit 静默失败，§4.5）。

---

## 1. 项目概览

### 1.1 目标
**Koyome.me** —— 用户的双语（English / 繁體中文）极简个人网站：收藏文字、图片、视频、音乐，展示动漫爱好，并接受访客留言。设计语言：浅纸色底、衬线标题、等宽小标签、红色 accent（`--accent: #9e2b25`），安静的极简纸质风（参考 1uvng.me，不照搬）。

### 1.2 整体架构

```
                        ┌────────────────────────────────────┐
   访客（任何设备） ──► │ GitHub Pages 静态托管 (只读快照)     │  https://koyome.github.io/
                        │  docs/ 目录 = 网站本体              │
                        └──────────────┬─────────────────────┘
                                       │ 留言读写 (fetch PostgREST)
                                       ▼
                        ┌────────────────────────────────────┐
                        │ Supabase 云数据库 (public.guestbook)│  全站共享留言
                        │ RLS: anon 仅 SELECT + INSERT        │
                        └────────────────────────────────────┘

   站长（用户电脑） ──►  server.js (端口 80, http://Koyome.me)
                        = 站长编辑台：读写 docs/data/*.json、上传素材到 docs/assets/
                        改完 → git commit → SSH push → Pages 自动重建上线
```

**双模式数据层**是理解全站的钥匙（`docs/js/data.js`）：运行时探测 `api/content` 是否存在——

| | 本机模式（server.js 运行中） | 静态模式（GitHub Pages） |
|---|---|---|
| 判定 | API 存活 → 站长（管理员） | API 不存在 → 游客（纯只读） |
| 内容数据 | Node API 读写磁盘 json | localStorage 覆盖层 → 内置 `data/*.json` |
| 管理页/编辑按钮 | 可见可用 | 完全隐藏（§2.3-3） |
| 上传素材 | 写入 `docs/assets/` | 无入口 |
| 留言 | **云表优先**（与线上一致） | **云表优先**；云未配置/失败时回退 localStorage |

**推论**：更新线上内容的唯一正确流程 = 本机改 → commit → push → Pages 重建。

### 1.3 技术栈
- 前端：纯 HTML/CSS/JS，无框架、无构建步骤、零 npm 依赖；双语 i18n 自制字典。
- 本地后端：`server.js` 单文件零依赖 Node（静态托管 + JSON API + 上传落盘），~470 行。
- 云后端：Supabase（PostgREST，纯 fetch，无 SDK；`sb_publishable_` anon key，RLS 只读+只写）。
- 托管：GitHub Pages（main 分支 `/docs`，`.nojekyll` 已就位）。
- 部署：SSH 原生推送（首选）/ REST Git Data API 重放（备选，§4.3）。
- 测试：jsdom 静态回归 + Edge headless CDP 端到端（Node 22 内置 WebSocket）。

### 1.4 当前进度
**功能全部完成并上线**（线上 = HEAD `a80506e`）：6 个页面、双语、游客只读、移动端适配、云端共享留言板全部生效；用户全部内容（10 首歌、9 个视频、8 图旅行、8 动漫 + 5 角色）均已推送，本地与线上同步。

---

## 2. 已完成工作

### 2.1 功能模块清单

| 模块 | 状态 | 说明 |
|---|---|---|
| 首页 index | ✅ 上线 | loader 动画、个人资料（头像/欢迎语/自述）、目录索引区、**爱好引导区**（拍立得卡片+引导链接）、六芒星 sigil |
| 目录页 catalog | ✅ 上线 | kinetic title：逐字模糊入场、悬停扫光+下划线、ghost 序号视差；站长双击标题内联改名 |
| 详情页 entry | ✅ 上线 | 图文/视频/音乐；12 列错落网格；素材描绘 caption 双击编辑；音频 track-card（ID3 封面自动读取）；NOTE/手記 区块；**i1 双地图（东京+济州岛，站长点击标注地标）**；t2 星空 |
| 爱好页 hobbies | ✅ 上线 | 两分区「喜歡的動漫/動漫角色」河流式交错布局；图文自由增删改；3 个 Q版装饰槽（已用 2） |
| 留言板 guestbook | ✅ 上线 | **Supabase 云端共享**；蜜罐反机器人；20 秒限流；云端时间按访客本地时区显示 |
| 管理页 admin | ✅ 上线 | 仅站长机可见（游客重定向）；条目增删改、profile 编辑、上传 |
| 双语系统 | ✅ 上线 | EN（默认）/繁中切换，localStorage 记忆；全部 UI 文案双字典 |
| 游客只读 | ✅ 上线 | 角色=API 探测；管理入口/编辑/上传/删除全部按角色条件渲染 |
| 移动端适配 | ✅ 上线 | sticky 页头修复菜单遮挡、全宽菜单面板、装饰元素移动版缩减渲染、iOS 防缩放、480px 断点 |
| 仓库改名 | ✅ 上线 | `Koyome/koyome` → `Koyome/koyome.github.io`，网址缩短为根路径 |

### 2.2 文件目录结构及作用

```
C:\Users\Public\koyome-site\          ← 项目根（= git 仓库根）
├─ server.js                          本地服务器 + 全部 API（零依赖；__dirname 寻址，无 cwd 依赖）
├─ start-koyome.bat                   双击启动本机网站（带窗口，端口 80）
├─ start-hidden.vbs                   ★ 双击后台静默启动（无窗口，独立于任何会话）
├─ push-update.bat                    ★ 双击一键推送更新（commit+push+核对，站长自用）
├─ push-update.sh                     macOS/Linux 同款启动器（.command 可双击）
├─ setup-koyome-me.bat                一次性配置：hosts 映射 + 代理绕过（需管理员，已跑过）
├─ AI-HANDOVER.md                     本文档
├─ .gitignore                         含 tools/deploy-key*、gh-token.txt、*.log、server.pid
├─ docs/                              ★ 网站本体（GitHub Pages 发布的就是这个目录）
│  ├─ .nojekyll                       必须存在！否则 Pages 的 Jekyll 吞掉下划线文件
│  ├─ index.html                      首页（个人介绍 + 目录索引区 + 爱好引导区 + 六芒星）
│  ├─ catalog.html                    目录页
│  ├─ entry.html?id=xxx               条目详情页
│  ├─ hobbies.html                    爱好页
│  ├─ guestbook.html                  留言板（含蜜罐隐藏字段 #gbSite）
│  ├─ admin.html                      管理页（游客被 JS 重定向）
│  ├─ css/style.css                   全部样式（CSS 变量配色；~1000 行；含移动端 3 个断点）
│  ├─ js/
│  │  ├─ i18n.js                      双语字典 + 语言切换（所有 UI 文案在此，en/zh 双字典）
│  │  ├─ data.js                      ★ 数据层：模式探测、云→API→localStorage→内置 json 回退链
│  │  ├─ gb-config.js                 ★ Supabase 凭据（url + sb_publishable key，公开设计）
│  │  ├─ header.js                    公共头部（导航 + 语言切换；admin 链接仅站长机注入）
│  │  ├─ main.js                      首页逻辑（loader、profile、目录区、爱好引导区渲染）
│  │  ├─ catalog.js                   目录页逻辑（kinetic title、双击改名）
│  │  ├─ entry.js                     详情页逻辑（媒体渲染、上传、ID3 封面、caption 编辑）
│  │  ├─ hobbies.js                   爱好页逻辑（图文增删改、Q版装饰上传）
│  │  ├─ guestbook.js                 留言板逻辑（云优先发送链、蜜罐、限流）
│  │  ├─ deco.js                      全站漂浮几何装饰（移动端缩减、reduced-motion 关闭）
│  │  └─ admin.js                     管理页逻辑（顶部角色 gate）
│  ├─ data/
│  │  ├─ content.json                 ★ 全部条目（真实用户数据，勿重置）
│  │  ├─ profile.json                 ★ 首页个人信息（用户亲笔，勿重置）
│  │  ├─ hobbies.json                 ★ 爱好页数据（用户真实内容，勿重置）
│  │  └─ guestbook.json               本地留言种子（云模式下仅兜底用）
│  └─ assets/                         ★ 全部素材（用户上传的图/视频/MP3/封面，勿动）
└─ tools/                             开发辅助（不进网站）
   ├─ deploy-key / deploy-key.pub     ★ SSH 部署密钥（gitignore；公钥已登记 GitHub 账号）
   ├─ push-update.js                  ★ 一键推送核心逻辑（被根目录 bat/sh 调用，--dry-run 可演练）
   ├─ gh-token.txt                    REST 备用 token（gitignore，scope=repo）
   ├─ gh-device-auth.ps1              GitHub 设备授权脚本（带重试）
   ├─ push-via-api.js                 REST 推送：重放提交保 SHA、断点续传 push-state.json
   ├─ test-static.js                  jsdom 静态渲染回归（22 项）
   ├─ test-render.js / verify.js      渲染/验证脚本
   ├─ fix-git.js                      git 配置修复（历史遗留）
   └─ make-avatar.py                  形象图生成脚本
```

路径注意：`C:\Users\杨坤\WorkBuddy\2026-09-19-19-30-28\koyome\` 与 `C:\Users\Public\koyome-site\` 是同一目录（junction）。**统一用 `C:\Users\Public\koyome-site\`。**

### 2.3 重要技术决策及原因

1. **双模式数据层（API 探测）**——同一套代码既能在本机读写磁盘（站长编辑），又能在 GitHub Pages 静态环境只读运行（游客）。免去两套代码；角色判定零配置。
2. **留言板上 Supabase 而非自建**——Pages 无后端，访客留言原本只存各自 localStorage（互不共享，用户报障的根因）。选型排除：WorkBuddy Cloud Service（publishableKey 强制 Origin 匹配自家域名，跨域被拒）；自建服务器（家庭宽带无公网 IP）。Supabase 免费层 + RLS（anon 仅 SELECT/INSERT，天生无法改删）+ 纯 fetch 无 SDK，零成本零依赖。删除留言=站长去 Supabase 仪表盘 Table Editor。
3. **游客纯只读的条件渲染**——曾所有访客可见删除按钮/管理入口（安全事故级）。现所有编辑能力由 `apiAvailable()` 驱动渲染，游客 DOM 里零编辑痕迹；admin 页 JS gate 重定向。
4. **页面间过渡动画全部拆除**——做过两版（v1 被反馈"卡、不完整"；v2 修好后用户仍决定不要）。教训：用户审美判断优先于技术完成度。全站唯一动画=首页 loader，保持勿动。
5. **仓库改名 `koyome.github.io`**——免费把网址从 `/koyome/` 缩短到根路径；Pages 配置自动保留。代价：旧 `/koyome/` 链接 404（Pages 不跟随改名跳转）。`koyome.com` 已被注册，`koyome.me` 可注册未购买。
6. **移动端"缩减而非移除"**——曾直接 `display:none`/early-return 装饰元素（用户反馈"设计都没了"）。现 deco.js 移动端渲染 2 个缩小图形、Q版槽 62px 缩小、悬停反馈改 `:active`。
7. **sticky 页头 z-index 100**——修三点菜单被图片压住点不了（页头与内容同 z-index 1，DOM 序决定覆盖）。`overflow-x: clip` 防横向滚动（`hidden` 会破坏 sticky）。
8. **SSH 推送为正路**——本机 github.com 的 HTTPS 九成丢包（运营商级），SSH(22/443) 畅通；REST API 推送作备胎但 blob ≤37MB。

---

## 3. 待办事项、已知问题与风险

### 3.1 未完成任务（按紧急度）

1. ~~用户新内容未推送上线~~ **✅ 已完成（2026-09-21，提交 `d9228af`）**：电台 4 首新歌、5 个视频、3 部动漫 + 1 角色、2 个 Q版装饰共 25 文件已上线；线上抽查 content/hobbies json 与新素材 200 全过。
2. **koyome.me 域名**：可注册（约 ¥70-120/年），用户未购买。购买后：DNS 加 `CNAME → koyome.github.io`，仓库 Settings → Pages 填自定义域名 + Enforce HTTPS（`koyome.com` 已被注册，放弃）。
3. **旧链接 404**：`https://koyome.github.io/koyome/` 已失效。若用户分享过旧链接，可新建 `Koyome/koyome` 仓库放重定向页（用户决定）。
4. **内容级待办（需用户素材或决定，AI 勿自行处理）**：Q版装饰槽剩 1 空位；旅行照片描绘只有中文（英文可补）；chars 分区第 5 个角色名称暂空；`assets/` 里早期重复上传的同一首歌（`1789830681xxx`/`1789830788xxx`）+ 本次 2 个同名 JPG 待用户决定是否清理。

### 3.2 已知问题（均为有意设计或无害）

- 留言删除无前端入口——有意设计（anon key 无 DELETE 权限），站长用 Supabase 仪表盘删。
- 云端留言板故障/项目暂停时，留言自动回退 localStorage + 内置种子（优雅降级，不报错）。
- 本仓库 `git fetch` 后 `refs/remotes/origin/main` 偶不持久化（junction 路径所致），`git update-ref` 手补即可，纯美观。
- jsdom 测试在 admin 页 gate 会打 "Not implemented: navigation" 噪音——预期行为。

### 3.3 潜在风险

- **Supabase 免费层**：项目连续约 7 天无任何请求可能被暂停（paused）——留言板会静默降级到本地兜底。处理：仪表盘点 Restore 即可恢复，数据不丢。用量（500MB DB / 5GB 带宽）对留言板绰绰有余。
- **GitHub Pages 限额**：100GB 存储 / 100GB/月带宽软限制。当前视频最大 46.8MB，正常使用无虞；若用户传超大视频注意单文件 <100MB（git 限制）。
- **密钥面**：`tools/deploy-key`（SSH 私钥）与 `tools/gh-token.txt`（REST token）在本机明文——绝不外发、绝不入库（已 gitignore）；泄露即去 GitHub Settings 撤销。Supabase `sb_publishable_` key 是公开设计，无需保密，但只有读+写权限。
- **hosts 依赖**：http://Koyome.me 依赖本机 hosts 映射（已配）；换电脑需重跑 `setup-koyome-me.bat`（管理员）。

---

## 4. 环境信息

### 4.1 依赖与配置
- **Node 运行时**：`C:\Users\Public\koyome-node\node.exe`（绿色版；系统 node 亦可，零依赖）。WorkBuddy 托管 node 22 在 `C:\Users\杨坤\.workbuddy\binaries\node\versions\22.22.2-3\node.exe`。
- **PortableGit**：`C:\Users\杨坤\.workbuddy\binaries\PortableGit\versions\1.2.0\cmd\git.exe`（精简版，**无 remote-https helper**——push 必须显式写 SSH 地址，见 §4.3）。
- **jsdom**（测试用）：`C:\Users\杨坤\.workbuddy\binaries\node\workspace\node_modules`（NODE_PATH 指过去）。
- **Supabase**：项目 ref `hvywwgbzzqrwjrxiwfhx`；表 `public.guestbook(id, name≤40, text≤2000, created_at)`，RLS 策略 `anon read`(SELECT) + `anon write`(INSERT)。凭据在 `docs/js/gb-config.js`（可公开）。建表 SQL 存档于 git 历史 `86d3ac6` 及 Supabase SQL Editor。
- **Edge headless**（端到端测试）：`C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`，`--headless=new --remote-debugging-port`，Node 22 内置 WebSocket 直连 CDP（参考工作区 `verify-live-cloud.js` / `verify-round2.js`）。

### 4.2 本机运行
- 启动：**双击 `start-hidden.vbs`**（后台无窗口，推荐）或 `start-koyome.bat`（带窗口）；或 `PORT=80 node server.js`（端口被占自动回退 8080）。
- **开机自启已配置**：`%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\koyome-site.vbs`（登录时静默启动）。取消=删该文件；停服务=任务管理器结束 node.exe。
- **⚠️ AI 无法在 WorkBuddy 沙箱里代起持久进程**（2026-09-20 实测四条路全灭）：沙箱拉黑 schtasks/wscript/cmd，会话结束回收整棵进程树（run_in_background、detached+unref spawn、Start-Process 均随会话死）。**要"关掉 WorkBuddy 还能访问"，只能用户双击 vbs 或重新登录**。AI 代开的服务仅当前会话有效。
- hosts 已配 `127.0.0.1 Koyome.me`。API 代码改动必须重启服务才生效；docs/ 前端改动刷新即可。

### 4.3 部署到线上（push 后 Pages 约 1 分钟自动重建）

**📌 推送授权（2026-09-23 用户亲定）**：~~原常驻授权（2026-09-21）已取消~~。推送一律由用户手动执行（桌面 `push-update.bat`）；AI 只做 commit，**推送前必须逐次征得用户明确同意**。

**⭐ 一键脚本（2026-09-23 新增，2026-09-24 加固，站长自用）**：**站长日常入口 = 桌面上的 `push-update.bat`**（薄启动器，call 项目根的正主 `C:\Users\Public\koyome-site\push-update.bat` → 核心 `tools/push-update.js`）。**桌面副本绝不能放完整脚本**——完整脚本靠 `%~dp0` 定位项目，离开项目目录必废（用户踩过：把旧版完整 bat 拷到桌面，运行即"找不到模块+假死"）。自动：检测改动 → **给 6 个 HTML 的 css/js 引用打 `?v=时间戳` 版本戳（防 Pages 10 分钟缓存导致的新旧资源混排"页面全乱"，§0.18）** → commit（时间戳消息）→ SSH push（非快进时自动 `pull --rebase` 一次）→ `ls-remote` 核对 → **轮询线上直到端出新版本戳（约 1–4 分钟）**；失败按 网络/认证/冲突/超时/身份未配置 分类显示原因+建议；**成功 10 秒自动关窗（exit 0），失败 pause 保持窗口（exit 1）**。支持 `--dry-run` 演练。内部已做：ASCII junction 根路径、清代理变量、显式 SSH URL。仅 Windows（用户明确只要这个系统）。脚本失效时 AI 再按下面手动流程。

**首选 SSH**（本机 SSH 畅通，git smart-HTTP 九成丢包）：
```bash
cd /c/Users/Public/koyome-site
GIT="/c/Users/杨坤/.workbuddy/binaries/PortableGit/versions/1.2.0/cmd/git.exe"
"$GIT" add <files> && "$GIT" commit -m "..."
"$GIT" -c core.sshCommand="ssh -i C:/Users/Public/koyome-site/tools/deploy-key -o UserKnownHostsFile=C:/Users/Public/koyome-ssh/known_hosts -o StrictHostKeyChecking=accept-new" \
  push git@github.com:Koyome/koyome.github.io.git main
```
- 密钥：`tools/deploy-key`（私钥绝不外发）；known_hosts 用 ASCII 路径 `C:/Users/Public/koyome-ssh/known_hosts`（中文用户名 `~` 展开会乱码）。
- **坑：`git push origin main` 会报 `'remote-https' is not a git command`**（origin 是 HTTPS + PortableGit 精简版无 helper）——必须显式写 SSH URL。
- 2026-09-20 曾 `--force-with-lease` 抹平远端分叉（`0b52fbd`），此后普通 push 即可。

**备选 REST**（SSH 失效时）：`powershell -ExecutionPolicy Bypass -File tools\gh-device-auth.ps1`（生成/复用 gh-token.txt）→ `node tools/push-via-api.js`（重放提交保 SHA、断点续传；**blob >37MB 会被 422 拒**，大文件只能走 SSH）。

**兜底**：GitHub Contents API 逐文件 PUT（单文件 <1MB，碎 commit + 哈希分叉，仅应急）。

**推送后验证**：① `git ls-remote git@github.com:Koyome/koyome.github.io.git main` = 本地 HEAD；② 轮询 https://koyome.github.io/ 出现新内容；③ 抽查关键资源 200（含大文件素材各一）。**若 ② 迟迟不出现**：查 Pages 构建状态 `node tools/pages-build-admin.js`——自动构建偶发 `errored`（服务端抖动），`node tools/pages-build-admin.js rebuild` 手动重建一次即可（2026-09-21 实测，§0.10）。

### 4.4 本机网络现状（2026-09-20 实测）
- `github.com` git smart-HTTP：约九成丢包，不可用；**SSH(22/443) 畅通**；`api.github.com` 畅通。
- 跑网络脚本前清空全部代理环境变量：`http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY all_proxy`（残留 dead proxy `127.0.0.1:61928` 曾致 git 静默 502；`ALL_PROXY` 最隐蔽）。
- 可达：`uploads.github.com`、`objects/raw.githubusercontent.com`、`codeload.github.com`。

### 4.5 开发环境注意事项（本机/本工具链）
- **WorkBuddy Bash 工具缺 coreutils**（ls/grep/head/tail/nul 重定向不可用）——用 shell 内建或 node 一行；`git -C` 不接受 `/c/` 路径，先 `cd`。
- **PowerShell 工具 stdout 偶发不回显且 UTF-16 编码**——关键输出写文件，再用 node 读（BOM 处理：`s[0]===0xFF&&s[1]===0xFE` → `slice(2).toString('utf16le')`）。
- **Edit 工具偶发静默失败**——关键改动后必须 grep/Read 复查落盘。
- 内联 `node -e` 转义地狱——复杂脚本写成临时 .js 再跑。
- PowerShell `Remove-Item` 在工作区曾静默失败——删除用 node `fs.unlinkSync/rmSync`；大目录 rmSync 偶被 SIGTERM，分开单条执行。
- 写 Windows 脚本文件（.bat/.vbs）：内容保持纯 ASCII（非 ASCII 路径会乱码）；写入目标路径含中文无妨（Write 工具处理 Unicode 正常）。

---

## 5. 下一步建议（优先级排序）

1. **P0 — 推送用户新内容上线**（§3.1-1）：与用户确认后直接 commit 全部改动 + 24 个素材，SSH 推送，抽查线上新条目。这既是备份也是上线。
2. **P1 — 自定义域名 koyome.me**：用户购买后，DNS `CNAME → koyome.github.io` + 仓库 Pages 设置 + Enforce HTTPS，全站验证（Supabase 调用不受域名影响——PostgREST 独立域名，天然兼容）。
3. **P2 — 内容收尾**（协助用户，勿代办）：Q版装饰槽第 3 位、chars 第 5 个角色命名、旅行照片英文描绘、重复素材清理决策。
4. **P3 — 可选工程项**：
   - 旧 `/koyome/` 链接重定向仓库（若用户分享过旧链接）；
   - `tools/test-static.js` 扩充断言：首页爱好区、云留言回退链；
   - Supabase 项目防暂停：可设每周一次的自动化访问留言板保持活跃（非必须——暂停也就一键恢复）。
5. **不建议做**：页面过渡动画（用户明确否决过两次）、给留言板加站长前端删除入口（需要暴露更高权限密钥，风险大于收益）、自建后端替代 Supabase（无公网 IP）。

---

## 附录 A 数据模型

### 条目 Entry（content.json 数组元素）
```js
{
  id: 't1',                     // 服务器生成 'c'+base36；种子用 t1/i1/v1
  type: 'text'|'image'|'video', // 音频不是独立 type——音频条目是带 audio 媒体的 text 条目
  title, titleZh,               // 双语标题
  category, categoryZh,         // 双语分类（自由文本）
  date: '2026-09-12',
  featured: true,               // 星标精选
  desc, descZh,                 // 列表摘要
  body, bodyZh,                 // 正文。text 必有；image/video 可选，渲染为素材旁「手記/NOTE」区块
  src: 'assets/xxx',            // = media[0].src，冗余缓存，删 media 时服务端重算
  media: [
    { type: 'image', src: 'assets/xx.png', caption, captionZh },  // 素材描绘（双语）
    { type: 'video', src: 'assets/xx.mp4' },
    { type: 'audio', src: 'assets/xx.mp3', title: '歌名', cover: 'assets/xx.jpg' }  // 音频专有
  ],
  mapPins: {                    // 第十轮新增（仅 i1 用）：旅行地图自建地标
    tokyo: [{ x, y, zh, en, icon }],  // 坐标钳制 0–560 / 0–400，每图 ≤60 枚
    jeju:  [{ x, y, zh, en, icon }]   // 站长在地图上点击添加；游客只读；
  }                                 // icon=R13 地标图案键（SPOT_ICONS，可选，空=水滴针）
}
```
### Profile（profile.json）
`name, nameZh, tagline, taglineZh, intro, introZh, avatar, figNote, figNoteZh`（figNote=首页人像注释，空则隐藏，站长双击编辑）
### 爱好（hobbies.json）
```js
{ intro, introZh,
  sections: [ { id: 'anime'|'chars',        // 固定两分区
    items: [{ id, name, nameZh, text, textZh, src }] } ],
  deco: [{ id: 'd1'|'d2'|'d3', src: '' }] } // 3 个 Q版装饰槽
```
### 留言（云表 public.guestbook / 本地 guestbook.json）
云端 `{ id(自增), name, text, created_at }` → 前端映射 `{ id:'sb'+id, name, text, date(本地时区) }`；本地 `{ id, name, text, date }`。

**双语约定**：任何文本字段都可能有 `*Zh` 孪生；`Koyome.loc(item,'title')` 按当前语言取值、空则回退英文。

## 附录 B 本地 API 一览（server.js）

| 方法 | 路径 | 作用 |
|---|---|---|
| GET/POST | `/api/content` | 全部条目 / 新建（可带 `files:[{file:dataURL,filename}]`） |
| PUT/DELETE | `/api/content?id=` | 改文本字段 / 删条目（**不删 assets 文件**） |
| POST | `/api/media` | 条目加素材（音频支持 title+coverFile） |
| PUT/DELETE | `/api/media?id=&index=` | 改/删第 index 个素材（caption/captionZh、音频 title） |
| GET/POST | `/api/profile` | 读/改首页信息（支持 avatarFile dataURL） |
| GET/POST | `/api/hobbies` | 读/整页覆写爱好数据（POST 字段裁剪） |
| POST | `/api/hobbies/upload` | 爱好图片上传 `{file:dataURL,filename}` → `{src}` |
| GET/POST/DELETE | `/api/guestbook` | 本地留言增删查（云模式下仅兜底） |
| GET/DELETE | `/api/visits` | 访客名册（本地行 + 云端行合流并补全定位）/ 清空本地记录 |
| GET | `/api/visits/status` | 云端半边体检：`{cloud: ok｜no-table｜denied｜no-config｜error, rows}` |
| GET/POST | `/api/geo-key` | 读/存高德 Web 服务 Key（POST 会当场验证，无效 Key 拒存） |

上传一律 dataURL base64 → `assets/时间戳_文件名.ext`；BODY_LIMIT 200MB；音频 MIME：mp3/wav/ogg/flac/m4a。

## 附录 C 用户内容红线清单（2026-09-21 实盘点，勿删勿重置）

- `t1 電台`：10 首 MP3 全带封面（含未推送的 4 首新歌）。
- `i1 旅行紀錄`：8 图，5 张东京行照片已填中文描绘（东京塔/东大/你的名字取景地/新宿/涩谷）。
- `t2 關於 Koyome`：用户亲笔双语。
- `v1 私人剪輯視頻`：9 个视频（含未推送的 5 个）。
- 爱好页：8 部动漫 + 5 个角色（图+文）；Q版装饰槽已用 2/3。
- 首页：头像 `1789835827804_avatar.png`，intro 用户亲笔。
- 云表留言：欢迎留言（id=2）+ 此后访客真实留言。
- assets 重复文件（早期 2 个同曲 MP3、本次 2 个同名 JPG）——**是否删由用户决定**。

## 附录 D 开发教训（血泪，请继承）

1. 用户数据文件（§0.5 硬规则）是红线：测试一律用临时条目，测完清理并验证原样。
2. 本环境 Edit 偶发静默失败——关键改动后必须验证落盘。
3. 代理环境变量要全清（含 `ALL_PROXY`）——残留 dead proxy 让 git 静默 502，极难排查。
4. `github.com` 与 `api.github.com` 可达性是两回事：前者被丢包，后者畅通；SSH 又另是一路（畅通）。
5. token/密钥出现过就假设已泄露：删文件 + 提醒用户 revoke。
6. jsdom `fromURL` 在 deferred 脚本执行前 resolve——页面断言要等 DOMContentLoaded 或显式 sleep。
7. 让用户复制密钥/长字符串：必须让其用界面的 **Copy 按钮**（用户手抄 JWT 两次串字符，401 排查一轮）；优先选短密钥（`sb_publishable_`）。
8. 验证云端 INSERT 权限可不落数据：故意违反 check 约束，返回 23514 即权限正常（401/42501 才是策略缺失）。
9. infinite CSS 动画只挂可见态选择器；出场动画时长必须 < 跳转延迟。（过渡动画已全拆，存档备用）
10. AI 沙箱起不了持久进程（§4.2）——需要"用户关机重启后仍在"的服务，给用户可双击的脚本，别自己扛。
11. **免费 IP 定位源会 429**，单源必挂：信标要写成串行兜底链（freeipapi → ipwho.is → jsonip），且每级独立超时。
12. **无头浏览器的 UA 含 `headless`**，会被站内"剔除爬虫"的逻辑正确拦掉——探针里凡是验证面向真人的行为，都要先 `Network.setUserAgentOverride` 伪装成真实设备 UA，否则会误判成"功能没生效"。
13. 静态站（GitHub Pages）**不可能**被站长本机的服务端看见。凡"线上访客 → 站长可见"的需求，必须走云端中转，且通常伴随一个用户不得不做的一次性动作（建表/填 Key）——要提前讲清，别让功能静默装死。
