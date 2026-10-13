-- =====================================================================
-- 社群經營工作台 資料庫 v2（Supabase / PostgreSQL）
-- 使用方式：Supabase 後台 → SQL Editor → 貼上整份 → Run（可重複執行）
-- 原則：①所有資料表都開啟 RLS（列級權限） ②金鑰/授權 token 放在「沒有任何用戶端權限」的表，
--       而且存進去之前已在 Next.js 伺服器用 AES-256-GCM 加密（資料庫外洩也拿不到明文）
--       ③權限規則寫在資料庫，前端被改過也繞不過去
-- v2 新增：profiles（使用者）、posts（貼文）、同步排程欄位、API 配額表、
--          一鍵刪除帳號函式、Meta 資料刪除請求紀錄、舊資料清除函式
-- 命名：srv_ 開頭的函式＝只有伺服器（service_role）能呼叫，前端呼叫會被拒絕
-- =====================================================================
create extension if not exists pgcrypto;
create schema if not exists app;                 -- 內部輔助函式（不對外開放）
revoke all on schema app from public;
grant usage on schema app to authenticated, service_role;

-- ---------- 資料表 ----------
-- 使用者個人資料（＝需求中的 users 表）。登入帳號本身由 Supabase 的 auth.users 管理，
-- 這裡只放「顯示用＋個資法同意紀錄」。刪除 auth.users 時會自動一起刪除（on delete cascade）。
create table if not exists public.profiles(
  id uuid primary key references auth.users on delete cascade,
  display_name text not null default '' check (char_length(display_name) <= 40),
  locale text not null default 'zh-TW',
  privacy_version text,                 -- 使用者同意的隱私權政策版本（例如 '2026-10-01'）
  privacy_accepted_at timestamptz,      -- 同意時間：個資法要求能證明「已告知並取得同意」
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspaces(
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80),
  settings jsonb not null default '{}'::jsonb,   -- 留言類型時限、備援條件、操作人員是否可一次回覆…
  created_at timestamptz not null default now()
);

create table if not exists public.members(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  user_id uuid references auth.users on delete set null,   -- 對方第一次登入後才會填
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  name text not null check (char_length(name) between 1 and 40),
  role text not null check (role in ('管理員','主管','操作人員')),
  all_brands boolean not null default false,
  active boolean not null default true,
  note text not null default '',
  created_at timestamptz not null default now(),
  unique (workspace_id, email),
  unique (workspace_id, name)
);
create unique index if not exists members_ws_user on public.members(workspace_id,user_id) where user_id is not null;
create index if not exists members_user on public.members(user_id);

create table if not exists public.brands(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  color text not null default '#1E88C7',
  description text not null default '',
  created_at timestamptz not null default now(),
  unique (id, workspace_id)
);

-- 成員負責哪些品牌（is_lead = 品牌負責人標記，不是角色）
create table if not exists public.member_brands(
  member_id uuid not null references public.members on delete cascade,
  brand_id uuid not null references public.brands on delete cascade,
  is_lead boolean not null default false,
  primary key (member_id, brand_id)
);

create table if not exists public.brand_profiles(      -- 品牌問卷答案（含「其他」文字，選項代碼與自由文字分開存）
  brand_id uuid primary key references public.brands on delete cascade,
  answers jsonb not null default '{}'::jsonb check (pg_column_size(answers) < 100000),
  updated_at timestamptz not null default now()
);
create table if not exists public.brand_configs(       -- AI 風格設定
  brand_id uuid primary key references public.brands on delete cascade,
  personality text not null default '', formal int not null default 50, humor int not null default 30,
  len int not null default 50, emoji text not null default '少量', addr text not null default '您',
  words text not null default '', ban text not null default '', nopromise text not null default '',
  updated_at timestamptz not null default now()
);
create table if not exists public.kb_items(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  brand_id uuid not null,
  category text not null, title text not null, body text not null default '',
  enabled boolean not null default true, source text not null default 'manual',
  created_at timestamptz not null default now(),
  foreign key (brand_id, workspace_id) references public.brands(id, workspace_id) on delete cascade
);

