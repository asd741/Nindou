// 公會貢獻度 Dashboard 的資料層：所有 Supabase 存取集中在此，元件只呼叫這些函式。
// 這裡也是「資料形狀」的單一真相：型別由此匯出給元件、Excel 匯入匯出共用。
//
// 資料模型是一張動態試算表：
//   members  列（每位公會成員）
//   columns  欄（可自訂事件或備註）；kind='number' 帶 weight 用於計分，'text' 為純文字
//   cells    某成員某欄的值（一律存字串）
// 某成員某欄分數 = 值 × 權重；成員總分 = 所有 number 欄分數加總（見 memberTotal）。
import { supabase } from '../supabase'

export type ColumnKind = 'number' | 'text'
export interface ContribColumn { id: string; name: string; kind: ColumnKind; weight: number; sort: number }
export interface ContribMember { id: string; name: string; sort: number }
// cells[memberId][columnId] = 值（字串）。缺 key 視為空字串。
export type CellMap = Record<string, Record<string, string>>
export interface ContribData { members: ContribMember[]; columns: ContribColumn[]; cells: CellMap }

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

// 某成員的總分：只加總 number 欄（值 × 權重）。純函式，供元件與匯出共用。
export function memberTotal(memberId: string, columns: ContribColumn[], cells: CellMap): number {
  const row = cells[memberId] ?? {}
  let sum = 0
  for (const c of columns) {
    if (c.kind !== 'number') continue
    sum += toNum(row[c.id]) * c.weight
  }
  return sum
}

// 新增列／欄時給的排序值：接在最後面。
export function nextSort(items: { sort: number }[]): number {
  return items.length ? Math.max(...items.map(i => i.sort)) + 1 : 0
}

// ── 讀取：一次撈回三張表，組成元件要的形狀 ─────────────────────────────────
export async function fetchAll(): Promise<ContribData> {
  const [mRes, cRes, vRes] = await Promise.all([
    supabase.from('contrib_members').select('id, name, sort_order').order('sort_order').order('created_at'),
    supabase.from('contrib_columns').select('id, name, kind, weight, sort_order').order('sort_order').order('created_at'),
    supabase.from('contrib_cells').select('member_id, column_id, value'),
  ])
  if (mRes.error) fail(mRes.error)
  if (cRes.error) fail(cRes.error)
  if (vRes.error) fail(vRes.error)

  const members: ContribMember[] = (mRes.data ?? []).map(m => ({ id: m.id, name: m.name, sort: m.sort_order }))
  const columns: ContribColumn[] = (cRes.data ?? []).map(c => ({
    id: c.id, name: c.name, kind: c.kind as ColumnKind, weight: toNum(c.weight), sort: c.sort_order,
  }))
  const cells: CellMap = {}
  for (const v of vRes.data ?? []) {
    ;(cells[v.member_id] ??= {})[v.column_id] = v.value
  }
  return { members, columns, cells }
}

// ── 成員（列）───────────────────────────────────────────────────────────────
export async function addMember(name: string, sort: number): Promise<ContribMember> {
  const { data, error } = await supabase.from('contrib_members').insert({ name, sort_order: sort })
    .select('id, name, sort_order').single()
  if (error) fail(error)
  return { id: data.id, name: data.name, sort: data.sort_order }
}
export async function renameMember(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('contrib_members').update({ name }).eq('id', id)
  if (error) fail(error)
}
export async function deleteMember(id: string): Promise<void> {          // cells 由外鍵 CASCADE 一併刪除
  const { error } = await supabase.from('contrib_members').delete().eq('id', id)
  if (error) fail(error)
}

