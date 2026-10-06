# 访客记录上线指南（手机访问线上站 → 本地看到 IP 与精确到区的位置）

> 这份文档只讲**必须你亲手做**的事。代码全部写好、测试通过，你只要照着点几下。
> 全程大约 15 分钟。
>
> - 第一步：建一张云端表 + 加固权限（让手机的到访能寄回来、且只有你能看）
> - 第二步：**推送一次**（⚠️ 装访客登记的 `visit-beacon.js` 只在本地，不推上去线上不会记录）
> - 第三步：申请一个高德 Key（让地址能精确到「区」，可后补）

---

## 为什么要做这两步（先看懂再动手）

你的线上站在 GitHub Pages 上，是**纯静态托管**——它只是一堆放在 CDN 上的文件，
没有服务器程序在跑。所以当你用手机打开 `koyome.github.io` 时：

- 请求根本**不会经过你这台电脑**
- 本机的 `server.js` 无论如何都**看不见这次访问**
- 这不是 bug，是静态托管的物理限制，靠改代码解决不了

唯一的办法是**加一个中转**：让手机浏览器自己把「我的 IP」写进一张网上的表里，
然后你的电脑再去那张表里读。也就是下面这张图：

```
   你的手机                        Supabase 云端表              你的电脑
   ────────                        ─────────────              ────────
   打开 koyome.github.io
        │
        │  visit-beacon.js 问公网服务
        │  「我的 IP 是多少？」
        │
        │  POST  ip / 页面 / 经纬度  ──────▶  visits 表
        │                                      │
        │                                      │  你打开 /visits.html
   server.js  ◀──── GET /api/visits ───────────┘
   读表 + 补全省市区和坐标
        │
        ▼
   visits.html 的名册表里出现这一行
```

**第一步**就是建这张表。**第二步**是让「补全地址」这一步从「只能到市级」升级成「能到区级」。

---

# 第一步 · 建云端表（Supabase SQL Editor）

这一步**只需要做一次**，建完就永远生效。

## 1-1 打开 SQL 编辑器

在你自己的浏览器里打开这个链接（会自动带上你的项目，不用选项目）：

```
https://supabase.com/dashboard/project/hvywwgbzzqrwjrxiwfhx/sql/new
```

- 如果跳转到登录页，用你平时管理 Supabase 的账号登录即可。
- 万一提示项目名不对，就先进 <https://supabase.com/dashboard> ，点进那个项目，
  然后左侧菜单最下面 **SQL Editor** → **New query**。

## 1-2 粘贴 SQL

**全选下面这段全部内容**（从第一行的 `/*` 到最后一行的 `*/`），复制：

```sql
create table if not exists public.visits (
  id        bigserial primary key,
  ip        text        not null,
  page      text,
  ua        text,
  lat       double precision,
  lon       double precision,
  ts        timestamptz not null default now()
);

alter table public.visits add column if not exists lat double precision;
alter table public.visits add column if not exists lon double precision;

create index if not exists visits_ts_idx on public.visits (ts desc);

alter table public.visits enable row level security;

drop policy if exists "anon register a visit" on public.visits;
create policy "anon register a visit"
  on public.visits for insert to anon
  with check (true);

drop policy if exists "owner reads visits" on public.visits;
create policy "owner reads visits"
  on public.visits for select to anon
  using (
    coalesce(
      current_setting('request.headers', true)::json ->> 'x-koyome-key',
      ''
    ) = 'iBo8lVV3DR1k1NI8otRfU91zYTtmiERT'
  );
```

> ⚠️ 这段 SQL 里的口令 `iBo8lVV3DR1k1NI8otRfU91zYTtmiERT` **不用改**——它和你电脑上
> `tools/sb-key.txt` 里那一串是同一串，已经对好了。那份文件在 `.gitignore` 里，不会外泄。

## 1-3 点 Run

编辑器右上角（或下方）有个 **Run** 按钮，点它。

**成功的样子**：结果区显示 `Success. No rows returned` 之类，
下方 Messages 里没有红色报错。整段是建表 DDL，成功时本来就没有数据行。

**失败了怎么办**：

| 报错里出现的 | 意思 | 怎么办 |
|---|---|---|
| `relation "visits" already exists` | 表早就建过了 | **不算错**，忽略即可 |
| `syntax error` | 粘贴时少了引号或分号 | 删掉重来，重新完整复制 |
| `must be owner of table` | 你不是这个项目的 owner | 确认左上角项目名是 `hvywwgbzzqrwjrxiwfhx` |
| `permission denied for schema public` | 项目开了额外限制 | 换个浏览器/退出重登 Supabase 再试 |

即使报 `already exists` 也**不影响**——后面的 policy 语句照样会执行。

## 1-4 验证建好了

打开 <http://Koyome.me/visits.html>（站点导航第 05 项「访客 / Visitors」），看顶部的
「线上登记 / ONLINE」那一格：

- 写着 **`未连接 · 线上登记可用`** → 成功 🎉
- 还写着 **`表还没建 · 需跑一次 tools/supabase-visits.sql`** → 回去检查 1-2、1-3

也可以直接开 <http://127.0.0.1/api/visits/status> 看，成功的返回是：

