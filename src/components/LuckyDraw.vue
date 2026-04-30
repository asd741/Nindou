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
const newSColor = ref('#e63946')
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

function startEditStatus(s) {
  editSId.value = s.id
  editSLabel.value = s.label
  editSColor.value = s.color
}

function saveEditStatus() {
  const s = statuses.value.find(x => x.id === editSId.value)
  if (s) { s.label = editSLabel.value.trim() || s.label; s.color = editSColor.value }
  editSId.value = null
  saveStatuses()
}

function deleteStatus(id) {
  statuses.value = statuses.value.filter(x => x.id !== id)
  lots.value.forEach(l => { if (l.statusId === id) l.statusId = null })
  saveStatuses()
  saveLots()
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
  lots.value.push({ id: uid(), text, selected: true, statusId: null })
  newLotText.value = ''
  saveLots()
}

function startEditLot(lot) {
  editLotId.value = lot.id
  editLotText.value = lot.text
}

function saveEditLot() {
  const l = lots.value.find(x => x.id === editLotId.value)
  if (l && editLotText.value.trim()) l.text = editLotText.value.trim()
  editLotId.value = null
  saveLots()
}

function cancelEditLot() { editLotId.value = null }

function deleteLot(id) {
  lots.value = lots.value.filter(x => x.id !== id)
  if (winner.value?.id === id) reset()
  saveLots()
}

function toggleSelect(lot) { lot.selected = !lot.selected; saveLots() }
function selectAll()  { lots.value.forEach(l => l.selected = true); saveLots() }
function selectNone() { lots.value.forEach(l => l.selected = false); saveLots() }

function assignStatus(lot, statusId) {
  lot.statusId = lot.statusId === statusId ? null : statusId
  saveLots()
}

const selectedLots = computed(() => lots.value.filter(l => l.selected))

// ── DRAW ─────────────────────────────────────────────────────────────────────

const phase = ref('idle')   // idle | drawing | done
const cyclingLot = ref(null)
const winner = ref(null)

async function startDraw() {
  if (!selectedLots.value.length || phase.value !== 'idle') return

  const pool = [...selectedLots.value]
  const picked = pool[Math.floor(Math.random() * pool.length)]

  winner.value = null
  phase.value = 'drawing'

  await new Promise(resolve => {
    let elapsed = 0
    const total = 2800

    const tick = () => {
      cyclingLot.value = pool[Math.floor(Math.random() * pool.length)]
      const progress = elapsed / total
      const delay = Math.round(60 + progress * progress * 360)
      elapsed += delay
      if (elapsed < total) setTimeout(tick, delay)
      else setTimeout(resolve, delay)
    }
    tick()
  })

  cyclingLot.value = null
  winner.value = picked
  phase.value = 'done'
}

function reset() {
  phase.value = 'idle'
  winner.value = null
  cyclingLot.value = null
}
</script>

