// 公會貢獻度 Dashboard 的資料層：所有 Supabase 存取集中在此，元件只呼叫這些函式。
// 這裡也是「資料形狀」的單一真相：型別由此匯出給元件、Excel 匯入匯出共用。
//
// 資料模型（見 supabase/schema.sql）：
//   guilds       公會；成員屬於單一公會、可被移動。價值觀（columns/tags）全公會共用。
//   members      列（每位成員）；guildId 指所屬公會（null＝未分配）
//   columns      欄：role='info' 純資訊不計分；role='value' 數字型價值觀，分數 = 值 × weight
//   cells        某成員某欄的值（一律存字串）
//   tags         標籤（text 型價值觀）：布林擁有，擁有即得 score 分（可負）
//   memberTags   成員擁有哪些標籤（memberId → Set<tagId>）
//   adjustments  成員專屬加減分（inline 備註）：label + points（可正可負）
// 成員總分 = Σ(value 欄 值×weight) + Σ(擁有標籤 score) + Σ(加減分 points)（見 memberTotal）。
import { supabase } from '../supabase'

export type ColumnRole = 'info' | 'value'
export interface Guild { id: string; name: string; sort: number }
export interface ContribColumn { id: string; name: string; role: ColumnRole; weight: number; sort: number }
export interface ContribMember { id: string; guildId: string | null; name: string; sort: number }
export interface Tag { id: string; name: string; score: number; sort: number }
export interface Adjustment { id: string; memberId: string; label: string; points: number; sort: number }
// cells[memberId][columnId] = 值（字串）。缺 key 視為空字串。
export type CellMap = Record<string, Record<string, string>>
// memberTags[memberId] = 該成員擁有的 tagId 集合。
export type MemberTagMap = Record<string, Set<string>>
export interface ContribData {
  guilds: Guild[]
  members: ContribMember[]
  columns: ContribColumn[]
  cells: CellMap
  tags: Tag[]
  memberTags: MemberTagMap
  adjustments: Adjustment[]
}

// Supabase／PostgREST 的錯誤是純物件 {message, details, hint, code}，不是 Error，
// 直接 String() 會變成 "[object Object]"；這裡抽出真正訊息再包成 Error。
function fail(error: unknown): never {
  if (error instanceof Error) throw error
  if (error && typeof error === 'object') {
    const e = error as Record<string, unknown>
    const text = (e.message ?? e.error_description ?? e.error ?? JSON.stringify(error)) as string
    const err = new Error(e.hint ? `${text}（提示：${e.hint}）` : text)
    if (e.code) err.name = `PostgrestError(${e.code})`
    throw err
  }
  throw new Error(String(error))
}

// PostgREST 的 numeric 可能以字串回傳，統一轉成 number。
function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? ''))
  return Number.isFinite(n) ? n : 0
}

// 某成員的總分：三種計分機制加總。純函式，供元件與匯出共用。
export function memberTotal(
  memberId: string,
  columns: ContribColumn[],
  cells: CellMap,
  tags: Tag[],
  memberTags: MemberTagMap,
  adjustments: Adjustment[],
): number {
  const row = cells[memberId] ?? {}
  let sum = 0
  for (const c of columns) {                                  // 1) value 欄：值 × 權重
    if (c.role !== 'value') continue
    sum += toNum(row[c.id]) * c.weight
  }
  const owned = memberTags[memberId]                          // 2) 擁有的標籤：各自 score
  if (owned) for (const t of tags) if (owned.has(t.id)) sum += t.score
  for (const a of adjustments) if (a.memberId === memberId) sum += a.points   // 3) 專屬加減分
  return sum
}

// 新增列／欄時給的排序值：接在最後面。
export function nextSort(items: { sort: number }[]): number {
  return items.length ? Math.max(...items.map(i => i.sort)) + 1 : 0
}

// 匯入可能一次帶入上萬欄／列／格；單一 insert/upsert 過大會被 PostgREST 拒絕或逾時，
// 因此所有大量寫入都切成固定大小的批次逐批送出。
const CHUNK = 500
function chunk<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}