create table if not exists public.social_accounts(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  brand_id uuid,
  platform text not null check (platform in ('instagram','facebook','youtube','google_business')),
  surface text not null default 'posts',               -- posts / reels / ads / shorts / reviews …
  handle text not null,
  external_id text,                     -- 平台上的帳號 ID（IG 商業帳號 ID／YouTube 頻道 ID）
  provider_user_id text,                -- 授權者在平台上的使用者 ID（Meta 資料刪除回呼要用它找資料）
  status text not null default '等待授權' check (status in ('未設定','等待授權','已連接','同步中','同步失敗','授權已過期','已解除')),
  dev_mode boolean not null default false,
  last_sync_at timestamptz, connected_by uuid references public.members on delete set null,
  -- 同步排程（給每 15 分鐘的批次同步用）
  next_sync_at timestamptz not null default now(),   -- 下次該同步的時間；失敗會自動往後延（退避）
  sync_cursor jsonb not null default '{}'::jsonb,    -- 上次同步到哪裡（例如最新留言時間）
  fail_count int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  unique (workspace_id, platform, external_id),
  foreign key (brand_id, workspace_id) references public.brands(id, workspace_id) on delete set null (brand_id)
);
-- 【從 v1 升級】如果之前跑過 v1，上面的 create table 會被略過，這裡補上 v2 新增的欄位（已存在就跳過）
alter table public.social_accounts add column if not exists external_id text;
alter table public.social_accounts add column if not exists provider_user_id text;
alter table public.social_accounts add column if not exists next_sync_at timestamptz not null default now();
alter table public.social_accounts add column if not exists sync_cursor jsonb not null default '{}'::jsonb;
alter table public.social_accounts add column if not exists fail_count int not null default 0;
alter table public.social_accounts add column if not exists last_error text;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='social_accounts_workspace_id_platform_external_id_key') then
    alter table public.social_accounts add constraint social_accounts_workspace_id_platform_external_id_key unique (workspace_id, platform, external_id);
  end if; end $$;
create index if not exists social_accounts_due on public.social_accounts(next_sync_at) where status in ('已連接','同步失敗','同步中');
-- 只有伺服器（service_role）能碰。存的是「已加密」的字串，格式 v1:iv:tag:密文（見 lib/crypto/tokens.ts）
create table if not exists public.social_account_secrets(
  account_id uuid primary key references public.social_accounts on delete cascade,
  encrypted_access_token text not null check (encrypted_access_token ~ '^v[0-9]+:'),   -- 擋掉不小心存入明文
  encrypted_refresh_token text check (encrypted_refresh_token is null or encrypted_refresh_token ~ '^v[0-9]+:'),
  scopes text[] not null default '{}',
  expires_at timestamptz,
  updated_at timestamptz not null default now()
);
-- 【從 v1 升級】v1 的欄位叫 encrypted_token → 改名，並補上新欄位與「只收加密格式」檢查
do $$ begin
  if exists(select 1 from information_schema.columns where table_schema='public' and table_name='social_account_secrets' and column_name='encrypted_token')
     and not exists(select 1 from information_schema.columns where table_schema='public' and table_name='social_account_secrets' and column_name='encrypted_access_token') then
    alter table public.social_account_secrets rename column encrypted_token to encrypted_access_token;
  end if;
  if not exists(select 1 from pg_constraint where conname='social_account_secrets_encrypted_access_token_check') then
    alter table public.social_account_secrets add constraint social_account_secrets_encrypted_access_token_check
      check (encrypted_access_token ~ '^v[0-9]+:') not valid;   -- not valid：不檢查舊資料，只擋新寫入
  end if;
end $$;
alter table public.social_account_secrets add column if not exists encrypted_refresh_token text
  check (encrypted_refresh_token is null or encrypted_refresh_token ~ '^v[0-9]+:');
alter table public.social_account_secrets add column if not exists scopes text[] not null default '{}';
alter table public.social_account_secrets add column if not exists updated_at timestamptz not null default now();

-- 貼文（同步時由伺服器寫入；斷開社群帳號＝刪除該帳號時，貼文與留言一起刪除）
create table if not exists public.posts(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  brand_id uuid not null,
  social_account_id uuid not null references public.social_accounts on delete cascade,
  platform text not null,
  external_id text not null,                          -- 平台上的貼文／影片 ID
  caption text not null default '',
  permalink text check (permalink is null or permalink ~ '^https://'),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (social_account_id, external_id),
  unique (id, workspace_id),
  foreign key (brand_id, workspace_id) references public.brands(id, workspace_id) on delete cascade
);
create index if not exists posts_brand on public.posts(brand_id, posted_at desc);

create table if not exists public.ai_providers(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  kind text not null check (kind in ('openai','anthropic','gemini','custom')),
  label text not null check (char_length(label) between 1 and 40),
  display_name text not null default '', model text not null default '',
  base_url text check (base_url is null or base_url ~ '^https://'),   -- 自訂供應商只允許 https（私有位址由伺服器端另外擋）
  key_last4 text not null default '',
  monthly_budget numeric not null default 20 check (monthly_budget > 0),
  used_cost numeric not null default 0, used_tokens bigint not null default 0,
  status text not null default '未測試' check (status in ('未測試','正常','異常','連不到','憑證錯誤','模型不可用','超額')),
  enabled boolean not null default true,
  last_tested_at timestamptz, created_at timestamptz not null default now(),
  unique (id, workspace_id)
);
create table if not exists public.ai_provider_secrets(      -- 只有伺服器能碰；存加密後的金鑰
  provider_id uuid primary key references public.ai_providers on delete cascade,
  encrypted_key text not null
);
create table if not exists public.brand_ai(
  brand_id uuid primary key references public.brands on delete cascade,
  classify_id uuid references public.ai_providers on delete set null,
  reply_id uuid references public.ai_providers on delete set null,
  backup_id uuid references public.ai_providers on delete set null,
  manual_id uuid references public.ai_providers on delete set null
);