<template>
  <div class="ld">

    <!-- ══ 抽獎區 ══ -->
    <div class="draw-sec">

      <!-- 參與預覽 -->
      <div v-if="selectedLots.length && phase === 'idle'" class="preview-row">
        <span
          v-for="l in selectedLots.slice(0, 7)" :key="l.id"
          class="preview-tag"
          :class="{ 'has-status': getStatus(l.statusId) }"
          :style="getStatus(l.statusId) ? { borderColor: getStatus(l.statusId).color, color: getStatus(l.statusId).color } : {}"
        >{{ l.text }}</span>
        <span v-if="selectedLots.length > 7" class="preview-more">+{{ selectedLots.length - 7 }}</span>
      </div>
      <div v-else-if="!lots.length" class="no-lots-hint">請先在下方新增籤</div>
      <div v-else-if="!selectedLots.length" class="no-lots-hint">請勾選要參加的籤</div>

      <!-- 籤桶 -->
      <div class="barrel-wrap">
        <div class="barrel" :class="{ spinning: phase === 'drawing' }">
          <div v-if="phase === 'drawing' && cyclingLot" class="barrel-cycling">
            {{ cyclingLot.text }}
          </div>
          <div v-else-if="phase === 'idle'" class="barrel-idle">
            <span v-if="selectedLots.length" class="barrel-count">{{ selectedLots.length }}</span>
            <span v-if="selectedLots.length" class="barrel-unit">支籤</span>
            <span v-else class="barrel-empty">—</span>
          </div>
        </div>
        <!-- 底座裝飾 -->
        <div class="barrel-stand"></div>
      </div>

      <!-- 操作按鈕 -->
      <button
        class="draw-btn"
        :class="{ 'draw-btn-disabled': !selectedLots.length || phase === 'drawing', 'draw-btn-reset': phase === 'done' }"
        :disabled="!selectedLots.length || phase === 'drawing'"
        @click="phase === 'done' ? reset() : startDraw()"
      >
        <span v-if="phase === 'idle'">開始抽獎</span>
        <span v-else-if="phase === 'drawing'">抽籤中⋯</span>
        <span v-else>再抽一次</span>
      </button>

      <!-- 結果 -->
      <Transition name="winner-pop">
        <div v-if="phase === 'done' && winner" class="winner-card">
          <div class="winner-sparkle">🎊</div>
          <div class="winner-title">抽到了！</div>
          <div class="winner-name">{{ winner.text }}</div>
          <div v-if="getStatus(winner.statusId)" class="winner-cur-status"
            :style="{ color: getStatus(winner.statusId).color, borderColor: getStatus(winner.statusId).color + '55', background: getStatus(winner.statusId).color + '15' }"
          >{{ getStatus(winner.statusId).label }}</div>
          <div v-if="statuses.length" class="winner-assign">
            <span class="assign-label">標記狀態：</span>
            <button
              v-for="s in statuses" :key="s.id"
              class="assign-btn"
              :class="{ 'assign-active': winner.statusId === s.id }"
              :style="{ '--sc': s.color }"
              @click="assignStatus(winner, s.id)"
            >{{ s.label }}</button>
          </div>
        </div>
      </Transition>

    </div>

    <!-- ══ 籤管理 ══ -->
    <div class="ld-section">
      <div class="sec-hd">
        <span class="sec-title">籤管理</span>
        <span class="sec-count">共 {{ lots.length }} 支</span>
      </div>

      <!-- 新增 -->
      <div class="add-row">
        <input
          v-model="newLotText"
          class="add-inp"
          placeholder="輸入籤上的文字⋯"
          maxlength="30"
          @keydown.enter="addLot"
        />
        <button class="add-btn" @click="addLot">新增</button>
      </div>

      <!-- 全選列 -->
      <div v-if="lots.length" class="sel-row">
        <button class="sel-btn" @click="selectAll">全選</button>
        <button class="sel-btn" @click="selectNone">全不選</button>
        <span class="sel-info">已選 {{ selectedLots.length }} / {{ lots.length }}</span>
      </div>

      <!-- 籤列表 -->
      <div class="lot-list">
        <div v-if="!lots.length" class="list-empty">尚未新增任何籤</div>

        <div v-for="lot in lots" :key="lot.id" class="lot-row">
          <!-- 勾選 -->
          <button
            class="lot-check"
            :class="{ checked: lot.selected }"
            @click="toggleSelect(lot)"
            :title="lot.selected ? '取消參加' : '加入抽籤'"
          >{{ lot.selected ? '✓' : '' }}</button>

          <!-- 文字或編輯框 -->
          <template v-if="editLotId === lot.id">
            <input
              v-model="editLotText"
              class="edit-inp"
              maxlength="30"
              @keydown.enter="saveEditLot"
              @keydown.escape="cancelEditLot"
            />
            <button class="act-btn save-btn" @click="saveEditLot">儲存</button>
            <button class="act-btn" @click="cancelEditLot">取消</button>
          </template>
          <template v-else>
            <span class="lot-text">{{ lot.text }}</span>
            <span v-if="getStatus(lot.statusId)" class="lot-chip"
              :style="{ color: getStatus(lot.statusId).color, borderColor: getStatus(lot.statusId).color + '55', background: getStatus(lot.statusId).color + '12' }"
            >{{ getStatus(lot.statusId).label }}</span>
            <div class="lot-actions">
              <button class="act-btn" title="編輯" @click="startEditLot(lot)">✏</button>
              <button class="act-btn del-btn" title="刪除" @click="deleteLot(lot.id)">✕</button>
            </div>
          </template>
        </div>
      </div>
    </div>

    <!-- ══ 狀態設定 ══ -->
    <div class="ld-section">
      <div class="sec-hd">
        <span class="sec-title">狀態設定</span>
        <span class="sec-count">共 {{ statuses.length }} 種</span>
      </div>

      <!-- 新增 -->
      <div class="add-row">
        <input
          v-model="newSLabel"
          class="add-inp"
          placeholder="狀態名稱⋯"
          maxlength="12"
          @keydown.enter="addStatus"
        />
        <input type="color" v-model="newSColor" class="color-inp" title="選擇顏色" />
        <button class="add-btn" @click="addStatus">新增</button>
      </div>

      <!-- 狀態列表 -->
      <div class="status-list">
        <div v-if="!statuses.length" class="list-empty">尚未設定任何狀態</div>

        <div v-for="s in statuses" :key="s.id" class="status-row">
          <template v-if="editSId === s.id">
            <input type="color" v-model="editSColor" class="color-inp" />
            <input v-model="editSLabel" class="edit-inp sm" maxlength="12" @keydown.enter="saveEditStatus" @keydown.escape="editSId = null" />
            <button class="act-btn save-btn" @click="saveEditStatus">儲存</button>
            <button class="act-btn" @click="editSId = null">取消</button>
          </template>
          <template v-else>
            <span class="s-dot" :style="{ background: s.color }"></span>
            <span class="s-label">{{ s.label }}</span>
            <span class="s-used">{{ lots.filter(l => l.statusId === s.id).length }} 支</span>
            <div class="lot-actions">
              <button class="act-btn" title="編輯" @click="startEditStatus(s)">✏</button>
              <button class="act-btn del-btn" title="刪除" @click="deleteStatus(s.id)">✕</button>
            </div>
          </template>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.ld {
  padding-bottom: 24px;
}

