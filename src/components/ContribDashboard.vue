<script setup lang="ts">
// 公會貢獻度 Dashboard：一張可 CRUD 的動態試算表 + Excel 匯入匯出。
// 所有寫入都先打 store（Supabase）成功再更新本地，與福袋抽籤頁同一套模式。
import { ref, computed, watch } from 'vue'
import LoginForm from './LoginForm.vue'
import { user, userEmail, authReady, signOut } from '../auth/auth'
import * as store from '../contrib/store'
import type { ContribMember, ContribColumn, CellMap, ColumnKind } from '../contrib/store'
import { exportExcel, parseExcel } from '../contrib/excel'

// ── 雲端資料（登入後由 Supabase 載入）───────────────────────────────────────
const members = ref<ContribMember[]>([])
const columns = ref<ContribColumn[]>([])
const cells = ref<CellMap>({})

const loading = ref(false)
const loadError = ref('')
const opError = ref('')
const opInfo = ref('')
const importing = ref(false)

function msg(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {                       // Supabase 錯誤是純物件，取其 message
    const a = e as Record<string, unknown>
    return String(a.message ?? a.error_description ?? a.error ?? JSON.stringify(e))
  }
  return String(e)
}
// 包住一次寫入：失敗只顯示提示、不中斷畫面（不需回滾的動作用它）。
async function guard(fn: () => Promise<void>) {
  opError.value = ''
  try { await fn() } catch (e) { opError.value = msg(e) }
}

// ── 計分 ────────────────────────────────────────────────────────────────────
function totalOf(m: ContribMember): number { return store.memberTotal(m.id, columns.value, cells.value) }
function fmt(n: number): number { return Math.round(n * 100) / 100 }
function cellVal(m: ContribMember, c: ContribColumn): string { return cells.value[m.id]?.[c.id] ?? '' }

// 依總分排序（純顯示，不改動儲存順序）
const sortByScore = ref(false)
const displayMembers = computed(() =>
  sortByScore.value ? [...members.value].sort((a, b) => totalOf(b) - totalOf(a)) : members.value,
)

// ── 成員（列）───────────────────────────────────────────────────────────────
const newMemberName = ref('')
function addMember() {
  const name = newMemberName.value.trim()
  if (!name) return
  guard(async () => {
    const m = await store.addMember(name, store.nextSort(members.value))
    members.value.push(m)
    newMemberName.value = ''
  })
}
// 簡稱直接內嵌編輯：空白則還原，失敗則回滾。
function onMemberName(m: ContribMember, e: Event) {
  const el = e.target as HTMLInputElement
  const v = el.value.trim()
  if (!v) { el.value = m.name; return }
  if (v === m.name) return
  const prev = m.name
  m.name = v
  opError.value = ''
  store.renameMember(m.id, v).catch(err => { m.name = prev; el.value = prev; opError.value = msg(err) })
}
function deleteMember(m: ContribMember) {
  if (!confirm(`確定刪除成員「${m.name}」嗎？\n此人所有欄位的值會一併刪除。`)) return
  guard(async () => {
    await store.deleteMember(m.id)
    members.value = members.value.filter(x => x.id !== m.id)
    delete cells.value[m.id]
  })
}

// ── 儲存格：內嵌編輯，樂觀更新、失敗回滾 ─────────────────────────────────────
function onCell(m: ContribMember, c: ContribColumn, e: Event) {
  const el = e.target as HTMLInputElement
  const value = el.value
  const prev = cells.value[m.id]?.[c.id] ?? ''
  if (value === prev) return
  ;(cells.value[m.id] ??= {})[c.id] = value
  opError.value = ''
  store.setCell(m.id, c.id, value).catch(err => {
    ;(cells.value[m.id] ??= {})[c.id] = prev
    el.value = prev
    opError.value = msg(err)
  })
}

// ── 欄位／事件（欄）─────────────────────────────────────────────────────────
const showColMng = ref(false)
const newColName = ref('')
const newColKind = ref<ColumnKind>('number')
const newColWeight = ref<number>(1)

