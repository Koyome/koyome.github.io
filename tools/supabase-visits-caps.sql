/* ============================================================
   Koyome.me — 给线上访客登记表加一列「访客名片」
   ------------------------------------------------------------
   为什么需要它：UA 只说设备「自称」是什么，而名片里是浏览器量出来
   的事实——屏幕物理分辨率、CPU 核数、内存、时区、深浅色偏好、网络
   类型、第几次来访。其中两条比 UA 更准：

     · Chromium 的 Client Hints 会给出 Android 真机型，以及 Windows
       的真实 platformVersion —— Windows 10 和 11 在 UA 里都报
       "NT 10.0"，这是唯一能把它们分开的办法。
     · 屏幕分辨率 × DPR = 物理分辨率，苹果各代分辨率各不相同，这是
       唯一能说出「哪台 iPhone」的办法（苹果早就不再把机型写进 UA）。

   为什么只加一列：全放进一个 jsonb，以后再加字段不用再改表。

   用法：Supabase 控制台 → SQL Editor → 全选粘贴 → Run。只需跑一次。
   不跑也不会出错——信标会先问表有没有这一列，没有就按原样登记，
   一次访问都不会丢。

   一步一步的图文说明在 tools/SETUP-VISITOR-CARD.md。
   ============================================================ */

/* ── 1. 加列：caps jsonb ────────────────────────────────────── */
alter table public.visits add column if not exists caps jsonb;

/* ── 2. 让 PostgREST 立刻认到这一列 ────────────────────────────
   Supabase 在 PostgREST 前面有一层 schema 缓存。不刷新它，网站那边
   可能要等十几分钟才看得到新列。这一行是官方推荐的刷新方式，重复跑
   无害（它只是一条通知，不是 DDL）。 */
notify pgrst, 'reload schema';

/* ── 3. 确认写入策略还在 ──────────────────────────────────────
   访客浏览器（anon）本来就能 insert，jsonb 列跟着同一条策略走，这里
   只是把它再立一次，重复跑安全。 */
drop policy if exists "anon register a visit" on public.visits;
create policy "anon register a visit"
  on public.visits for insert to anon
  with check (true);

/* ── 4. 自检（可看可不看） ────────────────────────────────────
   跑完应该看到一行：caps 列存在，类型是 jsonb。
   如果 Step 2 的 notify 没生效，这一条仍会显示 jsonb（它读的是数据库
   字典，不是 PostgREST 缓存），所以请以第 5 步为准。 */
select column_name, data_type
from information_schema.columns
where table_schema = 'public' and table_name = 'visits' and column_name = 'caps';

/* ── 5. 收尾确认：这一条应当返回「一行、只有 caps 一个字段」 ────
   PostgREST 认识这一列的标志就是它能被 select。把这一行单独选中再 Run，
   看到 200 且没有报错，就说明网站那边已经能写名片了。 */
-- select caps from public.visits limit 1;
