<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import LoginForm from './LoginForm.vue'
import { user, userEmail, authReady, signOut } from '../auth/auth'
import * as store from '../luckydraw/store'
import type { Member, Season, Winner, BagKey, SeasonBag, WinnersMap } from '../luckydraw/store'
import { readLocalData, hasMeaningfulLocalData, alreadyImported, markImported } from '../luckydraw/local'

const ACTIVE_SEASON_NAME_KEY = 'nindou-active-season-name'   // 以「季度名稱」記住選擇（跨裝置也適用）

// ── 雲端資料狀態（登入後由 Supabase 載入；未登入為空）────────────────────────
// 三份 ref 就是畫面的單一資料來源，所有寫入都先打 store（雲端）成功再更新本地。
const members = ref<Member[]>([])
const seasons = ref<Season[]>([])
const winners = ref<WinnersMap>({})

const loading = ref(false)
const loadError = ref('')
const opError = ref('')   // 單筆操作（新增／刪除／改名等）失敗提示

// 包住每個會寫入雲端的動作：失敗時顯示提示，不讓例外中斷整個畫面。
async function guard(fn: () => Promise<void>) {
  opError.value = ''
  try { await fn() } catch (e) { opError.value = e instanceof Error ? e.message : String(e) }
}

// ── MEMBERS（籤庫／公會成員，全季度共用）─────────────────────────────────────
const newMemberText = ref('')
const editMemberId = ref<string | null>(null)
const editMemberText = ref('')

function addMember() {
  const text = newMemberText.value.trim()
  if (!text) return
  guard(async () => {
    const m = await store.addMember(text)
    members.value.push(m)
    newMemberText.value = ''
  })
}
function startEditMember(m: Member) { editMemberId.value = m.id; editMemberText.value = m.text }
function saveEditMember() {
  const m = members.value.find(x => x.id === editMemberId.value)
  const text = editMemberText.value.trim()
  editMemberId.value = null
  if (!m || !text) return
  guard(async () => { await store.renameMember(m.id, text); m.text = text })
}
function deleteMember(m: Member) {
  if (!confirm(`確定要從公會成員（籤庫）刪除「${m.text}」嗎？\n（已抽出的獲獎紀錄不受影響）`)) return
  guard(async () => {
    await store.deleteMember(m.id)
    members.value = members.value.filter(x => x.id !== m.id)
    if (winner.value?.id === m.id) winner.value = null
  })
}
function toggleSelect(m: Member) {
  const next = !m.selected
  guard(async () => { await store.setMemberSelected(m.id, next); m.selected = next })
}
function selectAll()  { guard(async () => { await store.setAllSelected(true);  members.value.forEach(m => m.selected = true) }) }
function selectNone() { guard(async () => { await store.setAllSelected(false); members.value.forEach(m => m.selected = false) }) }

const selectedMembers = computed(() => members.value.filter(m => m.selected))

// ── SEASONS（季度，可 CRUD）──────────────────────────────────────────────────
const activeSeasonId = ref<string | null>(null)
const activeBag = ref<BagKey>((localStorage.getItem('nindou-active-bag') as BagKey) || 'big')

const activeSeasonObj = computed(() => seasons.value.find(s => s.id === activeSeasonId.value) ?? null)
const bagLabel = computed(() => activeBag.value === 'big' ? '大福袋' : '小福袋')

watch(activeSeasonId, v => {
  const s = seasons.value.find(x => x.id === v)
  if (s) localStorage.setItem(ACTIVE_SEASON_NAME_KEY, s.name)
  resetDrawResult()
})
watch(activeBag, v => { localStorage.setItem('nindou-active-bag', v); resetDrawResult() })

const showSeasonMng = ref(false)
const newSeasonName = ref('')
const editSeasonId = ref<string | null>(null)
const editSeasonName = ref('')

function addSeason() {
  const name = newSeasonName.value.trim()
  if (!name) return
  guard(async () => {
    const s = await store.addSeason(name)
    seasons.value.push(s)
    if (!winners.value[s.id]) winners.value[s.id] = { big: [], small: [] }
    newSeasonName.value = ''
    if (!activeSeasonId.value) activeSeasonId.value = s.id
  })
}
function startEditSeason(s: Season) { editSeasonId.value = s.id; editSeasonName.value = s.name }
function saveEditSeason() {
  const s = seasons.value.find(x => x.id === editSeasonId.value)
  const name = editSeasonName.value.trim()
  editSeasonId.value = null
  if (!s || !name) return
  guard(async () => { await store.renameSeason(s.id, name); s.name = name })
}
function deleteSeason(s: Season) {
  if (seasons.value.length <= 1) return
  const cnt = seasonWinnerCount(s.id)
  const warn = cnt > 0 ? `\n此季已有 ${cnt} 筆獲獎紀錄，將一併刪除！` : ''
  if (!confirm(`確定刪除季度「${s.name}」嗎？${warn}`)) return
  guard(async () => {
    await store.deleteSeason(s.id)   // 中獎紀錄由外鍵 CASCADE 一併刪除
    seasons.value = seasons.value.filter(x => x.id !== s.id)
    if (winners.value[s.id]) delete winners.value[s.id]
    if (activeSeasonId.value === s.id) activeSeasonId.value = seasons.value[0]?.id ?? null
  })
}

// ── WINNERS（獲獎成員＋領取紀錄，依季度＋福袋分別管理）───────────────────────
function ensureBucketLocal(sid: string): SeasonBag {
  const map = winners.value
  if (!map[sid]) map[sid] = { big: [], small: [] }
  if (!map[sid].big) map[sid].big = []
  if (!map[sid].small) map[sid].small = []
  return map[sid]
}
function seasonWinnerCount(sid: string): number {
  const b = winners.value[sid]
  return (b?.big?.length ?? 0) + (b?.small?.length ?? 0)
}

const seasonBucket = computed<SeasonBag | null>(() => {
  const sid = activeSeasonId.value
  return sid ? (winners.value[sid] ?? null) : null
})
// 轉盤/抽籤仍以「當前福袋」為主，mini 最近獲獎沿用此清單。
const currentWinnerList = computed<Winner[]>(() => seasonBucket.value?.[activeBag.value] ?? [])
const recentWinners = computed(() => currentWinnerList.value.slice(-6).reverse())

// ── 領取總表：把本季大／小福袋名單以「成員」為單位合併成一列 ──────────────────
// 同一人可能同時中大袋與小袋（甚至同一袋多次），兩袋領取狀態各自獨立呈現，
// 未中的那一袋顯示「未中獎」。此為純呈現層彙整，不改動 nindou-winners 儲存結構。
interface CombinedRow { name: string; big: Winner[]; small: Winner[] }
const combinedWinners = computed<CombinedRow[]>(() => {
  const b = seasonBucket.value
  if (!b) return []
  const map = new Map<string, CombinedRow>()  // Map 保留插入順序：先大袋、再小袋獨有者
  const add = (w: Winner, bag: BagKey) => {
    let row = map.get(w.name)
    if (!row) { row = { name: w.name, big: [], small: [] }; map.set(w.name, row) }
    row[bag].push(w)
  }
  ;(b.big ?? []).forEach(w => add(w, 'big'))
  ;(b.small ?? []).forEach(w => add(w, 'small'))
  return [...map.values()]
})
function bagAllClaimed(recs: Winner[]) { return recs.length > 0 && recs.every(w => w.claimed) }
function bagStat(bag: BagKey) {
  const arr = seasonBucket.value?.[bag] ?? []
  return { total: arr.length, claimed: arr.filter(w => w.claimed).length }
}
const bigStat = computed(() => bagStat('big'))
const smallStat = computed(() => bagStat('small'))