function addColumn() {
  const name = newColName.value.trim()
  if (!name) return
  const kind = newColKind.value
  const weight = kind === 'number' ? (Number(newColWeight.value) || 0) : 0
  guard(async () => {
    const c = await store.addColumn(name, kind, weight, store.nextSort(columns.value))
    columns.value.push(c)
    newColName.value = ''
    newColWeight.value = 1
  })
}
function onColName(c: ContribColumn, e: Event) {
  const el = e.target as HTMLInputElement
  const v = el.value.trim()
  if (!v) { el.value = c.name; return }
  if (v === c.name) return
  const prev = c.name
  c.name = v
  opError.value = ''
  store.updateColumn(c.id, { name: v }).catch(err => { c.name = prev; el.value = prev; opError.value = msg(err) })
}
function onColKind(c: ContribColumn, e: Event) {
  const el = e.target as HTMLSelectElement
  const kind = el.value as ColumnKind
  if (kind === c.kind) return
  const prev = c.kind
  c.kind = kind
  opError.value = ''
  store.updateColumn(c.id, { kind }).catch(err => { c.kind = prev; el.value = prev; opError.value = msg(err) })
}
function onColWeight(c: ContribColumn, e: Event) {
  const w = Number((e.target as HTMLInputElement).value) || 0
  if (w === c.weight) return
  const prev = c.weight
  c.weight = w
  store.updateColumn(c.id, { weight: w }).catch(err => { c.weight = prev; opError.value = msg(err) })
}
// 左右移：與相鄰欄互換 sort 並持久化。
function moveColumn(c: ContribColumn, dir: -1 | 1) {
  const i = columns.value.findIndex(x => x.id === c.id)
  const j = i + dir
  if (j < 0 || j >= columns.value.length) return
  const a = columns.value[i], b = columns.value[j]
  const as = a.sort, bs = b.sort
  guard(async () => {
    await store.updateColumn(a.id, { sort: bs })
    await store.updateColumn(b.id, { sort: as })
    a.sort = bs; b.sort = as
    columns.value = [...columns.value].sort((x, y) => x.sort - y.sort)
  })
}
function deleteColumn(c: ContribColumn) {
  if (!confirm(`確定刪除欄位「${c.name}」嗎？\n此欄所有成員的值會一併刪除。`)) return
  guard(async () => {
    await store.deleteColumn(c.id)
    columns.value = columns.value.filter(x => x.id !== c.id)
    for (const mid in cells.value) { if (cells.value[mid]) delete cells.value[mid][c.id] }
  })
}

// ── Excel 匯入／匯出 ─────────────────────────────────────────────────────────
const fileInput = ref<HTMLInputElement | null>(null)
async function onExport() {
  if (!members.value.length && !columns.value.length) { opError.value = '目前沒有資料可匯出。'; return }
  opError.value = ''
  const stamp = new Date().toISOString().slice(0, 10)
  try {
    await exportExcel({ members: members.value, columns: columns.value, cells: cells.value }, `公會貢獻度_${stamp}.xlsx`)
  } catch (e) { opError.value = msg(e) }
}
function triggerImport() { fileInput.value?.click() }
async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''                                    // 清空以便再次選同一檔
  if (!file) return
  importing.value = true; opError.value = ''; opInfo.value = ''
  try {
    const parsed = await parseExcel(file)
    const ok = confirm(
      `即將從「${file.name}」匯入：\n・欄位 ${parsed.columns.length} 個\n・成員 ${parsed.rows.length} 位\n\n` +
      `匯入方式為「新增或更新」：以「簡稱」對應成員、以「欄名」對應欄位，不會刪除任何既有資料。確定匯入嗎？`,
    )
    if (!ok) return
    const res = await store.importData(parsed)
    await loadData()
    opInfo.value = `匯入完成：新增 ${res.newMembers} 位成員、${res.newColumns} 個欄位，寫入 ${res.cells} 格資料。`
  } catch (err) {
    opError.value = msg(err)
  } finally {
    importing.value = false
  }
}

// ── 載入 ────────────────────────────────────────────────────────────────────
async function loadData() {
  loading.value = true; loadError.value = ''
  try {
    let data = await store.fetchAll()
    if (!data.columns.length) {                         // 全新帳號：種入預設欄位
      await store.seedDefaultColumns()
      data = await store.fetchAll()
    }
    members.value = data.members
    columns.value = data.columns
    cells.value = data.cells
  } catch (e) {
    loadError.value = msg(e)
  } finally {
    loading.value = false
  }
}

async function doSignOut() { await signOut() }

