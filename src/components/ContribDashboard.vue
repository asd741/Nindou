<script setup lang="ts">
// 公會貢獻度 Dashboard：多公會的動態試算表 + 三種計分（value 欄／標籤／專屬加減分）+ Excel 匯入匯出。
// 所有寫入都先打 store（Supabase）成功再更新本地，與福袋抽籤頁同一套模式。
import { ref, computed, watch } from 'vue'
import LoginForm from './LoginForm.vue'
import { user, userEmail, authReady, signOut } from '../auth/auth'
import * as store from '../contrib/store'
import type {
  Guild, ContribMember, ContribColumn, CellMap, Tag, Adjustment, MemberTagMap, ColumnRole,
} from '../contrib/store'
import { exportExcel, parseExcel } from '../contrib/excel'

// ── 雲端資料 ─────────────────────────────────────────────────────────────────
const guilds = ref<Guild[]>([])
const members = ref<ContribMember[]>([])
const columns = ref<ContribColumn[]>([])
const cells = ref<CellMap>({})
const tags = ref<Tag[]>([])
const memberTags = ref<MemberTagMap>({})
const adjustments = ref<Adjustment[]>([])

const currentGuildId = ref<string | null>(null)   // 目前檢視的公會

const loading = ref(false)
const loadError = ref('')
const opError = ref('')
const opInfo = ref('')
const importing = ref(false)

function msg(e: unknown): string {
  if (e instanceof Error) return e.message
  if (e && typeof e === 'object') {
    const a = e as Record<string, unknown>
    return String(a.message ?? a.error_description ?? a.error ?? JSON.stringify(e))
  }
  return String(e)
}
async function guard(fn: () => Promise<void>) {
  opError.value = ''
  try { await fn() } catch (e) { opError.value = msg(e) }
}

// ── 計分 ────────────────────────────────────────────────────────────────────
function totalOf(m: ContribMember): number {
  return store.memberTotal(m.id, columns.value, cells.value, tags.value, memberTags.value, adjustments.value)
}
function fmt(n: number): number { return Math.round(n * 100) / 100 }
function cellVal(m: ContribMember, c: ContribColumn): string { return cells.value[m.id]?.[c.id] ?? '' }
function hasTag(mid: string, tid: string): boolean { return memberTags.value[mid]?.has(tid) ?? false }
function ownedTags(mid: string): Tag[] { return tags.value.filter(t => hasTag(mid, t.id)) }
function adjOf(mid: string): Adjustment[] { return adjustments.value.filter(a => a.memberId === mid) }
function adjSum(mid: string): number { return adjOf(mid).reduce((s, a) => s + a.points, 0) }

// ── 公會檢視／排序 ────────────────────────────────────────────────────────────
const sortByScore = ref(false)
const guildMembers = computed(() => members.value.filter(m => m.guildId === currentGuildId.value))
const displayMembers = computed(() =>
  sortByScore.value ? [...guildMembers.value].sort((a, b) => totalOf(b) - totalOf(a)) : guildMembers.value,
)
const currentGuild = computed(() => guilds.value.find(g => g.id === currentGuildId.value) ?? null)
const valueColumns = computed(() => columns.value.filter(c => c.role === 'value'))

// ── 複選（含 Shift 範圍選取）──────────────────────────────────────────────────
const selected = ref<Set<string>>(new Set())
const lastIdx = ref<number | null>(null)
const allChecked = computed(() => displayMembers.value.length > 0 && displayMembers.value.every(m => selected.value.has(m.id)))
const someChecked = computed(() => displayMembers.value.some(m => selected.value.has(m.id)) && !allChecked.value)
function isSel(id: string): boolean { return selected.value.has(id) }
function onCheck(index: number, e: MouseEvent) {
  const list = displayMembers.value
  const id = list[index].id
  const willSelect = !selected.value.has(id)
  const next = new Set(selected.value)
  if (e.shiftKey && lastIdx.value !== null) {
    const [a, b] = [lastIdx.value, index].sort((x, y) => x - y)
    for (let i = a; i <= b; i++) { willSelect ? next.add(list[i].id) : next.delete(list[i].id) }
  } else {
    willSelect ? next.add(id) : next.delete(id)
  }
  selected.value = next
  lastIdx.value = index
}
function toggleAll() {
  selected.value = allChecked.value ? new Set() : new Set(displayMembers.value.map(m => m.id))
  lastIdx.value = null
}
function clearSelection() { selected.value = new Set(); lastIdx.value = null }

// ── 公會 CRUD ─────────────────────────────────────────────────────────────────
async function addGuild() {
  const name = prompt('新公會名稱：')?.trim()
  if (!name) return
  guard(async () => {
    const g = await store.addGuild(name, store.nextSort(guilds.value))
    guilds.value.push(g)
    currentGuildId.value = g.id
  })
}
async function renameGuild() {
  const g = currentGuild.value
  if (!g) return
  const name = prompt('公會改名：', g.name)?.trim()
  if (!name || name === g.name) return
  guard(async () => { await store.renameGuild(g.id, name); g.name = name })
}
async function deleteGuild() {
  const g = currentGuild.value
  if (!g) return
  const n = members.value.filter(m => m.guildId === g.id).length
  if (!confirm(`確定刪除公會「${g.name}」嗎？\n其 ${n} 位成員不會被刪除，會變成「未分配」。`)) return
  guard(async () => {
    await store.deleteGuild(g.id)
    guilds.value = guilds.value.filter(x => x.id !== g.id)
    for (const m of members.value) if (m.guildId === g.id) m.guildId = null
    currentGuildId.value = guilds.value[0]?.id ?? null
  })
}
// 移動選取的成員到指定公會（null＝移出成「未分配」）
async function moveSelectedTo(e: Event) {
  const val = (e.target as HTMLSelectElement).value
  ;(e.target as HTMLSelectElement).value = ''            // 還原下拉，方便再次操作
  if (!selected.value.size) return
  const guildId = val === '__none__' ? null : val
  const ids = [...selected.value]
  guard(async () => {
    await store.moveMembers(ids, guildId)
    for (const m of members.value) if (selected.value.has(m.id)) m.guildId = guildId
    const gname = guildId ? (guilds.value.find(g => g.id === guildId)?.name ?? '') : '未分配'
    opInfo.value = `已將 ${ids.length} 位成員移動到「${gname}」。`
    clearSelection()
  })
}

