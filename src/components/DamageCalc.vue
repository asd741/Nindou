<script setup lang="ts">
/* ════════════════════════════════════════════════════════════════════════════
   傷害計算 — UI 層
   只負責「反應式接線 + 畫面 + 樣式」。所有規則在 src/damage/config.ts，
   引擎機械在 src/damage/engine.ts。要改規則請去 config.ts，不必動這支。
   ════════════════════════════════════════════════════════════════════════════ */
import { ref, reactive, computed } from 'vue'
import { resolveModifiers, signed } from '../damage/engine'
import {
  ELEMENTS, ELEM_COLOR, ELEMENT_ADJ, ELEMENT_RULE, elementMult,
  ATTACKER_BUFFS, DEFENDER_STATES, MODIFIER_CATEGORIES, SHURA_CORRECTION, ATTACK_TYPES, SPECIAL_RULES,
  type Element,
} from '../damage/config'
import type { AttackType, ModifierDef, ModifierStep, ModifierTone } from '../damage/types'

// enabled !== false 的才納入：把某規則 enabled 設為 false（或刪掉）即從 UI 與計算一併消失。
const attackTypes    = ATTACK_TYPES.filter(t => t.enabled !== false)
const attackerBuffs  = ATTACKER_BUFFS.filter(b => b.enabled !== false)
const defenderStates = DEFENDER_STATES.filter(s => s.enabled !== false)
const specialRules   = SPECIAL_RULES.filter(r => r.enabled !== false)

// 依分類分區（道具效果／忍術效果／職業特性）。空分區自動略過；分類順序由 config 決定。
function groupByCategory(defs: ModifierDef[]) {
  return MODIFIER_CATEGORIES
    .map(cat => ({ cat, items: defs.filter(d => d.category === cat) }))
    .filter(g => g.items.length > 0)
}
const attackerGroups  = groupByCategory(attackerBuffs)
const defenderGroups  = groupByCategory(defenderStates)

const TONE_CLASS: Record<ModifierTone, string> = { atk: 'atk-act', def: 'def-act', grn: 'grn-act', wrath: 'wrath' }

const activeTypeId = ref<string>(attackTypes[0].id)
const atkBuffs  = reactive<Record<string, boolean>>(Object.fromEntries(attackerBuffs.map(b => [b.id, false])))
const defStates = reactive<Record<string, boolean>>(Object.fromEntries(defenderStates.map(s => [s.id, false])))
const atkAttr   = reactive<{ a1: Element; a2: Element; dual: boolean }>({ a1: '無', a2: '無', dual: false })
const defAttr   = reactive<{ a1: Element; a2: Element; dual: boolean }>({ a1: '無', a2: '無', dual: false })
const inputs    = reactive<Record<string, number>>({ base: 0, specialDef: 0, atkStat: 0 })
const toggles   = reactive<Record<string, boolean>>(Object.fromEntries(specialRules.map(r => [r.id, false])))

const activeType = computed<AttackType>(() => attackTypes.find(t => t.id === activeTypeId.value) ?? attackTypes[0])

const atkAttrs = computed<Element[]>(() => atkAttr.dual && atkAttr.a2 !== atkAttr.a1 ? [atkAttr.a1, atkAttr.a2] : [atkAttr.a1])
const defAttrs = computed<Element[]>(() => defAttr.dual && defAttr.a2 !== defAttr.a1 ? [defAttr.a1, defAttr.a2] : [defAttr.a1])
const attackerHasShura = computed(() => atkAttrs.value.includes('修羅'))

// 攻方暴怒法印能否無視受擊方青蟲——攻方對承受倍率的唯一干涉。攻擊系忍術關閉此干涉，
// 使「攻方使用什麼都不影響傷害，只有受擊方自身狀態生效」。
const attackerWrathOnDrm = computed(() =>
  activeType.value.uses.attackerWrathVoidsGreenBug !== false && !!atkBuffs.wrathSeal)

const bamRes = computed(() => resolveModifiers(attackerBuffs, atkBuffs))
const drmRes = computed(() => resolveModifiers(defenderStates, defStates, { attackerWrath: attackerWrathOnDrm.value }))