/* ── 抽獎區 ── */
.draw-sec {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 20px 28px;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  gap: 18px;
  min-height: 340px;
}

/* 參與預覽 */
.preview-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  justify-content: center;
  max-width: 540px;
}
.preview-tag {
  padding: 2px 10px;
  border-radius: 12px;
  border: 1px solid var(--border2);
  background: var(--surface2);
  color: var(--text2);
  font-size: 0.78rem;
  transition: all 0.15s;
}
.preview-tag.has-status { font-weight: 600; }
.preview-more {
  padding: 2px 10px;
  border-radius: 12px;
  border: 1px solid var(--border);
  color: var(--text3);
  font-size: 0.78rem;
}
.no-lots-hint {
  font-size: 0.8rem;
  color: var(--text3);
}

/* 籤桶 */
.barrel-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0;
}

.barrel {
  width: 164px;
  height: 164px;
  border-radius: 50%;
  background: radial-gradient(circle at 38% 32%, #3d2010 0%, #140905 100%);
  border: 4px solid #c8853a;
  box-shadow:
    0 0 0 2px #7a4820,
    inset 0 4px 16px rgba(0,0,0,0.65),
    0 6px 24px rgba(0,0,0,0.4);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  position: relative;
  transition: box-shadow 0.3s;
}

.barrel.spinning {
  animation: barrelShake 0.22s ease-in-out infinite;
  box-shadow:
    0 0 0 2px var(--gold),
    0 0 24px rgba(244, 192, 48, 0.25),
    inset 0 4px 16px rgba(0,0,0,0.65);
}

@keyframes barrelShake {
  0%   { transform: rotate(-6deg) scale(1.04); }
  25%  { transform: rotate(6deg)  scale(0.96); }
  50%  { transform: rotate(-5deg) scale(1.03); }
  75%  { transform: rotate(5deg)  scale(0.97); }
  100% { transform: rotate(-6deg) scale(1.04); }
}

.barrel-cycling {
  font-size: 1rem;
  font-weight: 700;
  color: var(--gold);
  text-align: center;
  padding: 0 16px;
  line-height: 1.3;
  text-shadow: 0 0 12px rgba(244, 192, 48, 0.6);
  max-width: 140px;
  word-break: break-all;
}

.barrel-idle {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.barrel-count {
  font-size: 2.4rem;
  font-weight: 800;
  color: var(--text2);
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.barrel-unit {
  font-size: 0.72rem;
  color: var(--text3);
  letter-spacing: 0.1em;
}
.barrel-empty { font-size: 1.2rem; color: var(--text3); }

/* 底座 */
.barrel-stand {
  width: 80px;
  height: 10px;
  background: linear-gradient(to bottom, #7a4820, #3a2010);
  border-radius: 0 0 8px 8px;
  box-shadow: 0 4px 8px rgba(0,0,0,0.3);
}

/* 抽獎按鈕 */
.draw-btn {
  padding: 12px 36px;
  border-radius: 28px;
  border: 2px solid var(--gold);
  background: rgba(244, 192, 48, 0.1);
  color: var(--gold);
  font-size: 1rem;
  font-weight: 700;
  font-family: inherit;
  letter-spacing: 0.08em;
  cursor: pointer;
  transition: all 0.15s;
  box-shadow: 0 0 16px rgba(244, 192, 48, 0.15);
}

.draw-btn:hover:not(:disabled) {
  background: rgba(244, 192, 48, 0.18);
  box-shadow: 0 0 24px rgba(244, 192, 48, 0.3);
  transform: translateY(-1px);
}

.draw-btn-disabled {
  border-color: var(--border2);
  color: var(--text3);
  background: transparent;
  box-shadow: none;
  cursor: not-allowed;
}

.draw-btn-reset {
  border-color: var(--blue);
  color: var(--blue);
  background: rgba(116, 185, 255, 0.08);
  box-shadow: none;
}

/* 結果卡片 */
.winner-pop-enter-active {
  animation: winnerPop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards;
}

@keyframes winnerPop {
  0%   { opacity: 0; transform: scale(0.4) translateY(-20px); }
  60%  { transform: scale(1.06) translateY(4px); }
  100% { opacity: 1; transform: scale(1) translateY(0); }
}

.winner-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  background: var(--surface2);
  border: 1px solid rgba(244, 192, 48, 0.35);
  border-radius: var(--radius-lg);
  padding: 20px 28px;
  min-width: 240px;
  box-shadow: 0 0 30px rgba(244, 192, 48, 0.1);
}

.winner-sparkle { font-size: 1.6rem; }
.winner-title {
  font-size: 0.72rem;
  color: var(--gold);
  text-transform: uppercase;
  letter-spacing: 0.2em;
  font-weight: 600;
}
.winner-name {
  font-size: 1.9rem;
  font-weight: 800;
  color: var(--text);
  letter-spacing: 0.04em;
}
.winner-cur-status {
  padding: 2px 12px;
  border-radius: 12px;
  border: 1px solid;
  font-size: 0.78rem;
  font-weight: 600;
}

.winner-assign {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 4px;
}
.assign-label {
  font-size: 0.72rem;
  color: var(--text3);
}
.assign-btn {
  padding: 3px 12px;
  border-radius: 12px;
  border: 1px solid var(--sc, var(--border2));
  background: transparent;
  color: var(--sc, var(--text3));
  font-size: 0.78rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.12s;
}
.assign-btn:hover { opacity: 0.8; }
.assign-btn.assign-active {
  background: var(--sc);
  color: #fff;
}

/* ── 通用 Section ── */
.ld-section {
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  padding: 18px 18px 20px;
}

.sec-hd {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 14px;
}
.sec-title {
  font-size: 0.9rem;
  font-weight: 700;
  color: var(--text);
  letter-spacing: 0.04em;
}
.sec-count {
  font-size: 0.72rem;
  color: var(--text3);
  background: var(--surface2);
  border: 1px solid var(--border);
  padding: 1px 8px;
  border-radius: 10px;
}

/* 新增表單 */
.add-row {
  display: flex;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.add-inp {
  flex: 1;
  min-width: 180px;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 0.88rem;
  padding: 6px 10px;
  outline: none;
  font-family: inherit;
  transition: border-color 0.15s;
}
.add-inp:focus { border-color: var(--gold); }
.add-btn {
  padding: 6px 16px;
  border-radius: var(--radius);
  border: 1px solid var(--gold);
  background: rgba(244, 192, 48, 0.08);
  color: var(--gold);
  font-size: 0.82rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.12s;
  white-space: nowrap;
}
.add-btn:hover { background: rgba(244, 192, 48, 0.15); }

/* 顏色選擇器 */
.color-inp {
  width: 36px;
  height: 34px;
  border: 1px solid var(--border2);
  border-radius: var(--radius);
  background: var(--surface2);
  cursor: pointer;
  padding: 2px;
}

/* 全選列 */
.sel-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 10px;
  flex-wrap: wrap;
}
.sel-btn {
  padding: 3px 12px;
  border-radius: 12px;
  border: 1px solid var(--border2);
  background: var(--surface2);
  color: var(--text2);
  font-size: 0.75rem;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.12s;
}
.sel-btn:hover { border-color: var(--text3); color: var(--text); }
.sel-info {
  font-size: 0.72rem;
  color: var(--text3);
}

/* 籤列表 */
.lot-list, .status-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.list-empty {
  font-size: 0.8rem;
  color: var(--text3);
  padding: 8px 0;
}

.lot-row {
  display: flex;
  align-items: center;
  gap: 8px;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 6px 10px;
  transition: border-color 0.12s;
}
.lot-row:hover { border-color: var(--border2); }

.lot-check {
  width: 24px;
  height: 24px;
  border-radius: 5px;
  border: 1px solid var(--border2);
  background: var(--surface);
  color: var(--green);
  font-size: 0.75rem;
  font-weight: 700;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  transition: all 0.12s;
  font-family: inherit;
}
.lot-check.checked {
  background: rgba(82, 183, 136, 0.12);
  border-color: var(--green);
}

.lot-text {
  flex: 1;
  font-size: 0.88rem;
  color: var(--text);
  min-width: 0;
  word-break: break-all;
}

.lot-chip {
  padding: 1px 8px;
  border-radius: 10px;
  border: 1px solid;
  font-size: 0.7rem;
  font-weight: 600;
  white-space: nowrap;
  flex-shrink: 0;
}

.lot-actions {
  display: flex;
  gap: 4px;
  flex-shrink: 0;
  margin-left: auto;
}

.act-btn {
  width: 26px;
  height: 26px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: transparent;
  color: var(--text3);
  font-size: 0.75rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: all 0.12s;
  font-family: inherit;
}
.act-btn:hover { border-color: var(--text3); color: var(--text2); }
.del-btn:hover { border-color: var(--red); color: var(--red); }
.save-btn { border-color: var(--green); color: var(--green); width: auto; padding: 0 10px; font-size: 0.75rem; }
.save-btn:hover { background: rgba(82,183,136,0.1); }

.edit-inp {
  flex: 1;
  background: var(--surface);
  border: 1px solid var(--gold);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 0.86rem;
  padding: 3px 8px;
  outline: none;
  font-family: inherit;
}
.edit-inp.sm { max-width: 160px; flex: none; }

/* 狀態列表 */
.status-row {
  display: flex;
  align-items: center;
  gap: 10px;
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 7px 10px;
}
.s-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}
.s-label {
  flex: 1;
  font-size: 0.86rem;
  color: var(--text);
}
.s-used {
  font-size: 0.7rem;
  color: var(--text3);
  white-space: nowrap;
}
</style>
