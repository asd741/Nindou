<script setup>
import { ref, computed } from 'vue'

function loadLS(key, def) {
  try { return JSON.parse(localStorage.getItem(key) ?? 'null') ?? def } catch { return def }
}
function saveLS(key, val) { localStorage.setItem(key, JSON.stringify(val)) }
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6) }

// ── STATUSES ─────────────────────────────────────────────────────────────────
const statuses = ref(loadLS('nindou-statuses', []))
const newSLabel = ref('')
const newSColor = ref('#52b788')
const editSId = ref(null)
const editSLabel = ref('')
const editSColor = ref('')

function saveStatuses() { saveLS('nindou-statuses', statuses.value) }

function addStatus() {
  const label = newSLabel.value.trim()
  if (!label) return
  statuses.value.push({ id: uid(), label, color: newSColor.value })
  newSLabel.value = ''
  saveStatuses()
}
function startEditStatus(s) { editSId.value = s.id; editSLabel.value = s.label; editSColor.value = s.color }
function saveEditStatus() {
  const s = statuses.value.find(x => x.id === editSId.value)
  if (s) { s.label = editSLabel.value.trim() || s.label; s.color = editSColor.value }
  editSId.value = null
  saveStatuses()
}
function deleteStatus(id) {
  statuses.value = statuses.value.filter(x => x.id !== id)
  lots.value.forEach(l => { if (l.statusId === id) l.statusId = null })
  saveStatuses(); saveLots()
}
function getStatus(id) { return id ? statuses.value.find(s => s.id === id) ?? null : null }

// ── LOTS ─────────────────────────────────────────────────────────────────────
const lots = ref(loadLS('nindou-lots', []))
const newLotText = ref('')
const editLotId = ref(null)
const editLotText = ref('')

function saveLots() { saveLS('nindou-lots', lots.value) }

function addLot() {
  const text = newLotText.value.trim()
  if (!text) return
  lots.value.push({ id: uid(), text, selected: false, statusId: null })
  newLotText.value = ''
  saveLots()
}
function startEditLot(lot) { editLotId.value = lot.id; editLotText.value = lot.text }
function cancelEditLot() { editLotId.value = null }
function saveEditLot() {
  const l = lots.value.find(x => x.id === editLotId.value)
  if (l && editLotText.value.trim()) l.text = editLotText.value.trim()
  editLotId.value = null; saveLots()
}
function deleteLot(id) {
  lots.value = lots.value.filter(x => x.id !== id)
  if (winner.value?.id === id) winner.value = null
  saveLots()
}
function toggleSelect(lot) { lot.selected = !lot.selected; saveLots() }
function selectAll()  { lots.value.forEach(l => l.selected = true);  saveLots() }
function selectNone() { lots.value.forEach(l => l.selected = false); saveLots() }
function assignStatus(lot, statusId) { lot.statusId = lot.statusId === statusId ? null : statusId; saveLots() }

const selectedLots = computed(() => lots.value.filter(l => l.selected))

// ── ROULETTE WHEEL ────────────────────────────────────────────────────────────
const COLORS = [
  '#c0392b','#e67e22','#f1c40f','#27ae60','#2980b9',
  '#8e44ad','#e91e63','#00bcd4','#ff5722','#607d8b',
  '#795548','#009688','#3f51b5','#ff9800','#4caf50',
]

const wheelAngle = ref(0)
const isSpinning = ref(false)
const SPIN_SEC = 5
const winner = ref(null)
const history = ref([])

const wheelSectors = computed(() => {
  const pool = selectedLots.value
  if (!pool.length) return []
  const n = pool.length
  const cx = 150, cy = 150, r = 138
  return pool.map((lot, i) => {
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
      label: lot.text.length > 5 ? lot.text.slice(0, 5) + '…' : lot.text,
    }
  })
})

const wheelFontSz = computed(() => {
  const n = selectedLots.value.length
  return n <= 4 ? 13 : n <= 8 ? 11 : n <= 14 ? 9 : 7
})

const wheelStyle = computed(() => ({
  transform: `rotate(${wheelAngle.value}deg)`,
  transition: isSpinning.value ? `transform ${SPIN_SEC}s cubic-bezier(0.08, 0.01, 0.18, 1)` : 'none',
}))