```json
{"cloud":"ok","rows":0}
```

`rows:0` 是正常的——表是空的，因为还没人从线上访问过。

## 1-4′ 顺手把权限加固（**别跳过**）

2026-10-07 自查时实测发现：虽然建表 SQL 已经开了 RLS、也建了"带口令才能读"的策略，
但实际请求里**不带口令也能读走全部访客 IP**。原因是你这份 Supabase 项目对 `anon`
角色还有别的宽松策略在生效。

这不是小问题——**anon key 就写在你网站的 `gb-config.js` 里，是公开的**。
任何打开你网站的人都能拿到它，然后读走或删掉你的访客记录。

**修法**：再跑一次这个文件（同样全选粘贴 → Run）：

```
tools/supabase-visits-harden.sql
```

它会先 `select` 出这张表上现存的全部策略让你看清楚，然后全部 drop 掉、
`revoke` 掉 anon 的一切权限，重新只授予 `INSERT`，再用四条策略精确重建。
最后顺手删掉自查时留下的两行自测数据（`203.0.113.x` 是保留网段，真实访客不会有）。

**跑完自己验一下**：浏览器里直接打开这个地址——

```
https://hvywwgbzzqrwjrxiwfhx.supabase.co/rest/v1/visits?select=*
```

**必须**看到 `[]` 或一行 permission denied。如果看到 `{"ip": "..."}` 说明还没锁上，
回来找我。

## 1-5 顺手测一次（可选，但建议）

1. 打开 <http://Koyome.me/visits.html>，点顶部「自动 / AUTO」。
2. **用手机**（流量，不要连同一个 Wi-Fi）打开你的线上站 `koyome.github.io`，随便点两页。
3. 几秒后桌面那张表应该自己多出一行，来源列写着 **线上 ↑**。

如果线上站还没推最新代码，这一步不会有反应——需要先把仓库推上去（你自己手动推）。

---

# 第三件事 · 必须推送一次，线上才会开始记录

**是的，一定要推送。** 这条容易被忽略，但它是整件事的开关。

原因：装访客登记的是 `docs/js/visit-beacon.js`，而它只存在于**你的本地仓库里**，
GitHub Pages 上跑的那份是**上次推送时的快照**。现在线上那份没有这个文件，
手机打开线上站时根本不会有人去登记，自然什么也传不回来。

## 推之前先确认这几件事

**① 三个敏感文件不能进仓库**（已配好，你不用管，但要知道自己配了）

```
tools/sb-key.txt          ← 云端读取口令
tools/geo-key.txt         ← 高德 Key
docs/data/visits.json     ← 真实访客 IP
```

跑一下这条命令确认：

```bash
cd C:/Users/杨坤/WorkBuddy/2026-09-19-19-30-28/koyome
git status --short
```

输出里**不应该**出现上面三个文件名。如果出现了，说明 `.gitignore` 被改坏了，
先别提交。

**② 确认要推的东西都在**

```bash
git status --short
```

应该看到 12 个修改 + 8 个新增，其中这几个是这次的关键：

```
?? docs/js/visit-beacon.js     ← 线上登记的开关，就是它
?? docs/visits.html              ← 访客名册大页（导航第 05 项）
?? docs/js/visits.js            ← 名册驱动
?? tools/supabase-visits.sql    ← 建表 SQL
?? tools/supabase-visits-harden.sql  ← 权限加固
?? tools/SETUP-VISITS.md        ← 本文档
```

## 推送

```bash
cd C:/Users/杨坤/WorkBuddy/2026-09-19-19-30-28/koyome
git add -A
git commit -m "Journal page + visitor IP roll (省市区 + 经纬度)"
git push origin main
```

push 完等 1–3 分钟（Pages 有 CDN 缓存），然后：

**① 强刷一次线上站**（Ctrl+F5，或手机清除缓存重开）
**② 用手机流量**打开 `koyome.github.io`，随便点两页
**③ 回到电脑看 <http://Koyome.me/visits.html>**，点一下刷新

应该多出一行，来源列写着 **线上 ↑**，所在地是「xx省xx市xx区」，经纬度一栏有数字。

## 如果推完还是没记录

按这个顺序排查：

| 检查 | 怎么看 | 说明 |
|---|---|---|
| 线上有没有 beacon | 打开 `https://koyome.github.io/js/visit-beacon.js` | 404 = 没推上去 |
| 云端通不通 | 本机 `/api/visits/status` | 不是 `ok` = 第一步没做完 |
| 手机是不是走了缓存 | 换浏览器/清缓存再试 | Pages 缓存可能要几分钟 |
| 是不是同一 Wi-Fi | 手机改用流量 | 同一局域网时手机看到的是你电脑的访问 |

最直接的验证：**打开线上那个 js 文件的 URL，能看到代码就说明推上去了**。

---

# 第二步 · 申请高德 Key（让地址精确到「区」）

## 不做这一步会怎样

