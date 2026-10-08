/* ============================================================
   Koyome.me — 访客表权限加固（RLS 兜底）
   ------------------------------------------------------------
   为什么要这份：2026-10-07 自查时发现，虽然建表 SQL 已经
   enable 了 RLS、并建了「带口令才能读」的策略，但实测
   **不带口令、甚至不带 x-koyome-key，依然能 SELECT，
   甚至能 DELETE** —— 说明这份 Supabase 项目对 anon 角色
   还有别的宽松策略在起作用（新版 Supabase 默认会给 anon
   配 permissive 策略）。

   风险：anon key 就在你网站的 gb-config.js 里，是公开的。
   任何打开你网站的人都能拿到它，然后：
     · 读走所有访客的 IP 和地理位置
     · 删掉你的记录

   本文件把所有可能生效的路径一次关掉，只留两条：
     INSERT  — 任何人可登记一次到访
     SELECT  — 必须带 tools/sb-key.txt 里那串口令

   用法：Supabase 控制台 → SQL Editor → 全选粘贴 → Run。
   跑完再跑一次 tools/supabase-visits.sql 不冲突（幂等）。
   ============================================================ */

/* ---------- 1. 列出这张表上现存的全部策略（先看清楚再动手） ---------- */
select policyname, cmd, roles, qual, with_check
  from pg_policies
 where schemaname = 'public' and tablename = 'visits';

/* ---------- 2. 关掉所有现存策略 ---------- */
do $$
declare p record
begin
  for p in select policyname from pg_policies
            where schemaname = 'public' and tablename = 'visits'
  loop
    execute format('drop policy if exists %I on public.visits', p.policyname);
  end loop;
end $$;

/* ---------- 3. 兜底：撤掉 anon / authenticated 身上所有 GRANT ---------- */
revoke all on table public.visits from anon;
revoke all on table public.visits from authenticated;

/* ---------- 4. 重新只授予「插入」 ---------- */
grant insert on table public.visits to anon;

/* ---------- 5. 策略：可插入，但必须带口令才能读、任何人不能改不能删 ---------- */
create policy "visits: anon may register"
  on public.visits for insert to anon
  with check (true);

create policy "visits: owner reads with secret"
  on public.visits for select to anon
  using (
    coalesce(
      current_setting('request.headers', true)::json ->> 'x-koyome-key',
      ''
    ) = 'iBo8lVV3DR1k1NI8otRfU91zYTtmiERT'
  );

/* 不许改、不许删——站长本人也不删。
   云端那张表是公开站写入的登记簿，不是本机的名册；页面上"删除"只作用于
   本机 docs/data/visits.json。云端数据保留是为了让漏删的记录还能追溯。 */
create policy "visits: nobody updates"
  on public.visits for update to anon
  using (false) with check (false);

create policy "visits: nobody deletes"
  on public.visits for delete to anon
  using (false);

/* ---------- 6. 确认 RLS 真的开着且强制 ---------- */
alter table public.visits enable row level security;

/* ---------- 7. 清掉 2026-10-07 自查时留下的两行自测数据 ---------- */
   （它们是 203.0.113.x 保留网段，真实访客不会有这种地址）
delete from public.visits
 where ip in ('203.0.113.99', '203.0.113.98')
   or ua = 'koyome-self-test';

/* ---------- 8. 跑完对答案（应只看到上面 4 条策略） ---------- */
select policyname, cmd, roles from pg_policies
 where schemaname = 'public' and tablename = 'visits'
 order by cmd, policyname;

/* ---------- 9. 对答案（应该没有 203.0.113.x 了） ---------- */
select count(*) as leftover from public.visits where ip like '203.0.113.%';

/* ============================================================
   跑完怎么验证生效（在你的浏览器里做）

   不带口令读 —— 必须失败：
   打开 https://hvywwgbzzqrwjrxiwfhx.supabase.co/rest/v1/visits?select=*
   预期看到 [] 或一行 permission denied，**绝对不能**看到 [{"ip":...}]

   带口令读 —— 必须成功：这一条由你的 server.js 自动做，
   所以直接看本机 /api/visits/status：
   预期 {"cloud":"ok","rows":N}
   ============================================================ */