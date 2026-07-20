// Excel 匯入／匯出：把 Dashboard 的資料層形狀與 .xlsx 檔互轉。使用 SheetJS。
// 只有這支檔案認得 xlsx；store／元件完全不碰，方便日後抽換或改格式。
//
// 檔案版面（單一工作表）：
//   第 1 列  表頭：      編號 │ 簡稱 │ <各欄名…> │ 總分
//   第 2 列  設定列：   #設定 │      │ <number 欄=權重數字；text 欄=空> │
//   第 3 列起 資料列：    序號 │ 姓名 │ <各儲存格值…>                  │ 分數
// 匯入時：'編號'/'總分' 欄略過；'簡稱' 為列身分；其餘欄依設定列判斷型別
//   （設定列該格為數字→number 欄取該權重，空白→text 欄）。無設定列則全部視為 text。
// xlsx 只在使用者按下匯入／匯出時才動態載入，避免它把主 bundle（含其他分頁）撐大。
import type * as XLSXNS from 'xlsx'
import type { ContribColumn, ContribData, ParsedImport, ColumnKind } from './store'
import { memberTotal } from './store'

const loadXLSX = (): Promise<typeof XLSXNS> => import('xlsx')

const SHEET = '公會貢獻度'
const SETTINGS_MARK = '#設定'   // 設定列首格標記
const COL_NO = '編號'
const COL_NAME = '簡稱'
const COL_TOTAL = '總分'

// 解析成數字：接受 number 或可轉為數字的非空字串，否則回 null（用來區分 number/text 欄）。
function asNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = String(v ?? '').trim()
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

function cellText(v: unknown): string {
  return v === null || v === undefined ? '' : String(v)
}

// ── 匯出：下載一份 .xlsx ─────────────────────────────────────────────────────
export async function exportExcel(data: ContribData, filename = '公會貢獻度.xlsx'): Promise<void> {
  const XLSX = await loadXLSX()
  const { members, columns, cells } = data
  const header = [COL_NO, COL_NAME, ...columns.map(c => c.name), COL_TOTAL]
  const settings = [SETTINGS_MARK, '', ...columns.map(c => (c.kind === 'number' ? c.weight : '')), '']
  const body = members.map((m, i) => [
    i + 1,
    m.name,
    ...columns.map(c => valueForExcel(cells[m.id]?.[c.id], c)),
    memberTotal(m.id, columns, cells),
  ])

  const ws = XLSX.utils.aoa_to_sheet([header, settings, ...body])
  ws['!cols'] = header.map((h, i) => ({ wch: i === 1 ? 12 : Math.max(8, h.length * 2 + 2) }))
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, SHEET)
  XLSX.writeFile(wb, filename)
}

// number 欄輸出成真正的數字（Excel 才能加總／排序），text 欄維持字串。
function valueForExcel(raw: string | undefined, col: ContribColumn): string | number {
  if (col.kind === 'number') {
    const n = asNumber(raw)
    return n === null ? '' : n
  }
  return raw ?? ''
}

// ── 匯入：解析檔案為 ParsedImport（欄定義＋每列的值）；實際寫入交給 store.importData ──
export async function parseExcel(file: File): Promise<ParsedImport> {
  const XLSX = await loadXLSX()
  const buf = await file.arrayBuffer()
  const wb = XLSX.read(buf, { type: 'array' })
  const wsName = wb.SheetNames[0]
  const ws = wsName ? wb.Sheets[wsName] : undefined
  if (!ws) throw new Error('檔案中找不到任何工作表。')

  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: '' })
  if (!aoa.length) throw new Error('檔案是空的。')

  const header = (aoa[0] ?? []).map(cellText)
  const nameIdx = header.findIndex(h => h.trim() === COL_NAME)
  if (nameIdx < 0) throw new Error(`找不到「${COL_NAME}」欄，無法對應成員，請沿用匯出的檔案格式。`)

  // 判斷第 2 列是否為設定列
  const hasSettings = aoa.length > 1 && cellText((aoa[1] ?? [])[0]).trim() === SETTINGS_MARK
  const settings = hasSettings ? (aoa[1] ?? []) : []
  const dataRows = aoa.slice(hasSettings ? 2 : 1)

  // 要匯入的欄（略過 編號／簡稱／總分／空表頭）
  const importCols: { idx: number; name: string; kind: ColumnKind; weight: number }[] = []
  header.forEach((h, idx) => {
    const name = h.trim()
    if (!name || name === COL_NO || name === COL_NAME || name === COL_TOTAL) return
    const w = hasSettings ? asNumber(settings[idx]) : null
    importCols.push(w === null ? { idx, name, kind: 'text', weight: 0 } : { idx, name, kind: 'number', weight: w })
  })

  const rows = dataRows
    .map(r => {
      const name = cellText(r[nameIdx]).trim()
      if (!name) return null
      const values: Record<string, string> = {}
      for (const c of importCols) values[c.name] = cellText(r[c.idx])
      return { name, values }
    })
    .filter((r): r is { name: string; values: Record<string, string> } => r !== null)

  if (!rows.length) throw new Error('沒有讀到任何成員資料列。')
  return { columns: importCols.map(({ name, kind, weight }) => ({ name, kind, weight })), rows }
}