const BAM    = computed(() => bamRes.value.value)
const rawDRM = computed(() => drmRes.value.value)
const shuraApplies   = computed(() => activeType.value.uses.shura)
const DRM            = computed(() => SHURA_CORRECTION.apply(rawDRM.value, { attackerHasShura: attackerHasShura.value, applies: shuraApplies.value }))
const shuraCorrected = computed(() => DRM.value !== rawDRM.value)
const CM   = computed(() => Math.round((BAM.value + DRM.value - 1) * 100) / 100)
const elem = computed(() => activeType.value.uses.element ? elementMult(atkAttrs.value, defAttrs.value) : 1)

const ctx = computed(() => ({ i: inputs, BAM: BAM.value, rawDRM: rawDRM.value, DRM: DRM.value, CM: CM.value, elem: elem.value }))
const finalDmg     = computed(() => activeType.value.formula(ctx.value))
const finalFormula = computed(() => activeType.value.formulaText(ctx.value))

const activeSpecials = computed(() => specialRules.filter(r => r.appliesTo.includes(activeTypeId.value)))

// 攻擊狀態區的提示：說明此攻擊類型對攻方狀態的取用方式。
const atkBlockHint = computed(() => {
  const u = activeType.value.uses
  if (u.bam) return ''
  if (!u.drm) return '（攻擊方狀態不計入此類型）'
  if (u.attackerWrathVoidsGreenBug === false) return '（攻擊方狀態完全不影響此類型；僅受擊方自身狀態生效）'
  return '（攻擊倍率不計入此類型；攻方暴怒仍影響防方青蟲）'
})

// 各按鈕的啟用狀態（on / suppressed / disabled），供樣式與警告使用。
const atkStatus = computed<Record<string, string>>(() => Object.fromEntries(bamRes.value.steps.map(s => [s.id, s.status])))
const defStatus = computed<Record<string, string>>(() => Object.fromEntries(drmRes.value.steps.map(s => [s.id, s.status])))

const atkWarn = computed(() =>
  bamRes.value.steps.filter(s => s.status !== 'on').map(s => `${s.label}（${s.note}）`).join('　'))
const defWarn = computed(() =>
  drmRes.value.steps.filter(s => s.status !== 'on').map(s => `${s.label}（${s.note}）`).join('　'))

interface StepRow { label: string; valText: string; cls: string; off: boolean; note?: string }
function stepRows(steps: ModifierStep[], extra: StepRow[] = []): StepRow[] {
  const rows: StepRow[] = [{ label: '基礎', valText: '1', cls: '', off: false }]
  for (const s of steps) {
    const off = s.status !== 'on'
    rows.push({
      label: s.label,
      valText: signed(s.delta),
      cls: off ? 'off' : (s.delta > 0 ? 'pos' : s.delta < 0 ? 'neg' : ''),
      off, note: s.note,
    })
  }
  return [...rows, ...extra]
}
const bamDetail = computed(() => stepRows(bamRes.value.steps))
const drmDetail = computed(() => stepRows(drmRes.value.steps,
  shuraCorrected.value ? [{ label: SHURA_CORRECTION.label, valText: '↑≥1', cls: 'shura', off: false }] : []))

const elemDetail = computed(() => {
  if (!activeType.value.uses.element) return []
  const out: { a: Element; d: Element; adj: number }[] = []
  for (const a of atkAttrs.value)
    for (const d of defAttrs.value) {
      const adj = ELEMENT_ADJ[a]?.[d] ?? 0
      if (adj !== 0) out.push({ a, d, adj })
    }
  return out
})

// app 內「規則一覽」：與計算共用同一份定義，永不脫鉤。
const RULE_BOOK = [
  { title: '攻擊類型公式',        items: attackTypes.map(t => ({ label: t.label, rule: t.rule })) },
  { title: '攻擊倍率（BAM）來源', items: attackerBuffs.map(b => ({ label: b.label, rule: b.rule })) },
  { title: '承受倍率（DRM）來源', items: defenderStates.map(s => ({ label: s.label, rule: s.rule })) },
  { title: '修羅補正',            items: [{ label: SHURA_CORRECTION.label, rule: SHURA_CORRECTION.rule }] },
  { title: '屬性相剋',            items: [{ label: '相剋規則', rule: ELEMENT_RULE }] },
  { title: '附加規則',            items: specialRules.map(r => ({ label: r.label, rule: r.rule })) },
].filter(g => g.items.length > 0)  // 無項目的分區（如目前的附加規則）自動隱藏