// ── 讀取：一次撈回全部表，組成元件要的形狀 ─────────────────────────────────
export async function fetchAll(): Promise<ContribData> {
  const [gRes, mRes, cRes, vRes, tRes, mtRes, aRes] = await Promise.all([
    supabase.from('contrib_guilds').select('id, name, sort_order').order('sort_order').order('created_at'),
    supabase.from('contrib_members').select('id, guild_id, name, sort_order').order('sort_order').order('created_at'),
    supabase.from('contrib_columns').select('id, name, role, weight, sort_order').order('sort_order').order('created_at'),
    supabase.from('contrib_cells').select('member_id, column_id, value'),
    supabase.from('contrib_tags').select('id, name, score, sort_order').order('sort_order').order('created_at'),
    supabase.from('contrib_member_tags').select('member_id, tag_id'),
    supabase.from('contrib_adjustments').select('id, member_id, label, points, sort_order').order('sort_order').order('created_at'),
  ])
  for (const r of [gRes, mRes, cRes, vRes, tRes, mtRes, aRes]) if (r.error) fail(r.error)

  const guilds: Guild[] = (gRes.data ?? []).map(g => ({ id: g.id, name: g.name, sort: g.sort_order }))
  const members: ContribMember[] = (mRes.data ?? []).map(m => ({ id: m.id, guildId: m.guild_id, name: m.name, sort: m.sort_order }))
  const columns: ContribColumn[] = (cRes.data ?? []).map(c => ({
    id: c.id, name: c.name, role: c.role as ColumnRole, weight: toNum(c.weight), sort: c.sort_order,
  }))
  const cells: CellMap = {}
  for (const v of vRes.data ?? []) (cells[v.member_id] ??= {})[v.column_id] = v.value
  const tags: Tag[] = (tRes.data ?? []).map(t => ({ id: t.id, name: t.name, score: toNum(t.score), sort: t.sort_order }))
  const memberTags: MemberTagMap = {}
  for (const mt of mtRes.data ?? []) (memberTags[mt.member_id] ??= new Set()).add(mt.tag_id)
  const adjustments: Adjustment[] = (aRes.data ?? []).map(a => ({
    id: a.id, memberId: a.member_id, label: a.label, points: toNum(a.points), sort: a.sort_order,
  }))
  return { guilds, members, columns, cells, tags, memberTags, adjustments }
}

// ── 公會 ─────────────────────────────────────────────────────────────────────
export async function addGuild(name: string, sort: number): Promise<Guild> {
  const { data, error } = await supabase.from('contrib_guilds').insert({ name, sort_order: sort })
    .select('id, name, sort_order').single()
  if (error) fail(error)
  return { id: data.id, name: data.name, sort: data.sort_order }
}
export async function renameGuild(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('contrib_guilds').update({ name }).eq('id', id)
  if (error) fail(error)
}
export async function deleteGuild(id: string): Promise<void> {   // 成員的 guild_id 由外鍵 set null
  const { error } = await supabase.from('contrib_guilds').delete().eq('id', id)
  if (error) fail(error)
}

// ── 成員（列）───────────────────────────────────────────────────────────────
export async function addMember(name: string, guildId: string | null, sort: number): Promise<ContribMember> {
  const { data, error } = await supabase.from('contrib_members').insert({ name, guild_id: guildId, sort_order: sort })
    .select('id, guild_id, name, sort_order').single()
  if (error) fail(error)
  return { id: data.id, guildId: data.guild_id, name: data.name, sort: data.sort_order }
}
// 批次新增成員（匯入用）：切批 insert，回傳全部新列。
export async function addMembers(rows: { name: string; guildId: string | null; sort: number }[]): Promise<ContribMember[]> {
  const out: ContribMember[] = []
  for (const batch of chunk(rows)) {
    const { data, error } = await supabase.from('contrib_members')
      .insert(batch.map(r => ({ name: r.name, guild_id: r.guildId, sort_order: r.sort })))
      .select('id, guild_id, name, sort_order')
    if (error) fail(error)
    for (const m of data ?? []) out.push({ id: m.id, guildId: m.guild_id, name: m.name, sort: m.sort_order })
  }
  return out
}
export async function renameMember(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('contrib_members').update({ name }).eq('id', id)
  if (error) fail(error)
}
export async function deleteMember(id: string): Promise<void> {          // cells/tags/adjustments 由外鍵 CASCADE 一併刪除
  const { error } = await supabase.from('contrib_members').delete().eq('id', id)
  if (error) fail(error)
}
// 批次移動成員到指定公會（可為 null＝移出公會）。
export async function moveMembers(ids: string[], guildId: string | null): Promise<void> {
  if (!ids.length) return
  const { error } = await supabase.from('contrib_members').update({ guild_id: guildId }).in('id', ids)
  if (error) fail(error)
}