| 数据源 | 免费额度 | 精度 |
|---|---|---|
| ip-api.com | 免费无密钥 | 国家 / 省 / **市** |
| 太平洋在线 whois | 免费无密钥 | 省 / 市 / **偶尔**有区 |
| **高德 Web 服务** | 注册就有，IP 定位 2.0 每天几千次 | 国家 / 省 / 市 / **区/县** ← 要的就是这个 |

实测：你的公网地址在免费源上只能查到「湖南省长沙市」，查不到区。
高德能给出「湖南省长沙市岳麓区」这一级。

## 我不能替你申请，原因很实在

高德要求 **手机号验证码 + 实名认证（身份证）**。这两样只能由你本人操作，
我既收不到验证码，也不该经手你的身份信息。所以这一步必须你亲手点。
但我把「申请→生效」压到了最短——**拿到 Key 后不用找文件、不用重启服务，
直接在 08 那一页粘进去点保存，当场生效。**

## 2-1 注册 / 登录

1. 打开 <https://lbs.amap.com/> ，右上角 **注册** 或 **登录**。
2. 建议用**手机号 + 扫码**登录（后面实名认证也要用同一个号）。
3. 登录后点右上角 **控制台**（或直接去 <https://console.amap.com/dev/key/app>）。

## 2-2 完成开发者认证（一次）

控制台里会引导你选 **个人开发者**，然后：

- 填姓名 + 身份证号
- 按提示上传身份证正反面
- 提交后通常几分钟内通过

认证通过才能建 Key。这一步是平台强制要求，无法跳过。

## 2-3 创建应用

1. 控制台左侧 **应用管理 → 我的应用**。
2. 右上角点 **+ 创建新应用**，随便填：
   - 应用名称：`koyome-visits`
   - 应用类型：选 **`Web服务`**（**这个必须选对，选成 Android/iOS 会报
     `SERVICE_NOT_ENABLED`**）
   - 描述：留空即可
3. 点确定，应用出现在列表里。

## 2-4 在应用下添加 Key

1. 点进刚建的应用，点 **+ 添加 Key**。
2. 填：
   - Key 名称：`koyome-ip`
   - **服务平台：只勾 `Web服务`**
     （JS API / Android / iOS 都不用勾——多了反而可能干扰）
   - **IP 白名单 / 域名白名单：全部留空**
     （IP 定位是服务端请求，没有 Referer；填了反而会拦掉）
   - 勾选底部的用户协议，提交
3. 生成一串 **32 位十六进制**字符，形如 `1a2b3c4d5e6f...`，**这就是 Key**。

## 2-5 粘进去，当场生效

1. 回到 <http://Koyome.me/visits.html>，用页面顶部那行「高德 KEY / AMAP KEY」。
2. 找到 **高德 Key** 那一行，把 Key 粘进输入框。
3. 点 **保存并生效**。

成功会显示：`已验证 · 1a2b••••••f2e · 精确到区`。

**这一步会自动完成三件事**：向高德真发一次请求验证 Key 有效 → 写进
`tools/geo-key.txt`（在 `.gitignore` 里，不会进仓库）→ 立刻清空定位缓存并重新查一遍。
**不需要重启服务。**

填错了会显示 `保存失败：INVALID_USER_KEY` 之类，并且**不会保存**——
不会有"填了坏 Key 导致永久空白"的风险。

---

## 出了岔子怎么查

在 08 那一页点 **自检** 按钮，会弹出一份清单，直接告诉你卡在哪一步：

```
自检 · 2026/10/7 06:10:22

① 本机服务    在线
② 高德 Key    已配置 1a2b••••••f2e
③ 云端登记    已连接 · 线上登记可用（3 条）

④ 到访记录    5 条
   最近一条：14.104.32.77 · 广东省深圳市南山区 · 22.5431, 114.0579

⑤ 线上访问    需要把本仓库推到 koyome.github.io，
   且手机打开线上站才会登记（线上请求不经过这台电脑）。
```

其他常见状况：

| 现象 | 原因 | 处理 |
|---|---|---|
| `自检` 报「连不上本机服务」 | 本机网站没开 | 双击项目根目录的 `start-hidden.vbs` |
| 云端一直 `no-table` | SQL 没跑或跑失败 | 回 1-2 重来 |
| 云端 `denied` | 口令对不上 | 确认 `tools/sb-key.txt` 里的串与 SQL 里的是同一串 |
| 手机访问线上站没记录 | **仓库还没推最新代码** | 先 `git add -A && git commit && git push` |
| 地址只有市没有区 | 高德 Key 没配 | 走第二步 |
| 地址显示「局域网 / 本机」 | 这条是本机自己访问的 | 正常，公网 IP 才有真实位置 |

---

## 安全说明

- `tools/sb-key.txt`、`tools/geo-key.txt`、`docs/data/visits.json`
  **三个文件都已在 `.gitignore` 里**，不会被推到公开仓库。
- 访客名册**只在你的电脑上渲染**（页面要先探测到本机 API 才显示）。
  访客打开线上站看不到任何人的 IP 记录。
- 云端表 `visits` 的权限：**任何人都能写入一条到访记录，但没人能改、不能删、不能读**。
  只有带着你本机那串口令的请求才读得到。
- 高德 Key 只存在你本机，会随请求发给 `restapi.amap.com`——这是它的唯一用途。