create table if not exists public.comments(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  brand_id uuid not null,
  post_id uuid,                                       -- 屬於哪篇貼文（手動建立的展示資料可為空）
  platform text not null, surface text not null default 'posts',
  external_id text,                                   -- 平台上的留言 ID（去重用）
  post_title text not null default '', author text not null, body text not null,
  type text not null default '其他', tags text[] not null default '{}',
  priority text not null default '中', risk text not null default '低',
  status text not null default '待處理' check (status in ('待處理','處理中','等待對方','已轉交','已完成','無需處理')),
  owner_id uuid references public.members on delete set null,
  locked_by uuid references public.members on delete set null,
  group_key text, ai jsonb,
  posted_at timestamptz not null default now(), first_reply_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (brand_id, workspace_id) references public.brands(id, workspace_id) on delete cascade,
  foreign key (post_id, workspace_id) references public.posts(id, workspace_id) on delete cascade,
  constraint comments_dedupe unique (workspace_id, platform, external_id)   -- 同一則平台留言只會存一次（空值不受限）
);
-- 【從 v1 升級】補上 post_id；把 v1 的「部分唯一索引」換成正式的唯一限制（同步程式需要）
alter table public.comments add column if not exists post_id uuid;
do $$ begin
  if not exists(select 1 from pg_constraint where conname='comments_post_id_workspace_id_fkey') then
    alter table public.comments add constraint comments_post_id_workspace_id_fkey
      foreign key (post_id, workspace_id) references public.posts(id, workspace_id) on delete cascade;
  end if;
  if not exists(select 1 from pg_constraint where conname='comments_dedupe') then
    drop index if exists public.comments_dedupe;
    alter table public.comments add constraint comments_dedupe unique (workspace_id, platform, external_id);
  end if;
end $$;
create index if not exists comments_brand_status on public.comments(brand_id,status,posted_at desc);
create index if not exists comments_post on public.comments(post_id);

create table if not exists public.replies(
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces on delete cascade,
  comment_id uuid not null references public.comments on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  -- 預設 no action：寫過回覆的成員不能被單獨刪除（只能匿名化），但整間公司刪除時可一起連動刪除
  by_member uuid not null references public.members,
  ai_used boolean not null default false, edited boolean not null default false,
  delivery text not null default 'pending' check (delivery in ('pending','sent','failed','simulated')),
  created_at timestamptz not null default now()
);
create index if not exists replies_comment on public.replies(comment_id);
-- 【從 v1 升級】v1 是 on delete restrict，會擋住「整間公司刪除」→ 改成預設的 no action
do $$ begin
  if exists(select 1 from pg_constraint where conname='replies_by_member_fkey' and confdeltype='r') then
    alter table public.replies drop constraint replies_by_member_fkey;
    alter table public.replies add constraint replies_by_member_fkey foreign key (by_member) references public.members;
  end if; end $$;

create table if not exists public.audit_log(            -- 只能新增，不能改、不能刪
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces on delete cascade,
  actor text not null, action text not null, detail text not null default '',
  created_at timestamptz not null default now()
);
create table if not exists public.ai_usage(
  id bigint generated always as identity primary key,
  workspace_id uuid not null references public.workspaces on delete cascade,
  brand_id uuid, task text not null check (task in ('classify','reply','assistant')),
  tokens int not null default 0, cost numeric not null default 0, created_at timestamptz not null default now()
);

-- 平台 API 配額用量（只有伺服器能碰）。例：YouTube 每天 10,000 units，太平洋時間午夜重置
create table if not exists public.api_quota_usage(
  platform text not null,
  bucket date not null,                 -- 以「平台的重置時區」計算的日期
  units int not null default 0,
  primary key (platform, bucket)
);
-- Meta「資料刪除回呼」的處理紀錄（Meta App Review 必備；使用者可用確認碼查詢進度）
create table if not exists public.data_deletion_requests(
  confirmation_code text primary key default encode(gen_random_bytes(9),'hex'),
  platform text not null,
  provider_user_id text not null,
  deleted_accounts int not null default 0,
  status text not null default '已完成' check (status in ('處理中','已完成')),
  created_at timestamptz not null default now()
);

-- ---------- 權限輔助函式 ----------
create or replace function app.my_member(ws uuid) returns public.members
language sql stable security definer set search_path=public as $$
  select m.* from public.members m where m.workspace_id=ws and m.user_id=auth.uid() and m.active limit 1 $$;