// ── 欄位（欄）─────────────────────────────────────────────────────────────────
export async function addColumn(name: string, role: ColumnRole, weight: number, sort: number): Promise<ContribColumn> {
  const { data, error } = await supabase.from('contrib_columns')
    .insert({ name, role, weight, sort_order: sort })
    .select('id, name, role, weight, sort_order').single()
  if (error) fail(error)
  return { id: data.id, name: data.name, role: data.role as ColumnRole, weight: toNum(data.weight), sort: data.sort_order }
}
// 批次新增欄位（匯入用）：切批 insert，回傳全部新欄。
export async function addColumns(cols: { name: string; role: ColumnRole; weight: number; sort: number }[]): Promise<ContribColumn[]> {
  const out: ContribColumn[] = []
  for (const batch of chunk(cols)) {
    const { data, error } = await supabase.from('contrib_columns')
      .insert(batch.map(c => ({ name: c.name, role: c.role, weight: c.weight, sort_order: c.sort })))
      .select('id, name, role, weight, sort_order')
    if (error) fail(error)
    for (const c of data ?? []) out.push({ id: c.id, name: c.name, role: c.role as ColumnRole, weight: toNum(c.weight), sort: c.sort_order })
  }
  return out
}
export async function updateColumn(id: string, patch: Partial<Pick<ContribColumn, 'name' | 'role' | 'weight' | 'sort'>>): Promise<void> {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.role !== undefined) row.role = patch.role
  if (patch.weight !== undefined) row.weight = patch.weight
  if (patch.sort !== undefined) row.sort_order = patch.sort
  const { error } = await supabase.from('contrib_columns').update(row).eq('id', id)
  if (error) fail(error)
}
export async function deleteColumn(id: string): Promise<void> {          // cells 由外鍵 CASCADE 一併刪除
  const { error } = await supabase.from('contrib_columns').delete().eq('id', id)
  if (error) fail(error)
}

// ── 儲存格：以 (member,column) 唯一鍵 upsert；空字串代表清空 ─────────────────
export async function setCell(memberId: string, columnId: string, value: string): Promise<void> {
  const { error } = await supabase.from('contrib_cells')
    .upsert({ member_id: memberId, column_id: columnId, value }, { onConflict: 'member_id,column_id' })
  if (error) fail(error)
}

// ── 標籤（text 型價值觀）──────────────────────────────────────────────────────
export async function addTag(name: string, score: number, sort: number): Promise<Tag> {
  const { data, error } = await supabase.from('contrib_tags').insert({ name, score, sort_order: sort })
    .select('id, name, score, sort_order').single()
  if (error) fail(error)
  return { id: data.id, name: data.name, score: toNum(data.score), sort: data.sort_order }
}
export async function updateTag(id: string, patch: Partial<Pick<Tag, 'name' | 'score' | 'sort'>>): Promise<void> {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.score !== undefined) row.score = patch.score
  if (patch.sort !== undefined) row.sort_order = patch.sort
  const { error } = await supabase.from('contrib_tags').update(row).eq('id', id)
  if (error) fail(error)
}
export async function deleteTag(id: string): Promise<void> {             // member_tags 由外鍵 CASCADE 一併刪除
  const { error } = await supabase.from('contrib_tags').delete().eq('id', id)
  if (error) fail(error)
}
// 給／取消某成員的標籤（擁有＝存在一列）。
export async function setMemberTag(memberId: string, tagId: string, has: boolean): Promise<void> {
  if (has) {
    const { error } = await supabase.from('contrib_member_tags')
      .upsert({ member_id: memberId, tag_id: tagId }, { onConflict: 'member_id,tag_id' })
    if (error) fail(error)
  } else {
    const { error } = await supabase.from('contrib_member_tags').delete().eq('member_id', memberId).eq('tag_id', tagId)
    if (error) fail(error)
  }
}