watch(user, (u) => {
  if (u) loadData()
  else { members.value = []; columns.value = []; cells.value = {}; sortByScore.value = false }
}, { immediate: true })
</script>

<template>
  <div class="cd">
    <!-- 前置狀態 -->
    <div v-if="!authReady" class="cd-state"><div class="cd-spinner"></div><span>載入中⋯</span></div>
    <LoginForm v-else-if="!user" />
    <div v-else-if="loading" class="cd-state"><div class="cd-spinner"></div><span>載入雲端資料中⋯</span></div>
    <div v-else-if="loadError" class="cd-state err">
      <span>載入失敗：{{ loadError }}</span>
      <button class="cd-retry" @click="loadData">重試</button>
    </div>

    <template v-else>
      <!-- 帳號列 -->
      <div class="acct-bar">
        <span class="acct-dot"></span>
        <span class="acct-email">{{ userEmail }}</span>
        <button class="acct-out" @click="doSignOut">登出</button>
      </div>

      <!-- 說明 -->
      <div class="cd-intro">
        <span class="cd-intro-dot"></span>
        每個「數字欄」都可設定<b>權重</b>，某成員該欄分數＝<b>次數 × 權重</b>；系統自動加總為<b>總分</b>＝貢獻度。
        「文字欄」（如暱稱、加入時間、備註）不計分。資料變更即時寫入雲端資料庫。
      </div>

      <!-- 提示條 -->
      <div v-if="opError" class="op-bar err"><span>操作失敗：{{ opError }}</span><button @click="opError = ''">✕</button></div>
      <div v-if="opInfo" class="op-bar ok"><span>{{ opInfo }}</span><button @click="opInfo = ''">✕</button></div>

      <!-- 工具列 -->
      <div class="cd-tools">
        <div class="cd-tools-l">
          <span class="cd-title">公會成員貢獻度</span>
          <span class="cd-count">{{ members.length }} 人 · {{ columns.length }} 欄</span>
        </div>
        <div class="cd-tools-r">
          <label class="cd-sort"><input type="checkbox" v-model="sortByScore" />依總分排序</label>
          <button class="cd-tbtn" :class="{ on: showColMng }" @click="showColMng = !showColMng">⚙ 欄位設定</button>
          <button class="cd-tbtn" :disabled="importing" @click="triggerImport">
            {{ importing ? '匯入中⋯' : '⬆ 匯入 Excel' }}
          </button>
          <button class="cd-tbtn gold" @click="onExport">⬇ 匯出 Excel</button>
          <input ref="fileInput" type="file" accept=".xlsx,.xls,.csv" class="cd-file" @change="onFile" />
        </div>
      </div>

      <!-- 欄位設定面板 -->
      <Transition name="slide">
        <div v-if="showColMng" class="col-panel">
          <div class="cp-add">
            <input v-model="newColName" class="cp-inp" placeholder="欄位名稱，例：公會戰參與次數" maxlength="20" @keydown.enter="addColumn" />
            <select v-model="newColKind" class="cp-sel">
              <option value="number">數字（計分）</option>
              <option value="text">文字（備註）</option>
            </select>
            <input v-if="newColKind === 'number'" v-model.number="newColWeight" class="cp-w" type="number" step="any" title="權重" />
            <button class="cp-add-btn" @click="addColumn">＋ 新增欄位</button>
          </div>
          <div class="cp-list">
            <div v-for="(c, i) in columns" :key="c.id" class="cp-row">
              <input class="cp-inp name" :value="c.name" maxlength="20" @change="onColName(c, $event)" />
              <select class="cp-sel" :value="c.kind" @change="onColKind(c, $event)">
                <option value="number">數字</option>
                <option value="text">文字</option>
              </select>
              <label v-if="c.kind === 'number'" class="cp-wlbl">權重
                <input class="cp-w" type="number" step="any" :value="c.weight" @change="onColWeight(c, $event)" />
              </label>
              <span v-else class="cp-wnote">不計分</span>
              <div class="cp-move">
                <button :disabled="i === 0" title="左移" @click="moveColumn(c, -1)">◀</button>
                <button :disabled="i === columns.length - 1" title="右移" @click="moveColumn(c, 1)">▶</button>
              </div>
              <button class="cp-del" @click="deleteColumn(c)">刪除</button>
            </div>
            <div v-if="!columns.length" class="cp-empty">尚無欄位，請於上方新增。</div>
          </div>
        </div>
      </Transition>

      <!-- 試算表 -->
      <div class="cd-table-wrap">
        <table class="cd-table">
          <thead>
            <tr>
              <th class="c-no">#</th>
              <th class="c-name">簡稱</th>
              <th v-for="c in columns" :key="c.id" class="c-col">
                <div class="th-in">
                  <span class="th-name" :title="c.name">{{ c.name }}</span>
                  <span v-if="c.kind === 'number'" class="th-w" title="權重（分數＝值×權重）">×{{ c.weight }}</span>
                  <span v-else class="th-t">文字</span>
                </div>
              </th>
              <th class="c-total">總分</th>
              <th class="c-act"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!members.length">
              <td :colspan="columns.length + 4" class="cd-empty">尚無成員 —— 於下方新增，或用「匯入 Excel」批次帶入。</td>
            </tr>
            <tr v-for="(m, i) in displayMembers" :key="m.id">
              <td class="c-no">{{ i + 1 }}</td>
              <td class="c-name"><input class="cell-inp name" :value="m.name" @change="onMemberName(m, $event)" /></td>
              <td v-for="c in columns" :key="c.id" class="c-col" :class="c.kind">
                <input class="cell-inp" :type="c.kind === 'number' ? 'number' : 'text'"
                  :value="cellVal(m, c)" @change="onCell(m, c, $event)" />
              </td>
              <td class="c-total"><span class="total-badge">{{ fmt(totalOf(m)) }}</span></td>
              <td class="c-act"><button class="row-del" title="刪除成員" @click="deleteMember(m)">✕</button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 新增成員 -->
      <div class="cd-addrow">
        <input v-model="newMemberName" class="cd-add-inp" placeholder="新增成員（簡稱）⋯" maxlength="20" @keydown.enter="addMember" />
        <button class="cd-add-btn" @click="addMember">＋ 新增成員</button>
      </div>
    </template>
  </div>
