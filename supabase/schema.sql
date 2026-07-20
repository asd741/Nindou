-- ═══════════════════════════════════════════════════════════════════════════
-- Nindou 公會戰福袋抽籤 —— Supabase 資料庫結構 ＋ Row Level Security
-- ───────────────────────────────────────────────────────────────────────────
-- 使用方式：登入 Supabase 專案 → 左側 SQL Editor → New query → 貼上整段 → Run。
-- 本腳本可重複執行（idempotent）：重跑不會重建資料，只會補齊缺的物件與規則。
--
-- 資料模型（對應前端 src/luckydraw/store.ts）：
--   members  籤庫成員（全季度共用）
--   seasons  季度
--   winners  中獎紀錄（依季度＋大/小福袋）
-- 每張表都有 user_id，且 RLS 限制「每個帳號只能看到並修改自己的資料」。
-- user_id 預設為 auth.uid()，故前端 insert 時不需（也不應）自行帶入。
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 成員（籤庫，全季度共用）─────────────────────────────────────────────────
create table if not exists public.members (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  text       text        not null,
  selected   boolean     not null default true,
  created_at timestamptz not null default now()
);

-- ── 季度 ─────────────────────────────────────────────────────────────────────
create table if not exists public.seasons (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  name       text        not null,
  created_at timestamptz not null default now()
);

-- ── 中獎紀錄（依季度＋福袋；刪季度時一併刪除）───────────────────────────────
create table if not exists public.winners (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  season_id  uuid        not null references public.seasons(id) on delete cascade,
  bag        text        not null check (bag in ('big', 'small')),
  name       text        not null,
  claimed    boolean     not null default false,
  time       text        not null default '',   -- 顯示用時間快照（例 07/20 09:35）
  created_at timestamptz not null default now()
);

-- ── 索引：查詢一律以 user_id ＋建立順序為主 ────────────────────────────────
create index if not exists members_user_idx on public.members (user_id, created_at);
create index if not exists seasons_user_idx on public.seasons (user_id, created_at);
create index if not exists winners_user_idx on public.winners (user_id, season_id, created_at);

-- ═══ Row Level Security：每個帳號只能存取自己的資料 ═════════════════════════
alter table public.members enable row level security;
alter table public.seasons enable row level security;
alter table public.winners enable row level security;

-- 逐表重建 policy（drop then create → 可重複執行）
drop policy if exists "own members" on public.members;
create policy "own members" on public.members
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own seasons" on public.seasons;
create policy "own seasons" on public.seasons
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own winners" on public.winners;
create policy "own winners" on public.winners
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