// ── 欄位／事件（欄）─────────────────────────────────────────────────────────
export async function addColumn(name: string, kind: ColumnKind, weight: number, sort: number): Promise<ContribColumn> {
  const { data, error } = await supabase.from('contrib_columns')
    .insert({ name, kind, weight, sort_order: sort })
    .select('id, name, kind, weight, sort_order').single()
  if (error) fail(error)
  return { id: data.id, name: data.name, kind: data.kind as ColumnKind, weight: toNum(data.weight), sort: data.sort_order }
}
export async function updateColumn(id: string, patch: Partial<Pick<ContribColumn, 'name' | 'kind' | 'weight' | 'sort'>>): Promise<void> {
  const row: Record<string, unknown> = {}
  if (patch.name !== undefined) row.name = patch.name
  if (patch.kind !== undefined) row.kind = patch.kind
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

// ── 首次使用：種入預設欄位，讓空的 Dashboard 有欄可填、匯出即是可用範本 ──────
export async function seedDefaultColumns(): Promise<ContribColumn[]> {
  const defs: { name: string; kind: ColumnKind; weight: number }[] = [
    { name: '暱稱',        kind: 'text',   weight: 0 },
    { name: '加入時間',    kind: 'text',   weight: 0 },
    { name: '公會戰參與次數', kind: 'number', weight: 10 },
    { name: '備註',        kind: 'text',   weight: 0 },
  ]
  const rows = defs.map((d, i) => ({ name: d.name, kind: d.kind, weight: d.weight, sort_order: i }))
  const { data, error } = await supabase.from('contrib_columns').insert(rows)
    .select('id, name, kind, weight, sort_order').order('sort_order')
  if (error) fail(error)
  return (data ?? []).map(c => ({ id: c.id, name: c.name, kind: c.kind as ColumnKind, weight: toNum(c.weight), sort: c.sort_order }))
}

// ── Excel 匯入：以「欄名／簡稱」為對應鍵，全部走後端 upsert（新增或更新，不刪除）──
// parsed 由 src/contrib/excel.ts 解析而來。回傳受影響的統計，供 UI 提示。
export interface ImportColumn { name: string; kind: ColumnKind; weight: number }
export interface ImportRow { name: string; values: Record<string, string> }  // values: 欄名 → 值
export interface ParsedImport { columns: ImportColumn[]; rows: ImportRow[] }

export async function importData(parsed: ParsedImport): Promise<{ newMembers: number; newColumns: number; cells: number }> {
  const current = await fetchAll()

  // 1) 欄位：同名沿用（並更新 kind/權重以反映檔案設定），否則新建
  const colByName = new Map(current.columns.map(c => [c.name, c]))
  let colSort = nextSort(current.columns)
  let newColumns = 0
  for (const ic of parsed.columns) {
    const exist = colByName.get(ic.name)
    if (exist) {
      if (exist.kind !== ic.kind || exist.weight !== ic.weight) {
        await updateColumn(exist.id, { kind: ic.kind, weight: ic.weight })
      }
    } else {
      const created = await addColumn(ic.name, ic.kind, ic.weight, colSort++)
      colByName.set(created.name, created)
      newColumns++
    }
  }

  // 2) 成員：同名沿用，否則新建
  const memByName = new Map(current.members.map(m => [m.name, m]))
  let memSort = nextSort(current.members)
  let newMembers = 0
  for (const r of parsed.rows) {
    if (memByName.has(r.name)) continue
    const created = await addMember(r.name, memSort++)
    memByName.set(created.name, created)
    newMembers++
  }

  // 3) 儲存格：一次批次 upsert
  const cellRows: { member_id: string; column_id: string; value: string }[] = []
  for (const r of parsed.rows) {
    const member = memByName.get(r.name)
    if (!member) continue
    for (const [colName, value] of Object.entries(r.values)) {
      const col = colByName.get(colName)
      if (!col) continue
      cellRows.push({ member_id: member.id, column_id: col.id, value })
    }
  }
  if (cellRows.length) {
    const { error } = await supabase.from('contrib_cells')
      .upsert(cellRows, { onConflict: 'member_id,column_id' })
    if (error) fail(error)
  }
  return { newMembers, newColumns, cells: cellRows.length }
}