// ── 成員專屬加減分（inline 備註）─────────────────────────────────────────────
export async function addAdjustment(memberId: string, label: string, points: number, sort: number): Promise<Adjustment> {
  const { data, error } = await supabase.from('contrib_adjustments')
    .insert({ member_id: memberId, label, points, sort_order: sort })
    .select('id, member_id, label, points, sort_order').single()
  if (error) fail(error)
  return { id: data.id, memberId: data.member_id, label: data.label, points: toNum(data.points), sort: data.sort_order }
}
export async function updateAdjustment(id: string, patch: Partial<Pick<Adjustment, 'label' | 'points'>>): Promise<void> {
  const row: Record<string, unknown> = {}
  if (patch.label !== undefined) row.label = patch.label
  if (patch.points !== undefined) row.points = patch.points
  const { error } = await supabase.from('contrib_adjustments').update(row).eq('id', id)
  if (error) fail(error)
}
export async function deleteAdjustment(id: string): Promise<void> {
  const { error } = await supabase.from('contrib_adjustments').delete().eq('id', id)
  if (error) fail(error)
}

// ── Excel 匯入：以「欄名／簡稱」為對應鍵，全部走後端批次 upsert（新增或更新，不刪除）──
// parsed 由 src/contrib/excel.ts 解析而來。匯入的欄一律為 info（純資訊）；使用者之後在
// 「價值觀管理」把欄轉成 value 才計分。成員一律建立在傳入的 guildId 之下。
export interface ImportColumn { name: string }
export interface ImportRow { name: string; values: Record<string, string> }  // values: 欄名 → 值
export interface ParsedImport { columns: ImportColumn[]; rows: ImportRow[] }

export async function importData(parsed: ParsedImport, guildId: string | null): Promise<{ newMembers: number; newColumns: number; cells: number }> {
  const current = await fetchAll()

  // 1) 欄位：同名沿用（保留其 role/weight，不因再匯入而降級為 info），其餘一次批次新建為 info。
  const colByName = new Map(current.columns.map(c => [c.name, c]))
  let colSort = nextSort(current.columns)
  const colsToAdd: { name: string; role: ColumnRole; weight: number; sort: number }[] = []
  for (const ic of parsed.columns) {
    if (colByName.has(ic.name)) continue
    colsToAdd.push({ name: ic.name, role: 'info', weight: 1, sort: colSort++ })
  }
  for (const c of await addColumns(colsToAdd)) colByName.set(c.name, c)

  // 2) 成員：以（所屬公會內的）同名沿用，其餘一次批次新建於 guildId。
  const memByName = new Map(current.members.filter(m => m.guildId === guildId).map(m => [m.name, m]))
  let memSort = nextSort(current.members)
  const memsToAdd: { name: string; guildId: string | null; sort: number }[] = []
  const memSeen = new Set(memByName.keys())
  for (const r of parsed.rows) {
    if (memSeen.has(r.name)) continue
    memSeen.add(r.name)
    memsToAdd.push({ name: r.name, guildId, sort: memSort++ })
  }
  for (const m of await addMembers(memsToAdd)) memByName.set(m.name, m)

  // 3) 儲存格：以 (member,column) 去重後切批 upsert（重複列或同鍵落在同批會被 PostgREST 拒絕）。
  const cellByKey = new Map<string, { member_id: string; column_id: string; value: string }>()
  for (const r of parsed.rows) {
    const member = memByName.get(r.name)
    if (!member) continue
    for (const [colName, value] of Object.entries(r.values)) {
      const col = colByName.get(colName)
      if (!col) continue
      cellByKey.set(`${member.id}|${col.id}`, { member_id: member.id, column_id: col.id, value })
    }
  }
  const cellRows = [...cellByKey.values()]
  for (const batch of chunk(cellRows)) {
    const { error } = await supabase.from('contrib_cells')
      .upsert(batch, { onConflict: 'member_id,column_id' })
    if (error) fail(error)
  }
  return { newMembers: memsToAdd.length, newColumns: colsToAdd.length, cells: cellRows.length }
}