</template>

<style scoped>
.cd { min-height: 560px; display: flex; flex-direction: column; }

/* 前置狀態 */
.cd-state {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px; padding: 60px 20px; min-height: 420px; color: var(--text3); font-size: 0.95rem;
}
.cd-state.err { color: var(--red); }
.cd-spinner {
  width: 34px; height: 34px; border-radius: 50%;
  border: 3px solid var(--border2); border-top-color: var(--gold); animation: cd-spin 0.8s linear infinite;
}
@keyframes cd-spin { to { transform: rotate(360deg); } }
.cd-retry {
  padding: 8px 22px; border-radius: 20px; border: 1px solid var(--gold); background: transparent;
  color: var(--gold); font-size: 0.88rem; font-weight: 700; font-family: inherit; cursor: pointer;
}
.cd-retry:hover { background: rgba(244,192,48,0.12); }

/* 帳號列 */
.acct-bar {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 18px; background: rgba(0,0,0,0.22); border-bottom: 1px solid var(--border);
}
.acct-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); box-shadow: 0 0 8px rgba(82,183,136,0.6); flex-shrink: 0; }
.acct-email { font-size: 0.8rem; color: var(--text2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acct-out {
  margin-left: auto; padding: 4px 14px; border-radius: 8px; border: 1px solid var(--border2);
  background: var(--surface2); color: var(--text3); font-size: 0.78rem; font-weight: 600;
  font-family: inherit; cursor: pointer; transition: all 0.12s; white-space: nowrap;
}
.acct-out:hover { color: var(--red); border-color: var(--red); }

/* 說明 */
.cd-intro {
  display: flex; align-items: flex-start; gap: 8px; margin: 12px 18px 0;
  padding: 10px 12px; background: rgba(244,192,48,0.06); border: 1px solid rgba(244,192,48,0.22);
  border-radius: var(--radius); font-size: 0.78rem; color: var(--text2); line-height: 1.55;
}
.cd-intro b { color: var(--gold); font-weight: 700; }
.cd-intro-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--gold); flex-shrink: 0; margin-top: 6px; box-shadow: 0 0 6px rgba(244,192,48,0.5); }