// ── 成員 ─────────────────────────────────────────────────────────────────────
const newMemberName = ref('')
function addMember() {
  const name = newMemberName.value.trim()
  if (!name) return
  guard(async () => {
    const m = await store.addMember(name, currentGuildId.value, store.nextSort(members.value))
    members.value.push(m)
    newMemberName.value = ''
  })
}
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
  if (!confirm(`確定刪除成員「${m.name}」嗎？\n此人所有欄位的值、標籤、加減分會一併刪除。`)) return
  guard(async () => {
    await store.deleteMember(m.id)
    members.value = members.value.filter(x => x.id !== m.id)
    delete cells.value[m.id]
    delete memberTags.value[m.id]
    adjustments.value = adjustments.value.filter(a => a.memberId !== m.id)
    const next = new Set(selected.value); next.delete(m.id); selected.value = next
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

// ── 欄位：新增（手動）／點表頭設定角色 ───────────────────────────────────────
const showValues = ref(false)
const colMenuId = ref<string | null>(null)                 // 表頭點擊後開啟的「欄位設定」彈窗
const colMenu = computed(() => columns.value.find(c => c.id === colMenuId.value) ?? null)
function addColumn() {                                      // 手動新增一欄（不需匯入 Excel）；預設資訊欄
  const name = prompt('新增欄位名稱：')?.trim()
  if (!name) return
  guard(async () => {
    const c = await store.addColumn(name, 'info', 1, store.nextSort(columns.value))
    columns.value.push(c)
    colMenuId.value = c.id                                  // 新增後直接開設定，方便立刻選類型
  })
}
function delColFromMenu() {
  const c = colMenu.value
  if (!c) return
  colMenuId.value = null
  deleteColumn(c)
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
function setColRole(c: ContribColumn, role: ColumnRole) {
  if (role === c.role) return
  const prev = c.role
  c.role = role
  opError.value = ''
  store.updateColumn(c.id, { role }).catch(err => { c.role = prev; opError.value = msg(err) })
}
function onColWeight(c: ContribColumn, e: Event) {
  const w = Number((e.target as HTMLInputElement).value) || 0
  if (w === c.weight) return
  const prev = c.weight
  c.weight = w
  store.updateColumn(c.id, { weight: w }).catch(err => { c.weight = prev; opError.value = msg(err) })
}
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

// 標籤（text 型價值觀）
const newTagName = ref('')
const newTagScore = ref<number>(0)
function addTag() {
  const name = newTagName.value.trim()
  if (!name) return
  guard(async () => {
    const t = await store.addTag(name, Number(newTagScore.value) || 0, store.nextSort(tags.value))
    tags.value.push(t)
    newTagName.value = ''; newTagScore.value = 0
  })
}
function onTagName(t: Tag, e: Event) {
  const el = e.target as HTMLInputElement
  const v = el.value.trim()
  if (!v) { el.value = t.name; return }
  if (v === t.name) return
  const prev = t.name
  t.name = v
  store.updateTag(t.id, { name: v }).catch(err => { t.name = prev; el.value = prev; opError.value = msg(err) })
}
function onTagScore(t: Tag, e: Event) {
  const s = Number((e.target as HTMLInputElement).value) || 0
  if (s === t.score) return
  const prev = t.score
  t.score = s
  store.updateTag(t.id, { score: s }).catch(err => { t.score = prev; opError.value = msg(err) })
}
function deleteTag(t: Tag) {
  if (!confirm(`確定刪除標籤「${t.name}」嗎？\n所有成員身上的此標籤會一併移除。`)) return
  guard(async () => {
    await store.deleteTag(t.id)
    tags.value = tags.value.filter(x => x.id !== t.id)
    for (const mid in memberTags.value) memberTags.value[mid]?.delete(t.id)
    memberTags.value = { ...memberTags.value }
  })
}

// ── 給某成員套用／取消標籤（彈窗）────────────────────────────────────────────
const tagMemberId = ref<string | null>(null)
const tagMember = computed(() => members.value.find(m => m.id === tagMemberId.value) ?? null)
function toggleMemberTag(mid: string, t: Tag) {
  const has = hasTag(mid, t.id)
  const set = new Set(memberTags.value[mid] ?? [])
  has ? set.delete(t.id) : set.add(t.id)
  memberTags.value = { ...memberTags.value, [mid]: set }
  opError.value = ''
  store.setMemberTag(mid, t.id, !has).catch(err => {
    const revert = new Set(memberTags.value[mid] ?? [])
    has ? revert.add(t.id) : revert.delete(t.id)
    memberTags.value = { ...memberTags.value, [mid]: revert }
    opError.value = msg(err)
  })
}

// ── 成員專屬加減分（inline 備註）彈窗 ────────────────────────────────────────
const adjMemberId = ref<string | null>(null)
const adjMember = computed(() => members.value.find(m => m.id === adjMemberId.value) ?? null)
const newAdjLabel = ref('')
const newAdjPoints = ref<number>(0)
function addAdjustment() {
  const mid = adjMemberId.value
  if (!mid) return
  const label = newAdjLabel.value.trim()
  const points = Number(newAdjPoints.value) || 0
  if (!label && !points) return
  guard(async () => {
    const a = await store.addAdjustment(mid, label, points, store.nextSort(adjustments.value))
    adjustments.value.push(a)
    newAdjLabel.value = ''; newAdjPoints.value = 0
  })
}
function onAdjLabel(a: Adjustment, e: Event) {
  const v = (e.target as HTMLInputElement).value
  if (v === a.label) return
  const prev = a.label
  a.label = v
  store.updateAdjustment(a.id, { label: v }).catch(err => { a.label = prev; opError.value = msg(err) })
}
function onAdjPoints(a: Adjustment, e: Event) {
  const p = Number((e.target as HTMLInputElement).value) || 0
  if (p === a.points) return
  const prev = a.points
  a.points = p
  store.updateAdjustment(a.id, { points: p }).catch(err => { a.points = prev; opError.value = msg(err) })
}
function deleteAdjustment(a: Adjustment) {
  guard(async () => {
    await store.deleteAdjustment(a.id)
    adjustments.value = adjustments.value.filter(x => x.id !== a.id)
  })
}

// ── Excel 匯入／匯出 ─────────────────────────────────────────────────────────
const fileInput = ref<HTMLInputElement | null>(null)
const exportChoice = ref(false)
function onExport() {
  if (!members.value.length && !columns.value.length) { opError.value = '目前沒有資料可匯出。'; return }
  exportChoice.value = true
}
// mode='one' 全公會一份；'perGuild' 每公會各一份（cells/tags/... 以 memberId 索引，過濾 members 即可）。
async function doExport(mode: 'one' | 'perGuild') {
  exportChoice.value = false
  opError.value = ''; opInfo.value = ''
  const stamp = new Date().toISOString().slice(0, 10)
  const base = {
    guilds: guilds.value, columns: columns.value, cells: cells.value,
    tags: tags.value, memberTags: memberTags.value, adjustments: adjustments.value,
  }
  try {
    if (mode === 'one') {
      await exportExcel({ ...base, members: members.value }, `公會貢獻度_${stamp}.xlsx`)
    } else {
      const groups: { id: string | null; name: string }[] = guilds.value.map(g => ({ id: g.id, name: g.name }))
      if (members.value.some(m => !m.guildId)) groups.push({ id: null, name: '未分配' })
      let n = 0
      for (const grp of groups) {
        const gm = members.value.filter(m => m.guildId === grp.id)
        if (!gm.length) continue
        await exportExcel({ ...base, members: gm }, `公會貢獻度_${grp.name}_${stamp}.xlsx`)
        n++
        await new Promise(r => setTimeout(r, 200))          // 讓瀏覽器逐一觸發下載
      }
      opInfo.value = n ? `已分別匯出 ${n} 個公會的 Excel。` : '沒有含成員的公會可匯出。'
    }
  } catch (e) { opError.value = msg(e) }
}
function triggerImport() { fileInput.value?.click() }
async function onFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  importing.value = true; opError.value = ''; opInfo.value = ''
  try {
    const parsed = await parseExcel(file)
    const gname = currentGuild.value?.name ?? '（未分配）'
    const ok = confirm(
      `即將從「${file.name}」匯入到公會「${gname}」：\n・欄位 ${parsed.columns.length} 個\n・成員 ${parsed.rows.length} 位\n\n` +
      `所有欄位會先以「資訊欄」帶入（不計分）；之後點欄位標題把要計分的欄轉為價值觀即可。\n` +
      `匯入方式為「新增或更新」，不會刪除既有資料。確定匯入嗎？`,
    )
    if (!ok) return
    // 確保有可匯入的目標公會
    if (!currentGuildId.value) {
      const g = await store.addGuild('我的公會', store.nextSort(guilds.value))
      guilds.value.push(g); currentGuildId.value = g.id
    }
    const res = await store.importData(parsed, currentGuildId.value)
    await loadData()
    const hint = res.newColumns ? `，其中 ${res.newColumns} 個為新欄（皆為資訊欄，點欄位標題可轉為價值觀）` : ''
    opInfo.value = `匯入完成：新增 ${res.newMembers} 位成員、${res.newColumns} 個欄位，寫入 ${res.cells} 格資料${hint}。`
    if (res.newColumns) showValues.value = true
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
    if (!data.guilds.length) {                          // 全新帳號：種入預設公會與兩個基本價值觀
      await store.addGuild('我的公會', 0)
      await store.addColumns([
        { name: '公會戰參與次數', role: 'value', weight: 1, sort: 0 },
        { name: '寺錢捐贈', role: 'value', weight: 1, sort: 1 },
      ])
      data = await store.fetchAll()
    }
    guilds.value = data.guilds
    members.value = data.members
    columns.value = data.columns
    cells.value = data.cells
    tags.value = data.tags
    memberTags.value = data.memberTags
    adjustments.value = data.adjustments
    if (!currentGuildId.value || !guilds.value.some(g => g.id === currentGuildId.value)) {
      currentGuildId.value = guilds.value[0]?.id ?? null
    }
  } catch (e) {
    loadError.value = msg(e)
  } finally {
    loading.value = false
  }
}

async function doSignOut() { await signOut() }

watch(currentGuildId, () => clearSelection())
watch(user, (u) => {
  if (u) loadData()
  else {
    guilds.value = []; members.value = []; columns.value = []; cells.value = {}
    tags.value = []; memberTags.value = {}; adjustments.value = []
    currentGuildId.value = null; sortByScore.value = false; clearSelection()
  }
}, { immediate: true })
</script>

<template>
  <div class="cd">
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
        總分＝<b>價值觀欄</b>（值×權重）＋<b>標籤</b>（擁有得分）＋<b>專屬加減分</b>。
        匯入的欄一律先為<span class="tag-info">資訊欄</span>（不計分），<b>點欄位標題</b>轉為<span class="tag-value">價值觀</span>才開始計分。
      </div>

      <div v-if="opError" class="op-bar err"><span>操作失敗：{{ opError }}</span><button @click="opError = ''">✕</button></div>
      <div v-if="opInfo" class="op-bar ok"><span>{{ opInfo }}</span><button @click="opInfo = ''">✕</button></div>

      <!-- 公會列 -->
      <div class="guild-bar">
        <span class="gb-label">公會</span>
        <div class="gb-tabs">
          <button v-for="g in guilds" :key="g.id" class="gb-tab" :class="{ on: g.id === currentGuildId }"
            @click="currentGuildId = g.id">
            {{ g.name }}
            <span class="gb-tab-n">{{ members.filter(m => m.guildId === g.id).length }}</span>
          </button>
          <button v-if="members.some(m => !m.guildId)" class="gb-tab" :class="{ on: currentGuildId === null }"
            @click="currentGuildId = null">
            未分配 <span class="gb-tab-n">{{ members.filter(m => !m.guildId).length }}</span>
          </button>
        </div>
        <div class="gb-actions">
          <button class="gb-btn" @click="addGuild">＋公會</button>
          <button class="gb-btn" :disabled="!currentGuild" @click="renameGuild">改名</button>
          <button class="gb-btn danger" :disabled="!currentGuild" @click="deleteGuild">刪除</button>
        </div>
      </div>

      <!-- 選取操作列 -->
      <Transition name="slide">
        <div v-if="selected.size" class="sel-bar">
          <span class="sel-n">已選取 <b>{{ selected.size }}</b> 位</span>
          <span class="sel-hint">（按住 Shift 點選可範圍多選）</span>
          <label class="sel-move">移動到
            <select class="sel-sel" @change="moveSelectedTo">
              <option value="">選擇公會⋯</option>
              <option v-for="g in guilds" :key="g.id" :value="g.id" :disabled="g.id === currentGuildId">{{ g.name }}</option>
              <option value="__none__">未分配</option>
            </select>
          </label>
          <button class="sel-clear" @click="clearSelection">取消選取</button>
        </div>
      </Transition>

      <!-- 工具列 -->
      <div class="cd-tools">
        <div class="cd-tools-l">
          <span class="cd-title">{{ currentGuild?.name ?? '未分配成員' }}</span>
          <span class="cd-count">{{ displayMembers.length }} 人 · {{ columns.length }} 欄 · {{ tags.length }} 標籤</span>
        </div>
        <div class="cd-tools-r">
          <label class="cd-sort"><input type="checkbox" v-model="sortByScore" />依總分排序</label>
          <button class="cd-tbtn" @click="addColumn">＋ 欄位</button>
          <button class="cd-tbtn" :class="{ on: showValues }" @click="showValues = !showValues">⚙ 價值觀管理</button>
          <button class="cd-tbtn" :disabled="importing" @click="triggerImport">{{ importing ? '匯入中⋯' : '⬆ 匯入 Excel' }}</button>
          <button class="cd-tbtn gold" @click="onExport">⬇ 匯出 Excel</button>
          <input ref="fileInput" type="file" accept=".xlsx,.xls,.csv" class="cd-file" @change="onFile" />
        </div>
      </div>

      <!-- 價值觀管理面板 -->
      <Transition name="slide">
        <div v-if="showValues" class="vp">
          <!-- 價值觀（計分欄位）：此處只列價值觀，不顯示資訊欄 -->
          <div class="vp-sec">
            <div class="vp-h"><span class="vp-title">價值觀（計分欄位）</span>
              <span class="vp-note">分數＝值×權重；在表格<b>點欄位標題</b>可把<span class="tag-info">資訊欄</span>轉為<span class="tag-value">價值觀</span></span></div>
            <div class="vp-list">
              <div v-for="c in valueColumns" :key="c.id" class="vp-row value">
                <input class="vp-inp name" :value="c.name" maxlength="30" @change="onColName(c, $event)" />
                <label class="vp-wlbl">權重
                  <input class="vp-w" type="number" step="any" :value="c.weight" @change="onColWeight(c, $event)" />
                </label>
                <button class="vp-mini" title="改回資訊欄（不計分）" @click="setColRole(c, 'info')">改為資訊欄</button>
                <button class="vp-del" @click="deleteColumn(c)">刪除</button>
              </div>
              <div v-if="!valueColumns.length" class="vp-empty">尚無價值觀欄位。到表格點欄位標題選「價值觀」即可啟用計分。</div>
            </div>
          </div>
          <!-- 標籤 -->
          <div class="vp-sec">
            <div class="vp-h"><span class="vp-title">標籤（text 型價值觀）</span>
              <span class="vp-note">布林擁有，擁有即得分（可負）；在成員列的「標籤」欄套用</span></div>
            <div class="vp-add">
              <input v-model="newTagName" class="vp-inp" placeholder="標籤名稱，例：全勤" maxlength="20" @keydown.enter="addTag" />
              <input v-model.number="newTagScore" class="vp-w" type="number" step="any" title="分數" placeholder="分數" />
              <button class="vp-add-btn" @click="addTag">＋ 新增標籤</button>
            </div>
            <div class="vp-list">
              <div v-for="t in tags" :key="t.id" class="vp-row tag">
                <span class="tag-chip">🏷 <input class="vp-inp name" :value="t.name" maxlength="20" @change="onTagName(t, $event)" /></span>
                <label class="vp-wlbl">分數
                  <input class="vp-w" type="number" step="any" :value="t.score" @change="onTagScore(t, $event)" />
                </label>
                <button class="vp-del" @click="deleteTag(t)">刪除</button>
              </div>
              <div v-if="!tags.length" class="vp-empty">尚無標籤，於上方新增。</div>
            </div>
          </div>
        </div>
      </Transition>

      <!-- 表格操作提示 -->
      <div class="tbl-hint">
        ☑ 勾選成員可批次移動公會；<b>按住 Shift</b> 點選能一次範圍多選。
        點<b>欄位標題</b>可切換<span class="tag-info">資訊欄</span>／<span class="tag-value">價值觀</span>；用「＋ 欄位」新增欄。
      </div>

      <!-- 試算表 -->
      <div class="cd-table-wrap">
        <table class="cd-table">
          <thead>
            <tr>
              <th class="c-chk"><button class="chk" :class="{ on: allChecked, part: someChecked }" title="全選／取消所有" @click="toggleAll"></button></th>
              <th class="c-no">#</th>
              <th class="c-name">簡稱</th>
              <th v-for="c in columns" :key="c.id" class="c-col th-clickable" :class="c.role"
                :title="'點擊設定欄位「' + c.name + '」（資訊欄／價值觀）'" @click="colMenuId = c.id">
                <div class="th-in">
                  <span class="th-name">{{ c.name }}</span>
                  <span v-if="c.role === 'value'" class="th-w" title="價值觀：分數＝值×權重">×{{ c.weight }}</span>
                  <span v-else class="th-t">資訊</span>
                  <span class="th-gear">⚙</span>
                </div>
              </th>
              <th class="c-tags">標籤</th>
              <th class="c-adj">加減分</th>
              <th class="c-total">總分</th>
              <th class="c-act"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="!displayMembers.length">
              <td :colspan="columns.length + 7" class="cd-empty">此公會尚無成員 —— 於下方新增，或用「匯入 Excel」批次帶入。</td>
            </tr>
            <tr v-for="(m, i) in displayMembers" :key="m.id" :class="{ sel: isSel(m.id) }">
              <td class="c-chk"><button class="chk" :class="{ on: isSel(m.id) }" title="點選以選取；按住 Shift 可一次範圍多選" @click="onCheck(i, $event)"></button></td>
              <td class="c-no">{{ i + 1 }}</td>
              <td class="c-name"><input class="cell-inp name" :value="m.name" @change="onMemberName(m, $event)" /></td>
              <td v-for="c in columns" :key="c.id" class="c-col" :class="c.role">
                <input class="cell-inp" :value="cellVal(m, c)" @change="onCell(m, c, $event)" />
              </td>
              <td class="c-tags">
                <div class="tags-cell" @click="tagMemberId = m.id">
                  <span v-for="t in ownedTags(m.id)" :key="t.id" class="tag-pill">{{ t.name }}</span>
                  <span class="tags-add">＋</span>
                </div>
              </td>
              <td class="c-adj">
                <button class="adj-btn" :class="{ pos: adjSum(m.id) > 0, neg: adjSum(m.id) < 0 }" @click="adjMemberId = m.id">
                  {{ adjSum(m.id) > 0 ? '+' : '' }}{{ fmt(adjSum(m.id)) }}
                  <span class="adj-n" v-if="adjOf(m.id).length">({{ adjOf(m.id).length }})</span>
                </button>
              </td>
              <td class="c-total"><span class="total-badge">{{ fmt(totalOf(m)) }}</span></td>
              <td class="c-act"><button class="row-del" title="刪除成員" @click="deleteMember(m)">✕</button></td>
            </tr>
          </tbody>
        </table>
      </div>

      <!-- 新增成員 -->
      <div class="cd-addrow">
        <input v-model="newMemberName" class="cd-add-inp" placeholder="新增成員（簡稱）⋯" maxlength="30" @keydown.enter="addMember" />
        <button class="cd-add-btn" @click="addMember">＋ 新增成員</button>
      </div>
    </template>

    <!-- 標籤套用彈窗 -->
    <div v-if="tagMember" class="modal-mask" @click.self="tagMemberId = null">
      <div class="modal">
        <div class="modal-h"><span>「{{ tagMember.name }}」的標籤</span><button @click="tagMemberId = null">✕</button></div>
        <div class="modal-body">
          <label v-for="t in tags" :key="t.id" class="tag-opt">
            <input type="checkbox" :checked="hasTag(tagMember.id, t.id)" @change="toggleMemberTag(tagMember!.id, t)" />
            <span class="tag-opt-name">{{ t.name }}</span>
            <span class="tag-opt-score" :class="{ neg: t.score < 0 }">{{ t.score > 0 ? '+' : '' }}{{ t.score }}</span>
          </label>
          <div v-if="!tags.length" class="modal-empty">尚無標籤。請到「價值觀管理 → 標籤」新增。</div>
        </div>
      </div>
    </div>

    <!-- 專屬加減分彈窗 -->
    <div v-if="adjMember" class="modal-mask" @click.self="adjMemberId = null">
      <div class="modal">
        <div class="modal-h"><span>「{{ adjMember.name }}」的專屬加減分</span><button @click="adjMemberId = null">✕</button></div>
        <div class="modal-body">
          <div class="adj-add">
            <input v-model="newAdjLabel" class="adj-inp" placeholder="事由，例：協助新人" maxlength="40" @keydown.enter="addAdjustment" />
            <input v-model.number="newAdjPoints" class="adj-pts" type="number" step="any" placeholder="±分數" @keydown.enter="addAdjustment" />
            <button class="adj-add-btn" @click="addAdjustment">＋ 新增</button>
          </div>
          <div class="adj-list">
            <div v-for="a in adjOf(adjMember.id)" :key="a.id" class="adj-item">
              <input class="adj-inp" :value="a.label" maxlength="40" @change="onAdjLabel(a, $event)" />
              <input class="adj-pts" type="number" step="any" :value="a.points" @change="onAdjPoints(a, $event)" />
              <button class="adj-del" @click="deleteAdjustment(a)">✕</button>
            </div>
            <div v-if="!adjOf(adjMember.id).length" class="modal-empty">尚無加減分項目。</div>
          </div>
          <div class="adj-sum">小計：<b :class="{ pos: adjSum(adjMember.id) > 0, neg: adjSum(adjMember.id) < 0 }">
            {{ adjSum(adjMember.id) > 0 ? '+' : '' }}{{ fmt(adjSum(adjMember.id)) }}</b></div>
        </div>
      </div>
    </div>

    <!-- 欄位設定彈窗（點表頭開啟）-->
    <div v-if="colMenu" class="modal-mask" @click.self="colMenuId = null">
      <div class="modal">
        <div class="modal-h"><span>欄位設定</span><button @click="colMenuId = null">✕</button></div>
        <div class="modal-body">
          <label class="cm-field">欄位名稱
            <input class="adj-inp" :value="colMenu.name" maxlength="30" @change="onColName(colMenu!, $event)" />
          </label>
          <div class="cm-field">類型
            <div class="role-seg wide">
              <button :class="{ on: colMenu.role === 'info' }" @click="setColRole(colMenu!, 'info')">資訊欄（不計分）</button>
              <button :class="{ on: colMenu.role === 'value' }" @click="setColRole(colMenu!, 'value')">價值觀（計分）</button>
            </div>
          </div>
          <label v-if="colMenu.role === 'value'" class="cm-field">權重（分數＝值×權重）
            <input class="adj-pts" type="number" step="any" :value="colMenu.weight" @change="onColWeight(colMenu!, $event)" />
          </label>
          <div class="cm-actions">
            <button class="vp-mini" @click="moveColumn(colMenu!, -1)">◀ 左移</button>
            <button class="vp-mini" @click="moveColumn(colMenu!, 1)">右移 ▶</button>
            <button class="vp-del" @click="delColFromMenu">刪除此欄</button>
          </div>
        </div>
      </div>
    </div>

    <!-- 匯出方式選擇彈窗 -->
    <div v-if="exportChoice" class="modal-mask" @click.self="exportChoice = false">
      <div class="modal">
        <div class="modal-h"><span>匯出 Excel</span><button @click="exportChoice = false">✕</button></div>
        <div class="modal-body">
          <p class="xc-desc">要如何匯出？</p>
          <button class="xc-opt" @click="doExport('one')">
            <b>全部公會匯出成一份</b><span>所有成員在同一張表，含「公會」欄</span>
          </button>
          <button class="xc-opt" @click="doExport('perGuild')">
            <b>每個公會各自一份</b><span>依公會分別下載多個 Excel 檔</span>
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cd { min-height: 560px; display: flex; flex-direction: column; }

/* 前置狀態 */
.cd-state { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 60px 20px; min-height: 420px; color: var(--text3); font-size: 0.95rem; }
.cd-state.err { color: var(--red); }
.cd-spinner { width: 34px; height: 34px; border-radius: 50%; border: 3px solid var(--border2); border-top-color: var(--gold); animation: cd-spin 0.8s linear infinite; }
@keyframes cd-spin { to { transform: rotate(360deg); } }
.cd-retry { padding: 8px 22px; border-radius: 20px; border: 1px solid var(--gold); background: transparent; color: var(--gold); font-size: 0.88rem; font-weight: 700; font-family: inherit; cursor: pointer; }
.cd-retry:hover { background: rgba(244,192,48,0.12); }

/* 帳號列 */
.acct-bar { display: flex; align-items: center; gap: 8px; padding: 8px 18px; background: rgba(0,0,0,0.22); border-bottom: 1px solid var(--border); }
.acct-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--green); box-shadow: 0 0 8px rgba(82,183,136,0.6); flex-shrink: 0; }
.acct-email { font-size: 0.8rem; color: var(--text2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.acct-out { margin-left: auto; padding: 4px 14px; border-radius: 8px; border: 1px solid var(--border2); background: var(--surface2); color: var(--text3); font-size: 0.78rem; font-weight: 600; font-family: inherit; cursor: pointer; transition: all 0.12s; white-space: nowrap; }
.acct-out:hover { color: var(--red); border-color: var(--red); }

/* 說明 */
.cd-intro { display: flex; align-items: flex-start; gap: 8px; margin: 12px 18px 0; padding: 10px 12px; background: rgba(244,192,48,0.06); border: 1px solid rgba(244,192,48,0.22); border-radius: var(--radius); font-size: 0.78rem; color: var(--text2); line-height: 1.6; }
.cd-intro b { color: var(--gold); font-weight: 700; }
.cd-intro-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--gold); flex-shrink: 0; margin-top: 6px; box-shadow: 0 0 6px rgba(244,192,48,0.5); }
.tag-info { color: var(--text2); background: var(--surface2); border: 1px solid var(--border2); border-radius: 6px; padding: 0 5px; font-weight: 700; }
.tag-value { color: var(--gold); background: rgba(244,192,48,0.12); border: 1px solid rgba(244,192,48,0.35); border-radius: 6px; padding: 0 5px; font-weight: 700; }

