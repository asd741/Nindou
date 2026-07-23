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

-- ═══════════════════════════════════════════════════════════════════════════
-- 公會貢獻度 Dashboard —— 對應前端 src/contrib/store.ts
-- ───────────────────────────────────────────────────────────────────────────
-- 設計理念：欄位不預設、盡量彈性——任何 Excel（幾千幾萬欄）都能匯入。
-- 資料模型：
--   contrib_guilds       公會（可 CRUD；成員屬於單一公會、可被移動）
--   contrib_members      成員（列）；guild_id 指向所屬公會
--   contrib_columns      試算表欄：role='info' 純資訊不計分；role='value' 數字型
--                        價值觀，分數 = 值 × weight。匯入時一律 info，使用者轉為 value 才計分。
--   contrib_cells        成員×欄位的值（存 text；value 欄計分時前端 parse）
--   contrib_tags         標籤（text 型價值觀）：布林擁有，擁有即得 score 分（可負）
--   contrib_member_tags  成員-標籤關聯（擁有即存在一列）
--   contrib_adjustments  成員專屬加減分（inline 備註）：label + points（可正可負）
-- 成員總分 = Σ(value 欄 值×weight) + Σ(擁有標籤 score) + Σ(加減分 points)（前端計算）。
-- 「價值觀」全公會共用（columns/tags 不綁 guild），故成員移動公會時分數規則不變。
-- 每張表都有 user_id，RLS 限制「每個帳號只能存取自己的資料」，與上方各表一致。
--
-- ⚠ 本段為破壞性重建：先 DROP 舊 contrib_* 再以新結構建立（既有資料一律清空，
--   使用者需重新匯入 Excel）。若日後要保留資料，改以 alter 遷移取代 drop。
-- ═══════════════════════════════════════════════════════════════════════════
drop table if exists public.contrib_adjustments cascade;
drop table if exists public.contrib_member_tags cascade;
drop table if exists public.contrib_tags        cascade;
drop table if exists public.contrib_cells       cascade;
drop table if exists public.contrib_columns     cascade;
drop table if exists public.contrib_members     cascade;
drop table if exists public.contrib_guilds      cascade;

-- ── 公會 ─────────────────────────────────────────────────────────────────────
create table public.contrib_guilds (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  name       text        not null,
  sort_order integer     not null default 0,
  created_at timestamptz not null default now()
);

-- ── 成員（列）；刪公會時成員留存（guild_id 轉 null＝未分配）─────────────────────
create table public.contrib_members (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  guild_id   uuid        references public.contrib_guilds(id) on delete set null,
  name       text        not null,                 -- 簡稱（列的身分；匯入時以此對應同一人）
  sort_order integer     not null default 0,
  created_at timestamptz not null default now()
);

-- ── 欄位（欄）：info 純資訊／value 數字型價值觀（分數 = 值 × weight）──────────────
create table public.contrib_columns (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  name       text        not null,
  role       text        not null default 'info' check (role in ('info', 'value')),
  weight     numeric     not null default 1,        -- 僅 value 欄使用；分數 = 值 × weight
  sort_order integer     not null default 0,
  created_at timestamptz not null default now()
);

-- ── 成員×欄位的值；(member,column) 唯一以支援 upsert ──────────────────────────
create table public.contrib_cells (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  member_id  uuid        not null references public.contrib_members(id) on delete cascade,
  column_id  uuid        not null references public.contrib_columns(id) on delete cascade,
  value      text        not null default '',
  created_at timestamptz not null default now(),
  unique (member_id, column_id)
);

-- ── 標籤（text 型價值觀）：布林擁有，擁有得 score 分 ──────────────────────────
create table public.contrib_tags (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  name       text        not null,
  score      numeric     not null default 0,
  sort_order integer     not null default 0,
  created_at timestamptz not null default now()
);

-- ── 成員-標籤關聯；(member,tag) 唯一 ─────────────────────────────────────────
create table public.contrib_member_tags (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  member_id  uuid        not null references public.contrib_members(id) on delete cascade,
  tag_id     uuid        not null references public.contrib_tags(id)    on delete cascade,
  created_at timestamptz not null default now(),
  unique (member_id, tag_id)
);

-- ── 成員專屬加減分（inline 備註）：label + points（可負）──────────────────────
create table public.contrib_adjustments (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        not null default auth.uid() references auth.users(id) on delete cascade,
  member_id  uuid        not null references public.contrib_members(id) on delete cascade,
  label      text        not null default '',
  points     numeric     not null default 0,
  sort_order integer     not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists contrib_guilds_user_idx      on public.contrib_guilds      (user_id, sort_order, created_at);
create index if not exists contrib_members_user_idx     on public.contrib_members     (user_id, sort_order, created_at);
create index if not exists contrib_members_guild_idx    on public.contrib_members     (guild_id);
create index if not exists contrib_columns_user_idx     on public.contrib_columns     (user_id, sort_order, created_at);
create index if not exists contrib_cells_user_idx       on public.contrib_cells       (user_id, member_id);
create index if not exists contrib_tags_user_idx        on public.contrib_tags        (user_id, sort_order, created_at);
create index if not exists contrib_member_tags_user_idx on public.contrib_member_tags (user_id, member_id);
create index if not exists contrib_adjustments_user_idx on public.contrib_adjustments (user_id, member_id);

alter table public.contrib_guilds      enable row level security;
alter table public.contrib_members     enable row level security;
alter table public.contrib_columns     enable row level security;
alter table public.contrib_cells       enable row level security;
alter table public.contrib_tags        enable row level security;
alter table public.contrib_member_tags enable row level security;
alter table public.contrib_adjustments enable row level security;

drop policy if exists "own contrib_guilds" on public.contrib_guilds;
create policy "own contrib_guilds" on public.contrib_guilds
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own contrib_members" on public.contrib_members;
create policy "own contrib_members" on public.contrib_members
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own contrib_columns" on public.contrib_columns;
create policy "own contrib_columns" on public.contrib_columns
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own contrib_cells" on public.contrib_cells;
create policy "own contrib_cells" on public.contrib_cells
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own contrib_tags" on public.contrib_tags;
create policy "own contrib_tags" on public.contrib_tags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own contrib_member_tags" on public.contrib_member_tags;
create policy "own contrib_member_tags" on public.contrib_member_tags
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own contrib_adjustments" on public.contrib_adjustments;
create policy "own contrib_adjustments" on public.contrib_adjustments
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