async function spin() {
  if (!selectedLots.value.length || isSpinning.value) return
  const pool = selectedLots.value
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
  isSpinning.value = true
  wheelAngle.value += delta
  await new Promise(r => setTimeout(r, (SPIN_SEC + 0.5) * 1000))
  isSpinning.value = false
  winner.value = picked
  history.value.unshift({ lot: picked, time: new Date().toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit' }) })
  if (history.value.length > 8) history.value.pop()
}
</script>

<template>
  <div class="ld">
    <div class="ld-body">

      <!-- ══ LEFT COLUMN ══ -->
      <div class="ld-left">

        <!-- 轉盤 (top) -->
        <div class="wheel-sec">
          <div class="wheel-frame">
            <!-- Outer deco ring -->
            <div class="deco-ring"></div>
            <!-- Pointer -->
            <div class="pointer-wrap">
              <div class="pointer-body">
                <div class="pointer-tri"></div>
                <div class="pointer-stem"></div>
              </div>
            </div>
            <!-- Spinning SVG -->
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

                <!-- Dark base -->
                <circle cx="150" cy="150" r="148" fill="#0c0a16"/>

                <!-- Sectors -->
                <g v-if="wheelSectors.length" filter="url(#segShadow)">
                  <path v-for="(s, i) in wheelSectors" :key="'s'+i"
                    :d="s.path" :fill="s.fill"
                    stroke="rgba(0,0,0,0.3)" stroke-width="1.5"
                  />
                </g>

                <!-- Sector text -->
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

                <!-- Empty hint -->
                <text v-if="!wheelSectors.length"
                  x="150" y="150" text-anchor="middle" dominant-baseline="middle"
                  fill="#444466" font-size="12" font-weight="600">點擊右側籤加入</text>

                <!-- Outer gold border -->
                <circle cx="150" cy="150" r="138" fill="none" stroke="#c89840" stroke-width="5"/>
                <!-- Second ring -->
                <circle cx="150" cy="150" r="130" fill="none" stroke="rgba(200,152,64,0.2)" stroke-width="1"/>
                <!-- Marker dots on border -->
                <g v-for="n in 16" :key="n">
                  <circle
                    :cx="150 + 143 * Math.cos((n/16*360 - 90) * Math.PI/180)"
                    :cy="150 + 143 * Math.sin((n/16*360 - 90) * Math.PI/180)"
                    r="3.5" fill="#c89840"
                  />
                </g>

                <!-- Center hub -->
                <circle cx="150" cy="150" r="26" fill="#0c0a16" stroke="#c89840" stroke-width="3.5"/>
                <circle cx="150" cy="150" r="16" fill="url(#hubGold)"/>
                <circle cx="150" cy="150" r="6"  fill="rgba(255,255,255,0.5)"/>
              </svg>
            </div>
          </div>

          <button
            class="spin-btn"
            :class="{ spinning: isSpinning, disabled: !selectedLots.length || isSpinning }"
            :disabled="!selectedLots.length || isSpinning"
            @click="spin"
          >
            <span v-if="isSpinning">旋轉中⋯</span>
            <span v-else>SPIN</span>
          </button>

          <div class="part-info">
            <span v-if="selectedLots.length" class="part-count">{{ selectedLots.length }} 人參與</span>
            <span v-else class="part-empty">請從右側選擇參與者</span>
          </div>
        </div>

        <!-- 結果 (bottom) -->
        <div class="result-sec">
          <div class="result-hd">抽籤結果</div>

          <Transition name="win">
            <div v-if="winner" class="winner-box">
              <div class="win-sparkle">🎊</div>
              <div class="win-name">{{ winner.text }}</div>
              <div v-if="getStatus(winner.statusId)" class="win-badge"
                :style="{ color: getStatus(winner.statusId).color, borderColor: getStatus(winner.statusId).color + '55', background: getStatus(winner.statusId).color + '14' }"
              >{{ getStatus(winner.statusId).label }}</div>
              <div v-if="statuses.length" class="assign-row">
                <button v-for="s in statuses" :key="s.id"
                  class="assign-btn" :class="{ on: winner.statusId === s.id }"
                  :style="{ '--sc': s.color }"
                  @click="assignStatus(winner, s.id)"
                >{{ s.label }}</button>
              </div>
            </div>
            <div v-else class="no-result">
              <span v-if="isSpinning" class="spinning-text">抽籤進行中⋯</span>
              <span v-else>尚未抽籤</span>
            </div>
          </Transition>

          <div v-if="history.length" class="history">
            <div class="hist-hd">歷史紀錄</div>
            <div v-for="(h, i) in history" :key="i" class="hist-row" :class="{ latest: i===0 }">
              <span class="hist-time">{{ h.time }}</span>
              <span class="hist-name">{{ h.lot.text }}</span>
              <span v-if="getStatus(h.lot.statusId)" class="hist-status"
                :style="{ color: getStatus(h.lot.statusId).color }">
                {{ getStatus(h.lot.statusId).label }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <!-- ══ RIGHT ASIDE ══ -->
      <aside class="stick-aside">
        <div class="aside-hd">
          <span class="aside-title">籤庫</span>
          <span class="aside-count">{{ lots.length }} 支</span>
          <div class="aside-acts">
            <button class="aside-act" @click="selectAll">全入</button>
            <button class="aside-act" @click="selectNone">全出</button>
          </div>
        </div>

        <!-- Add lot -->
        <div class="lot-add-row">
          <input v-model="newLotText" class="lot-inp" placeholder="輸入名字⋯" maxlength="8" @keydown.enter="addLot"/>
          <button class="lot-add-btn" @click="addLot">新增</button>
        </div>

        <!-- Fortune sticks grid -->
        <div class="sticks-grid">
          <div v-if="!lots.length" class="sticks-empty">尚未新增任何籤</div>

          <div v-for="lot in lots" :key="lot.id"
            class="stick" :class="{ 'stick-on': lot.selected }"
            :title="lot.selected ? '點擊移出轉盤' : '點擊加入轉盤'"
            @click="toggleSelect(lot)"
          >
            <button class="stick-del" @click.stop="deleteLot(lot.id)">×</button>
            <span v-if="getStatus(lot.statusId)" class="stick-dot"
              :style="{ background: getStatus(lot.statusId).color }"></span>
            <span class="stick-name">{{ lot.text }}</span>
            <div class="stick-grain"></div>
          </div>
        </div>

        <!-- Status config -->
        <details class="status-cfg">
          <summary class="status-sum">狀態設定</summary>
          <div class="status-body">
            <div class="status-add">
              <input v-model="newSLabel" class="s-inp" placeholder="狀態名稱⋯" maxlength="10" @keydown.enter="addStatus"/>
              <input type="color" v-model="newSColor" class="c-inp"/>
              <button class="s-add-btn" @click="addStatus">+</button>
            </div>
            <div class="s-list">
              <div v-if="!statuses.length" class="s-empty">尚未設定狀態</div>
              <div v-for="s in statuses" :key="s.id" class="s-row">
                <template v-if="editSId === s.id">
                  <input type="color" v-model="editSColor" class="c-inp"/>
                  <input v-model="editSLabel" class="s-inp sm" maxlength="10" @keydown.enter="saveEditStatus" @keydown.escape="editSId = null"/>
                  <button class="s-btn ok" @click="saveEditStatus">✓</button>
                  <button class="s-btn" @click="editSId = null">✕</button>
                </template>
                <template v-else>
                  <span class="s-dot2" :style="{ background: s.color }"></span>
                  <span class="s-label">{{ s.label }}</span>
                  <button class="s-btn" @click="startEditStatus(s)">✏</button>
                  <button class="s-btn del" @click="deleteStatus(s.id)">✕</button>
                </template>
              </div>
            </div>
          </div>
        </details>
      </aside>

    </div>
  </div>
</template>

<style scoped>
/* ── LAYOUT ── */
.ld { min-height: 560px; }

.ld-body {
  display: grid;
  grid-template-columns: 1fr 220px;
  gap: 1px;
  background: var(--border);
  min-height: 560px;
}

@media (max-width: 680px) {
  .ld-body { grid-template-columns: 1fr; }
}

/* ── LEFT ── */
.ld-left {
  display: flex;
  flex-direction: column;
  background: var(--surface);
}

/* WHEEL SECTION */
.wheel-sec {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 20px 20px;
  gap: 18px;
  border-bottom: 1px solid var(--border);
}

.wheel-frame {
  position: relative;
  width: 300px;
  height: 300px;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Casino outer ring */
.deco-ring {
  position: absolute;
  top: -14px; left: -14px; right: -14px; bottom: -14px;
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
  content: '';
  position: absolute;
  top: 9px; left: 9px; right: 9px; bottom: 9px;
  border-radius: 50%;
  background: #12101e;
}

/* Pointer */
.pointer-wrap {
  position: absolute;
  top: -6px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  display: flex;
  flex-direction: column;
  align-items: center;
}
.pointer-body {
  display: flex;
  flex-direction: column;
  align-items: center;
  filter: drop-shadow(0 4px 8px rgba(0,0,0,0.7));
}
.pointer-tri {
  width: 0; height: 0;
  border-left: 13px solid transparent;
  border-right: 13px solid transparent;
  border-top: 32px solid var(--gold);
}
.pointer-stem {
  width: 8px; height: 14px;
  background: linear-gradient(to bottom, #f4c030, #8a5a00);
  border-radius: 0 0 4px 4px;
}

.wheel-svg {
  position: relative;
  z-index: 10;
  width: 300px;
  height: 300px;
}
.wheel-svg svg { width: 100%; height: 100%; }

/* SPIN BTN */
.spin-btn {
  padding: 13px 56px;
  border-radius: 40px;
  border: 2px solid var(--gold);
  background: linear-gradient(135deg, rgba(244,192,48,0.14), rgba(176,123,69,0.06));
  color: var(--gold);
  font-size: 1.15rem;
  font-weight: 900;
  letter-spacing: 0.22em;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.2s;
  box-shadow: 0 0 22px rgba(244,192,48,0.14), inset 0 1px rgba(255,255,255,0.08);
  position: relative;
  overflow: hidden;
}
.spin-btn::after {
  content: '';
  position: absolute;
  top: 0; left: -100%; width: 50%; height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.12), transparent);
  transition: left 0.5s;
}
.spin-btn:hover:not([disabled])::after { left: 200%; }
.spin-btn:hover:not([disabled]) {
  background: linear-gradient(135deg, rgba(244,192,48,0.22), rgba(176,123,69,0.12));
  box-shadow: 0 0 36px rgba(244,192,48,0.28);
  transform: translateY(-2px);
}
.spin-btn.disabled, .spin-btn.spinning {
  opacity: 0.38; cursor: not-allowed; transform: none;
}

.part-info { font-size: 0.76rem; }
.part-count { color: var(--text3); }
.part-empty { color: var(--text3); font-style: italic; }

/* RESULT SECTION */
.result-sec {
  flex: 1;
  padding: 18px 22px;
  overflow-y: auto;
}

.result-hd {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.18em;
  color: var(--text3);
  margin-bottom: 14px;
}

/* Winner animation */
.win-enter-active { animation: winPop 0.65s cubic-bezier(0.34, 1.56, 0.64, 1); }
@keyframes winPop {
  0%   { opacity: 0; transform: scale(0.35) rotate(-8deg); }
  60%  { transform: scale(1.07) rotate(2deg); }
  100% { opacity: 1; transform: scale(1) rotate(0); }
}

.winner-box {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 7px;
  background: linear-gradient(135deg, rgba(244,192,48,0.08), rgba(176,123,69,0.03));
  border: 1px solid rgba(244,192,48,0.3);
  border-radius: var(--radius-lg);
  padding: 18px 20px;
  margin-bottom: 16px;
  box-shadow: 0 0 28px rgba(244,192,48,0.08);
}
.win-sparkle { font-size: 1.5rem; }
.win-name { font-size: 1.75rem; font-weight: 800; color: var(--text); }
.win-badge {
  padding: 2px 12px; border-radius: 10px; border: 1px solid;
  font-size: 0.75rem; font-weight: 600;
}
.assign-row { display: flex; flex-wrap: wrap; gap: 5px; justify-content: center; margin-top: 4px; }
.assign-btn {
  padding: 3px 12px; border-radius: 12px; border: 1px solid var(--sc);
  background: transparent; color: var(--sc); font-size: 0.75rem; font-weight: 600;
  font-family: inherit; cursor: pointer; transition: all 0.12s;
}
.assign-btn:hover { opacity: 0.75; }
.assign-btn.on { background: var(--sc); color: #fff; }

.no-result { padding: 20px; text-align: center; color: var(--text3); font-size: 0.82rem; }
.spinning-text { color: var(--gold); animation: pulse 1s ease-in-out infinite; }
@keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }

/* History */
.history { margin-top: 4px; }
.hist-hd {
  font-size: 0.62rem; text-transform: uppercase; letter-spacing: 0.14em;
  color: var(--text3); margin-bottom: 8px; padding-bottom: 5px; border-bottom: 1px solid var(--border);
}
.hist-row {
  display: flex; align-items: center; gap: 8px; padding: 5px 0;
  border-bottom: 1px solid var(--border); font-size: 0.78rem; color: var(--text2);
}
.hist-row.latest { color: var(--gold); }
.hist-time { font-size: 0.68rem; color: var(--text3); font-variant-numeric: tabular-nums; }
.hist-name { flex: 1; font-weight: 600; }
.hist-status { font-size: 0.68rem; }

/* ── RIGHT ASIDE ── */
.stick-aside {
  background: var(--surface);
  display: flex;
  flex-direction: column;
  padding: 12px 10px;
  overflow-y: auto;
  max-height: 560px;
}

.aside-hd {
  display: flex; align-items: center; gap: 6px; margin-bottom: 10px;
}
.aside-title { font-size: 0.88rem; font-weight: 700; color: var(--text); }
.aside-count {
  font-size: 0.65rem; color: var(--text3); background: var(--surface2);
  border: 1px solid var(--border); padding: 1px 7px; border-radius: 9px;
}
.aside-acts { display: flex; gap: 4px; margin-left: auto; }
.aside-act {
  padding: 2px 7px; border-radius: 8px; border: 1px solid var(--border2);
  background: var(--surface2); color: var(--text3); font-size: 0.65rem;
  font-family: inherit; cursor: pointer; transition: all 0.12s;
}
.aside-act:hover { color: var(--text); border-color: var(--text3); }

.lot-add-row { display: flex; gap: 5px; margin-bottom: 10px; }
.lot-inp {
  flex: 1; min-width: 0; background: var(--surface2); border: 1px solid var(--border);
  border-radius: var(--radius); color: var(--text); font-size: 0.8rem; padding: 5px 8px;
  outline: none; font-family: inherit; transition: border-color 0.15s;
}
.lot-inp:focus { border-color: var(--gold); }
.lot-add-btn {
  padding: 5px 10px; border-radius: var(--radius); border: 1px solid var(--border2);
  background: var(--surface2); color: var(--text2); font-size: 0.78rem;
  font-family: inherit; cursor: pointer; transition: all 0.12s; white-space: nowrap;
}
.lot-add-btn:hover { border-color: var(--gold); color: var(--gold); }

/* ── STICKS ── */
.sticks-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 2px 0 10px;
  align-content: flex-start;
}
.sticks-empty { font-size: 0.75rem; color: var(--text3); padding: 8px 0; width: 100%; }

.stick {
  position: relative;
  width: 42px;
  min-height: 112px;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  transition: transform 0.18s, filter 0.18s;
  user-select: none;
  flex-shrink: 0;
}

/* Stick top cap */
.stick::before {
  content: '';
  position: absolute;
  top: 0; left: 50%; transform: translateX(-50%);
  width: 36px; height: 18px;
  background: linear-gradient(
    to right,
    #241008 0%, #4a2010 30%, #7a3a18 50%, #4a2010 70%, #241008 100%
  );
  border-radius: 10px 10px 2px 2px;
  border: 1px solid #180a04;
  box-shadow: 0 2px 4px rgba(0,0,0,0.5);
  z-index: 1;
}

/* Stick body */
.stick::after {
  content: '';
  position: absolute;
  top: 12px; left: 0; right: 0; bottom: 0;
  background: linear-gradient(
    to right,
    #3d1a08 0%, #6b3010 8%, #a85c2a 24%,
    #d47a44 42%, #e08a50 50%, #d47a44 58%,
    #a85c2a 76%, #6b3010 92%, #3d1a08 100%
  );
  border-radius: 3px 3px 7px 7px;
  border: 1px solid #281208;
  box-shadow:
    inset 2px 0 5px rgba(255,180,80,0.1),
    inset -2px 0 5px rgba(0,0,0,0.2),
    2px 4px 10px rgba(0,0,0,0.55);
  z-index: 0;
}

/* Wood grain lines */
.stick-grain {
  position: absolute;
  top: 14px; left: 12px; right: 12px; bottom: 4px;
  z-index: 1;
  background: repeating-linear-gradient(
    180deg,
    transparent 0px,
    transparent 5px,
    rgba(0,0,0,0.04) 5px,
    rgba(0,0,0,0.04) 6px
  );
  border-radius: 2px;
  pointer-events: none;
}

.stick-name {
  position: relative;
  z-index: 2;
  writing-mode: vertical-rl;
  text-orientation: mixed;
  font-size: 0.8rem;
  color: #230e04;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-shadow: 0 1px 0 rgba(255,200,120,0.4);
  max-height: 74px;
  overflow: hidden;
  margin-top: 10px;
  line-height: 1.4;
}

.stick-del {
  position: absolute; top: 2px; right: 0px; z-index: 20;
  width: 15px; height: 15px; border-radius: 50%; border: none;
  background: rgba(220, 50, 60, 0.75); color: white; font-size: 0.58rem;
  cursor: pointer; display: none; align-items: center; justify-content: center;
  line-height: 1; padding: 0; font-family: inherit;
}
.stick:hover .stick-del { display: flex; }

.stick-dot {
  position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%);
  width: 7px; height: 7px; border-radius: 50%; z-index: 3;
  border: 1px solid rgba(0,0,0,0.35);
}

.stick:hover { transform: translateY(-5px) scale(1.05); filter: brightness(1.1); }

/* SELECTED (in drum) */
.stick.stick-on::before {
  background: linear-gradient(
    to right,
    #1a0c00 0%, #2e1800 30%, #4e2c00 50%, #2e1800 70%, #1a0c00 100%
  );
  border-color: rgba(244,192,48,0.45);
}
.stick.stick-on::after {
  background: linear-gradient(
    to right,
    #160a00 0%, #281400 8%, #401e00 24%,
    #542800 42%, #5e2e00 50%, #542800 58%,
    #401e00 76%, #281400 92%, #160a00 100%
  );
  border-color: rgba(244,192,48,0.45);
  box-shadow:
    0 0 16px rgba(244,192,48,0.18),
    0 0 6px rgba(244,192,48,0.1),
    inset 0 0 12px rgba(244,192,48,0.05),
    2px 4px 10px rgba(0,0,0,0.65);
}
.stick.stick-on .stick-name {
  color: var(--gold);
  text-shadow: 0 0 10px rgba(244,192,48,0.45), 0 1px 0 rgba(0,0,0,0.3);
}

/* STATUS CONFIG */
.status-cfg {
  margin-top: auto;
  padding-top: 10px;
  border-top: 1px solid var(--border);
}
.status-sum {
  font-size: 0.7rem; color: var(--text3); cursor: pointer; padding: 4px 0;
  list-style: none; user-select: none; letter-spacing: 0.04em;
}
.status-sum:hover { color: var(--text2); }
.status-body { padding: 8px 0 0; }
.status-add { display: flex; gap: 4px; margin-bottom: 7px; align-items: center; }
.s-inp {
  flex: 1; min-width: 0; background: var(--surface2); border: 1px solid var(--border);
  border-radius: var(--radius); color: var(--text); font-size: 0.75rem;
  padding: 4px 6px; outline: none; font-family: inherit;
}
.s-inp:focus { border-color: var(--gold); }
.s-inp.sm { max-width: 80px; flex: none; }
.c-inp {
  width: 28px; height: 27px; border: 1px solid var(--border); border-radius: 4px;
  background: var(--surface2); cursor: pointer; padding: 1px; flex-shrink: 0;
}
.s-add-btn {
  width: 26px; height: 27px; border-radius: var(--radius); border: 1px solid rgba(244,192,48,0.3);
  background: rgba(244,192,48,0.06); color: var(--gold); font-size: 1rem;
  font-family: inherit; cursor: pointer; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
}
.s-add-btn:hover { background: rgba(244,192,48,0.14); }
.s-list { display: flex; flex-direction: column; gap: 4px; }
.s-empty { font-size: 0.72rem; color: var(--text3); }
.s-row {
  display: flex; align-items: center; gap: 5px; background: var(--surface2);
  border: 1px solid var(--border); border-radius: var(--radius); padding: 4px 6px;
}
.s-dot2 { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
.s-label { flex: 1; font-size: 0.75rem; color: var(--text2); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.s-btn {
  width: 22px; height: 22px; border-radius: 4px; border: 1px solid var(--border);
  background: transparent; color: var(--text3); font-size: 0.7rem; cursor: pointer;
  font-family: inherit; display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; transition: all 0.12s; padding: 0;
}
.s-btn:hover { border-color: var(--text3); color: var(--text); }
.s-btn.del:hover { border-color: var(--red); color: var(--red); }
.s-btn.ok { border-color: rgba(82,183,136,0.35); color: var(--green); }
.s-btn.ok:hover { background: rgba(82,183,136,0.1); }
</style>