function btnClass(active: boolean, status: string | undefined, tone: ModifierTone) {
  if (!active) return {}
  const eff = status === 'on'
  const c: Record<string, boolean> = { on: true, dim: !eff }
  if (eff) c[TONE_CLASS[tone]] = true
  return c
}

function setType(id: string) {
  activeTypeId.value = id
  const t = attackTypes.find(x => x.id === id) ?? attackTypes[0]
  inputs.base = 0; inputs.specialDef = 0; inputs.atkStat = 0
  for (const f of t.inputs) inputs[f.id] = f.default ?? 0
  for (const r of specialRules) toggles[r.id] = false
}

function resetAll() {
  for (const b of attackerBuffs) atkBuffs[b.id] = false
  for (const s of defenderStates) defStates[s.id] = false
  Object.assign(atkAttr, { a1: '無', a2: '無', dual: false })
  Object.assign(defAttr, { a1: '無', a2: '無', dual: false })
  setType(attackTypes[0].id)
}
</script>

<template>
  <div class="dc">

    <!-- ATTACK TYPE SELECTOR -->
    <div class="type-bar">
      <button
        v-for="t in attackTypes" :key="t.id"
        class="type-btn" :class="{ active: activeTypeId === t.id }"
        @click="setType(t.id)"
      >{{ t.label }}</button>
    </div>

    <!-- BASE / INPUTS -->
    <div class="base-sec">
      <div class="base-inner">
        <template v-for="f in activeType.inputs" :key="f.id">
          <span class="base-lbl" :class="{ 'base-lbl-def': f.id === 'specialDef' }">{{ f.label }}</span>
          <input
            type="number" v-model.number="inputs[f.id]" min="0" placeholder="0"
            class="base-inp" :class="{ 'base-inp-sm': f.id === 'specialDef' }"
          />
          <div v-if="f.presets" class="presets">
            <button
              v-for="p in f.presets" :key="p.val"
              class="pre-btn" :class="{ 'pre-active': inputs[f.id] === p.val }"
              @click="inputs[f.id] = p.val"
            >{{ p.label }}</button>
          </div>
        </template>

        <span v-if="activeType.baseNote" class="base-fixed">{{ activeType.baseNote }}</span>

        <button class="pre-btn rst-btn" @click="resetAll">重置</button>
      </div>
      <div v-if="activeType.caution" class="caution-note">※ {{ activeType.caution }}</div>
    </div>

    <!-- PANELS -->
    <div class="panels">

      <!-- ATTACKER -->
      <section class="panel">
        <div class="ptitle atk-title">
          <span class="ptitle-icon">⚔</span>
          <span>攻擊方</span>
          <span class="ptag atk-tag">BAM {{ BAM }}</span>
        </div>

        <div class="pblk">
          <div class="pblk-hd">
            攻擊狀態
            <span v-if="atkBlockHint" class="na-hint">{{ atkBlockHint }}</span>
          </div>
          <div v-for="g in attackerGroups" :key="g.cat" class="cat-group">
            <div class="cat-label">{{ g.cat }}</div>
            <div class="btn-row">
              <button
                v-for="b in g.items" :key="b.id"
                class="sbtn" :class="btnClass(atkBuffs[b.id], atkStatus[b.id], b.tone)"
                @click="atkBuffs[b.id] = !atkBuffs[b.id]"
              >
                <span class="sb-name">{{ b.label }}</span>
                <span class="sb-val">{{ signed(b.delta) }}</span>
              </button>
            </div>
          </div>
          <div v-if="atkWarn" class="warn">{{ atkWarn }}</div>
        </div>

        <div class="pblk" :class="{ 'pblk-na': !activeType.uses.element }">
          <div class="pblk-hd">
            元素屬性
            <span v-if="!activeType.uses.element && activeType.uses.shura" class="na-hint">（屬性不計入此類型；修羅仍影響承受倍率補正）</span>
            <span v-else-if="!activeType.uses.element" class="na-hint">（屬性不計入此類型）</span>
          </div>
          <div class="egrid">
            <button
              v-for="e in ELEMENTS" :key="e"
              class="ebtn" :class="{ 'ebtn-on': atkAttr.a1 === e }"
              :style="atkAttr.a1 === e ? { '--ec': ELEM_COLOR[e] } : {}"
              @click="atkAttr.a1 = e"
            >{{ e }}</button>
          </div>
          <label class="dual-lbl">
            <input type="checkbox" v-model="atkAttr.dual" />
            <span>雙屬性</span>
          </label>
          <div v-if="atkAttr.dual" class="egrid mt4">
            <button
              v-for="e in ELEMENTS" :key="e"
              class="ebtn"
              :class="{ 'ebtn-on': atkAttr.a2 === e, 'ebtn-same': e === atkAttr.a1 && e !== '無' }"
              :style="atkAttr.a2 === e ? { '--ec': ELEM_COLOR[e] } : {}"
              @click="atkAttr.a2 = e"
            >{{ e }}</button>
          </div>
          <div v-if="atkAttrs.filter(e => e !== '無').length" class="chips">
            <span
              v-for="e in atkAttrs.filter(e => e !== '無')" :key="e" class="chip"
              :style="{ background: ELEM_COLOR[e] + '22', borderColor: ELEM_COLOR[e], color: ELEM_COLOR[e] }"
            >{{ e }}</span>
          </div>
        </div>
      </section>

      <!-- DEFENDER -->
      <section class="panel">
        <div class="ptitle def-title">
          <span class="ptitle-icon">🛡</span>
          <span>受擊方</span>
          <span class="ptag def-tag">DRM {{ DRM }}</span>
        </div>

        <div class="pblk">
          <div class="pblk-hd">
            承受狀態
            <span v-if="!activeType.uses.drm" class="na-hint">（此類型無視承受倍率）</span>
          </div>
          <div v-for="g in defenderGroups" :key="g.cat" class="cat-group">
            <div class="cat-label">{{ g.cat }}</div>
            <div class="btn-row">
              <button
                v-for="s in g.items" :key="s.id"
                class="sbtn" :class="btnClass(defStates[s.id], defStatus[s.id], s.tone)"
                @click="defStates[s.id] = !defStates[s.id]"
              >
                <span class="sb-name">{{ s.label }}</span>
                <span class="sb-val">{{ signed(s.delta) }}</span>
              </button>
            </div>
          </div>
          <div v-if="defWarn" class="warn">{{ defWarn }}</div>
        </div>

        <div class="pblk" :class="{ 'pblk-na': !activeType.uses.element }">
          <div class="pblk-hd">
            元素屬性
            <span v-if="!activeType.uses.element" class="na-hint">（屬性不計入此類型）</span>
          </div>
          <div class="egrid">
            <button
              v-for="e in ELEMENTS" :key="e"
              class="ebtn" :class="{ 'ebtn-on': defAttr.a1 === e }"
              :style="defAttr.a1 === e ? { '--ec': ELEM_COLOR[e] } : {}"
              @click="defAttr.a1 = e"
            >{{ e }}</button>
          </div>
          <label class="dual-lbl">
            <input type="checkbox" v-model="defAttr.dual" />
            <span>雙屬性</span>
          </label>
          <div v-if="defAttr.dual" class="egrid mt4">
            <button
              v-for="e in ELEMENTS" :key="e"
              class="ebtn"
              :class="{ 'ebtn-on': defAttr.a2 === e, 'ebtn-same': e === defAttr.a1 && e !== '無' }"
              :style="defAttr.a2 === e ? { '--ec': ELEM_COLOR[e] } : {}"
              @click="defAttr.a2 = e"
            >{{ e }}</button>
          </div>
          <div v-if="defAttrs.filter(e => e !== '無').length" class="chips">
            <span
              v-for="e in defAttrs.filter(e => e !== '無')" :key="e" class="chip"
              :style="{ background: ELEM_COLOR[e] + '22', borderColor: ELEM_COLOR[e], color: ELEM_COLOR[e] }"
            >{{ e }}</span>
          </div>
        </div>
      </section>

    </div>

    <!-- RESULTS -->
    <section class="results">

      <div class="fcards">

        <!-- BAM -->
        <div class="fcard" :class="{ 'fcard-na': !activeType.uses.bam }">
          <div class="fc-name">
            攻擊倍率 <span class="tag">BAM</span>
            <span v-if="!activeType.uses.bam" class="na-tag">不計入公式</span>
          </div>
          <div class="fc-val" :class="activeType.uses.bam ? (BAM > 1 ? 'v-pos' : BAM < 1 ? 'v-neg' : '') : 'v-na'">{{ BAM }}</div>
          <div class="steps">
            <div v-for="(s, i) in bamDetail" :key="i" class="step" :class="{ 'step-off': s.off }">
              <span class="sv" :class="'sv-' + s.cls">{{ s.valText }}</span>
              <span class="sl">{{ s.label }}</span>
              <span v-if="s.note" class="sn">{{ s.note }}</span>
            </div>
          </div>
          <div class="fc-eq">= {{ BAM }}</div>
        </div>

        <!-- DRM -->
        <div class="fcard" :class="{ 'fcard-na': !activeType.uses.drm }">
          <div class="fc-name">
            承受倍率 <span class="tag">DRM</span>
            <span v-if="!activeType.uses.drm" class="na-tag">不計入公式</span>
          </div>
          <div class="fc-val" :class="activeType.uses.drm ? (DRM > 1 ? 'v-pos' : DRM < 1 ? 'v-neg' : '') : 'v-na'">{{ DRM }}</div>
          <div class="steps">
            <div v-for="(s, i) in drmDetail" :key="i" class="step" :class="{ 'step-off': s.off }">
              <span class="sv" :class="'sv-' + s.cls">{{ s.valText }}</span>
              <span class="sl">{{ s.label }}</span>
              <span v-if="s.note" class="sn">{{ s.note }}</span>
            </div>
          </div>
          <div class="fc-eq">
            = {{ DRM }}
            <span v-if="shuraCorrected" class="shura-note">（修羅補正）</span>
          </div>
        </div>

        <!-- CM -->
        <div class="fcard fcard-cm" :class="{ 'fcard-na': !activeType.uses.cm }">
          <div class="fc-name">
            綜合倍率 <span class="tag">CM</span>
            <span v-if="!activeType.uses.cm" class="na-tag">不計入公式</span>
          </div>
          <div class="fc-val fc-val-lg" :class="activeType.uses.cm ? (CM > 1 ? 'v-pos' : CM < 1 ? 'v-neg' : '') : 'v-na'">{{ CM }}</div>
          <div class="cm-formula">BAM({{ BAM }}) + DRM({{ DRM }}) − 1</div>
        </div>

        <!-- 屬性相剋 -->
        <div class="fcard fcard-elem" :class="{ 'fcard-na': !activeType.uses.element }">
          <div class="fc-name">
            屬性相剋
            <span v-if="!activeType.uses.element" class="na-tag">不計入公式</span>
          </div>
          <div class="fc-val fc-val-lg" :class="activeType.uses.element ? (elem > 1 ? 'v-pos' : elem < 1 ? 'v-neg' : '') : 'v-na'">
            {{ activeType.uses.element ? elem + 'x' : '—' }}
          </div>
          <div class="elem-parts">
            <template v-if="activeType.uses.element">
              <span v-if="!elemDetail.length" class="ep-none">無相剋</span>
              <span
                v-for="(p, i) in elemDetail" :key="i"
                class="ep" :class="p.adj > 0 ? 'ep-pos' : p.adj < 0 ? 'ep-neg' : 'ep-neu'"
              >{{ p.adj > 0 ? '+' : '−' }}0.2 {{ p.a }}→{{ p.d }}</span>
            </template>
            <span v-else class="ep-none">此類型不受屬性影響</span>
          </div>
        </div>

      </div>

      <!-- FINAL DAMAGE -->
      <div class="final-box">
        <div class="final-formula">{{ finalFormula }}</div>
        <div class="final-label">最終傷害</div>
        <div class="final-num" :class="finalDmg > 0 ? 'num-hi' : ''">{{ finalDmg.toLocaleString() }}</div>
      </div>

      <!-- 附加規則：依附在最終傷害之上的額外計算（目前無啟用項目）-->
      <div v-for="r in activeSpecials" :key="r.id" class="toad-box">
        <label class="toad-toggle">
          <input type="checkbox" v-model="toggles[r.id]" />
          <span>{{ r.label }}傷害（{{ r.note }}）</span>
        </label>
        <div v-if="toggles[r.id]" class="toad-result">
          {{ r.exprText({ finalDmg }) }} =
          <span class="toad-num">{{ r.compute({ finalDmg }).toLocaleString() }}</span>
        </div>
      </div>

      <!-- 規則一覽：與計算共用同一份定義 -->
      <details class="rules-ref">
        <summary>傷害規則一覽（與計算同源，點開查看）</summary>
        <div v-for="g in RULE_BOOK" :key="g.title" class="rb-group">
          <div class="rb-title">{{ g.title }}</div>
          <div v-for="it in g.items" :key="it.label" class="rb-item">
            <b>{{ it.label }}</b>：{{ it.rule }}
          </div>
        </div>
      </details>

    </section>

  </div>