/* 提示條 */
.op-bar { display: flex; align-items: center; gap: 10px; margin: 10px 18px 0; padding: 8px 12px; border-radius: var(--radius); font-size: 0.82rem; }
.op-bar span { flex: 1; min-width: 0; line-height: 1.4; }
.op-bar button { border: none; background: transparent; font-size: 0.9rem; cursor: pointer; font-family: inherit; flex-shrink: 0; }
.op-bar.err { background: rgba(230,70,70,0.1); border: 1px solid rgba(230,70,70,0.35); color: var(--red); }
.op-bar.err button { color: var(--red); }
.op-bar.ok { background: rgba(82,183,136,0.1); border: 1px solid rgba(82,183,136,0.35); color: var(--green); }
.op-bar.ok button { color: var(--green); }

/* 公會列 */
.guild-bar { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 12px 18px; margin-top: 10px; background: rgba(0,0,0,0.16); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
.gb-label { font-size: 0.76rem; color: var(--text3); font-weight: 700; }
.gb-tabs { display: flex; gap: 6px; flex-wrap: wrap; flex: 1; min-width: 0; }
.gb-tab { display: inline-flex; align-items: center; gap: 6px; padding: 5px 12px; border-radius: 16px; border: 1px solid var(--border2); background: var(--surface2); color: var(--text2); font-size: 0.82rem; font-weight: 600; font-family: inherit; cursor: pointer; transition: all 0.12s; }
.gb-tab:hover { color: var(--text); border-color: var(--text3); }
.gb-tab.on { color: var(--gold); border-color: var(--gold); background: rgba(244,192,48,0.1); }
.gb-tab-n { font-size: 0.68rem; background: rgba(0,0,0,0.3); border-radius: 8px; padding: 0 6px; color: var(--text3); }
.gb-tab.on .gb-tab-n { color: var(--gold); }
.gb-actions { display: flex; gap: 6px; }
.gb-btn { padding: 5px 12px; border-radius: 8px; border: 1px solid var(--border2); background: var(--surface2); color: var(--text2); font-size: 0.78rem; font-weight: 600; font-family: inherit; cursor: pointer; transition: all 0.12s; }
.gb-btn:hover:not(:disabled) { color: var(--text); border-color: var(--text3); }
.gb-btn.danger:hover:not(:disabled) { color: var(--red); border-color: var(--red); }
.gb-btn:disabled { opacity: 0.4; cursor: not-allowed; }

/* 選取操作列 */
.sel-bar { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 10px 18px; background: rgba(244,192,48,0.08); border-bottom: 1px solid rgba(244,192,48,0.25); font-size: 0.82rem; color: var(--text2); }
.sel-n b { color: var(--gold); }
.sel-hint { color: var(--text3); font-size: 0.74rem; }
.sel-move { display: flex; align-items: center; gap: 6px; margin-left: auto; }
.sel-sel { background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 0.8rem; padding: 5px 8px; font-family: inherit; cursor: pointer; }
.sel-clear { padding: 5px 12px; border-radius: 8px; border: 1px solid var(--border2); background: transparent; color: var(--text3); font-size: 0.78rem; font-family: inherit; cursor: pointer; }
.sel-clear:hover { color: var(--text); border-color: var(--text3); }

/* 工具列 */
.cd-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px; padding: 14px 18px; background: linear-gradient(135deg, #11101c, #15131f); border-bottom: 1px solid var(--border2); }
.cd-tools-l { display: flex; align-items: baseline; gap: 10px; margin-right: auto; }
.cd-title { font-size: 1.02rem; font-weight: 800; color: var(--text); }
.cd-count { font-size: 0.76rem; color: var(--text3); }
.cd-tools-r { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cd-sort { display: flex; align-items: center; gap: 5px; font-size: 0.8rem; color: var(--text2); cursor: pointer; user-select: none; margin-right: 2px; }
.cd-tbtn { padding: 7px 14px; border-radius: 8px; border: 1px solid var(--border2); background: var(--surface2); color: var(--text2); font-size: 0.82rem; font-weight: 600; font-family: inherit; cursor: pointer; transition: all 0.14s; white-space: nowrap; }
.cd-tbtn:hover:not(:disabled) { color: var(--text); border-color: var(--text3); }
.cd-tbtn.on { color: var(--gold); border-color: var(--gold); }
.cd-tbtn.gold { color: var(--gold); border-color: rgba(244,192,48,0.5); background: rgba(244,192,48,0.08); }
.cd-tbtn.gold:hover { background: rgba(244,192,48,0.16); }
.cd-tbtn:disabled { opacity: 0.5; cursor: not-allowed; }
.cd-file { display: none; }

/* 價值觀管理面板 */
.vp { background: var(--surface); border-bottom: 1px solid var(--border2); padding: 14px 18px; overflow: hidden; display: flex; flex-direction: column; gap: 16px; }
.vp-sec { display: flex; flex-direction: column; gap: 8px; }
.vp-h { display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; }
.vp-title { font-size: 0.9rem; font-weight: 800; color: var(--text); }
.vp-note { font-size: 0.72rem; color: var(--text3); }
.vp-add { display: flex; flex-wrap: wrap; gap: 8px; }
.vp-inp { min-width: 0; background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); font-size: 0.86rem; padding: 7px 10px; outline: none; font-family: inherit; transition: border-color 0.15s; }
.vp-inp:focus { border-color: var(--gold); }
.vp-add .vp-inp { flex: 1; min-width: 160px; }
.vp-inp.name { width: 200px; flex: 0 1 200px; }
.vp-w { width: 84px; background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); font-size: 0.86rem; padding: 7px 8px; outline: none; font-family: inherit; text-align: right; }
.vp-w:focus { border-color: var(--gold); }
.vp-add-btn { padding: 7px 14px; border-radius: var(--radius); border: 1px solid rgba(244,192,48,0.4); background: rgba(244,192,48,0.08); color: var(--gold); font-size: 0.84rem; font-weight: 600; font-family: inherit; cursor: pointer; white-space: nowrap; transition: all 0.15s; }
.vp-add-btn:hover { background: rgba(244,192,48,0.16); }
.vp-list { display: flex; flex-direction: column; gap: 7px; }
.vp-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; background: var(--surface2); border: 1px solid var(--border); border-left: 3px solid var(--border2); border-radius: var(--radius); padding: 6px 10px; }
.vp-row.info { border-left-color: var(--text3); }
.vp-row.value { border-left-color: var(--gold); background: rgba(244,192,48,0.05); }
.vp-row.tag { border-left-color: var(--green); background: rgba(82,183,136,0.05); }
.role-seg { display: inline-flex; border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
.role-seg button { padding: 5px 10px; border: none; background: transparent; color: var(--text3); font-size: 0.76rem; font-weight: 700; font-family: inherit; cursor: pointer; }
.role-seg button.on { background: rgba(244,192,48,0.18); color: var(--gold); }
.role-seg button:first-child.on { background: var(--surface); color: var(--text); }
.vp-wlbl { display: flex; align-items: center; gap: 5px; font-size: 0.76rem; color: var(--text3); }
.vp-wnote { font-size: 0.76rem; color: var(--text3); font-style: italic; }
.vp-move { display: flex; gap: 3px; margin-left: auto; }
.vp-move button { width: 26px; height: 26px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--text3); font-size: 0.72rem; cursor: pointer; font-family: inherit; }
.vp-move button:hover:not(:disabled) { border-color: var(--text3); color: var(--text); }
.vp-move button:disabled { opacity: 0.3; cursor: not-allowed; }
.vp-del { padding: 5px 12px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--text3); font-size: 0.78rem; cursor: pointer; font-family: inherit; transition: all 0.12s; }
.vp-del:hover { border-color: var(--red); color: var(--red); }
.vp-empty { font-size: 0.82rem; color: var(--text3); padding: 6px 2px; }
.tag-chip { display: inline-flex; align-items: center; gap: 4px; }

