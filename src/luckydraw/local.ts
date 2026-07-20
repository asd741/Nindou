// 讀取舊版 localStorage 資料，正規化成 LuckyData，供「首次登入匯入雲端」使用。
// 所有與舊格式相容的雜事（statusId 遺留標記、預設季度）都集中在這支檔案，
// 匯入完成後即可安心整支刪除，不會污染雲端資料層。
import type { LuckyData, Member, Season, WinnersMap, BagKey } from './store'
import { nowStamp } from './store'

const IMPORTED_FLAG = 'nindou-cloud-imported'   // 這台瀏覽器是否已匯入過（避免重複匯入）

const DEFAULT_SEASONS: Season[] = [
  { id: 'se1', name: '第一季' }, { id: 'se2', name: '第二季' }, { id: 'se3', name: '第三季' },
  { id: 'se4', name: '第四季' }, { id: 'se5', name: '第五季' },
]

function loadLS<T>(key: string, def: T): T {
  try { return (JSON.parse(localStorage.getItem(key) ?? 'null') as T | null) ?? def } catch { return def }
}

// 讀出並正規化本機資料（含舊版 statusId → 第三季大福袋中獎者 的一次性轉換）。
export function readLocalData(): LuckyData {
  const rawMembers = loadLS<any[]>('nindou-lots', [])
  const legacyTaggedNames: string[] = []
  const members: Member[] = (Array.isArray(rawMembers) ? rawMembers : []).map((l: any) => {
    if (l?.statusId) legacyTaggedNames.push(l.text)
    return { id: String(l?.id ?? ''), text: l?.text ?? '', selected: l?.selected !== false }
  }).filter(m => m.text)

  const seasons: Season[] = loadLS<Season[] | null>('nindou-seasons', null) ?? DEFAULT_SEASONS.map(s => ({ ...s }))

  const rawWinners = loadLS<any>('nindou-winners', {})
  const winners: WinnersMap = {}
  for (const s of seasons) winners[s.id] = { big: [], small: [] }
  for (const [sid, bags] of Object.entries(rawWinners ?? {})) {
    if (!winners[sid]) winners[sid] = { big: [], small: [] }
    for (const bag of ['big', 'small'] as BagKey[]) {
      const arr = (bags as any)?.[bag]
      if (Array.isArray(arr)) {
        winners[sid][bag] = arr.map((w: any) => ({
          id: String(w?.id ?? ''), name: w?.name ?? '', claimed: w?.claimed !== false, time: w?.time ?? '',
        })).filter((w: { name: string }) => w.name)
      }
    }
  }

  // 舊版遺留標記 → 第三季大福袋中獎者（沒有大小袋維度，依約定歸大福袋、已領取）。
  if (legacyTaggedNames.length) {
    const sid = seasons.some(s => s.id === 'se3') ? 'se3' : (seasons[0]?.id ?? 'se3')
    if (!winners[sid]) winners[sid] = { big: [], small: [] }
    const exist = new Set(winners[sid].big.map(w => w.name))
    for (const name of legacyTaggedNames) {
      if (exist.has(name)) continue
      winners[sid].big.push({ id: '', name, claimed: true, time: nowStamp() })
      exist.add(name)
    }
  }
  return { members, seasons, winners }
}

// 是否有「值得匯入」的資料：預設季度本身不算，需有成員或中獎紀錄。
export function hasMeaningfulLocalData(d: LuckyData): boolean {
  if (d.members.length) return true
  return Object.values(d.winners).some(b => (b.big?.length ?? 0) + (b.small?.length ?? 0) > 0)
}

export function alreadyImported(): boolean { return localStorage.getItem(IMPORTED_FLAG) === 'yes' }
export function markImported(): void { localStorage.setItem(IMPORTED_FLAG, 'yes') }
