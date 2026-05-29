<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'

interface Member { id: string; text: string; selected: boolean }
interface Season { id: string; name: string }
interface Winner { id: string; name: string; claimed: boolean; time: string }
type BagKey = 'big' | 'small'
type SeasonBag = Record<BagKey, Winner[]>
type WinnersMap = Record<string, SeasonBag>

function loadLS<T>(key: string, def: T): T {
  try { return (JSON.parse(localStorage.getItem(key) ?? 'null') as T | null) ?? def } catch { return def }
}
function saveLS(key: string, val: unknown) { localStorage.setItem(key, JSON.stringify(val)) }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }
function nowStamp() {
  return new Date().toLocaleString('zh-TW', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
}

// ── MEMBERS（籤庫／公會成員，全季度共用）─────────────────────────────────────
// 直接沿用既有 key `nindou-lots`（歷史名稱為「籤」，本質就是公會成員），
// 不另開新 key：舊版使用者無痛沿用，localStorage 維持單一來源。
// 載入時順手正規化：丟掉舊版的 statusId（領取狀態已改記在 winner.claimed），補上 selected 預設。
//
// 一次性遷移：舊版用 `成員.statusId` + `nindou-statuses` 標籤來標記中獎/領取者。
// 載入時先把「有被標記過」的成員名字撈進 legacyTaggedNames，稍後（onMounted）
// 轉成「第三季 · 大福袋」的 winner（見 migrateLegacyTags）。撈完即丟掉 statusId，
// 存檔後舊資料不再帶 statusId，故下次載入此陣列為空、不會重複遷移。
const legacyTaggedNames: string[] = []
function loadMembers(): Member[] {
  const raw = loadLS<any[]>('nindou-lots', [])
  return (Array.isArray(raw) ? raw : []).map((l: any) => {
    if (l.statusId) legacyTaggedNames.push(l.text)
    return {
      id: l.id ?? uid(),
      text: l.text,
      selected: l.selected !== false,
    }
  })
}
const members = ref<Member[]>(loadMembers())
function saveMembers() { saveLS('nindou-lots', members.value) }

const newMemberText = ref('')
const editMemberId = ref<string | null>(null)
const editMemberText = ref('')

function addMember() {
  const text = newMemberText.value.trim()
  if (!text) return
  members.value.push({ id: uid(), text, selected: true })
  newMemberText.value = ''
  saveMembers()
}
function startEditMember(m: Member) { editMemberId.value = m.id; editMemberText.value = m.text }
function saveEditMember() {
  const m = members.value.find(x => x.id === editMemberId.value)
  if (m && editMemberText.value.trim()) m.text = editMemberText.value.trim()
  editMemberId.value = null; saveMembers()
}
function deleteMember(m: Member) {
  if (!confirm(`確定要從公會成員（籤庫）刪除「${m.text}」嗎？\n（已抽出的獲獎紀錄不受影響）`)) return
  members.value = members.value.filter(x => x.id !== m.id)
  if (winner.value?.id === m.id) winner.value = null
  saveMembers()
}
function toggleSelect(m: Member) { m.selected = !m.selected; saveMembers() }
function selectAll()  { members.value.forEach(m => m.selected = true);  saveMembers() }
function selectNone() { members.value.forEach(m => m.selected = false); saveMembers() }

const selectedMembers = computed(() => members.value.filter(m => m.selected))

// ── SEASONS（季度，可 CRUD）──────────────────────────────────────────────────
const DEFAULT_SEASONS: Season[] = [
  { id: 'se1', name: '第一季' },
  { id: 'se2', name: '第二季' },
  { id: 'se3', name: '第三季' },
  { id: 'se4', name: '第四季' },
  { id: 'se5', name: '第五季' },
]
const seasons = ref<Season[]>(loadLS<Season[] | null>('nindou-seasons', null) ?? DEFAULT_SEASONS.map(s => ({ ...s })))
function saveSeasons() { saveLS('nindou-seasons', seasons.value) }

// 舊資料皆對應第三季 → 預設選第三季
const activeSeasonId = ref<string | null>(
  loadLS<string | null>('nindou-active-season', null) ??
  (seasons.value.find(s => s.id === 'se3')?.id ?? seasons.value[0]?.id ?? null)
)
const activeBag = ref<BagKey>(loadLS<BagKey>('nindou-active-bag', 'big'))

const activeSeasonObj = computed(() => seasons.value.find(s => s.id === activeSeasonId.value) ?? null)
const bagLabel = computed(() => activeBag.value === 'big' ? '大福袋' : '小福袋')

watch(activeSeasonId, v => { saveLS('nindou-active-season', v); resetDrawResult() })
watch(activeBag, v => { saveLS('nindou-active-bag', v); resetDrawResult() })

const showSeasonMng = ref(false)
const newSeasonName = ref('')
const editSeasonId = ref<string | null>(null)
const editSeasonName = ref('')

function addSeason() {
  const name = newSeasonName.value.trim()
  if (!name) return
  const s: Season = { id: uid(), name }
  seasons.value.push(s)
  newSeasonName.value = ''
  saveSeasons()
  if (!activeSeasonId.value) activeSeasonId.value = s.id
}
function startEditSeason(s: Season) { editSeasonId.value = s.id; editSeasonName.value = s.name }
function saveEditSeason() {
  const s = seasons.value.find(x => x.id === editSeasonId.value)
  if (s && editSeasonName.value.trim()) s.name = editSeasonName.value.trim()
  editSeasonId.value = null; saveSeasons()
}
function deleteSeason(s: Season) {
  if (seasons.value.length <= 1) return
  const cnt = seasonWinnerCount(s.id)
  const warn = cnt > 0 ? `\n此季已有 ${cnt} 筆獲獎紀錄，將一併刪除！` : ''
  if (!confirm(`確定刪除季度「${s.name}」嗎？${warn}`)) return
  seasons.value = seasons.value.filter(x => x.id !== s.id)
  if (winners.value[s.id]) { delete winners.value[s.id]; saveWinners() }
  if (activeSeasonId.value === s.id) activeSeasonId.value = seasons.value[0]?.id ?? null
  saveSeasons()
}

// ── WINNERS（獲獎成員＋領取紀錄，依季度＋福袋分別管理）───────────────────────
const winners = ref<WinnersMap>(loadLS<WinnersMap>('nindou-winners', {}))
function saveWinners() { saveLS('nindou-winners', winners.value) }

function ensureBucket(): Winner[] | null {
  const sid = activeSeasonId.value
  if (!sid) return null
  if (!winners.value[sid]) winners.value[sid] = { big: [], small: [] }
  if (!winners.value[sid].big) winners.value[sid].big = []
  if (!winners.value[sid].small) winners.value[sid].small = []
  return winners.value[sid][activeBag.value]
}
function seasonWinnerCount(sid: string): number {
  const b = winners.value[sid]
  return (b?.big?.length ?? 0) + (b?.small?.length ?? 0)
}

const currentWinnerList = computed<Winner[]>(() => {
  const sid = activeSeasonId.value
  if (!sid) return []
  return winners.value[sid]?.[activeBag.value] ?? []
})
const claimedCount = computed(() => currentWinnerList.value.filter(w => w.claimed).length)
const recentWinners = computed(() => currentWinnerList.value.slice(-6).reverse())

const newWinnerName = ref('')
const editWinnerId = ref<string | null>(null)
const editWinnerName = ref('')

function addWinner() {
  const name = newWinnerName.value.trim()
  if (!name || !activeSeasonId.value) return
  const list = ensureBucket()
  if (!list) return
  list.push({ id: uid(), name, claimed: false, time: nowStamp() })
  newWinnerName.value = ''
  saveWinners()
}
function toggleClaim(w: Winner) { w.claimed = !w.claimed; saveWinners() }
function startEditWinner(w: Winner) { editWinnerId.value = w.id; editWinnerName.value = w.name }
function saveEditWinner() {
  const w = currentWinnerList.value.find(x => x.id === editWinnerId.value)
  if (w && editWinnerName.value.trim()) w.name = editWinnerName.value.trim()
  editWinnerId.value = null; saveWinners()
}
function deleteWinner(id: string) {
  const sid = activeSeasonId.value
  if (!sid || !winners.value[sid]) return
  const rec = currentWinnerList.value.find(x => x.id === id)
  if (!confirm(`確定要刪除「${rec?.name ?? '此紀錄'}」的獲獎紀錄嗎？`)) return
  winners.value[sid][activeBag.value] = currentWinnerList.value.filter(x => x.id !== id)
  if (lastWinnerRecord.value?.id === id) { lastWinnerRecord.value = null; winner.value = null }
  saveWinners()
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
  // 寫入該季該福袋的獲獎名單
  const rec: Winner = { id: uid(), name: picked.text, claimed: true, time: nowStamp() }
  const list = ensureBucket()
  if (list) { list.push(rec); saveWinners(); lastWinnerRecord.value = rec }
  winner.value = picked
}
function toggleLastClaim() {
  if (lastWinnerRecord.value) { lastWinnerRecord.value.claimed = !lastWinnerRecord.value.claimed; saveWinners() }
}

// 一次性遷移：把舊版 statusId 標記過的成員，轉成「第三季 · 大福袋」的 winner。
// 舊資料沒有大/小福袋維度，依約定一律歸第三季大福袋、claimed=true。
// 只在 legacyTaggedNames 有值時執行（＝舊版使用者首次開新版），之後不再觸發。
function migrateLegacyTags() {
  if (!legacyTaggedNames.length) return
  // 第三季預設存在（舊使用者無 nindou-seasons → 用預設 se1..se5）；保險起見退而求其次。
  const sid = seasons.value.some(s => s.id === 'se3') ? 'se3' : (activeSeasonId.value ?? seasons.value[0]?.id)
  if (!sid) return
  if (!winners.value[sid]) winners.value[sid] = { big: [], small: [] }
  if (!winners.value[sid].big) winners.value[sid].big = []
  const exist = new Set(winners.value[sid].big.map(w => w.name))
  for (const name of legacyTaggedNames) {
    if (exist.has(name)) continue          // 避免與既有紀錄重複
    winners.value[sid].big.push({ id: uid(), name, claimed: true, time: nowStamp() })
    exist.add(name)
  }
  saveWinners()
}

// 鎖定結果：先遷移舊標記，再存回各 key（saveMembers 會把舊 statusId 一併清掉）
onMounted(() => {
  migrateLegacyTags()
  saveMembers(); saveSeasons()
  saveLS('nindou-active-season', activeSeasonId.value)
  saveLS('nindou-active-bag', activeBag.value)
  // 舊版「領取標記」字典在新版已無用（遷移後 statusId 外鍵也消費完畢）→ 清掉，key 越少越好。
  // 對沒有此 key 的使用者為無害的 no-op。
  localStorage.removeItem('nindou-statuses')
})
</script>

<template>
  <div class="ld">

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

    <!-- ══ 獲獎成員 ＆ 領取紀錄（依季度＋福袋）══ -->
    <section class="winners-sec">
      <div class="ws-hd">
        <div class="ws-title">
          <span class="ws-season">{{ activeSeasonObj?.name ?? '—' }}</span>
          <span class="ws-bag" :class="activeBag">{{ bagLabel }}</span>
          <span class="ws-h">獲獎成員 ＆ 領取紀錄</span>
        </div>
        <div class="ws-stat">
          <span>{{ currentWinnerList.length }} 人中獎</span>
          <span class="dot">·</span>
          <span class="ok-txt">{{ claimedCount }} 已領取</span>
          <span class="dot">·</span>
          <span class="wait-txt">{{ currentWinnerList.length - claimedCount }} 未領</span>
        </div>
      </div>

      <div class="ws-add">
        <input v-model="newWinnerName" class="ws-inp" :disabled="!activeSeasonId"
          placeholder="手動新增獲獎成員⋯" maxlength="12" @keydown.enter="addWinner"/>
        <button class="ws-add-btn" :disabled="!activeSeasonId" @click="addWinner">＋ 新增</button>
      </div>

      <div class="ws-list">
        <div v-if="!currentWinnerList.length" class="ws-empty">
          尚無獲獎紀錄 — 可用上方轉盤抽「{{ bagLabel }}」，或在此手動新增。
        </div>
        <div v-for="w in currentWinnerList" :key="w.id" class="ws-row" :class="{ claimed: w.claimed }">
          <template v-if="editWinnerId === w.id">
            <input v-model="editWinnerName" class="ws-inp sm" maxlength="12"
              @keydown.enter="saveEditWinner" @keydown.escape="editWinnerId = null"/>
            <button class="ws-btn ok" @click="saveEditWinner">✓</button>
            <button class="ws-btn" @click="editWinnerId = null">✕</button>
          </template>
          <template v-else>
            <button class="ws-claim" :class="{ done: w.claimed }" @click="toggleClaim(w)">
              {{ w.claimed ? '✓ 已領取' : '未領取' }}
            </button>
            <span class="ws-name">{{ w.name }}</span>
            <span class="ws-time">{{ w.time }}</span>
            <button class="ws-btn" title="改名" @click="startEditWinner(w)">✏</button>
            <button class="ws-btn del" title="刪除紀錄" @click="deleteWinner(w.id)">✕</button>
          </template>
        </div>
      </div>
    </section>

  </div>
</template>

<style scoped>
.ld { min-height: 560px; display: flex; flex-direction: column; }

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
.ws-stat { display: flex; align-items: center; gap: 6px; margin-left: auto; font-size: 0.82rem; color: var(--text3); }
.ws-stat .dot { color: var(--border2); }
.ws-stat .ok-txt { color: var(--green); font-weight: 600; }
.ws-stat .wait-txt { color: var(--text2); font-weight: 600; }

.ws-add { display: flex; gap: 8px; margin-bottom: 14px; max-width: 420px; }
.ws-inp {
  flex: 1; min-width: 0; background: var(--surface2); border: 1px solid var(--border);
  border-radius: var(--radius); color: var(--text); font-size: 0.9rem; padding: 8px 12px;
  outline: none; font-family: inherit; transition: border-color 0.15s;
}
.ws-inp:focus { border-color: var(--gold); }
.ws-inp:disabled { opacity: 0.5; cursor: not-allowed; }
.ws-inp.sm { max-width: 160px; }
.ws-add-btn {
  padding: 8px 16px; border-radius: var(--radius); border: 1px solid var(--border2);
  background: var(--surface2); color: var(--text2); font-size: 0.88rem; font-weight: 600;
  font-family: inherit; cursor: pointer; white-space: nowrap; transition: all 0.12s;
}
.ws-add-btn:hover:not(:disabled) { border-color: var(--gold); color: var(--gold); }
.ws-add-btn:disabled { opacity: 0.5; cursor: not-allowed; }

.ws-list {
  display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 8px;
}
.ws-empty { grid-column: 1 / -1; font-size: 0.88rem; color: var(--text3); padding: 12px 0; }
.ws-row {
  display: flex; align-items: center; gap: 8px; background: var(--surface2);
  border: 1px solid var(--border); border-radius: var(--radius); padding: 8px 10px;
  transition: border-color 0.14s;
}
.ws-row.claimed { border-color: rgba(82,183,136,0.35); background: rgba(82,183,136,0.05); }
.ws-claim {
  padding: 4px 10px; border-radius: 14px; border: 1px solid var(--border2);
  background: transparent; color: var(--text2); font-size: 0.74rem; font-weight: 700;
  font-family: inherit; cursor: pointer; white-space: nowrap; flex-shrink: 0; transition: all 0.14s;
}
.ws-claim:hover { border-color: var(--green); color: var(--green); }
.ws-claim.done { background: var(--green); border-color: var(--green); color: #fff; }
.ws-name { flex: 1; min-width: 0; font-size: 0.92rem; font-weight: 600; color: var(--text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ws-time { font-size: 0.7rem; color: var(--text3); font-variant-numeric: tabular-nums; flex-shrink: 0; }
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