</template>

<style scoped>
/* ATTACK TYPE BAR */
.type-bar {
  display: flex;
  gap: 2px;
  padding: 10px 14px 0;
  background: var(--surface);
  border-bottom: 1px solid var(--border);
  flex-wrap: wrap;
}
.type-btn {
  padding: 6px 16px;
  border-radius: 7px 7px 0 0;
  border: 1px solid transparent;
  border-bottom: none;
  background: transparent;
  color: var(--text3);
  font-size: 0.84rem;
  font-weight: 600;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;
  letter-spacing: 0.03em;
  white-space: nowrap;
  position: relative;
  bottom: -1px;
}
.type-btn:hover:not(.active) { color: var(--text2); background: var(--surface2); }
.type-btn.active {
  background: var(--surface2);
  color: var(--gold);
  border-color: var(--border);
  border-bottom-color: var(--surface2);
}

/* BASE DAMAGE */
.base-sec {
  background: var(--surface2);
  border-bottom: 1px solid var(--border);
  padding: 12px 18px;
}
.base-inner {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.base-lbl {
  font-size: 0.82rem;
  font-weight: 600;
  color: var(--text2);
  white-space: nowrap;
}
.base-lbl-def {
  margin-left: 6px;
  color: var(--blue);
}
.base-fixed {
  font-size: 1.05rem;
  font-weight: 700;
  color: var(--text3);
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 16px;
}
.base-inp {
  width: 130px;
  font-size: 1.05rem;
  font-weight: 600;
  text-align: center;
}
.base-inp-sm {
  width: 90px;
}
.presets {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.pre-btn {
  padding: 4px 12px;
  border-radius: 20px;
  border: 1px solid var(--border2);
  background: var(--surface);
  color: var(--text2);
  font-size: 0.78rem;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.12s;
  white-space: nowrap;
}
.pre-btn:hover { border-color: var(--gold); color: var(--gold); }
.pre-btn.pre-active { border-color: var(--gold); color: var(--gold); background: rgba(244,192,48,0.08); }
.rst-btn { border-color: var(--border); color: var(--text3); margin-left: auto; }
.rst-btn:hover { border-color: var(--red); color: var(--red); }
.caution-note { margin-top: 8px; font-size: 0.72rem; color: var(--gold); opacity: 0.85; }

/* PANELS */
.panels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 2px;
  background: var(--border2);
}
@media (max-width: 600px) {
  .panels { grid-template-columns: 1fr; }
}
.panel {
  background: var(--surface);
  padding: 16px 15px;
}

.ptitle {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 0.95rem;
  font-weight: 700;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 14px;
  letter-spacing: 0.04em;
}
.ptitle-icon { font-size: 0.9rem; }
.atk-title { color: var(--red); }
.def-title { color: var(--blue); }

.ptag {
  margin-left: auto;
  font-size: 0.6rem;
  font-weight: 700;
  letter-spacing: 0.08em;
  padding: 2px 8px;
  border-radius: 4px;
}
.atk-tag { background: rgba(230,57,70,0.12); border: 1px solid rgba(230,57,70,0.3); color: var(--red); }
.def-tag { background: rgba(116,185,255,0.12); border: 1px solid rgba(116,185,255,0.3); color: var(--blue); }

.pblk { margin-bottom: 16px; }
.pblk:last-child { margin-bottom: 0; }
.pblk-na { opacity: 0.55; }
.pblk-hd {
  font-size: 0.65rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text3);
  margin-bottom: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}