const newWinnerName = ref('')
const editRowName = ref<string | null>(null)   // 以「原名字」為 key 進入編輯
const editRowText = ref('')

function addWinner(bag: BagKey) {
  const name = newWinnerName.value.trim()
  const sid = activeSeasonId.value
  if (!name || !sid) return
  guard(async () => {
    const rec = await store.addWinner(sid, bag, name, false)
    ensureBucketLocal(sid)[bag].push(rec)
    newWinnerName.value = ''
  })
}
// 領取狀態以「該袋此人全部紀錄」為單位切換：尚有未領→整批標記已領，反之取消。
function toggleBagClaim(row: CombinedRow, bag: BagKey) {
  const recs = row[bag]
  if (!recs.length) return
  const target = !bagAllClaimed(recs)
  const ids = recs.map(w => w.id)
  guard(async () => { await store.setWinnersClaimed(ids, target); recs.forEach(w => { w.claimed = target }) })
}
function startEditRow(row: CombinedRow) { editRowName.value = row.name; editRowText.value = row.name }
function saveEditRow() {
  const old = editRowName.value
  const next = editRowText.value.trim()
  const sid = activeSeasonId.value
  const b = seasonBucket.value
  editRowName.value = null
  if (!old || !next || next === old || !sid || !b) return
  guard(async () => {
    // 改名同步套用到此人在本季大／小袋的所有紀錄，維持合併成同一列
    await store.renameWinnersInSeason(sid, old, next)
    ;[...(b.big ?? []), ...(b.small ?? [])].forEach(w => { if (w.name === old) w.name = next })
  })
}
function deleteCombinedRow(row: CombinedRow) {
  const b = seasonBucket.value
  if (!b) return
  const n = row.big.length + row.small.length
  if (!confirm(`確定刪除「${row.name}」本季的獲獎紀錄嗎？\n（大福袋 ${row.big.length} 筆、小福袋 ${row.small.length} 筆，共 ${n} 筆）`)) return
  const ids = [...row.big, ...row.small].map(w => w.id)
  guard(async () => {
    await store.deleteWinners(ids)
    const idset = new Set(ids)
    b.big = (b.big ?? []).filter(w => !idset.has(w.id))
    b.small = (b.small ?? []).filter(w => !idset.has(w.id))
    if (lastWinnerRecord.value && idset.has(lastWinnerRecord.value.id)) { lastWinnerRecord.value = null; winner.value = null }
  })
}

// ── ROULETTE WHEEL ────────────────────────────────────────────────────────────
const COLORS: string[] = [
  '#f4c030', '#5a3a08', '#fbcd3f', '#8c4818', '#fff099', '#a86a1f', '#e9b13c',
  '#3a2208', '#e08f1a', '#6b4410', '#d4a93c', '#9c3018', '#f7e58e', '#c4781e', '#8a5c10',
]

const wheelAngle = ref(0)
const isSpinning = ref(false)
const SPIN_SEC = 5
const winner = ref<Member | null>(null)            // 被抽中的 member 物件
const lastWinnerRecord = ref<Winner | null>(null)  // 對應寫入的 winner 紀錄（含 claimed）

function resetDrawResult() { winner.value = null; lastWinnerRecord.value = null }