create or replace function app.is_member(ws uuid) returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from public.members m where m.workspace_id=ws and m.user_id=auth.uid() and m.active) $$;
create or replace function app.is_admin(ws uuid) returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from public.members m where m.workspace_id=ws and m.user_id=auth.uid() and m.active and m.role='管理員') $$;
create or replace function app.is_manager(ws uuid) returns boolean language sql stable security definer set search_path=public as
$$ select exists(select 1 from public.members m where m.workspace_id=ws and m.user_id=auth.uid() and m.active and m.role in ('管理員','主管')) $$;
-- 能不能看這個品牌：管理員／主管看全部；其他人看「全部品牌」或被指派的
create or replace function app.can_brand(ws uuid, b uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.members m where m.workspace_id=ws and m.user_id=auth.uid() and m.active and (
     m.role in ('管理員','主管') or m.all_brands or exists(select 1 from public.member_brands mb where mb.member_id=m.id and mb.brand_id=b))) $$;
create or replace function app.is_lead(ws uuid, b uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.members m join public.member_brands mb on mb.member_id=m.id
     where m.workspace_id=ws and m.user_id=auth.uid() and m.active and mb.brand_id=b and mb.is_lead) $$;
create or replace function app.brand_ws(b uuid) returns uuid language sql stable security definer set search_path=public as
$$ select workspace_id from public.brands where id=b $$;
create or replace function app.member_ws(mid uuid) returns uuid language sql stable security definer set search_path=public as
$$ select workspace_id from public.members where id=mid $$;
create or replace function app.comment_ws(cid uuid) returns uuid language sql stable security definer set search_path=public as
$$ select workspace_id from public.comments where id=cid $$;

-- 至少保留一位啟用中的管理員
create or replace function app.keep_one_admin() returns trigger language plpgsql security definer set search_path=public as $$
declare ws uuid := coalesce(old.workspace_id,new.workspace_id);
begin
  -- 整間公司被刪除（連動刪除成員）時不需要檢查
  if tg_op='DELETE' and not exists(select 1 from public.workspaces where id=ws) then return old; end if;
  if (tg_op='DELETE' or new.role<>'管理員' or not new.active) and old.role='管理員' then
    if not exists(select 1 from public.members where workspace_id=ws and role='管理員' and active and id<>old.id) then
      raise exception '至少要保留一位啟用中的管理員' using errcode='P0001'; end if;
  end if;
  return coalesce(new,old);
end $$;
drop trigger if exists members_keep_admin on public.members;
create trigger members_keep_admin before update or delete on public.members for each row execute function app.keep_one_admin();
-- 不能把資料搬到別的公司
create or replace function app.freeze_ws() returns trigger language plpgsql as $$
begin if new.workspace_id<>old.workspace_id then raise exception 'workspace_id 不能變更'; end if; return new; end $$;
do $$ declare t text; begin
  foreach t in array array['members','brands','kb_items','social_accounts','posts','ai_providers','comments','replies'] loop
    execute format('drop trigger if exists freeze_ws on public.%I; create trigger freeze_ws before update on public.%I for each row execute function app.freeze_ws();',t,t);
  end loop; end $$;
-- 留言：一般成員只能改狀態／負責人等處理欄位，不能改留言內容與來源
create or replace function app.comment_guard() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is null then return new; end if;     -- 伺服器（service_role）不受限
  if new.body<>old.body or new.author<>old.author or new.platform<>old.platform or new.brand_id<>old.brand_id
     or new.external_id is distinct from old.external_id or new.posted_at<>old.posted_at
     or new.post_id is distinct from old.post_id then
    raise exception '不能修改留言原文與來源'; end if;
  return new;
end $$;
drop trigger if exists comments_guard on public.comments;
create trigger comments_guard before update on public.comments for each row execute function app.comment_guard();

-- ---------- 對外 RPC ----------
-- 第一次登入：建立自己的公司並成為管理員
create or replace function public.create_workspace(p_name text, p_my_name text) returns uuid
language plpgsql security definer set search_path=public as $$
declare ws uuid; em text := auth.jwt()->>'email';
begin
  if auth.uid() is null then raise exception '請先登入'; end if;
  insert into public.workspaces(name) values (p_name) returning id into ws;
  insert into public.members(workspace_id,user_id,email,name,role,all_brands) values (ws,auth.uid(),em,p_my_name,'管理員',true);
  insert into public.audit_log(workspace_id,actor,action,detail) values (ws,p_my_name,'建立公司',p_name);
  return ws;
end $$;
-- 被邀請的人登入後：把「同 email 的邀請」綁到自己的帳號
create or replace function public.claim_invites() returns int
language plpgsql security definer set search_path=public as $$
declare n int; em text := lower(auth.jwt()->>'email');
begin
  if auth.uid() is null then raise exception '請先登入'; end if;
  update public.members set user_id=auth.uid() where user_id is null and lower(email)=em and active;
  get diagnostics n = row_count; return n;
end $$;
revoke all on function public.create_workspace(text,text), public.claim_invites() from public, anon;
grant execute on function public.create_workspace(text,text), public.claim_invites() to authenticated;

