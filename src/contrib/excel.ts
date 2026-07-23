// Excel 匯入／匯出：把 Dashboard 的資料層形狀與 .xlsx 檔互轉。使用 SheetJS。
// 只有這支檔案認得 xlsx；store／元件完全不碰，方便日後抽換或改格式。
//
// 設計理念：匯入要相容「任何 Excel」——不知道有哪些欄、可能上萬欄也照收：
//   • 表頭不必在第 1 列：掃描前面數列，找第一列含「簡稱／暱稱…」（姓名候選）當表頭，
//     其上的註記／標題列一律忽略；連候選都沒有時退而取「第一列≥2 非空表頭」當表頭、
//     首個非編號／總分欄當身分欄。真的連表頭都沒有才報錯。
//   • 每列身分（簡稱）那格為空時，退用同列「暱稱」欄的值當身分，兩者皆空才略過該列。
//   • 匯入的欄一律視為「純資訊欄」；型別／權重不從檔案猜——由使用者之後在「價值觀
//     管理」把欄轉為 value 才計分（見 store.importData）。
// xlsx 只在使用者按下匯入／匯出時才動態載入，避免它把主 bundle（含其他分頁）撐大。
import type * as XLSXNS from 'xlsx'
import type { ContribData, ParsedImport } from './store'
import { memberTotal } from './store'

const loadXLSX = (): Promise<typeof XLSXNS> => import('xlsx')

const SHEET = '公會貢獻度'
const SETTINGS_MARK = '#設定'   // 本工具匯出檔的設定列首格標記（匯入時據此跳過該列）
const COL_NO = '編號'
const COL_NAME = '簡稱'
const COL_GUILD = '公會'
const COL_TOTAL = '總分'
// 姓名（列身分）欄的候選表頭名，依優先序；掃描表頭列時用來自動定位。
const NAME_CANDIDATES = ['簡稱', '暱稱', '名稱', '姓名', '名字', 'ID', 'id', 'name', 'Name']
// 次要身分欄（列的簡稱為空時，退用此欄的值當身分）。
const ALT_NAME = '暱稱'
// 略過不匯入的表頭名（純衍生欄）。
const SKIP_NAMES = new Set([COL_NO, COL_TOTAL])
const HEADER_SCAN_LIMIT = 30   // 只在前 N 列內找表頭，避免整份掃描

function cellText(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}

// ── 匯出：下載一份 .xlsx（資訊欄／價值觀欄／標籤／加減分／總分一次呈現）─────────
export async function exportExcel(data: ContribData, filename = '公會貢獻度.xlsx'): Promise<void> {
  const XLSX = await loadXLSX()
  const { guilds, members, columns, cells, tags, memberTags, adjustments } = data
  const guildName = new Map(guilds.map(g => [g.id, g.name]))

  const header = [COL_NO, COL_NAME, COL_GUILD, ...columns.map(c => c.name), ...tags.map(t => t.name), '加減分', COL_TOTAL]
  const body = members.map((m, i) => {
    const owned = memberTags[m.id]
    const adj = adjustments.filter(a => a.memberId === m.id).reduce((s, a) => s + a.points, 0)
    return [
      i + 1,
      m.name,
      m.guildId ? (guildName.get(m.guildId) ?? '') : '',
      ...columns.map(c => cells[m.id]?.[c.id] ?? ''),
      ...tags.map(t => (owned && owned.has(t.id) ? '✓' : '')),
      adj,
      memberTotal(m.id, columns, cells, tags, memberTags, adjustments),
    ]
  })

  const ws = XLSX.utils.aoa_to_sheet([header, ...body])
  ws['!cols'] = header.map((h, i) => ({ wch: i === 1 ? 14 : Math.max(8, cellText(h).length * 2 + 2) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, SHEET)
  XLSX.writeFile(wb, filename)
}

// 掃描前幾列找表頭：回傳表頭列索引與姓名（列身分）欄索引，並附「暱稱」欄索引（次要身分）。
// 設計目標是「不知道檔案有哪些欄、可能上萬欄」也照樣運作，所以分兩段、盡量不拒收。
function findHeader(aoa: unknown[][]): { headerRow: number; nameIdx: number } | null {
  const limit = Math.min(aoa.length, HEADER_SCAN_LIMIT)
  for (const cand of NAME_CANDIDATES) {
    for (let r = 0; r < limit; r++) {
      const idx = (aoa[r] ?? []).findIndex(c => cellText(c).trim() === cand)
      if (idx >= 0) return { headerRow: r, nameIdx: idx }
    }
  }
  for (let r = 0; r < limit; r++) {
    const cells = (aoa[r] ?? []).map((c, i) => ({ name: cellText(c).trim(), i })).filter(x => x.name)
    if (cells.length >= 2) {
      const id = cells.find(x => !SKIP_NAMES.has(x.name)) ?? cells[0]
      return { headerRow: r, nameIdx: id.i }
    }
  }
  return null
}

// ── 匯入：解析檔案為 ParsedImport（欄名＋每列的值）；實際寫入交給 store.importData ──
export async function parseExcel(file: File): Promise<ParsedImport> {
  const XLSX = await loadXLSX()
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const wsName = wb.SheetNames[0]
  const ws = wsName ? wb.Sheets[wsName] : undefined
  if (!ws) throw new Error('檔案中找不到任何工作表。')

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: '' })
  if (!aoa.length) throw new Error('檔案是空的。')

  const found = findHeader(aoa)
  if (!found) {
    throw new Error(
      `找不到可對應成員的姓名欄（如「${COL_NAME}」）。請確認表頭列含下列任一欄名：${NAME_CANDIDATES.join('、')}。`,
    )
  }
  const { headerRow, nameIdx } = found
  const header = (aoa[headerRow] ?? []).map(cellText)
  const altIdx = header.findIndex(h => h.trim() === ALT_NAME)   // 次要身分欄（簡稱為空時退用）

  // 表頭下一列若首格為 '#設定' 才當設定列（本工具舊匯出檔專屬）；一律跳過不當資料。
  const hasSettings = cellText((aoa[headerRow + 1] ?? [])[0]).trim() === SETTINGS_MARK
  const dataRows = aoa.slice(headerRow + (hasSettings ? 2 : 1))

  // 要匯入的欄：略過 編號／總分／姓名欄本身／空表頭；同名只取第一個，避免值互蓋。
  const importCols: { idx: number; name: string }[] = []
  const seen = new Set<string>()
  header.forEach((h, idx) => {
    const name = h.trim()
    if (!name || idx === nameIdx || SKIP_NAMES.has(name) || seen.has(name)) return
    seen.add(name)
    importCols.push({ idx, name })
  })

  const rows = dataRows
    .map(r => {
      let name = cellText(r[nameIdx]).trim()
      if (!name && altIdx >= 0) name = cellText(r[altIdx]).trim()   // 簡稱空 → 退用暱稱
      if (!name) return null
      const values: Record<string, string> = {}
      for (const c of importCols) values[c.name] = cellText(r[c.idx])
      return { name, values }
    })
    .filter((r): r is { name: string; values: Record<string, string> } => r !== null)

  if (!rows.length) throw new Error('沒有讀到任何成員資料列。')
  return { columns: importCols.map(({ name }) => ({ name })), rows }
}