/* 提示條 */
.op-bar {
  display: flex; align-items: center; gap: 10px; margin: 10px 18px 0;
  padding: 8px 12px; border-radius: var(--radius); font-size: 0.82rem;
}
.op-bar span { flex: 1; min-width: 0; line-height: 1.4; }
.op-bar button { border: none; background: transparent; font-size: 0.9rem; cursor: pointer; font-family: inherit; flex-shrink: 0; }
.op-bar.err { background: rgba(230,70,70,0.1); border: 1px solid rgba(230,70,70,0.35); color: var(--red); }
.op-bar.err button { color: var(--red); }
.op-bar.ok { background: rgba(82,183,136,0.1); border: 1px solid rgba(82,183,136,0.35); color: var(--green); }
.op-bar.ok button { color: var(--green); }

/* 工具列 */
.cd-tools {
  display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px;
  padding: 14px 18px; background: linear-gradient(135deg, #11101c, #15131f); border-bottom: 1px solid var(--border2);
}
.cd-tools-l { display: flex; align-items: baseline; gap: 10px; margin-right: auto; }
.cd-title { font-size: 1.02rem; font-weight: 800; color: var(--text); }
.cd-count { font-size: 0.76rem; color: var(--text3); }
.cd-tools-r { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cd-sort {
  display: flex; align-items: center; gap: 5px; font-size: 0.8rem; color: var(--text2);
  cursor: pointer; user-select: none; margin-right: 2px;
}
.cd-tbtn {
  padding: 7px 14px; border-radius: 8px; border: 1px solid var(--border2); background: var(--surface2);
  color: var(--text2); font-size: 0.82rem; font-weight: 600; font-family: inherit; cursor: pointer;
  transition: all 0.14s; white-space: nowrap;
}
.cd-tbtn:hover:not(:disabled) { color: var(--text); border-color: var(--text3); }
.cd-tbtn.on { color: var(--gold); border-color: var(--gold); }
.cd-tbtn.gold { color: var(--gold); border-color: rgba(244,192,48,0.5); background: rgba(244,192,48,0.08); }
.cd-tbtn.gold:hover { background: rgba(244,192,48,0.16); }
.cd-tbtn:disabled { opacity: 0.5; cursor: not-allowed; }
.cd-file { display: none; }

/* 欄位設定面板 */
.col-panel { background: var(--surface); border-bottom: 1px solid var(--border2); padding: 14px 18px; overflow: hidden; }
.cp-add { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
.cp-inp {
  min-width: 0; background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text); font-size: 0.88rem; padding: 7px 10px; outline: none; font-family: inherit; transition: border-color 0.15s;
}
.cp-inp:focus { border-color: var(--gold); }
.cp-add .cp-inp { flex: 1; min-width: 180px; }
.cp-inp.name { width: 180px; flex: 0 1 180px; }
.cp-sel {
  background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text); font-size: 0.84rem; padding: 7px 8px; outline: none; font-family: inherit; cursor: pointer;
}
.cp-w {
  width: 76px; background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text); font-size: 0.86rem; padding: 7px 8px; outline: none; font-family: inherit; text-align: right;
}
.cp-w:focus { border-color: var(--gold); }
.cp-add-btn {
  padding: 7px 14px; border-radius: var(--radius); border: 1px solid rgba(244,192,48,0.4);
  background: rgba(244,192,48,0.08); color: var(--gold); font-size: 0.84rem; font-weight: 600;
  font-family: inherit; cursor: pointer; white-space: nowrap; transition: all 0.15s;
}
.cp-add-btn:hover { background: rgba(244,192,48,0.16); }
.cp-list { display: flex; flex-direction: column; gap: 7px; }
.cp-row {
  display: flex; align-items: center; gap: 8px; flex-wrap: wrap; background: var(--surface2);
  border: 1px solid var(--border); border-radius: var(--radius); padding: 6px 10px;
}
.cp-wlbl { display: flex; align-items: center; gap: 5px; font-size: 0.76rem; color: var(--text3); }
.cp-wnote { font-size: 0.76rem; color: var(--text3); font-style: italic; }
.cp-move { display: flex; gap: 3px; margin-left: auto; }
.cp-move button {
  width: 26px; height: 26px; border-radius: 6px; border: 1px solid var(--border); background: transparent;
  color: var(--text3); font-size: 0.72rem; cursor: pointer; font-family: inherit;
}
.cp-move button:hover:not(:disabled) { border-color: var(--text3); color: var(--text); }
.cp-move button:disabled { opacity: 0.3; cursor: not-allowed; }
.cp-del {
  padding: 5px 12px; border-radius: 6px; border: 1px solid var(--border); background: transparent;
  color: var(--text3); font-size: 0.78rem; cursor: pointer; font-family: inherit; transition: all 0.12s;
}
.cp-del:hover { border-color: var(--red); color: var(--red); }
.cp-empty { font-size: 0.84rem; color: var(--text3); padding: 6px 2px; }