-- 新使用者註冊時自動建立 profiles 一列
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path=public as $$
begin
  insert into public.profiles(id, display_name) values (new.id, '') on conflict (id) do nothing;
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function app.handle_new_user();

-- =====================================================================
-- 伺服器專用函式（srv_）：只授權給 service_role，前端（anon / authenticated）呼叫會被拒絕
-- =====================================================================

-- 【配額】原子地「先扣額度再呼叫 API」：額度不足回傳 false，就不要呼叫平台 API
-- p_tz：平台重置配額的時區（YouTube＝America/Los_Angeles）
create or replace function public.srv_try_consume_quota(p_platform text, p_units int, p_daily_limit int, p_tz text default 'UTC')
returns boolean language plpgsql security definer set search_path=public as $$
declare d date := (now() at time zone p_tz)::date; ok boolean;
begin
  insert into public.api_quota_usage(platform,bucket,units) values (p_platform,d,0) on conflict do nothing;
  update public.api_quota_usage set units = units + p_units
   where platform=p_platform and bucket=d and units + p_units <= p_daily_limit
   returning true into ok;
  return coalesce(ok,false);
end $$;

-- 【同步】領取一批「該同步了」的帳號；skip locked 讓兩個排程同時跑也不會重複處理
-- 狀態改成「同步中」並給 10 分鐘租約：若程式中途當掉，10 分鐘後會自動被重新領取
create or replace function public.srv_claim_sync_batch(p_limit int default 10)
returns setof public.social_accounts language plpgsql security definer set search_path=public as $$
begin
  return query
  with due as (
    select id from public.social_accounts
     where status in ('已連接','同步失敗','同步中')
       and next_sync_at <= now()
       and brand_id is not null and external_id is not null
     order by next_sync_at
     limit greatest(1, least(p_limit, 50))
     for update skip locked)
  update public.social_accounts s
     set status='同步中', next_sync_at = now() + interval '10 minutes'
    from due where s.id = due.id
  returning s.*;
end $$;

-- 【同步】回報結果。成功：15 分鐘後再同步。失敗：指數退避 15→30→60…最多 6 小時
create or replace function public.srv_finish_sync(p_account uuid, p_ok boolean, p_error text default null,
  p_token_expired boolean default false, p_cursor jsonb default null)
returns void language plpgsql security definer set search_path=public as $$
begin
  if p_ok then
    update public.social_accounts set status='已連接', last_sync_at=now(), fail_count=0, last_error=null,
      next_sync_at = now() + interval '15 minutes', sync_cursor = coalesce(p_cursor, sync_cursor)
     where id=p_account;
  else
    update public.social_accounts set
      status = case when p_token_expired then '授權已過期' else '同步失敗' end,
      fail_count = fail_count + 1,
      last_error = left(coalesce(p_error,'未知錯誤'), 500),
      next_sync_at = now() + make_interval(mins => least(15 * power(2, least(fail_count, 5))::int, 360))
     where id=p_account;
  end if;
end $$;

-- 【同步】一次寫入一批留言（含所屬貼文）。重複的留言自動略過，回傳新增幾則
-- p_items：[{post_external_id, post_caption, post_permalink, post_posted_at, external_id, author, body, posted_at}]
create or replace function public.srv_ingest_comments(p_account uuid, p_items jsonb)
returns int language plpgsql security definer set search_path=public as $$
declare a public.social_accounts; it jsonb; pid uuid; n int := 0; k int;
begin
  select * into a from public.social_accounts where id=p_account;
  if a.id is null or a.brand_id is null then raise exception '社群帳號不存在或尚未指定品牌'; end if;
  for it in select * from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) loop
    insert into public.posts(workspace_id,brand_id,social_account_id,platform,external_id,caption,permalink,posted_at)
    values (a.workspace_id, a.brand_id, a.id, a.platform, it->>'post_external_id',
            left(coalesce(it->>'post_caption',''),2000),
            case when it->>'post_permalink' ~ '^https://' then it->>'post_permalink' end,
            (it->>'post_posted_at')::timestamptz)
    on conflict (social_account_id, external_id) do update set caption = excluded.caption
    returning id into pid;
    insert into public.comments(workspace_id,brand_id,post_id,platform,surface,external_id,post_title,author,body,posted_at)
    values (a.workspace_id, a.brand_id, pid, a.platform, a.surface, it->>'external_id',
            left(coalesce(it->>'post_caption',''),80), left(coalesce(it->>'author','（匿名）'),100),
            left(coalesce(it->>'body',''),5000), coalesce((it->>'posted_at')::timestamptz, now()))
    on conflict on constraint comments_dedupe do nothing;
    get diagnostics k = row_count; n := n + k;
  end loop;
  return n;
end $$;

