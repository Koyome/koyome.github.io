# 让线上真实访客也有「访客名片」——Supabase 操作说明

整个过程 **3 分钟、只跑一段 SQL、不用改代码、不用填密钥**。跑完之后，从手机打开
线上站点，访客名册里那条记录点开就会多出一张名片。

> 不跑也不会出问题：网站会先问表有没有这一列，没有就按原样登记，**一次访问都不会丢**。
> 只是线上访客没有名片而已。

---

## 第 1 步：进 Supabase 控制台

浏览器打开 <https://supabase.com/dashboard> → 用你建这个项目时的账号登录。

本项目的信息（不用记，只是核对用）：

- 项目地址：`https://hvywwgbzzqrwjrxiwfhx.supabase.co`
- 表：`public.visits`
- 口令文件：本机的 `tools/sb-key.txt`（已在 `.gitignore` 里，不会外泄）

在控制台左侧的项目列表里点进这个项目（名字一般不是上面那串域名，就是你自己起的那个）。

---

## 第 2 步：打开 SQL Editor

左侧栏最下面一个图标 **SQL Editor**（齿轮旁边的数据库图标）→ 点它 →
右上角 **+ New query**（新建查询）。

会看到一个空白的输入框，右上角有个绿色的 **Run** 按钮。

---

## 第 3 步：把下面这段整段贴进去

> 也可以直接打开仓库里的 `tools/supabase-visits-caps.sql`，全选复制。

```sql
-- 1. 加一列，放访客名片
alter table public.visits add column if not exists caps jsonb;

-- 2. 让 PostgREST 立刻认到新列（不刷新缓存可能要等十几分钟）
notify pgrst, 'reload schema';

-- 3. 写入策略再立一次（访客浏览器本来就能登记，这列跟着同一条策略走）
drop policy if exists "anon register a visit" on public.visits;
create policy "anon register a visit"
  on public.visits for insert to anon
  with check (true);

-- 4. 自检：应当返回一行 caps / jsonb
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'visits' and column_name = 'caps';
```

---

## 第 4 步：点 Run

正常的话，下面 Results 区域会出现一行：

| column_name | data_type |
|---|---|
| caps | jsonb |

**这就成了。** 没有报错、出现上面这一行 = 成功。

### 可能看到的提示（都不是错误）

- `column "caps" of relation "visits" already exists` —— 说明你之前跑过一次，
  语句里带了 `if not exists`，所以只是跳过，没问题。
- 第 4 条自检返回空 —— 极少见，说明 `alter` 没生效；把页面刷新后单独重跑第 1 条再试。

---

## 第 5 步：验证 PostgREST 真的认到这一列（可选，但建议做）

SQL Editor 里**再开一个 New query**，只贴这一行然后 Run：

```sql
select caps from public.visits limit 1;
```

- 返回一行（内容可能是空的，显示 `caps` 一个字段名）→ 正常。
- 报 `column visits.caps does not exist` → 第 2 步的缓存刷新没生效，等 1–2 分钟再跑一次这一行。

> 这一步其实就是网站每次访问时做的事：它会先问一句"你有 caps 这一列吗"，
> 你说"有"，它才把名片写进来。所以这行能跑通，网站就能写。

---

## 第 6 步：让它在本机生效

改了 `server.js` 之后必须重启一次：

**双击桌面上的 `Koyome-Restart-Site.vbs`** —— 会弹一个确认框，点掉就好。

想确认重启成功，浏览器打开 <http://127.0.0.1/api/visits/status> ，看到的一长串 JSON 里
应该有 `"build": "一串数字"`。没有 `build` = 还是旧进程。

---

## 第 7 步：看效果

1. 手机（开 4G/WiFi 都行）打开线上站点，随便点两个页面，停留十几秒。
2. 回到电脑，打开访客页 → 找到刚那条记录 → **点一下那一行**展开。
3. 展开区顶部就是「访客名片」，大概长这样：

   - **屏幕** 393×852 @3x —— 视口 393×659
   - **处理器** 6 核 —— 内存 8 GB
   - **时区** Asia/Shanghai —— 当地时间 04:12
   - **配色** 深色 —— 动效 正常 —— 操控 触屏
   - **网络** 4g —— 延迟 50 ms —— 下行 9.2 Mb/s
   - **第几次来访** #7 —— 首次 2026-09-01 —— 本次来访 3 页 · 4分22秒
   - **上一页停留** 1分14秒（/index.html）—— 阅读 62%

---

## 没看到名片？按这个顺序排查

| 现象 | 原因 | 怎么办 |
|---|---|---|
| 展开区完全没有「访客名片」四个字 | 这条记录是在跑 SQL **之前**产生的 | 老记录没有名片，这是正常的；用手机重新访问一次再看新记录 |
| 手机上访问了，还是没有 | 本机没重启，跑的旧代码 | 双击 `Koyome-Restart-Site.vbs`，再核对 `/api/visits/status` 里有 `build` |
| 有 `build`，新记录还是没有 | 浏览器缓存了旧版信标 | 手机端强刷一次（版本号已刷新，正常会自动生效）；或换无痕窗口 |
| 只有一部分字段 | 浏览器不支持 | Safari 拿不到 Client Hints（Chromium 才有）；iPhone 仍会由屏幕识别出机型 |
| 报 `permission denied` | 用的不是项目 Owner 账号 | 换建这个项目的账号登录 |

---

## 几个你可能想问的

**会不会多泄露访客隐私？**
名片里没有姓名、账号、精确位置，只有屏幕尺寸、时区、网络类型这类"设备档位"信息。
站点本来就已经在记 IP 和 UA（比这些敏感得多）。但决定权在你——不跑这段 SQL，就一条都不会多记。

**要不要定期重跑？**
不用。`if not exists` 保证重复跑无害，但也没必要再跑。

**以后想加新字段怎么办？**
不用改表。`caps` 是 jsonb，新字段直接塞进去就行。

**会影响现有数据吗？**
不会。只加一列，不动任何已有行。

**能撤回吗？**
能：`alter table public.visits drop column caps;` —— 网站会自动退回原样登记，一次访问都不会丢。