.slide-enter-active, .slide-leave-active { transition: all 0.25s ease; }
.slide-enter-from, .slide-leave-to { opacity: 0; transform: translateY(-8px); }

/* 試算表 */
.cd-table-wrap { overflow-x: auto; padding: 14px 18px 0; }
.cd-table { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 0.86rem; }
.cd-table th, .cd-table td { border-bottom: 1px solid var(--border); border-right: 1px solid var(--border); white-space: nowrap; }
.cd-table th:first-child, .cd-table td:first-child { border-left: 1px solid var(--border); }
.cd-table thead th { border-top: 1px solid var(--border); }
.cd-table th {
  background: var(--surface2); padding: 8px 10px; text-align: left; font-weight: 700;
  color: var(--text2); position: sticky; top: 0; z-index: 2;
}
.th-in { display: flex; align-items: center; gap: 6px; }
.th-name { max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.th-w { font-size: 0.68rem; font-weight: 800; color: var(--gold); background: rgba(244,192,48,0.12); border: 1px solid rgba(244,192,48,0.3); border-radius: 8px; padding: 0 6px; }
.th-t { font-size: 0.66rem; color: var(--text3); border: 1px solid var(--border2); border-radius: 8px; padding: 0 6px; }
.c-no { width: 40px; text-align: center; color: var(--text3); }
td.c-no { text-align: center; color: var(--text3); font-size: 0.8rem; }
.c-name { min-width: 110px; }
.c-total { width: 84px; text-align: right; background: rgba(244,192,48,0.05); }
.c-act { width: 40px; }

.cd-table td { padding: 0; background: var(--bg); }
.cd-table td.c-total { padding: 6px 10px; text-align: right; }
.cell-inp {
  width: 100%; min-width: 72px; border: none; background: transparent; color: var(--text);
  font-size: 0.86rem; padding: 8px 10px; outline: none; font-family: inherit;
}
.cell-inp.name { font-weight: 700; }
.c-col.number .cell-inp { text-align: right; color: var(--blue); }
.cell-inp:focus { background: rgba(244,192,48,0.08); box-shadow: inset 0 0 0 1px var(--gold); }
.total-badge { font-weight: 800; color: var(--gold); font-size: 0.92rem; }
.row-del {
  width: 26px; height: 26px; border-radius: 6px; border: 1px solid var(--border); background: transparent;
  color: var(--text3); font-size: 0.78rem; cursor: pointer; font-family: inherit; transition: all 0.12s;
  display: flex; align-items: center; justify-content: center; margin: 4px auto;
}
.row-del:hover { border-color: var(--red); color: var(--red); }
.cd-empty { padding: 20px; text-align: center; color: var(--text3); font-size: 0.9rem; background: var(--bg); }

/* 新增成員列 */
.cd-addrow { display: flex; gap: 8px; padding: 12px 18px 20px; max-width: 460px; }
.cd-add-inp {
  flex: 1; min-width: 0; background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius);
  color: var(--text); font-size: 0.9rem; padding: 9px 12px; outline: none; font-family: inherit; transition: border-color 0.15s;
}
.cd-add-inp:focus { border-color: var(--gold); }
.cd-add-btn {
  padding: 9px 16px; border-radius: var(--radius); border: 1px solid rgba(244,192,48,0.4);
  background: rgba(244,192,48,0.08); color: var(--gold); font-size: 0.86rem; font-weight: 600;
  font-family: inherit; cursor: pointer; white-space: nowrap; transition: all 0.15s;
}
.cd-add-btn:hover { background: rgba(244,192,48,0.16); }

@media (max-width: 600px) {
  .cd-intro { margin: 10px 12px 0; }
  .cd-tools { padding: 12px; }
  .cd-tools-l { width: 100%; }
  .cd-table-wrap { padding: 12px 12px 0; }
  .cd-addrow { padding: 12px; }
}
</style>