-- 【刪除帳號】先看計畫：每個所屬公司會被怎麼處理
--   delete_workspace   ：公司裡沒有其他已登入成員 → 整間公司資料連動刪除（token、貼文、留言、回覆…）
--   anonymize          ：公司還有其他人 → 只把你的成員資料匿名化（公司資料屬於公司，保留）
--   blocked_sole_admin ：你是唯一管理員但還有其他成員 → 必須先指定新管理員
create or replace function public.srv_deletion_plan(p_uid uuid)
returns table(workspace_id uuid, workspace_name text, action text)
language sql stable security definer set search_path=public as $$
  select m.workspace_id, w.name,
    case
      when not exists(select 1 from public.members o where o.workspace_id=m.workspace_id and o.id<>m.id
                      and o.active and o.user_id is not null) then 'delete_workspace'
      when m.role='管理員' and not exists(select 1 from public.members o where o.workspace_id=m.workspace_id
                      and o.id<>m.id and o.active and o.user_id is not null and o.role='管理員') then 'blocked_sole_admin'
      else 'anonymize'
    end
  from public.members m join public.workspaces w on w.id=m.workspace_id
  where m.user_id = p_uid
$$;

-- 【刪除帳號】依計畫執行（全部在同一個交易裡：要嘛全部成功，要嘛全部不動）
-- 執行完後，伺服器再呼叫 auth.admin.deleteUser() 刪除登入帳號 → profiles 自動連動刪除
create or replace function public.srv_delete_user_data(p_uid uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare r record; m public.members; new_name text; n_del int := 0; n_anon int := 0;
begin
  if exists(select 1 from public.srv_deletion_plan(p_uid) where action='blocked_sole_admin') then
    raise exception '你是某間公司唯一的管理員，請先指定另一位管理員再刪除帳號' using errcode='P0001';
  end if;
  for r in select * from public.srv_deletion_plan(p_uid) loop
    if r.action = 'delete_workspace' then
      delete from public.workspaces where id = r.workspace_id;      -- 連動刪除該公司全部資料
      n_del := n_del + 1;
    else
      select * into m from public.members where workspace_id=r.workspace_id and user_id=p_uid;
      new_name := '已刪除成員-' || left(m.id::text, 8);
      update public.members set user_id=null, active=false, all_brands=false, note='',
             email='deleted-' || left(m.id::text,8) || '@deleted.invalid', name=new_name
       where id = m.id;
      delete from public.member_brands where member_id = m.id;
      update public.audit_log set actor = new_name where workspace_id=r.workspace_id and actor = m.name;
      n_anon := n_anon + 1;
    end if;
  end loop;
  delete from public.profiles where id = p_uid;
  return jsonb_build_object('deleted_workspaces', n_del, 'anonymized_memberships', n_anon);
end $$;

-- 【Meta 資料刪除回呼】刪除某位 Meta 使用者授權的所有社群帳號（連動刪除 token、貼文、留言）
create or replace function public.srv_delete_by_provider_user(p_platforms text[], p_provider_user_id text)
returns text language plpgsql security definer set search_path=public as $$
declare n int; code text;
begin
  delete from public.social_accounts where platform = any(p_platforms) and provider_user_id = p_provider_user_id;
  get diagnostics n = row_count;
  insert into public.data_deletion_requests(platform, provider_user_id, deleted_accounts)
  values (array_to_string(p_platforms, ','), p_provider_user_id, n) returning confirmation_code into code;
  return code;
end $$;

-- 【資料保存期限】刪除超過 N 天的留言（保存期限未決定前不會自動執行；決定後用 pg_cron 每天跑）
create or replace function public.srv_purge_old_comments(p_days int)
returns int language plpgsql security definer set search_path=public as $$
declare n int;
begin
  if p_days < 30 then raise exception '保存天數至少 30 天'; end if;
  delete from public.comments where posted_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  delete from public.api_quota_usage where bucket < current_date - 30;
  return n;
end $$;

revoke all on function public.srv_try_consume_quota(text,int,int,text), public.srv_claim_sync_batch(int),
  public.srv_finish_sync(uuid,boolean,text,boolean,jsonb), public.srv_ingest_comments(uuid,jsonb),
  public.srv_deletion_plan(uuid), public.srv_delete_user_data(uuid),
  public.srv_delete_by_provider_user(text[],text), public.srv_purge_old_comments(int)
  from public, anon, authenticated;
grant execute on function public.srv_try_consume_quota(text,int,int,text), public.srv_claim_sync_batch(int),
  public.srv_finish_sync(uuid,boolean,text,boolean,jsonb), public.srv_ingest_comments(uuid,jsonb),
  public.srv_deletion_plan(uuid), public.srv_delete_user_data(uuid),
  public.srv_delete_by_provider_user(text[],text), public.srv_purge_old_comments(int)
  to service_role;

-- ---------- 列級權限（RLS） ----------
-- 每張表明確啟用並強制 RLS
alter table public.workspaces enable row level security;
alter table public.workspaces force row level security;
alter table public.members enable row level security;
alter table public.members force row level security;
alter table public.brands enable row level security;
alter table public.brands force row level security;
alter table public.member_brands enable row level security;
alter table public.member_brands force row level security;
alter table public.brand_profiles enable row level security;
alter table public.brand_profiles force row level security;
alter table public.brand_configs enable row level security;
alter table public.brand_configs force row level security;
alter table public.kb_items enable row level security;
alter table public.kb_items force row level security;
alter table public.social_accounts enable row level security;
alter table public.social_accounts force row level security;
alter table public.social_account_secrets enable row level security;
alter table public.social_account_secrets force row level security;
alter table public.ai_providers enable row level security;
alter table public.ai_providers force row level security;
alter table public.ai_provider_secrets enable row level security;
alter table public.ai_provider_secrets force row level security;
alter table public.brand_ai enable row level security;
alter table public.brand_ai force row level security;
alter table public.comments enable row level security;
alter table public.comments force row level security;
alter table public.replies enable row level security;
alter table public.replies force row level security;
alter table public.audit_log enable row level security;
alter table public.audit_log force row level security;
alter table public.ai_usage enable row level security;
alter table public.ai_usage force row level security;
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
alter table public.posts enable row level security;
alter table public.posts force row level security;
alter table public.api_quota_usage enable row level security;
alter table public.api_quota_usage force row level security;
alter table public.data_deletion_requests enable row level security;
alter table public.data_deletion_requests force row level security;

-- 先清掉同名舊政策（讓腳本可重複執行；第一次執行時沒有東西可清）
drop policy if exists ws_sel on public.workspaces;
drop policy if exists ws_upd on public.workspaces;
drop policy if exists mem_sel on public.members;
drop policy if exists mem_ins on public.members;
drop policy if exists mem_upd on public.members;
drop policy if exists mem_del on public.members;
drop policy if exists brand_sel on public.brands;
drop policy if exists brand_ins on public.brands;
drop policy if exists brand_upd on public.brands;
drop policy if exists brand_del on public.brands;
drop policy if exists mb_sel on public.member_brands;
drop policy if exists mb_all on public.member_brands;
drop policy if exists bp_sel on public.brand_profiles;
drop policy if exists bp_wr on public.brand_profiles;
drop policy if exists bc_sel on public.brand_configs;
drop policy if exists bc_wr on public.brand_configs;
drop policy if exists kb_sel on public.kb_items;
drop policy if exists kb_wr on public.kb_items;
drop policy if exists sa_sel on public.social_accounts;
drop policy if exists sa_wr on public.social_accounts;
drop policy if exists ap_sel on public.ai_providers;
drop policy if exists ap_wr on public.ai_providers;
drop policy if exists bai_sel on public.brand_ai;
drop policy if exists bai_wr on public.brand_ai;
drop policy if exists cm_sel on public.comments;
drop policy if exists cm_upd on public.comments;
drop policy if exists rp_sel on public.replies;
drop policy if exists rp_ins on public.replies;
drop policy if exists al_sel on public.audit_log;
drop policy if exists al_ins on public.audit_log;
drop policy if exists au_sel on public.ai_usage;
drop policy if exists pf_sel on public.profiles;
drop policy if exists pf_upd on public.profiles;
drop policy if exists po_sel on public.posts;

-- 個人資料：只能讀、改自己的（auth.uid() = id）。新增由註冊觸發器做；刪除走「刪除帳號」流程
create policy pf_sel on public.profiles for select to authenticated using (id = auth.uid());
create policy pf_upd on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
-- 貼文：能看品牌的人可讀；寫入只有伺服器同步程式
create policy po_sel on public.posts for select to authenticated using (app.can_brand(workspace_id, brand_id));
-- api_quota_usage / data_deletion_requests：沒有任何用戶端政策＝前端完全讀不到

create policy ws_sel on public.workspaces for select to authenticated using (app.is_member(id));
create policy ws_upd on public.workspaces for update to authenticated using (app.is_admin(id)) with check (app.is_admin(id));

create policy mem_sel on public.members for select to authenticated using (app.is_member(workspace_id) or (user_id is null and lower(email)=lower(auth.jwt()->>'email')));
create policy mem_ins on public.members for insert to authenticated with check (app.is_admin(workspace_id));
create policy mem_upd on public.members for update to authenticated using (app.is_admin(workspace_id)) with check (app.is_admin(workspace_id));
create policy mem_del on public.members for delete to authenticated using (app.is_admin(workspace_id));

create policy brand_sel on public.brands for select to authenticated using (app.can_brand(workspace_id,id));
create policy brand_ins on public.brands for insert to authenticated with check (app.is_admin(workspace_id));
create policy brand_upd on public.brands for update to authenticated using (app.is_admin(workspace_id) or app.is_lead(workspace_id,id)) with check (app.is_admin(workspace_id) or app.is_lead(workspace_id,id));
create policy brand_del on public.brands for delete to authenticated using (app.is_admin(workspace_id));

create policy mb_sel on public.member_brands for select to authenticated using (app.is_member(app.member_ws(member_id)));
create policy mb_all on public.member_brands for all to authenticated using (app.is_admin(app.member_ws(member_id)))
  with check (app.is_admin(app.member_ws(member_id)) and app.member_ws(member_id)=app.brand_ws(brand_id));

-- 品牌資料（問卷、風格、知識庫）：能看品牌的人可讀；管理員或該品牌負責人可寫
create policy bp_sel on public.brand_profiles for select to authenticated using (app.can_brand(app.brand_ws(brand_id),brand_id));
create policy bp_wr on public.brand_profiles for all to authenticated
  using (app.is_admin(app.brand_ws(brand_id)) or app.is_lead(app.brand_ws(brand_id),brand_id))
  with check (app.is_admin(app.brand_ws(brand_id)) or app.is_lead(app.brand_ws(brand_id),brand_id));
create policy bc_sel on public.brand_configs for select to authenticated using (app.can_brand(app.brand_ws(brand_id),brand_id));
create policy bc_wr on public.brand_configs for all to authenticated
  using (app.is_admin(app.brand_ws(brand_id)) or app.is_lead(app.brand_ws(brand_id),brand_id))
  with check (app.is_admin(app.brand_ws(brand_id)) or app.is_lead(app.brand_ws(brand_id),brand_id));
create policy kb_sel on public.kb_items for select to authenticated using (app.can_brand(workspace_id,brand_id));
create policy kb_wr on public.kb_items for all to authenticated
  using (app.is_admin(workspace_id) or app.is_lead(workspace_id,brand_id))
  with check (app.is_admin(workspace_id) or app.is_lead(workspace_id,brand_id));

-- 社群帳號、AI 設定：只有管理員能改；token／金鑰表沒有任何用戶端政策＝完全讀不到
create policy sa_sel on public.social_accounts for select to authenticated using (brand_id is null and app.is_manager(workspace_id) or (brand_id is not null and app.can_brand(workspace_id,brand_id)));
create policy sa_wr on public.social_accounts for all to authenticated using (app.is_admin(workspace_id)) with check (app.is_admin(workspace_id));
create policy ap_sel on public.ai_providers for select to authenticated using (app.is_member(workspace_id));
create policy ap_wr on public.ai_providers for all to authenticated using (app.is_admin(workspace_id)) with check (app.is_admin(workspace_id));
create policy bai_sel on public.brand_ai for select to authenticated using (app.can_brand(app.brand_ws(brand_id),brand_id));
create policy bai_wr on public.brand_ai for all to authenticated using (app.is_admin(app.brand_ws(brand_id))) with check (app.is_admin(app.brand_ws(brand_id)));

-- 留言：能看品牌的人可讀可處理；新增留言只有伺服器（Webhook）能做
create policy cm_sel on public.comments for select to authenticated using (app.can_brand(workspace_id,brand_id));
create policy cm_upd on public.comments for update to authenticated using (app.can_brand(workspace_id,brand_id)) with check (app.can_brand(workspace_id,brand_id));
create policy rp_sel on public.replies for select to authenticated using (app.can_brand(workspace_id,(select brand_id from public.comments c where c.id=comment_id)));
create policy rp_ins on public.replies for insert to authenticated with check (
  app.comment_ws(comment_id)=workspace_id
  and app.can_brand(workspace_id,(select brand_id from public.comments c where c.id=comment_id))
  and by_member=(app.my_member(workspace_id)).id
  and delivery in ('pending','simulated'));            -- 「已送出」只有伺服器能標記

create policy al_sel on public.audit_log for select to authenticated using (app.is_manager(workspace_id));
create policy al_ins on public.audit_log for insert to authenticated with check (app.is_member(workspace_id));
create policy au_sel on public.ai_usage for select to authenticated using (app.is_manager(workspace_id));

-- ---------- 資料表層級授權（RLS 之外再收一層） ----------
revoke all on all tables in schema public from anon, authenticated;
grant select,insert,update,delete on public.members,public.member_brands,public.brands,public.brand_profiles,public.brand_configs,public.kb_items,public.social_accounts,public.ai_providers,public.brand_ai to authenticated;
grant select,update on public.workspaces, public.comments to authenticated;
grant select,insert on public.replies to authenticated;
grant select,insert on public.audit_log to authenticated;
grant select on public.ai_usage to authenticated;
grant select on public.posts to authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, locale, privacy_version, privacy_accepted_at, updated_at) on public.profiles to authenticated;  -- 只能改這幾欄
grant usage on all sequences in schema public to authenticated;
-- social_account_secrets / ai_provider_secrets / api_quota_usage / data_deletion_requests：不授權給任何用戶端角色
-- social_accounts 表本身沒有 token（只有狀態與同步時間），所以前端可讀；token 永遠只在 secrets 表
