# Koyome.me — 项目交接文档（AI Handover）

> 写给下一个接管本项目的 AI（或人类开发者）：**读完这一份，即拥有继续开发的全部上下文。**
> 最后更新：2026-09-27（第二十八轮：桌面测试服 `kstage-preview.html` 增设人偶节；`server.js` 为本地跨域测试加 CORS 头）
> 仓库状态：本地 HEAD = `4e8dc46`，**远端 main 与之相同**（09-26 20:37 用户一键推送，R20–R24 已上线）｜ ⚠️ 常驻推送授权**已于 2026-09-23 取消**：AI 推送前必须逐次征得用户同意（§4.3）

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