.slide-enter-active, .slide-leave-active { transition: all 0.25s ease; }
.slide-enter-from, .slide-leave-to { opacity: 0; transform: translateY(-8px); }

/* 表格操作提示 */
.tbl-hint { margin: 12px 18px 0; padding: 7px 12px; background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius); font-size: 0.74rem; color: var(--text3); line-height: 1.6; }
.tbl-hint b { color: var(--gold); font-weight: 700; }

/* 試算表 */
.cd-table-wrap { overflow-x: auto; padding: 14px 18px 0; }
.cd-table { border-collapse: separate; border-spacing: 0; width: 100%; font-size: 0.86rem; }
.cd-table th, .cd-table td { border-bottom: 1px solid var(--border); border-right: 1px solid var(--border); white-space: nowrap; }
.cd-table th:first-child, .cd-table td:first-child { border-left: 1px solid var(--border); }
.cd-table thead th { border-top: 1px solid var(--border); }
.cd-table th { background: var(--surface2); padding: 8px 10px; text-align: left; font-weight: 700; color: var(--text2); position: sticky; top: 0; z-index: 2; }
.th-in { display: flex; align-items: center; gap: 6px; }
.th-name { max-width: 160px; overflow: hidden; text-overflow: ellipsis; }
.th-w { font-size: 0.68rem; font-weight: 800; color: var(--gold); background: rgba(244,192,48,0.12); border: 1px solid rgba(244,192,48,0.3); border-radius: 8px; padding: 0 6px; }
.th-t { font-size: 0.66rem; color: var(--text3); border: 1px solid var(--border2); border-radius: 8px; padding: 0 6px; }
.c-chk { width: 40px; text-align: center; padding: 0; }
/* 自製核取方塊：配合網站金色主題，取代突兀的原生 checkbox */
.chk { width: 18px; height: 18px; border-radius: 5px; border: 1.5px solid var(--border2); background: var(--surface2); cursor: pointer; padding: 0; position: relative; vertical-align: middle; transition: all 0.12s; }
.chk:hover { border-color: var(--gold); }
.chk.on { background: var(--gold); border-color: var(--gold); }
.chk.on::after { content: '✓'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 900; color: #14101c; line-height: 1; }
.chk.part { background: rgba(244,192,48,0.22); border-color: var(--gold); }
.chk.part::after { content: '–'; position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; font-size: 14px; font-weight: 900; color: var(--gold); }
/* 表頭可點：切換資訊欄／價值觀 */
.th-clickable { cursor: pointer; user-select: none; }
.th-clickable:hover { color: var(--gold); }
.th-gear { opacity: 0; font-size: 0.68rem; color: var(--text3); transition: opacity 0.12s; }
.th-clickable:hover .th-gear { opacity: 1; }
.c-no { width: 40px; text-align: center; color: var(--text3); }
td.c-no { text-align: center; color: var(--text3); font-size: 0.8rem; }
.c-name { min-width: 110px; }
.c-tags { min-width: 120px; }
.c-adj { width: 92px; text-align: center; }
.c-total { width: 84px; text-align: right; background: rgba(244,192,48,0.05); }
.c-act { width: 40px; }
/* 欄位顏色：資訊欄中性、價值觀金色 */
th.c-col.value { background: rgba(244,192,48,0.1); color: var(--gold); }
th.c-col.info { color: var(--text3); }
td.c-col.value { background: rgba(244,192,48,0.04); }

.cd-table td { padding: 0; background: var(--bg); }
.cd-table tr.sel td { background: rgba(244,192,48,0.07); }
.cd-table td.c-total { padding: 6px 10px; text-align: right; }
.cell-inp { width: 100%; min-width: 72px; border: none; background: transparent; color: var(--text); font-size: 0.86rem; padding: 8px 10px; outline: none; font-family: inherit; }
.cell-inp.name { font-weight: 700; }
.c-col.value .cell-inp { text-align: right; color: var(--gold); }
.cell-inp:focus { background: rgba(244,192,48,0.08); box-shadow: inset 0 0 0 1px var(--gold); }
.total-badge { font-weight: 800; color: var(--gold); font-size: 0.92rem; }
.row-del { width: 26px; height: 26px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--text3); font-size: 0.78rem; cursor: pointer; font-family: inherit; transition: all 0.12s; display: flex; align-items: center; justify-content: center; margin: 4px auto; }
.row-del:hover { border-color: var(--red); color: var(--red); }
.cd-empty { padding: 20px; text-align: center; color: var(--text3); font-size: 0.9rem; background: var(--bg); }

