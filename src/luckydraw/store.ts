// 福袋抽籤的資料層：所有 Supabase 存取集中在此，元件只呼叫這些函式、不直接碰 supabase。
// 這裡是「資料形狀」的單一真相：型別也由此匯出給元件與匯入邏輯共用。
import { supabase } from '../supabase'

export interface Member { id: string; text: string; selected: boolean }
export interface Season { id: string; name: string }
export interface Winner { id: string; name: string; claimed: boolean; time: string }
export type BagKey = 'big' | 'small'
export type SeasonBag = Record<BagKey, Winner[]>
export type WinnersMap = Record<string, SeasonBag>   // key = seasonId

export type LuckyData = { members: Member[]; seasons: Season[]; winners: WinnersMap }

// 顯示用的時間快照（與舊版一致：MM/DD HH:mm）。
export function nowStamp() {
  return new Date().toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

function fail(error: unknown): never {
  throw error instanceof Error ? error : new Error(String(error))
}

// ── 讀取：一次撈回三張表，組成元件要的形狀 ─────────────────────────────────
export async function fetchAll(): Promise<LuckyData> {
  const [mRes, sRes, wRes] = await Promise.all([
    supabase.from('members').select('id, text, selected').order('created_at'),
    supabase.from('seasons').select('id, name').order('created_at'),
    supabase.from('winners').select('id, season_id, bag, name, claimed, time').order('created_at'),
  ])
  if (mRes.error) fail(mRes.error)
  if (sRes.error) fail(sRes.error)
  if (wRes.error) fail(wRes.error)

  const members: Member[] = (mRes.data ?? []).map(m => ({ id: m.id, text: m.text, selected: m.selected }))
  const seasons: Season[] = (sRes.data ?? []).map(s => ({ id: s.id, name: s.name }))

  const winners: WinnersMap = {}
  for (const s of seasons) winners[s.id] = { big: [], small: [] }
  for (const w of wRes.data ?? []) {
    const bucket = winners[w.season_id]
    if (!bucket) continue                         // 對應不到季度（理論上不會，防呆）
    const bag = w.bag as BagKey
    bucket[bag].push({ id: w.id, name: w.name, claimed: w.claimed, time: w.time })
  }
  return { members, seasons, winners }
}

// ── 成員（籤庫）───────────────────────────────────────────────────────────────
export async function addMember(text: string): Promise<Member> {
  const { data, error } = await supabase.from('members').insert({ text, selected: true })
    .select('id, text, selected').single()
  if (error) fail(error)
  return { id: data.id, text: data.text, selected: data.selected }
}
export async function renameMember(id: string, text: string): Promise<void> {
  const { error } = await supabase.from('members').update({ text }).eq('id', id)
  if (error) fail(error)
}
export async function deleteMember(id: string): Promise<void> {
  const { error } = await supabase.from('members').delete().eq('id', id)
  if (error) fail(error)
}
export async function setMemberSelected(id: string, selected: boolean): Promise<void> {
  const { error } = await supabase.from('members').update({ selected }).eq('id', id)
  if (error) fail(error)
}
// 全入／全出：一次更新目前帳號的所有成員（RLS 已把範圍限制在自己）。
export async function setAllSelected(selected: boolean): Promise<void> {
  const { error } = await supabase.from('members').update({ selected }).not('id', 'is', null)
  if (error) fail(error)
}

// ── 季度 ─────────────────────────────────────────────────────────────────────
export async function addSeason(name: string): Promise<Season> {
  const { data, error } = await supabase.from('seasons').insert({ name }).select('id, name').single()
  if (error) fail(error)
  return { id: data.id, name: data.name }
}
export async function renameSeason(id: string, name: string): Promise<void> {
  const { error } = await supabase.from('seasons').update({ name }).eq('id', id)
  if (error) fail(error)
}
// 刪季度：winners 由外鍵 ON DELETE CASCADE 一併刪除。
export async function deleteSeason(id: string): Promise<void> {
  const { error } = await supabase.from('seasons').delete().eq('id', id)
  if (error) fail(error)
}

// ── 中獎紀錄 ─────────────────────────────────────────────────────────────────
export async function addWinner(seasonId: string, bag: BagKey, name: string, claimed: boolean): Promise<Winner> {
  const time = nowStamp()
  const { data, error } = await supabase.from('winners')
    .insert({ season_id: seasonId, bag, name, claimed, time })
    .select('id, name, claimed, time').single()
  if (error) fail(error)
  return { id: data.id, name: data.name, claimed: data.claimed, time: data.time }
}
export async function setWinnersClaimed(ids: string[], claimed: boolean): Promise<void> {
  if (!ids.length) return
  const { error } = await supabase.from('winners').update({ claimed }).in('id', ids)
  if (error) fail(error)
}
// 同一人在某季的大小袋全部紀錄一起改名（維持合併成一列的行為）。
export async function renameWinnersInSeason(seasonId: string, oldName: string, newName: string): Promise<void> {
  const { error } = await supabase.from('winners').update({ name: newName })
    .eq('season_id', seasonId).eq('name', oldName)
  if (error) fail(error)
}
export async function deleteWinners(ids: string[]): Promise<void> {
  if (!ids.length) return
  const { error } = await supabase.from('winners').delete().in('id', ids)
  if (error) fail(error)
}

// ── 首次登入：把本機 localStorage 資料匯入雲端（只在雲端無實質資料時呼叫）────
// 季度以「名稱」對應：雲端已存在同名季度就沿用，否則新建 → 不會產生重複季度，
// 也能相容「另一台裝置已先建了預設季度」的情況。
export async function importData(local: LuckyData): Promise<void> {
  // 1) 先確保季度存在，建立 季度名稱 → 雲端 id 的對照
  const existing = await supabase.from('seasons').select('id, name').order('created_at')
  if (existing.error) fail(existing.error)
  const nameToId = new Map<string, string>()
  for (const s of existing.data ?? []) if (!nameToId.has(s.name)) nameToId.set(s.name, s.id)

  for (const s of local.seasons) {
    if (!nameToId.has(s.name)) {
      const created = await addSeason(s.name)
      nameToId.set(s.name, created.id)
    }
  }

  // 2) 匯入成員（保留原順序）
  for (const m of local.members) {
    const { error } = await supabase.from('members').insert({ text: m.text, selected: m.selected })
    if (error) fail(error)
  }

  // 3) 匯入中獎紀錄：本機以 localSeasonId 為 key，需先換成季度名稱再對到雲端 id
  const localIdToName = new Map(local.seasons.map(s => [s.id, s.name]))
  const rows: { season_id: string; bag: BagKey; name: string; claimed: boolean; time: string }[] = []
  for (const [localSid, bags] of Object.entries(local.winners)) {
    const seasonName = localIdToName.get(localSid)
    const cloudSid = seasonName ? nameToId.get(seasonName) : undefined
    if (!cloudSid) continue
    for (const bag of ['big', 'small'] as BagKey[]) {
      for (const w of bags[bag] ?? []) {
        rows.push({ season_id: cloudSid, bag, name: w.name, claimed: w.claimed, time: w.time || nowStamp() })
      }
    }
  }
  if (rows.length) {
    const { error } = await supabase.from('winners').insert(rows)
    if (error) fail(error)
  }
}

// 新帳號、且本機也沒有可匯入的資料時，種入預設季度讓 UI 有季度可選。
export async function seedDefaultSeasons(): Promise<void> {
  const names = ['第一季', '第二季', '第三季', '第四季', '第五季']
  const { error } = await supabase.from('seasons').insert(names.map(name => ({ name })))
  if (error) fail(error)
}