const wheelSectors = computed(() => {
  const pool = selectedMembers.value
  if (!pool.length) return []
  const n = pool.length
  const cx = 150, cy = 150, r = 138
  return pool.map((m, i) => {
    const s = (i / n) * 360
    const e = ((i + 1) / n) * 360
    const mid = (s + e) / 2
    const sRad = (s - 90) * Math.PI / 180
    const eRad = (e - 90) * Math.PI / 180
    const mRad = (mid - 90) * Math.PI / 180
    const x1 = cx + r * Math.cos(sRad)
    const y1 = cy + r * Math.sin(sRad)
    const x2 = cx + r * Math.cos(eRad)
    const y2 = cy + r * Math.sin(eRad)
    const path = n === 1
      ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.001} ${cy - r} Z`
      : `M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${e - s > 180 ? 1 : 0} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z`
    const tr = r * 0.64
    return {
      path,
      fill: COLORS[i % COLORS.length],
      tx: (cx + tr * Math.cos(mRad)).toFixed(1),
      ty: (cy + tr * Math.sin(mRad)).toFixed(1),
      rot: mid,
      label: m.text.length > 5 ? m.text.slice(0, 5) + '…' : m.text,
    }
  })
})

const wheelFontSz = computed(() => {
  const n = selectedMembers.value.length
  return n <= 4 ? 13 : n <= 8 ? 11 : n <= 14 ? 9 : 7
})

const wheelStyle = computed(() => ({
  transform: `rotate(${wheelAngle.value}deg)`,
  transition: isSpinning.value ? `transform ${SPIN_SEC}s cubic-bezier(0.08, 0.01, 0.18, 1)` : 'none',
}))

const canSpin = computed(() => !!selectedMembers.value.length && !!activeSeasonId.value && !isSpinning.value)

async function spin() {
  if (!canSpin.value) return
  const sid = activeSeasonId.value
  if (!sid) return
  const pool = selectedMembers.value
  const pickedIdx = Math.floor(Math.random() * pool.length)
  const picked = pool[pickedIdx]
  const segAngle = 360 / pool.length
  const winnerCenter = (pickedIdx + 0.5) * segAngle
  const curEff = ((wheelAngle.value % 360) + 360) % 360
  const targetEff = (360 - winnerCenter % 360) % 360
  let delta = (targetEff - curEff + 360) % 360
  if (delta < 10) delta += 360
  delta += (5 + Math.floor(Math.random() * 4)) * 360
  winner.value = null
  lastWinnerRecord.value = null
  isSpinning.value = true
  wheelAngle.value += delta
  await new Promise(r => setTimeout(r, (SPIN_SEC + 0.5) * 1000))
  isSpinning.value = false
  // 寫入該季該福袋的獲獎名單（雲端成功後才更新本地）
  try {
    const bag = activeBag.value
    const rec = await store.addWinner(sid, bag, picked.text, true)
    ensureBucketLocal(sid)[bag].push(rec)
    lastWinnerRecord.value = rec
  } catch (e) {
    opError.value = e instanceof Error ? e.message : String(e)
  }
  winner.value = picked
}
function toggleLastClaim() {
  const rec = lastWinnerRecord.value
  if (!rec) return
  const next = !rec.claimed
  guard(async () => { await store.setWinnersClaimed([rec.id], next); rec.claimed = next })
}

// ── 載入 / 首次匯入 ───────────────────────────────────────────────────────────
// 首次登入（每台瀏覽器最多一次）把本機 localStorage 資料匯入雲端。
// 舊版 statusId 遺留標記的轉換集中在 luckydraw/local.ts，匯入時一併處理；
// 本機資料保留不刪，作為離線備份。
async function maybeImport() {
  const cloud = await store.fetchAll()
  const cloudHasData = cloud.members.length > 0 ||
    Object.values(cloud.winners).some(b => b.big.length + b.small.length > 0)
  if (cloudHasData) return                       // 雲端已有實質資料 → 不動它
  const local = readLocalData()
  if (hasMeaningfulLocalData(local)) {
    await store.importData(local)                // 本機有資料 → 匯入（季度以名稱對應，不重複）
  } else if (cloud.seasons.length === 0) {
    await store.seedDefaultSeasons()             // 全新帳號 → 種預設季度
  }
}

function pickActiveSeason() {
  const prefer = localStorage.getItem(ACTIVE_SEASON_NAME_KEY)
  activeSeasonId.value =
    seasons.value.find(s => s.name === prefer)?.id ??
    seasons.value.find(s => s.name === '第三季')?.id ??
    seasons.value[0]?.id ?? null
}

async function loadData() {
  loading.value = true; loadError.value = ''
  try {
    if (!alreadyImported()) { await maybeImport(); markImported() }
    const data = await store.fetchAll()
    if (!data.seasons.length) {                   // 保底：完全沒有季度就補種子
      await store.seedDefaultSeasons()
      Object.assign(data, await store.fetchAll())
    }
    members.value = data.members
    seasons.value = data.seasons
    winners.value = data.winners
    pickActiveSeason()
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : String(e)
  } finally {
    loading.value = false
  }
}

async function doSignOut() { await signOut() }

// 登入狀態改變即載入 / 清空（放最後：確保所用的 ref 皆已宣告）
watch(user, (u) => {
  if (u) loadData()
  else { members.value = []; seasons.value = []; winners.value = {}; resetDrawResult() }
}, { immediate: true })
</script>

<template>
  <div class="ld">

    <!-- 未初始化 → 未登入 → 載入中 → 載入失敗，四種前置狀態 -->
    <div v-if="!authReady" class="ld-state">
      <div class="ld-spinner"></div><span>載入中⋯</span>
    </div>
    <LoginForm v-else-if="!user" />
    <div v-else-if="loading" class="ld-state">
      <div class="ld-spinner"></div><span>載入雲端資料中⋯</span>
    </div>
    <div v-else-if="loadError" class="ld-state err">
      <span>載入失敗：{{ loadError }}</span>
      <button class="ld-retry" @click="loadData">重試</button>
    </div>

    <!-- 已登入且載入完成：以下為原本的抽籤介面 -->
    <template v-else>

    <!-- 帳號列 -->
    <div class="acct-bar">
      <span class="acct-dot"></span>
      <span class="acct-email">{{ userEmail }}</span>
      <button class="acct-out" @click="doSignOut">登出</button>
    </div>

    <!-- 單筆操作失敗提示 -->
    <div v-if="opError" class="op-err">
      <span class="op-err-txt">操作失敗：{{ opError }}</span>
      <button class="op-err-x" title="關閉" @click="opError = ''">✕</button>
    </div>

    <!-- ══ 季度 ＆ 福袋 控制列 ══ -->
    <div class="ctrl-bar">
      <div class="ctrl-group">
        <span class="ctrl-lbl">季度</span>
        <div class="season-pills">
          <button v-for="s in seasons" :key="s.id"
            class="season-pill" :class="{ on: s.id === activeSeasonId }"
            @click="activeSeasonId = s.id">{{ s.name }}</button>
          <button class="season-mng-btn" :class="{ open: showSeasonMng }"
            title="管理季度" @click="showSeasonMng = !showSeasonMng">⚙ 管理</button>
        </div>
      </div>

      <div class="ctrl-group">
        <span class="ctrl-lbl">福袋</span>
        <div class="bag-seg">
          <button class="bag-btn big" :class="{ on: activeBag === 'big' }" @click="activeBag = 'big'">🎁 大福袋</button>
          <button class="bag-btn small" :class="{ on: activeBag === 'small' }" @click="activeBag = 'small'">🎀 小福袋</button>
        </div>
      </div>
    </div>

    <!-- 季度管理面板 -->
    <Transition name="slide">
      <div v-if="showSeasonMng" class="season-panel">
        <div class="sp-add">
          <input v-model="newSeasonName" class="sp-inp" placeholder="新增季度，例：第六季" maxlength="12" @keydown.enter="addSeason"/>
          <button class="sp-add-btn" @click="addSeason">＋ 新增季度</button>
        </div>
        <div class="sp-list">
          <div v-for="s in seasons" :key="s.id" class="sp-row" :class="{ on: s.id === activeSeasonId }">
            <template v-if="editSeasonId === s.id">
              <input v-model="editSeasonName" class="sp-inp sm" maxlength="12" @keydown.enter="saveEditSeason" @keydown.escape="editSeasonId = null"/>
              <button class="sp-btn ok" @click="saveEditSeason">✓</button>
              <button class="sp-btn" @click="editSeasonId = null">✕</button>
            </template>
            <template v-else>
              <span class="sp-name">{{ s.name }}</span>
              <span class="sp-meta">{{ seasonWinnerCount(s.id) }} 中獎</span>
              <button class="sp-btn" title="改名" @click="startEditSeason(s)">✏</button>
              <button class="sp-btn del" :disabled="seasons.length <= 1" title="刪除季度" @click="deleteSeason(s)">✕</button>
            </template>
          </div>
        </div>
      </div>
    </Transition>

    <div class="ld-body">

      <!-- ══ LEFT COLUMN ══ -->
      <div class="ld-left">

        <!-- 轉盤 -->
        <div class="wheel-sec">
          <div class="wheel-tag">
            <span class="wt-season">{{ activeSeasonObj?.name ?? '請新增季度' }}</span>
            <span class="wt-bag" :class="activeBag">{{ bagLabel }}</span>
          </div>

          <div class="wheel-frame">
            <div class="deco-ring"></div>
            <div class="pointer-wrap">
              <div class="pointer-body">
                <div class="pointer-tri"></div>
                <div class="pointer-stem"></div>
              </div>
            </div>
            <div class="wheel-svg" :style="wheelStyle">
              <svg viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">
                <defs>
                  <radialGradient id="hubGold" cx="38%" cy="32%">
                    <stop offset="0%"   stop-color="#fff8b0"/>
                    <stop offset="45%"  stop-color="#f4c030"/>
                    <stop offset="100%" stop-color="#8a5a00"/>
                  </radialGradient>
                  <filter id="segShadow">
                    <feDropShadow dx="0" dy="0" stdDeviation="1" flood-color="rgba(0,0,0,0.4)"/>
                  </filter>
                </defs>

                <circle cx="150" cy="150" r="148" fill="#0c0a16"/>

                <g v-if="wheelSectors.length" filter="url(#segShadow)">
                  <path v-for="(s, i) in wheelSectors" :key="'s'+i"
                    :d="s.path" :fill="s.fill"
                    stroke="rgba(0,0,0,0.3)" stroke-width="1.5"
                  />
                </g>

                <g v-if="wheelSectors.length">
                  <text v-for="(s, i) in wheelSectors" :key="'t'+i"
                    :x="s.tx" :y="s.ty"
                    :font-size="wheelFontSz"
                    font-weight="800"
                    fill="white"
                    text-anchor="middle"
                    dominant-baseline="middle"
                    paint-order="stroke"
                    stroke="rgba(0,0,0,0.65)"
                    stroke-width="3"
                    stroke-linejoin="round"
                    :transform="`rotate(${s.rot}, ${s.tx}, ${s.ty})`"
                  >{{ s.label }}</text>
                </g>

                <text v-if="!wheelSectors.length"
                  x="150" y="150" text-anchor="middle" dominant-baseline="middle"
                  fill="#444466" font-size="12" font-weight="600">點擊右側成員加入</text>

                <circle cx="150" cy="150" r="138" fill="none" stroke="#c89840" stroke-width="5"/>
                <circle cx="150" cy="150" r="130" fill="none" stroke="rgba(200,152,64,0.2)" stroke-width="1"/>
                <g v-for="n in 16" :key="n">
                  <circle
                    :cx="150 + 143 * Math.cos((n/16*360 - 90) * Math.PI/180)"
                    :cy="150 + 143 * Math.sin((n/16*360 - 90) * Math.PI/180)"
                    r="3.5" fill="#c89840"
                  />
                </g>

                <circle cx="150" cy="150" r="26" fill="#0c0a16" stroke="#c89840" stroke-width="3.5"/>
                <circle cx="150" cy="150" r="16" fill="url(#hubGold)"/>
                <circle cx="150" cy="150" r="6"  fill="rgba(255,255,255,0.5)"/>
              </svg>
            </div>
          </div>

          <button
            class="spin-btn"
            :class="{ spinning: isSpinning, disabled: !canSpin }"
            :disabled="!canSpin"
            @click="spin"
          >
            <span v-if="isSpinning">旋轉中⋯</span>
            <span v-else>抽 {{ bagLabel }}</span>
          </button>

          <div class="part-info">
            <span v-if="!activeSeasonId" class="part-empty">請先於上方新增季度</span>
            <span v-else-if="selectedMembers.length" class="part-count">{{ selectedMembers.length }} 人在轉盤上</span>
            <span v-else class="part-empty">請從右側選擇參與成員</span>
          </div>
        </div>

        <!-- 結果 -->
        <div class="result-sec">
          <div class="result-hd">抽籤結果</div>

          <Transition name="win">
            <div v-if="winner" class="winner-box">
              <div class="win-sparkle">🎊</div>
              <div class="win-name">{{ winner.text }}</div>
              <div class="win-sub">{{ activeSeasonObj?.name }} · {{ bagLabel }} 中獎</div>
              <button class="claim-toggle" :class="{ done: lastWinnerRecord?.claimed }" @click="toggleLastClaim">
                {{ lastWinnerRecord?.claimed ? '✓ 已領取' : '標記為已領取' }}
              </button>
            </div>
            <div v-else class="no-result">
              <span v-if="isSpinning" class="spinning-text">抽籤進行中⋯</span>
              <span v-else>尚未抽籤</span>
            </div>
          </Transition>

          <div v-if="recentWinners.length" class="mini-hist">
            <div class="mini-hd">本季{{ bagLabel }}最近獲獎（共 {{ currentWinnerList.length }} 人）</div>
            <div v-for="w in recentWinners" :key="w.id" class="mini-row">
              <span class="mini-name">{{ w.name }}</span>
              <span class="mini-claim" :class="{ done: w.claimed }">{{ w.claimed ? '已領取' : '未領取' }}</span>
            </div>
          </div>
        </div>
      </div>

      <!-- ══ RIGHT ASIDE：籤庫（公會成員）══ -->
      <aside class="stick-aside">
        <div class="aside-hd">
          <span class="aside-title">籤庫（公會成員）</span>
          <span class="aside-count">{{ members.length }} 人</span>
          <div class="aside-acts">
            <button class="aside-act" @click="selectAll">全入</button>
            <button class="aside-act" @click="selectNone">全出</button>
          </div>
        </div>

        <div class="lot-add-row">
          <input v-model="newMemberText" class="lot-inp" placeholder="輸入成員名字⋯" maxlength="8" @keydown.enter="addMember"/>
          <button class="lot-add-btn" @click="addMember">新增</button>
        </div>

        <div class="lot-hint">
          <span class="lot-hint-dot"></span>
          點擊成員＝加入／移出轉盤；公會成員全季度共用。
        </div>

        <div class="sticks-grid">
          <div v-if="!members.length" class="sticks-empty">尚未新增任何成員</div>

          <div v-for="m in members" :key="m.id"
            class="stick" :class="{ 'stick-on': m.selected, editing: editMemberId === m.id }"
          >
            <template v-if="editMemberId === m.id">
              <input v-model="editMemberText" class="stick-edit-inp" maxlength="8"
                @keydown.enter="saveEditMember" @keydown.escape="editMemberId = null"/>
              <button class="stick-act ok" @click.stop="saveEditMember">✓</button>
              <button class="stick-act" @click.stop="editMemberId = null">✕</button>
            </template>
            <template v-else>
              <span class="stick-tap" :title="m.selected ? '點擊移出轉盤' : '點擊加入轉盤'" @click="toggleSelect(m)">
                <span class="stick-name">{{ m.text }}</span>
              </span>
              <button class="stick-act edit" title="改名" @click.stop="startEditMember(m)">✏</button>
              <button class="stick-act del" title="刪除成員" @click.stop="deleteMember(m)">✕</button>
            </template>
          </div>
        </div>
      </aside>

    </div>

    <!-- ══ 獲獎成員 ＆ 領取總表（大小福袋合併，一人一列）══ -->
    <section class="winners-sec">
      <div class="ws-hd">
        <div class="ws-title">
          <span class="ws-season">{{ activeSeasonObj?.name ?? '—' }}</span>
          <span class="ws-h">獲獎成員 ＆ 領取總表</span>
        </div>
        <div class="ws-stat">
          <span class="stat-chip big">🎁 大福袋 {{ bigStat.total }} 中 · <b>{{ bigStat.claimed }}</b> 領</span>
          <span class="stat-chip small">🎀 小福袋 {{ smallStat.total }} 中 · <b>{{ smallStat.claimed }}</b> 領</span>
          <span class="stat-people">{{ combinedWinners.length }} 人</span>
        </div>
      </div>

      <div class="ws-add">
        <input v-model="newWinnerName" class="ws-inp" :disabled="!activeSeasonId"
          placeholder="手動新增獲獎成員⋯" maxlength="12" @keydown.enter="addWinner('big')"/>
        <button class="ws-add-btn big" :disabled="!activeSeasonId" @click="addWinner('big')">＋ 大福袋</button>
        <button class="ws-add-btn small" :disabled="!activeSeasonId" @click="addWinner('small')">＋ 小福袋</button>
      </div>

      <div class="ws-list">
        <div v-if="!combinedWinners.length" class="ws-empty">
          尚無獲獎紀錄 — 可用上方轉盤抽福袋，或在此手動新增。
        </div>
        <div v-for="row in combinedWinners" :key="row.name" class="wc-row">
          <template v-if="editRowName === row.name">
            <input v-model="editRowText" class="ws-inp sm" maxlength="12"
              @keydown.enter="saveEditRow" @keydown.escape="editRowName = null"/>
            <button class="ws-btn ok" @click="saveEditRow">✓</button>
            <button class="ws-btn" @click="editRowName = null">✕</button>
          </template>
          <template v-else>
            <span class="wc-name" :title="row.name">{{ row.name }}</span>
            <div class="wc-bags">
              <button class="wc-claim big"
                :class="{ won: row.big.length, done: bagAllClaimed(row.big) }"
                :disabled="!row.big.length"
                :title="row.big.length ? '點擊切換大福袋領取狀態' : '此人本季未中大福袋'"
                @click="toggleBagClaim(row, 'big')">
                <span class="wc-tag">🎁大</span>
                <span class="wc-st">{{ !row.big.length ? '未中獎' : bagAllClaimed(row.big) ? '✓ 已領' : '未領取' }}</span>
                <span v-if="row.big.length > 1" class="wc-mul">×{{ row.big.length }}</span>
              </button>
              <button class="wc-claim small"
                :class="{ won: row.small.length, done: bagAllClaimed(row.small) }"
                :disabled="!row.small.length"
                :title="row.small.length ? '點擊切換小福袋領取狀態' : '此人本季未中小福袋'"
                @click="toggleBagClaim(row, 'small')">
                <span class="wc-tag">🎀小</span>
                <span class="wc-st">{{ !row.small.length ? '未中獎' : bagAllClaimed(row.small) ? '✓ 已領' : '未領取' }}</span>
                <span v-if="row.small.length > 1" class="wc-mul">×{{ row.small.length }}</span>
              </button>
            </div>
            <button class="ws-btn" title="改名" @click="startEditRow(row)">✏</button>
            <button class="ws-btn del" title="刪除此人紀錄" @click="deleteCombinedRow(row)">✕</button>
          </template>
        </div>
      </div>
    </section>

    </template>

  </div>
</template>

<style scoped>
.ld { min-height: 560px; display: flex; flex-direction: column; }

/* ── 前置狀態：載入中／載入失敗 ── */
.ld-state {
  flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 14px; padding: 60px 20px; min-height: 420px; color: var(--text3); font-size: 0.95rem;
}
.ld-state.err { color: var(--red); }
.ld-spinner {
  width: 34px; height: 34px; border-radius: 50%;
  border: 3px solid var(--border2); border-top-color: var(--gold);
  animation: ld-spin 0.8s linear infinite;
}
@keyframes ld-spin { to { transform: rotate(360deg); } }
.ld-retry {
  padding: 8px 22px; border-radius: 20px; border: 1px solid var(--gold); background: transparent;
  color: var(--gold); font-size: 0.88rem; font-weight: 700; font-family: inherit; cursor: pointer;
  transition: all 0.15s;
}
.ld-retry:hover { background: rgba(244,192,48,0.12); }

/* ── 帳號列 ── */
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

/* ── 操作失敗提示 ── */
.op-err {
  display: flex; align-items: center; gap: 10px; margin: 10px 18px 0;
  padding: 8px 12px; background: rgba(230,70,70,0.1); border: 1px solid rgba(230,70,70,0.35);
  border-radius: var(--radius); color: var(--red); font-size: 0.82rem;
}
.op-err-txt { flex: 1; min-width: 0; line-height: 1.4; }
.op-err-x {
  border: none; background: transparent; color: var(--red); font-size: 0.9rem; cursor: pointer;
  font-family: inherit; flex-shrink: 0; padding: 0 2px;
}

/* ── 控制列：季度＋福袋 ── */
.ctrl-bar {
  display: flex;
  flex-wrap: wrap;
  gap: 14px 24px;
  align-items: center;
  padding: 14px 18px;
  background: linear-gradient(135deg, #11101c, #15131f);
  border-bottom: 1px solid var(--border2);
}
.ctrl-group { display: flex; align-items: center; gap: 10px; min-width: 0; }
.ctrl-lbl {
  font-size: 0.72rem; font-weight: 700; letter-spacing: 0.14em;
  color: var(--text3); flex-shrink: 0;
}
.season-pills {
  display: flex; gap: 6px; flex-wrap: wrap; align-items: center;
}
.season-pill {
  padding: 6px 14px; border-radius: 20px; border: 1px solid var(--border2);
  background: var(--surface2); color: var(--text2); font-size: 0.85rem;
  font-weight: 600; font-family: inherit; cursor: pointer; transition: all 0.15s;
  white-space: nowrap;
}
.season-pill:hover { color: var(--text); border-color: var(--text3); }
.season-pill.on {
  background: linear-gradient(135deg, rgba(244,192,48,0.2), rgba(176,123,69,0.1));
  border-color: var(--gold); color: var(--gold);
  box-shadow: 0 0 12px rgba(244,192,48,0.2);
}
.season-mng-btn {
  padding: 6px 12px; border-radius: 20px; border: 1px dashed var(--border2);
  background: transparent; color: var(--text3); font-size: 0.8rem;
  font-family: inherit; cursor: pointer; transition: all 0.15s; white-space: nowrap;
}
.season-mng-btn:hover, .season-mng-btn.open { color: var(--text); border-color: var(--text3); }

.bag-seg {
  display: flex; gap: 3px; background: rgba(0,0,0,0.3);
  border: 1px solid var(--border); border-radius: 10px; padding: 3px;
}
.bag-btn {
  padding: 7px 16px; border-radius: 7px; border: none; background: transparent;
  color: var(--text3); font-size: 0.86rem; font-weight: 700; font-family: inherit;
  cursor: pointer; transition: all 0.18s; white-space: nowrap;
}
.bag-btn:hover:not(.on) { color: var(--text2); }
.bag-btn.big.on  { background: linear-gradient(135deg, rgba(244,192,48,0.22), rgba(176,123,69,0.12)); color: var(--gold); box-shadow: 0 0 10px rgba(244,192,48,0.25); }
.bag-btn.small.on { background: linear-gradient(135deg, rgba(162,155,254,0.22), rgba(116,185,255,0.12)); color: var(--purple); box-shadow: 0 0 10px rgba(162,155,254,0.25); }

/* ── 季度管理面板 ── */
.season-panel {
  background: var(--surface); border-bottom: 1px solid var(--border2);
  padding: 14px 18px; overflow: hidden;
}
.sp-add { display: flex; gap: 8px; margin-bottom: 12px; max-width: 460px; }
.sp-inp {
  flex: 1; min-width: 0; background: var(--surface2); border: 1px solid var(--border);
  border-radius: var(--radius); color: var(--text); font-size: 0.9rem; padding: 8px 12px;
  outline: none; font-family: inherit; transition: border-color 0.15s;
}
.sp-inp:focus { border-color: var(--gold); }
.sp-inp.sm { max-width: 140px; }
.sp-add-btn {
  padding: 8px 16px; border-radius: var(--radius); border: 1px solid rgba(244,192,48,0.4);
  background: rgba(244,192,48,0.08); color: var(--gold); font-size: 0.86rem; font-weight: 600;
  font-family: inherit; cursor: pointer; white-space: nowrap; transition: all 0.15s;
}
.sp-add-btn:hover { background: rgba(244,192,48,0.16); }
.sp-list { display: flex; flex-wrap: wrap; gap: 8px; }
.sp-row {
  display: flex; align-items: center; gap: 8px; background: var(--surface2);
  border: 1px solid var(--border); border-radius: var(--radius); padding: 6px 10px;
}
.sp-row.on { border-color: var(--gold); }
.sp-name { font-size: 0.9rem; font-weight: 600; color: var(--text); }
.sp-row.on .sp-name { color: var(--gold); }
.sp-meta { font-size: 0.72rem; color: var(--text3); }
.sp-btn {
  width: 28px; height: 28px; border-radius: 6px; border: 1px solid var(--border);
  background: transparent; color: var(--text3); font-size: 0.82rem; cursor: pointer;
  font-family: inherit; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; transition: all 0.12s; padding: 0;
}
.sp-btn:hover { border-color: var(--text3); color: var(--text); }
.sp-btn.del:hover:not(:disabled) { border-color: var(--red); color: var(--red); }
.sp-btn.ok { border-color: rgba(82,183,136,0.4); color: var(--green); }
.sp-btn:disabled { opacity: 0.3; cursor: not-allowed; }

.slide-enter-active, .slide-leave-active { transition: all 0.25s ease; }
.slide-enter-from, .slide-leave-to { opacity: 0; transform: translateY(-8px); }

/* ── BODY GRID ── */
.ld-body {
  display: grid;
  grid-template-columns: 1fr 290px;
  gap: 2px;
  background: var(--border2);
}
@media (max-width: 820px) { .ld-body { grid-template-columns: 1fr 240px; } }
@media (max-width: 600px) { .ld-body { grid-template-columns: 1fr; } }

.ld-left { display: flex; flex-direction: column; background: var(--bg); }

/* WHEEL SECTION */
.wheel-sec {
  display: flex; flex-direction: column; align-items: center;
  padding: 18px 20px 20px; gap: 14px; border-bottom: 1px solid var(--border2);
}
.wheel-tag { display: flex; align-items: center; gap: 8px; }
.wt-season { font-size: 0.95rem; font-weight: 700; color: var(--text); letter-spacing: 0.04em; }
.wt-bag {
  font-size: 0.78rem; font-weight: 700; padding: 2px 12px; border-radius: 12px; border: 1px solid;
}
.wt-bag.big   { color: var(--gold);   border-color: rgba(244,192,48,0.5);  background: rgba(244,192,48,0.1); }
.wt-bag.small { color: var(--purple); border-color: rgba(162,155,254,0.5); background: rgba(162,155,254,0.1); }

.wheel-frame {
  position: relative;
  width: min(300px, calc(100vw - 80px));
  height: min(300px, calc(100vw - 80px));
  display: flex; align-items: center; justify-content: center;
}
.deco-ring {
  position: absolute; top: -14px; left: -14px; right: -14px; bottom: -14px;
  border-radius: 50%;
  background: conic-gradient(
    #8a5c10 0deg, #c89840 12deg, #f4c030 18deg, #c89840 24deg,
    #8a5c10 36deg, #c89840 48deg, #f4c030 54deg, #c89840 60deg,
    #8a5c10 72deg, #c89840 84deg, #f4c030 90deg, #c89840 96deg,
    #8a5c10 108deg, #c89840 120deg, #f4c030 126deg, #c89840 132deg,
    #8a5c10 144deg, #c89840 156deg, #f4c030 162deg, #c89840 168deg,
    #8a5c10 180deg, #c89840 192deg, #f4c030 198deg, #c89840 204deg,
    #8a5c10 216deg, #c89840 228deg, #f4c030 234deg, #c89840 240deg,
    #8a5c10 252deg, #c89840 264deg, #f4c030 270deg, #c89840 276deg,
    #8a5c10 288deg, #c89840 300deg, #f4c030 306deg, #c89840 312deg,
    #8a5c10 324deg, #c89840 336deg, #f4c030 342deg, #c89840 348deg,
    #8a5c10 360deg
  );
  box-shadow: 0 0 40px rgba(0,0,0,0.7), inset 0 0 20px rgba(0,0,0,0.5);
  z-index: 0;
}
.deco-ring::after {
  content: ''; position: absolute; top: 9px; left: 9px; right: 9px; bottom: 9px;
  border-radius: 50%; background: #12101e;
}
.pointer-wrap {
  position: absolute; top: -6px; left: 50%; transform: translateX(-50%); z-index: 30;
  display: flex; flex-direction: column; align-items: center;
}
.pointer-body { display: flex; flex-direction: column; align-items: center; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.7)); }
.pointer-tri { width: 0; height: 0; border-left: 13px solid transparent; border-right: 13px solid transparent; border-top: 32px solid var(--gold); }
.pointer-stem { width: 8px; height: 14px; background: linear-gradient(to bottom, #f4c030, #8a5a00); border-radius: 0 0 4px 4px; }

.wheel-svg { position: relative; z-index: 10; width: 100%; height: 100%; }
.wheel-svg svg { width: 100%; height: 100%; }

.spin-btn {
  margin-top: 6px; padding: 13px 56px; border-radius: 40px; border: 2px solid var(--gold);
  background: linear-gradient(135deg, rgba(244,192,48,0.14), rgba(176,123,69,0.06));
  color: var(--gold); font-size: 1.08rem; font-weight: 900; letter-spacing: 0.1em;
  font-family: inherit; cursor: pointer; transition: all 0.2s;
  box-shadow: 0 0 22px rgba(244,192,48,0.14), inset 0 1px rgba(255,255,255,0.08);
  position: relative; overflow: hidden;
}
.spin-btn::after {
  content: ''; position: absolute; top: 0; left: -100%; width: 50%; height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent); transition: left 0.5s;
}
.spin-btn:hover:not([disabled])::after { left: 200%; }
.spin-btn:hover:not([disabled]) {
  background: linear-gradient(135deg, rgba(244,192,48,0.22), rgba(176,123,69,0.12));
  box-shadow: 0 0 36px rgba(244,192,48,0.28); transform: translateY(-2px);
}
.spin-btn.disabled, .spin-btn.spinning { opacity: 0.38; cursor: not-allowed; transform: none; }

.part-info { font-size: 0.9rem; }
.part-count { color: var(--text3); }
.part-empty { color: var(--text3); font-style: italic; }

/* RESULT SECTION */
.result-sec { flex: 1; padding: 18px 22px; overflow-y: auto; }
.result-hd { font-size: 0.8rem; font-weight: 700; letter-spacing: 0.12em; color: var(--text3); margin-bottom: 14px; }

.win-enter-active { animation: winPop 0.65s cubic-bezier(0.34, 1.56, 0.64, 1); }
@keyframes winPop {
  0%   { opacity: 0; transform: scale(0.35) rotate(-8deg); }
  60%  { transform: scale(1.07) rotate(2deg); }
  100% { opacity: 1; transform: scale(1) rotate(0); }
}
.winner-box {
  display: flex; flex-direction: column; align-items: center; gap: 7px;
  background: linear-gradient(135deg, rgba(244,192,48,0.08), rgba(176,123,69,0.03));
  border: 1px solid rgba(244,192,48,0.3); border-radius: var(--radius-lg);
  padding: 18px 20px; margin-bottom: 16px; box-shadow: 0 0 28px rgba(244,192,48,0.08);
}
.win-sparkle { font-size: 1.8rem; }
.win-name { font-size: 2rem; font-weight: 800; color: var(--text); }
.win-sub { font-size: 0.78rem; color: var(--text3); }
.claim-toggle {
  margin-top: 4px; padding: 6px 18px; border-radius: 20px; border: 1px solid var(--green);
  background: transparent; color: var(--green); font-size: 0.82rem; font-weight: 700;
  font-family: inherit; cursor: pointer; transition: all 0.14s;
}
.claim-toggle:hover { background: rgba(82,183,136,0.12); }
.claim-toggle.done { background: var(--green); color: #fff; }

.no-result { padding: 20px; text-align: center; color: var(--text3); font-size: 0.95rem; }
.spinning-text { color: var(--gold); animation: pulse 1s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }

.mini-hist { margin-top: 4px; }
.mini-hd { font-size: 0.75rem; letter-spacing: 0.08em; color: var(--text3); margin-bottom: 8px; padding-bottom: 5px; border-bottom: 1px solid var(--border); }
.mini-row { display: flex; align-items: center; gap: 8px; padding: 5px 0; border-bottom: 1px solid var(--border); font-size: 0.9rem; }
.mini-name { flex: 1; font-weight: 600; color: var(--text2); }
.mini-claim { font-size: 0.74rem; color: var(--text3); padding: 1px 8px; border-radius: 9px; border: 1px solid var(--border2); }
.mini-claim.done { color: var(--green); border-color: rgba(82,183,136,0.4); background: rgba(82,183,136,0.08); }

/* ── 籤庫 ASIDE ── */
.stick-aside {
  background: var(--surface); display: flex; flex-direction: column;
  padding: 14px 12px; overflow-y: auto; max-height: 720px;
}
.aside-hd { display: flex; align-items: center; gap: 6px; margin-bottom: 12px; flex-wrap: wrap; }
.aside-title { font-size: 0.95rem; font-weight: 700; color: var(--text); }
.aside-count { font-size: 0.78rem; color: var(--text3); background: var(--surface2); border: 1px solid var(--border); padding: 1px 8px; border-radius: 9px; }
.aside-acts { display: flex; gap: 4px; margin-left: auto; }
.aside-act {
  padding: 4px 10px; border-radius: 8px; border: 1px solid var(--border2);
  background: var(--surface2); color: var(--text3); font-size: 0.75rem;
  font-family: inherit; cursor: pointer; transition: all 0.12s;
}
.aside-act:hover { color: var(--text); border-color: var(--text3); }

.lot-add-row { display: flex; gap: 6px; margin-bottom: 12px; }
.lot-inp {
  flex: 1; min-width: 0; background: var(--surface2); border: 1px solid var(--border);
  border-radius: var(--radius); color: var(--text); font-size: 0.9rem; padding: 8px 10px;
  outline: none; font-family: inherit; transition: border-color 0.15s;
}
.lot-inp:focus { border-color: var(--gold); }
.lot-add-btn {
  padding: 8px 14px; border-radius: var(--radius); border: 1px solid var(--border2);
  background: var(--surface2); color: var(--text2); font-size: 0.88rem;
  font-family: inherit; cursor: pointer; transition: all 0.12s; white-space: nowrap;
}
.lot-add-btn:hover { border-color: var(--gold); color: var(--gold); }

.lot-hint {
  display: flex; align-items: center; gap: 6px; font-size: 0.72rem; color: var(--text2);
  margin: -4px 0 10px; padding: 6px 9px; background: rgba(244,192,48,0.06);
  border: 1px solid rgba(244,192,48,0.22); border-radius: var(--radius); line-height: 1.35;
}
.lot-hint-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--gold); flex-shrink: 0; box-shadow: 0 0 6px rgba(244,192,48,0.5); }

.sticks-grid { display: flex; flex-direction: column; gap: 9px; padding: 2px 0 10px; }
.sticks-empty { font-size: 0.88rem; color: var(--text3); padding: 8px 0; }

.stick {
  position: relative; width: 100%; min-height: 32px; display: flex; align-items: center;
  padding: 0 6px 0 4px; gap: 4px; border-radius: 16px;
  background:
    linear-gradient(to bottom, rgba(255,255,255,0.52) 0%, rgba(255,255,255,0.16) 30%, transparent 68%),
    repeating-linear-gradient(177deg, transparent 0px, transparent 3.5px, rgba(118,65,8,0.18) 3.5px, rgba(118,65,8,0.18) 4.5px, transparent 4.5px, transparent 9px, rgba(95,50,5,0.12) 9px, rgba(95,50,5,0.12) 10px),
    repeating-linear-gradient(175deg, transparent 0px, transparent 6px, rgba(155,90,15,0.09) 6px, rgba(155,90,15,0.09) 7px, transparent 7px, transparent 14px, rgba(100,55,5,0.06) 14px, rgba(100,55,5,0.06) 15px),
    linear-gradient(175deg, #f5e9c4 0%, #ebd49a 20%, #dfc47a 40%, #cfad5c 60%, #c09f46 80%, #b38e30 100%);
  border: 1px solid #9f7422;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.52), inset 0 -1px 0 rgba(0,0,0,0.14), 0 2px 6px rgba(0,0,0,0.34), 0 1px 2px rgba(0,0,0,0.20);
  transition: transform 0.14s, box-shadow 0.14s, filter 0.14s;
  user-select: none; overflow: hidden;
}
.stick-tap {
  flex: 1; min-width: 0; display: flex; align-items: center; cursor: pointer;
  padding: 6px 4px 6px 8px; position: relative; z-index: 2;
}
.stick-name {
  font-size: 0.84rem; color: #3c2008; font-weight: 700; flex: 1;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap; letter-spacing: 0.04em;
  text-shadow: 0 1px 0 rgba(255,230,150,0.35);
}
.stick-act {
  position: relative; z-index: 20; width: 22px; height: 22px; border-radius: 50%; border: none;
  font-size: 0.7rem; cursor: pointer; display: flex; align-items: center; justify-content: center;
  line-height: 1; padding: 0; font-family: inherit; flex-shrink: 0; transition: all 0.14s;
}
.stick-act.edit { background: rgba(60,32,8,0.18); color: rgba(60,32,8,0.7); }
.stick-act.edit:hover { background: rgba(60,32,8,0.32); color: #3c2008; }
.stick-act.del { background: rgba(160,25,35,0.22); color: rgba(120,15,25,0.75); }
.stick-act.del:hover { background: rgba(210,45,55,0.92); color: #fff; }
.stick-act.ok { background: rgba(82,183,136,0.3); color: #1d6b48; }
.stick-edit-inp {
  flex: 1; min-width: 0; background: rgba(255,255,255,0.7); border: 1px solid #9f7422;
  border-radius: 8px; color: #3c2008; font-size: 0.82rem; font-weight: 700; padding: 4px 8px;
  outline: none; font-family: inherit; margin-left: 4px;
}

.stick.stick-on {
  background:
    linear-gradient(to bottom, rgba(255,255,255,0.52) 0%, rgba(255,255,255,0.18) 30%, transparent 68%),
    repeating-linear-gradient(177deg, transparent 0px, transparent 3.5px, rgba(160,100,0,0.20) 3.5px, rgba(160,100,0,0.20) 4.5px, transparent 4.5px, transparent 9px, rgba(130,80,0,0.13) 9px, rgba(130,80,0,0.13) 10px),
    repeating-linear-gradient(175deg, transparent 0px, transparent 6px, rgba(180,115,0,0.10) 6px, rgba(180,115,0,0.10) 7px),
    linear-gradient(175deg, #fff6b0 0%, #f4cc48 18%, #e8b020 42%, #d89800 65%, #c88800 100%);
  border-color: #b87c00;
  box-shadow: inset 0 1px 0 rgba(255,255,220,0.62), 0 0 16px rgba(244,192,48,0.52), 0 2px 6px rgba(0,0,0,0.28);
}
.stick:hover { transform: translateY(-1px); filter: brightness(1.04); }

/* ── 獲獎成員 ＆ 領取紀錄 ── */
.winners-sec { background: var(--surface); padding: 18px 20px 24px; }
.ws-hd {
  display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px;
  margin-bottom: 14px; padding-bottom: 12px; border-bottom: 1px solid var(--border);
}
.ws-title { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.ws-season { font-size: 1.05rem; font-weight: 800; color: var(--text); }
.ws-bag { font-size: 0.78rem; font-weight: 700; padding: 2px 12px; border-radius: 12px; border: 1px solid; }
.ws-bag.big   { color: var(--gold);   border-color: rgba(244,192,48,0.5);  background: rgba(244,192,48,0.1); }
.ws-bag.small { color: var(--purple); border-color: rgba(162,155,254,0.5); background: rgba(162,155,254,0.1); }
.ws-h { font-size: 0.95rem; font-weight: 700; color: var(--text2); }
.ws-stat { display: flex; align-items: center; gap: 8px; margin-left: auto; font-size: 0.8rem; color: var(--text3); flex-wrap: wrap; }
.stat-chip { padding: 3px 10px; border-radius: 12px; border: 1px solid; font-weight: 600; white-space: nowrap; }
.stat-chip b { font-weight: 800; }
.stat-chip.big   { color: var(--gold);   border-color: rgba(244,192,48,0.4);  background: rgba(244,192,48,0.08); }
.stat-chip.small { color: var(--purple); border-color: rgba(162,155,254,0.4); background: rgba(162,155,254,0.08); }
.stat-chip b { color: var(--green); }
.stat-people { color: var(--text2); font-weight: 600; }

.ws-add { display: flex; gap: 8px; margin-bottom: 14px; max-width: 520px; }
.ws-inp {
  flex: 1; min-width: 0; background: var(--surface2); border: 1px solid var(--border);
  border-radius: var(--radius); color: var(--text); font-size: 0.9rem; padding: 8px 12px;
  outline: none; font-family: inherit; transition: border-color 0.15s;
}
.ws-inp:focus { border-color: var(--gold); }
.ws-inp:disabled { opacity: 0.5; cursor: not-allowed; }
.ws-inp.sm { max-width: 160px; }
.ws-add-btn {
  padding: 8px 14px; border-radius: var(--radius); border: 1px solid var(--border2);
  background: var(--surface2); color: var(--text2); font-size: 0.86rem; font-weight: 600;
  font-family: inherit; cursor: pointer; white-space: nowrap; transition: all 0.12s;
}
.ws-add-btn.big:hover:not(:disabled)   { border-color: var(--gold);   color: var(--gold); }
.ws-add-btn.small:hover:not(:disabled) { border-color: var(--purple); color: var(--purple); }
.ws-add-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.ws-list {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 8px;
}
.ws-empty { grid-column: 1 / -1; font-size: 0.88rem; color: var(--text3); padding: 12px 0; }

/* 領取總表：一人一列，name ＋ 大/小福袋各一個領取鈕 */
.wc-row {
  display: flex; align-items: center; gap: 8px; background: var(--surface2);
  border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px;
}
.wc-name {
  flex: 0 0 auto; max-width: 84px; font-size: 0.92rem; font-weight: 700; color: var(--text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.wc-bags { display: flex; gap: 6px; flex: 1; min-width: 0; }
.wc-claim {
  display: flex; align-items: center; justify-content: center; gap: 5px; flex: 1; min-width: 0;
  padding: 5px 8px; border-radius: 10px; border: 1px solid var(--border2);
  background: transparent; color: var(--text3); font-size: 0.74rem; font-weight: 700;
  font-family: inherit; cursor: pointer; white-space: nowrap; transition: all 0.14s;
}
.wc-tag { font-weight: 800; opacity: 0.9; }
.wc-mul { font-size: 0.66rem; opacity: 0.7; }
.wc-claim:disabled { opacity: 0.42; cursor: default; }     /* 未中該袋 */
.wc-claim.big.won   { color: var(--gold);   border-color: rgba(244,192,48,0.55); }   /* 中獎未領 */
.wc-claim.small.won { color: var(--purple); border-color: rgba(162,155,254,0.55); }
.wc-claim.won:hover { border-color: var(--green); color: var(--green); }
.wc-claim.done { background: var(--green); border-color: var(--green); color: #fff; }  /* 已領 */
.wc-claim.done:hover { opacity: 0.88; color: #fff; }
.ws-btn {
  width: 26px; height: 26px; border-radius: 6px; border: 1px solid var(--border);
  background: transparent; color: var(--text3); font-size: 0.78rem; cursor: pointer;
  font-family: inherit; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; transition: all 0.12s; padding: 0;
}
.ws-btn:hover { border-color: var(--text3); color: var(--text); }
.ws-btn.del:hover { border-color: var(--red); color: var(--red); }
.ws-btn.ok { border-color: rgba(82,183,136,0.4); color: var(--green); }

/* ── RWD 手機版 ── */
@media (max-width: 600px) {
  .ctrl-bar { padding: 12px 12px; gap: 12px 16px; }
  .ctrl-group { flex: 1 1 100%; }
  .bag-seg { flex: 1; }
  .bag-btn { flex: 1; padding: 9px 8px; }
  .wheel-sec { padding: 14px 10px; gap: 12px; }
  .spin-btn { padding: 12px 40px; font-size: 1rem; }
  .stick-aside { max-height: 320px; padding: 12px 10px; }
  .result-sec { padding: 14px 16px; }
  .winners-sec { padding: 16px 12px 22px; }
  .ws-list { grid-template-columns: 1fr; }
  .ws-stat { margin-left: 0; flex-basis: 100%; }
  /* 手機加大點擊區 */
  .stick { min-height: 38px; }
  .stick-act { width: 28px; height: 28px; font-size: 0.78rem; }
  .season-pill { padding: 8px 14px; }
}
@media (max-width: 400px) {
  .spin-btn { padding: 10px 30px; font-size: 0.95rem; }
  .win-name { font-size: 1.6rem; }
}
</style>