/* 標籤欄 */
.tags-cell { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; padding: 6px 8px; cursor: pointer; min-height: 34px; }
.tag-pill { font-size: 0.72rem; color: var(--green); background: rgba(82,183,136,0.12); border: 1px solid rgba(82,183,136,0.35); border-radius: 10px; padding: 1px 8px; white-space: nowrap; }
.tags-add { font-size: 0.8rem; color: var(--text3); border: 1px dashed var(--border2); border-radius: 10px; padding: 0 7px; }
.tags-cell:hover .tags-add { color: var(--gold); border-color: var(--gold); }

/* 加減分欄 */
.c-adj { padding: 4px; }
.adj-btn { width: 100%; padding: 6px 8px; border-radius: 8px; border: 1px solid var(--border); background: transparent; color: var(--text3); font-size: 0.82rem; font-weight: 700; font-family: inherit; cursor: pointer; transition: all 0.12s; }
.adj-btn:hover { border-color: var(--text3); color: var(--text); }
.adj-btn.pos { color: var(--green); border-color: rgba(82,183,136,0.4); }
.adj-btn.neg { color: var(--red); border-color: rgba(230,70,70,0.4); }
.adj-n { font-size: 0.68rem; opacity: 0.7; }

/* 新增成員列 */
.cd-addrow { display: flex; gap: 8px; padding: 12px 18px 20px; max-width: 460px; }
.cd-add-inp { flex: 1; min-width: 0; background: var(--surface2); border: 1px solid var(--border); border-radius: var(--radius); color: var(--text); font-size: 0.9rem; padding: 9px 12px; outline: none; font-family: inherit; transition: border-color 0.15s; }
.cd-add-inp:focus { border-color: var(--gold); }
.cd-add-btn { padding: 9px 16px; border-radius: var(--radius); border: 1px solid rgba(244,192,48,0.4); background: rgba(244,192,48,0.08); color: var(--gold); font-size: 0.86rem; font-weight: 600; font-family: inherit; cursor: pointer; white-space: nowrap; transition: all 0.15s; }
.cd-add-btn:hover { background: rgba(244,192,48,0.16); }