.na-hint {
  font-size: 0.6rem;
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  color: var(--text3);
  opacity: 0.8;
}

/* CATEGORY SUB-SECTIONS（道具效果／忍術效果／職業特性）*/
.cat-group { margin-bottom: 10px; }
.cat-group:last-child { margin-bottom: 0; }
.cat-label {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.62rem;
  font-weight: 700;
  color: var(--text3);
  letter-spacing: 0.08em;
  margin-bottom: 6px;
  opacity: 0.9;
}
.cat-label::before {
  content: '';
  width: 4px;
  height: 4px;
  border-radius: 50%;
  background: var(--gold);
  opacity: 0.6;
}

/* STATUS BUTTONS */
.btn-row { display: flex; flex-wrap: wrap; gap: 6px; }
.sbtn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 7px 12px 6px;
  border-radius: 7px;
  border: 1px solid var(--border2);
  background: var(--surface2);
  color: var(--text2);
  cursor: pointer;
  font-family: inherit;
  transition: all 0.13s;
}
.sbtn:hover { border-color: var(--text3); color: var(--text); }
.sb-name { font-size: 0.85rem; font-weight: 600; }
.sb-val  {
  font-size: 0.82rem;
  font-weight: 800;
  color: var(--text2);
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  padding: 1px 7px;
  border-radius: 9px;
  background: rgba(255,255,255,0.06);
  border: 1px solid var(--border2);
  line-height: 1.2;
}

