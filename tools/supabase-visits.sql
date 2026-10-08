/* ============================================================
   Koyome.me — 线上访客登记表（Supabase / PostgREST）
   ------------------------------------------------------------
   为什么需要它：线上是 GitHub Pages 静态托管，手机打开
   koyome.github.io 时请求根本不经过站长的电脑，所以「手机访问
   线上网址 → 本地看到记录」必须借云端转一手。访客浏览器把自己
   的公网 IP 写进这张表，本机的 server.js 再读回来并补全定位。

   用法：Supabase 控制台 → SQL Editor → 全选粘贴 → Run。
   只需跑一次。口令已经替你生成好了，不用改任何东西。
   ============================================================ */

create table if not exists public.visits (
  id        bigserial primary key,
  ip        text        not null,
  page      text,
  ua        text,
  lat       double precision,   /* 浏览器侧顺手带回的坐标，可为空 */
  lon       double precision,
  ts        timestamptz not null default now()
);

/* 已经建过表也不会出错：缺的列补上 */
alter table public.visits add column if not exists lat double precision;
alter table public.visits add column if not exists lon double precision;

/* ── 地址兜底：让表自己把访客 IP 填进去（强烈建议跑这一段）──
   为什么需要：访客浏览器要先问第三方服务「我的公网 IP 是多少」，
   才敢把地址写进来。第三方会挂、会限流、会被墙——只要它没回答，
   这次访问就只能整条丢掉。

   这里把 ip 的默认值改成从请求头里取。PostgREST 每次插入都会带上
   真实来源地址，所以哪怕访客浏览器一个地址都查不到，只要它不带
   ip 字段提交，这一列也会被自动填上真值——而且比浏览器自报的更
   可信，因为它不是访客说了算。

   重复跑这一整个文件是安全的：下面这些 create or replace 都不会报错。 */
create or replace function public.visits_client_ip() returns text
language sql stable as $$
  select coalesce(
    nullif(btrim(split_part(
      coalesce(current_setting('request.headers', true)::json ->> 'x-forwarded-for', ''),
      ',', 1)), ''),
    ''
  );
$$;

alter table public.visits alter column ip set default public.visits_client_ip();

/* 地址为空的行也必须能写进来——宁可留一条没有地址的记录，
   也不要因为查不到地址而把整次访问丢掉 */
alter table public.visits alter column ip drop not null;

create index if not exists visits_ts_idx on public.visits (ts desc);

alter table public.visits enable row level security;

/* 任何人（含访客浏览器）都可以登记一次到访 —— 但不能改、不能删 */
drop policy if exists "anon register a visit" on public.visits;
create policy "anon register a visit"
  on public.visits for insert to anon
  with check (true);

/* 读取：只有带本机那串口令的请求才读得到。
   口令已写在本机的 tools/sb-key.txt（该文件已在 .gitignore 里，
   不会进仓库、不会外泄）。下面这串和它一致：iBo8lVV3DR1k1NI8otRfU91zYTtmiERT */
drop policy if exists "owner reads visits" on public.visits;
create policy "owner reads visits"
  on public.visits for select to anon
  using (
    coalesce(
      current_setting('request.headers', true)::json ->> 'x-koyome-key',
      ''
    ) = 'iBo8lVV3DR1k1NI8otRfU91zYTtmiERT'
  );

/* ── 备用方案（省事，但访客 IP 对任何拿到 anon key 的人可读）──
   如果上面那条口令校验在你的项目里不生效（老版本 PostgREST 读
   不到 request.headers），就删掉「owner reads visits」，改用这条：

drop policy if exists "owner reads visits" on public.visits;
create policy "anon reads visits"
  on public.visits for select to anon
  using (true);
*/