/* 彈窗 */
.modal-mask { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
.modal { width: 100%; max-width: 420px; max-height: 80vh; display: flex; flex-direction: column; background: var(--surface); border: 1px solid var(--border2); border-radius: 14px; overflow: hidden; box-shadow: 0 12px 40px rgba(0,0,0,0.5); }
.modal-h { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; background: var(--surface2); border-bottom: 1px solid var(--border); font-size: 0.9rem; font-weight: 800; color: var(--text); }
.modal-h button { border: none; background: transparent; color: var(--text3); font-size: 1rem; cursor: pointer; font-family: inherit; }
.modal-h button:hover { color: var(--red); }
.modal-body { padding: 14px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
.modal-empty { font-size: 0.82rem; color: var(--text3); padding: 8px 2px; text-align: center; }
.tag-opt { display: flex; align-items: center; gap: 10px; padding: 8px 10px; border: 1px solid var(--border); border-radius: 8px; cursor: pointer; }
.tag-opt:hover { border-color: var(--text3); }
.tag-opt-name { flex: 1; font-size: 0.86rem; color: var(--text); }
.tag-opt-score { font-size: 0.8rem; font-weight: 800; color: var(--green); }
.tag-opt-score.neg { color: var(--red); }
.adj-add { display: flex; gap: 6px; margin-bottom: 6px; }
.adj-inp { flex: 1; min-width: 0; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 0.84rem; padding: 7px 9px; outline: none; font-family: inherit; }
.adj-inp:focus { border-color: var(--gold); }
.adj-pts { width: 76px; background: var(--surface2); border: 1px solid var(--border); border-radius: 8px; color: var(--text); font-size: 0.84rem; padding: 7px 8px; outline: none; font-family: inherit; text-align: right; }
.adj-pts:focus { border-color: var(--gold); }
.adj-add-btn { padding: 7px 12px; border-radius: 8px; border: 1px solid rgba(244,192,48,0.4); background: rgba(244,192,48,0.08); color: var(--gold); font-size: 0.8rem; font-weight: 700; font-family: inherit; cursor: pointer; white-space: nowrap; }
.adj-add-btn:hover { background: rgba(244,192,48,0.16); }
.adj-list { display: flex; flex-direction: column; gap: 6px; }
.adj-item { display: flex; gap: 6px; align-items: center; }
.adj-del { width: 28px; height: 30px; border-radius: 8px; border: 1px solid var(--border); background: transparent; color: var(--text3); font-size: 0.8rem; cursor: pointer; font-family: inherit; flex-shrink: 0; }
.adj-del:hover { border-color: var(--red); color: var(--red); }
.adj-sum { margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--border); text-align: right; font-size: 0.84rem; color: var(--text2); }
.adj-sum b { color: var(--text); }
.adj-sum b.pos { color: var(--green); }
.adj-sum b.neg { color: var(--red); }

/* 欄位管理小按鈕（vp 面板／欄位設定彈窗共用）*/
.vp-mini { padding: 5px 10px; border-radius: 6px; border: 1px solid var(--border); background: transparent; color: var(--text2); font-size: 0.76rem; font-family: inherit; cursor: pointer; transition: all 0.12s; }
.vp-mini:hover { border-color: var(--text3); color: var(--text); }

/* 欄位設定彈窗 */
.cm-field { display: flex; flex-direction: column; gap: 6px; font-size: 0.8rem; color: var(--text2); }
.cm-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 6px; }
.role-seg.wide { display: flex; width: 100%; }
.role-seg.wide button { flex: 1; padding: 8px 6px; }

/* 匯出選擇彈窗 */
.xc-desc { font-size: 0.86rem; color: var(--text2); margin-bottom: 2px; }
.xc-opt { display: flex; flex-direction: column; gap: 2px; align-items: flex-start; text-align: left; padding: 12px 14px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface2); cursor: pointer; font-family: inherit; transition: all 0.12s; }
.xc-opt:hover { border-color: var(--gold); background: rgba(244,192,48,0.06); }
.xc-opt b { color: var(--text); font-size: 0.9rem; }
.xc-opt span { color: var(--text3); font-size: 0.76rem; }

@media (max-width: 600px) {
  .cd-intro, .op-bar { margin-left: 12px; margin-right: 12px; }
  .cd-tools { padding: 12px; }
  .cd-tools-l { width: 100%; }
  .cd-table-wrap { padding: 12px 12px 0; }
  .cd-addrow { padding: 12px; }
  .guild-bar { padding: 10px 12px; }
}
</style>