.sbtn.on { opacity: 1; }
.sbtn.dim { opacity: 0.35; text-decoration: line-through; }
.sbtn.atk-act { background: rgba(230,57,70,0.12); border-color: var(--red); color: var(--red); }
.sbtn.atk-act .sb-val { color: #fff; background: var(--red); border-color: var(--red); }
.sbtn.def-act { background: rgba(116,185,255,0.12); border-color: var(--blue); color: var(--blue); }
.sbtn.def-act .sb-val { color: #0a1428; background: var(--blue); border-color: var(--blue); }
.sbtn.grn-act { background: rgba(82,183,136,0.12); border-color: var(--green); color: var(--green); }
.sbtn.grn-act .sb-val { color: #0a1f15; background: var(--green); border-color: var(--green); }
.sbtn.wrath { background: rgba(244,192,48,0.12); border-color: var(--gold); color: var(--gold); }
.sbtn.wrath .sb-val { color: #1a1300; background: var(--gold); border-color: var(--gold); }

.warn {
  margin-top: 7px;
  font-size: 0.72rem;
  color: var(--gold);
  background: rgba(244,192,48,0.06);
  border-left: 2px solid rgba(244,192,48,0.4);
  padding: 4px 8px;
  border-radius: 0 4px 4px 0;
}

/* ELEMENT GRID */
.egrid { display: flex; flex-wrap: wrap; gap: 5px; }
.mt4 { margin-top: 5px; }
.ebtn {
  padding: 3px 8px;
  border-radius: 5px;
  border: 1px solid var(--border);
  background: var(--surface2);
  color: var(--text2);
  font-size: 0.78rem;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.1s;
}
.ebtn:hover { border-color: var(--text3); color: var(--text); }
.ebtn.ebtn-on {
  background: color-mix(in srgb, var(--ec) 14%, transparent);
  border-color: var(--ec);
  color: var(--ec);
  font-weight: 600;
}
.ebtn.ebtn-same { opacity: 0.3; pointer-events: none; }
.dual-lbl {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  font-size: 0.78rem;
  color: var(--text2);
  cursor: pointer;
}
.chips { display: flex; gap: 5px; margin-top: 8px; flex-wrap: wrap; }
.chip {
  padding: 2px 10px;
  border-radius: 12px;
  border: 1px solid;
  font-size: 0.76rem;
  font-weight: 600;
}

/* RESULTS */
.results {
  background: var(--surface);
  border-top: 1px solid var(--border);
  padding: 18px 16px;
}

/* FORMULA CARDS */
.fcards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
  gap: 10px;
  margin-bottom: 14px;
}
@media (max-width: 480px) {
  .fcards { grid-template-columns: 1fr 1fr; }
}
.fcard {
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 12px 12px 10px;
  transition: opacity 0.2s;
}
.fcard-na { opacity: 0.4; }
.fcard-cm   { border-color: rgba(162,155,254,0.25); }
.fcard-elem { border-color: rgba(244,192,48,0.2); }

.fc-name {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.65rem;
  color: var(--text3);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 4px;
  flex-wrap: wrap;
}
.tag {
  background: var(--border);
  color: var(--text3);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 0.58rem;
}
.na-tag {
  font-size: 0.58rem;
  color: var(--text3);
  font-weight: 400;
  text-transform: none;
  letter-spacing: 0;
  margin-left: auto;
}
.fc-val {
  font-size: 1.55rem;
  font-weight: 700;
  color: var(--text);
  margin: 2px 0 8px;
  font-variant-numeric: tabular-nums;
}
.fc-val-lg { font-size: 2rem; }
.v-pos { color: var(--green); }
.v-neg { color: var(--red); }
.v-na  { color: var(--text3); }

.steps { display: flex; flex-direction: column; gap: 3px; margin-bottom: 7px; }
.step {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.74rem;
  color: var(--text2);
}
.step-off { color: var(--text3); text-decoration: line-through; opacity: 0.45; }
.sv { font-weight: 700; min-width: 38px; font-size: 0.74rem; font-variant-numeric: tabular-nums; }
.sv-pos   { color: var(--green); }
.sv-neg   { color: var(--red); }
.sv-off   { color: var(--text3); }
.sv-shura { color: var(--purple); }
.sl { font-weight: 500; }
.sn { font-size: 0.65rem; color: var(--text3); }
.fc-eq {
  font-size: 0.72rem;
  color: var(--text3);
  padding-top: 6px;
  border-top: 1px solid var(--border);
  font-variant-numeric: tabular-nums;
}
.shura-note { color: var(--purple); font-size: 0.65rem; }
.cm-formula { font-size: 0.74rem; color: var(--text2); font-family: 'Courier New', monospace; margin-top: 4px; }

.elem-parts { display: flex; flex-direction: column; gap: 3px; }
.ep-none { font-size: 0.72rem; color: var(--text3); }
.ep { font-size: 0.72rem; font-weight: 600; }
.ep-pos { color: var(--green); }
.ep-neg { color: var(--red); }
.ep-neu { color: var(--text3); }

/* FINAL DAMAGE */
.final-box {
  background: var(--surface2);
  border: 1px solid var(--border2);
  border-radius: var(--radius-lg);
  padding: 20px 24px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
}
.final-formula {
  font-size: 0.78rem;
  color: var(--text3);
  font-family: 'Courier New', monospace;
  text-align: center;
}
.final-label {
  font-size: 0.7rem;
  color: var(--text3);
  text-transform: uppercase;
  letter-spacing: 0.18em;
  font-weight: 600;
}
.final-num {
  font-size: 3.2rem;
  font-weight: 800;
  color: var(--text2);
  font-variant-numeric: tabular-nums;
  line-height: 1;
  letter-spacing: -0.02em;
}
.num-hi { color: var(--gold); }

/* 附加規則（依附最終傷害的額外計算）*/
.toad-box {
  margin-top: 12px;
  background: rgba(176,143,255,0.06);
  border: 1px solid rgba(176,143,255,0.2);
  border-radius: var(--radius-lg);
  padding: 12px 18px;
}
.toad-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 0.78rem;
  color: var(--text2);
  cursor: pointer;
}
.toad-toggle input { accent-color: var(--purple); }
.toad-result {
  margin-top: 10px;
  font-size: 0.85rem;
  color: var(--text2);
  font-family: 'Courier New', monospace;
  text-align: center;
}
.toad-num {
  font-size: 1.6rem;
  font-weight: 800;
  color: var(--purple);
  font-family: inherit;
  font-variant-numeric: tabular-nums;
  margin-left: 4px;
}

/* RULES REFERENCE (app 自帶說明) */
.rules-ref {
  margin-top: 14px;
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  background: var(--surface2);
  padding: 0 16px;
}
.rules-ref > summary {
  cursor: pointer;
  padding: 12px 0;
  font-size: 0.8rem;
  font-weight: 700;
  color: var(--text2);
  letter-spacing: 0.04em;
  list-style: none;
}
.rules-ref > summary::-webkit-details-marker { display: none; }
.rules-ref > summary::before { content: '▸ '; color: var(--gold); }
.rules-ref[open] > summary::before { content: '▾ '; }
.rb-group { padding: 9px 0 12px; border-top: 1px solid var(--border); }
.rb-title {
  font-size: 0.66rem;
  font-weight: 700;
  color: var(--gold);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 7px;
}
.rb-item { font-size: 0.76rem; color: var(--text2); line-height: 1.55; margin-bottom: 5px; }
.rb-item b { color: var(--text); }
</style>
