<script setup>
import { ref, reactive, computed } from 'vue'

// ─── CONSTANTS ─────────────────────────────────────────────────────────────

const ELEMENTS = ['無', '炎', '冰', '風', '雷', '地', '光', '闇', '修羅', '毒木']

const ELEM_COLOR = {
  '無': '#666',
  '炎': '#ff6b35',
  '冰': '#74c0fc',
  '風': '#a9e34b',
  '雷': '#f4c030',
  '地': '#b07b45',
  '光': '#ffd700',
  '闇': '#b08fff',
  '修羅': '#e63946',
  '毒木': '#52b788',
}

// strong[A] = elements that A is strong against (+0.2x)
const STRONG = {
  '炎': ['風'],
  '冰': ['炎', '地'],
  '風': ['雷'],
  '雷': ['地'],
  '地': ['冰'],
  '光': ['闇', '修羅'],
  '闇': ['光'],
  '修羅': [],
  '毒木': ['炎', '冰', '風', '雷', '地', '闇'],
  '無': [],
}

function elemAdj(a, d) {
  if (a === '無' || d === '無') return 0
  if (STRONG[a]?.includes(d)) return 0.2
  if (STRONG[d]?.includes(a)) return -0.2
  return 0
}

function fmt(n) {
  return n < 0 ? `−${Math.abs(n).toLocaleString()}` : n.toLocaleString()
}

function round2(n) {
  return Math.round(n * 100) / 100
}

// ─── STATE ─────────────────────────────────────────────────────────────────

const atk = reactive({
  hotblooded: false,
  explosive: false,
  magicWater: false,
  redBug: false,
  shikigami: false,
  wrathSeal: false,
  shura: false,
  elem: '無',
  useDual: false,
  dualElem: '無',
  baseAtk: 100,
  baseMagic: 100,
})

const def = reactive({
  iron: false,
  magicWater: false,
  greenBug: false,
  wrathSeal: false,
  elem: '無',
  useDual: false,
  dualElem: '無',
  defense: 0,
  magicDef: 0,
})

const collisionType = ref('normal')

// ─── EFFECTIVE BUFFS (after override rules) ────────────────────────────────

const eAtk = computed(() => {
  const { hotblooded, explosive, magicWater, redBug, shikigami, wrathSeal } = atk
  if (wrathSeal) {
    return { hotblooded: false, explosive: false, magicWater: false, redBug, shikigami, wrathSeal: true }
  }
  if (magicWater) {
    return { hotblooded: false, explosive: false, magicWater: true, redBug, shikigami, wrathSeal: false }
  }
  return { hotblooded, explosive, magicWater, redBug, shikigami, wrathSeal: false }
})

const eDef = computed(() => {
  const { iron, magicWater, greenBug, wrathSeal } = def
  return {
    iron,
    magicWater,
    // Attacker's Wrath Seal ignores defender's Green Bug
    greenBug: atk.wrathSeal ? false : greenBug,
    wrathSeal,
  }
})

// ─── CORE MULTIPLIERS ──────────────────────────────────────────────────────

const BAM = computed(() => {
  const b = eAtk.value
  if (b.wrathSeal) return 4
  let v = 1
  if (b.magicWater) v += 1
  if (b.hotblooded || b.explosive) v += 0.5  // don't stack; only one +0.5
  if (b.redBug) v -= 0.5
  if (b.shikigami) v += 1
  return round2(v)
})

const DRM = computed(() => {
  const b = eDef.value
  if (b.wrathSeal) return 4
  let v = 1
  if (b.iron) v -= 0.25
  if (b.magicWater) v -= 0.5
  if (b.greenBug) v += 0.5
  // Shura attribute: DRM cannot drop below 1
  if (atk.shura && v < 1) v = 1
  return round2(v)
})

const CM = computed(() => round2(BAM.value + DRM.value - 1))

// ─── ELEMENT ───────────────────────────────────────────────────────────────

const defElems = computed(() => {
  const arr = def.elem !== '無' ? [def.elem] : []
  if (def.useDual && def.dualElem !== '無' && def.dualElem !== def.elem) {
    arr.push(def.dualElem)
  }
  return arr
})

const atkElems = computed(() => {
  const arr = atk.elem !== '無' ? [atk.elem] : []
  if (atk.useDual && atk.dualElem !== '無' && atk.dualElem !== atk.elem) {
    arr.push(atk.dualElem)
  }
  return arr
})

const elemMult = computed(() => {
  if (atkElems.value.length === 0 || defElems.value.length === 0) return 1
  // Use primary attacker element for matrix calculation
  const ae = atk.elem
  if (ae === '無') return 1
  const adj = defElems.value.reduce((s, de) => s + elemAdj(ae, de), 0)
  return round2(1 + adj)
})

// ─── DAMAGE FORMULAS ───────────────────────────────────────────────────────

const collBase = computed(() => {
  if (collisionType.value === 'yaksha') return 100
  if (collisionType.value === 'redOgre') return 200
  return 30
})

const dmg = computed(() => {
  const bAtk = Number(atk.baseAtk) || 0
  const bMag = Number(atk.baseMagic) || 0
  const bDef = Number(def.defense) || 0
  const bMDef = Number(def.magicDef) || 0

  return {
    // Normal Attack / Shikigami: Base × CM × Elemental
    normal: Math.floor(bAtk * CM.value * elemMult.value),

    // Secret Technique: (Base × DRM × Elemental) − Def
    secret: Math.floor(bAtk * DRM.value * elemMult.value) - bDef,

    // Ninjutsu: Base × DRM − MagicDef
    ninjutsu: Math.floor(bMag * DRM.value) - bMDef,

    // Money Dart: 150 × CM
    moneyDart: Math.floor(150 * CM.value),

    // Collision: Base × CM  (base: normal=30, yaksha=100, redOgre=200)
    collision: Math.floor(collBase.value * CM.value),

    // Poison: CollisionDmg × 3, ignores DRM (use BAM only)
    poison: Math.floor(collBase.value * BAM.value * 3),
  }
})

// ─── BREAKDOWNS ────────────────────────────────────────────────────────────

const bamBreakdown = computed(() => {
  const r = atk
  const b = eAtk.value
  const steps = []

  if (r.wrathSeal) {
    steps.push({ label: '基礎', delta: '+1', active: true })
    steps.push({ label: '怒印', delta: '+3', active: true })
    const dead = []
    if (r.magicWater) dead.push('魔水')
    if (r.hotblooded) dead.push('熱血')
    if (r.explosive) dead.push('爆裂')
    if (dead.length) steps.push({ label: dead.join('、'), delta: '×', active: false, note: '怒印覆蓋，失效' })
    if (r.redBug) steps.push({ label: '赤虫', delta: '-0.5', active: true })
    if (r.shikigami) steps.push({ label: '式神', delta: '+1', active: true })
    return steps
  }

  steps.push({ label: '基礎', delta: '+1', active: true })

  if (r.magicWater) {
    steps.push({ label: '魔水', delta: '+1', active: true })
  }

  if (r.hotblooded && r.explosive) {
    const inactive = b.magicWater  // disabled by Magic Water
    steps.push({ label: '熱血', delta: '+0.5', active: !inactive })
    steps.push({ label: '爆裂', delta: '+0.5', active: false, note: inactive ? '魔水覆蓋' : '與熱血不疊加' })
  } else if (r.hotblooded) {
    steps.push({ label: '熱血', delta: '+0.5', active: b.hotblooded, note: b.hotblooded ? '' : '魔水覆蓋，失效' })
  } else if (r.explosive) {
    steps.push({ label: '爆裂', delta: '+0.5', active: b.explosive, note: b.explosive ? '' : '魔水覆蓋，失效' })
  }

  if (r.redBug) steps.push({ label: '赤虫', delta: '-0.5', active: true })
  if (r.shikigami) steps.push({ label: '式神', delta: '+1', active: true })

  return steps
})

const drmBreakdown = computed(() => {
  const r = def
  const b = eDef.value
  const steps = []

  if (r.wrathSeal) {
    steps.push({ label: '基礎', delta: '+1', active: true })
    steps.push({ label: '怒印', delta: '+3', active: true })
    return steps
  }

  steps.push({ label: '基礎', delta: '+1', active: true })
  if (r.iron) steps.push({ label: '鉄', delta: '-0.25', active: true })
  if (r.magicWater) steps.push({ label: '魔水', delta: '-0.5', active: true })
  if (r.greenBug) {
    const active = b.greenBug
    steps.push({ label: '緑虫', delta: '+0.5', active, note: active ? '' : '攻方怒印，無效' })
  }

  if (atk.shura) {
    const rawDrm = round2(1 + (b.iron ? -0.25 : 0) + (b.magicWater ? -0.5 : 0) + (b.greenBug ? 0.5 : 0))
    if (rawDrm < 1) {
      steps.push({ label: '修羅補正', delta: `→ 強制 ≥ 1（原值 ${rawDrm}）`, active: true, special: true })
    }
  }

  return steps
})

const elemBreakdown = computed(() => {
  const ae = atk.elem
  if (ae === '無') return [{ text: '攻方無屬性，無元素加成' }]
  if (defElems.value.length === 0) return [{ text: '防方無屬性，無元素加成' }]

  const parts = [{ text: '基礎 1.0' }]
  for (const de of defElems.value) {
    const adj = elemAdj(ae, de)
    if (adj > 0) parts.push({ text: `+0.2`, sub: `${ae} 克 ${de}`, good: true })
    else if (adj < 0) parts.push({ text: `-0.2`, sub: `${ae} 弱於 ${de}`, bad: true })
    else parts.push({ text: `±0`, sub: `${ae} vs ${de} 中立`, neutral: true })
  }
  return parts
})

// ─── UI HELPERS ────────────────────────────────────────────────────────────

const ATK_BUFFS = [
  { key: 'hotblooded', label: '熱血' },
  { key: 'explosive',  label: '爆裂' },
  { key: 'magicWater', label: '魔水' },
  { key: 'redBug',     label: '赤虫' },
  { key: 'shikigami',  label: '式神' },
  { key: 'wrathSeal',  label: '怒印' },
]

const DEF_BUFFS = [
  { key: 'iron',       label: '鉄' },
  { key: 'magicWater', label: '魔水' },
  { key: 'greenBug',   label: '緑虫' },
  { key: 'wrathSeal',  label: '怒印' },
]

const COLL_TYPES = [
  { key: 'normal',  label: '通常', base: 30 },
  { key: 'yaksha',  label: '夜叉', base: 100 },
  { key: 'redOgre', label: '紅鬼', base: 200 },
]

function atkBuffDisabled(key) {
  return atk[key] && !eAtk.value[key]
}

function defBuffDisabled(key) {
  return def[key] && !eDef.value[key]
}

const atkWarnMsg = computed(() => {
  if (atk.wrathSeal) {
    const dead = ['magicWater', 'hotblooded', 'explosive'].filter(k => atk[k]).map(k => ({ magicWater: '魔水', hotblooded: '熱血', explosive: '爆裂' }[k]))
    return dead.length ? `怒印啟動：${dead.join('、')} 失效` : ''
  }
  if (atk.magicWater && (atk.hotblooded || atk.explosive)) {
    return '魔水啟動：熱血/爆裂 失效'
  }
  if (atk.hotblooded && atk.explosive) {
    return '熱血・爆裂不疊加，僅計 +0.5'
  }
  return ''
})

const defWarnMsg = computed(() => {
  if (def.greenBug && atk.wrathSeal) return '攻方怒印：緑虫無效'
  return ''
})

// Element matrix display (for reference tooltip)
function getMatrixRelation(e) {
  const strong = STRONG[e] || []
  const weak = ELEMENTS.filter(x => STRONG[x]?.includes(e))
  return { strong, weak }
}
</script>

<template>
  <div class="app">
    <!-- ═══ HEADER ═══ -->
    <header class="header">
      <div class="header-inner">
        <h1>忍道傷害計算器</h1>
        <p class="subtitle">Nindou Damage Calculator</p>
      </div>
    </header>

    <!-- ═══ TWO-COLUMN PANELS ═══ -->
    <div class="panels-wrap">

      <!-- ── ATTACKER ── -->
      <section class="panel panel-atk">
        <div class="panel-head">
          <span class="panel-icon">⚔</span>
          <h2>攻擊方</h2>
        </div>

        <!-- Buffs -->
        <div class="block">
          <div class="block-title">狀態增益 (BAM)</div>
          <div class="buff-row">
            <button
              v-for="buf in ATK_BUFFS" :key="buf.key"
              class="buff-btn"
              :class="{
                active: atk[buf.key],
                dimmed: atkBuffDisabled(buf.key),
                wrath: buf.key === 'wrathSeal' && atk.wrathSeal
              }"
              @click="atk[buf.key] = !atk[buf.key]"
            >{{ buf.label }}</button>
          </div>
          <p v-if="atkWarnMsg" class="warn-msg">⚠ {{ atkWarnMsg }}</p>
        </div>

        <!-- Shura attribute -->
        <div class="block">
          <div class="block-title">特殊屬性</div>
          <label class="toggle-label">
            <input type="checkbox" v-model="atk.shura" />
            <span>修羅特性 <em>（目標受傷倍率強制 ≥ 1）</em></span>
          </label>
        </div>

        <!-- Attacker Element -->
        <div class="block">
          <div class="block-title">元素屬性</div>
          <div class="elem-grid">
            <button
              v-for="e in ELEMENTS" :key="e"
              class="elem-btn"
              :class="{ selected: atk.elem === e }"
              :style="atk.elem === e ? { '--ec': ELEM_COLOR[e] } : {}"
              @click="atk.elem = e"
            >{{ e }}</button>
          </div>
          <label class="toggle-label mt8">
            <input type="checkbox" v-model="atk.useDual" />
            <span>雙屬性</span>
          </label>
          <div v-if="atk.useDual" class="elem-grid mt4">
            <button
              v-for="e in ELEMENTS" :key="e"
              class="elem-btn"
              :class="{ selected: atk.dualElem === e }"
              :style="atk.dualElem === e ? { '--ec': ELEM_COLOR[e] } : {}"
              @click="atk.dualElem = e"
            >{{ e }}</button>
          </div>
          <div v-if="atkElems.length" class="elem-preview">
            <span
              v-for="e in atkElems" :key="e"
              class="elem-badge"
              :style="{ background: ELEM_COLOR[e] + '22', borderColor: ELEM_COLOR[e], color: ELEM_COLOR[e] }"
            >{{ e }}</span>
          </div>
        </div>

        <!-- Base Stats -->
        <div class="block">
          <div class="block-title">基礎數值</div>
          <div class="input-grid">
            <label class="input-label">
              <span>基礎攻擊力</span>
              <input type="number" v-model.number="atk.baseAtk" min="0" placeholder="0" />
            </label>
            <label class="input-label">
              <span>忍術威力</span>
              <input type="number" v-model.number="atk.baseMagic" min="0" placeholder="0" />
            </label>
          </div>
        </div>

        <!-- Collision type -->
        <div class="block">
          <div class="block-title">衝撞類型</div>
          <div class="coll-row">
            <button
              v-for="ct in COLL_TYPES" :key="ct.key"
              class="coll-btn"
              :class="{ active: collisionType === ct.key }"
              @click="collisionType = ct.key"
            >{{ ct.label }}<span class="coll-base">{{ ct.base }}</span></button>
          </div>
        </div>
      </section>

      <!-- ── DEFENDER ── -->
      <section class="panel panel-def">
        <div class="panel-head">
          <span class="panel-icon">🛡</span>
          <h2>防禦方</h2>
        </div>

        <!-- Buffs -->
        <div class="block">
          <div class="block-title">狀態增益 (DRM)</div>
          <div class="buff-row">
            <button
              v-for="buf in DEF_BUFFS" :key="buf.key"
              class="buff-btn"
              :class="{
                active: def[buf.key],
                dimmed: defBuffDisabled(buf.key),
                wrath: buf.key === 'wrathSeal' && def.wrathSeal
              }"
              @click="def[buf.key] = !def[buf.key]"
            >{{ buf.label }}</button>
          </div>
          <p v-if="defWarnMsg" class="warn-msg">⚠ {{ defWarnMsg }}</p>
        </div>

        <!-- Defender Element -->
        <div class="block">
          <div class="block-title">元素屬性</div>
          <div class="elem-grid">
            <button
              v-for="e in ELEMENTS" :key="e"
              class="elem-btn"
              :class="{ selected: def.elem === e }"
              :style="def.elem === e ? { '--ec': ELEM_COLOR[e] } : {}"
              @click="def.elem = e"
            >{{ e }}</button>
          </div>
          <label class="toggle-label mt8">
            <input type="checkbox" v-model="def.useDual" />
            <span>雙屬性</span>
          </label>
          <div v-if="def.useDual" class="elem-grid mt4">
            <button
              v-for="e in ELEMENTS" :key="e"
              class="elem-btn"
              :class="{ selected: def.dualElem === e }"
              :style="def.dualElem === e ? { '--ec': ELEM_COLOR[e] } : {}"
              @click="def.dualElem = e"
            >{{ e }}</button>
          </div>
          <div v-if="defElems.length" class="elem-preview">
            <span
              v-for="e in defElems" :key="e"
              class="elem-badge"
              :style="{ background: ELEM_COLOR[e] + '22', borderColor: ELEM_COLOR[e], color: ELEM_COLOR[e] }"
            >{{ e }}</span>
          </div>
        </div>

        <!-- Defense Stats -->
        <div class="block">
          <div class="block-title">防禦數值</div>
          <div class="input-grid">
            <label class="input-label">
              <span>防御力</span>
              <input type="number" v-model.number="def.defense" min="0" placeholder="0" />
            </label>
            <label class="input-label">
              <span>魔法防御力</span>
              <input type="number" v-model.number="def.magicDef" min="0" placeholder="0" />
            </label>
          </div>
        </div>

        <!-- Element Reference Table -->
        <div class="block">
          <div class="block-title">元素相剋參考</div>
          <div class="matrix-table">
            <div class="matrix-row matrix-header">
              <span>元素</span><span>克屬 (+20%)</span><span>弱屬 (-20%)</span>
            </div>
            <div
              v-for="e in ELEMENTS.filter(x => x !== '無')" :key="e"
              class="matrix-row"
            >
              <span class="matrix-elem" :style="{ color: ELEM_COLOR[e] }">{{ e }}</span>
              <span class="matrix-strong">
                <span
                  v-for="s in getMatrixRelation(e).strong" :key="s"
                  class="matrix-badge"
                  :style="{ color: ELEM_COLOR[s] }"
                >{{ s }}</span>
                <span v-if="!getMatrixRelation(e).strong.length" class="matrix-none">—</span>
              </span>
              <span class="matrix-weak">
                <span
                  v-for="w in getMatrixRelation(e).weak" :key="w"
                  class="matrix-badge weak"
                  :style="{ color: ELEM_COLOR[w] }"
                >{{ w }}</span>
                <span v-if="!getMatrixRelation(e).weak.length" class="matrix-none">—</span>
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>

    <!-- ═══ RESULTS ═══ -->
    <section class="results">
      <h2 class="results-title">⚡ 倍率計算說明</h2>

      <!-- Multiplier cards -->
      <div class="mult-cards">

        <!-- BAM Card -->
        <div class="mult-card">
          <div class="mc-label">攻擊倍率 <span class="mc-tag">BAM</span></div>
          <div class="mc-value">{{ BAM }}</div>
          <div class="mc-steps">
            <span
              v-for="(s, i) in bamBreakdown" :key="i"
              class="mc-step"
              :class="{ inactive: !s.active, special: s.special }"
            >
              <span class="step-delta" :class="s.delta?.startsWith('-') ? 'neg' : s.delta === '×' ? 'dead' : 'pos'">
                {{ s.delta }}
              </span>
              <span class="step-label">{{ s.label }}</span>
              <span v-if="s.note" class="step-note">{{ s.note }}</span>
            </span>
          </div>
          <div class="mc-formula">
            = <strong>{{ BAM }}</strong>
          </div>
        </div>

        <!-- DRM Card -->
        <div class="mult-card">
          <div class="mc-label">受傷倍率 <span class="mc-tag">DRM</span></div>
          <div class="mc-value">{{ DRM }}</div>
          <div class="mc-steps">
            <span
              v-for="(s, i) in drmBreakdown" :key="i"
              class="mc-step"
              :class="{ inactive: !s.active, special: s.special }"
            >
              <span class="step-delta" :class="s.delta?.startsWith('-') ? 'neg' : s.delta?.startsWith('+') ? 'pos' : 'note'">
                {{ s.delta }}
              </span>
              <span class="step-label">{{ s.label }}</span>
              <span v-if="s.note" class="step-note">{{ s.note }}</span>
            </span>
          </div>
          <div class="mc-formula">= <strong>{{ DRM }}</strong></div>
        </div>

        <!-- CM Card -->
        <div class="mult-card cm-card">
          <div class="mc-label">組合倍率 <span class="mc-tag">CM</span></div>
          <div class="mc-value large" :class="CM > 1 ? 'pos' : CM < 1 ? 'neg' : ''">{{ CM }}</div>
          <div class="mc-formula cm-formula">
            BAM <span class="cm-op">({{ BAM }})</span>
            + DRM <span class="cm-op">({{ DRM }})</span>
            − 1
            = <strong>{{ CM }}</strong>
          </div>
          <p class="mc-hint">普通攻擊・式神・錢標・衝撞 均使用 CM</p>
        </div>

        <!-- Element Card -->
        <div class="mult-card elem-card">
          <div class="mc-label">元素倍率</div>
          <div class="mc-value large" :class="elemMult > 1 ? 'pos' : elemMult < 1 ? 'neg' : ''">
            {{ elemMult }}x
          </div>
          <div class="mc-steps">
            <span v-for="(p, i) in elemBreakdown" :key="i" class="mc-step">
              <span class="step-delta" :class="p.good ? 'pos' : p.bad ? 'neg' : 'note'">{{ p.text }}</span>
              <span v-if="p.sub" class="step-note">({{ p.sub }})</span>
            </span>
          </div>
          <div class="mc-formula">= <strong>{{ elemMult }}x</strong></div>
        </div>
      </div>

      <!-- ─── DAMAGE TABLE ─── -->
      <h2 class="results-title mt24">💥 傷害結果</h2>

      <div class="dmg-table">
        <div class="dmg-row header-row">
          <span>攻擊類型</span>
          <span class="col-formula">計算公式</span>
          <span class="col-dmg">傷害值</span>
        </div>

        <!-- Normal Attack / Shikigami -->
        <div class="dmg-row">
          <span class="dmg-name">普通攻擊 / 式神</span>
          <span class="col-formula formula-text">
            {{ atk.baseAtk }} × <span class="f-cm">CM {{ CM }}</span> × <span class="f-em">{{ elemMult }}x</span>
          </span>
          <span class="col-dmg dmg-val" :class="dmg.normal < 0 ? 'neg' : ''">{{ fmt(dmg.normal) }}</span>
        </div>

        <!-- Secret Technique -->
        <div class="dmg-row">
          <span class="dmg-name">奧義（秘術）</span>
          <span class="col-formula formula-text">
            ( {{ atk.baseAtk }} × <span class="f-drm">DRM {{ DRM }}</span> × <span class="f-em">{{ elemMult }}x</span> ) − {{ def.defense }}
          </span>
          <span class="col-dmg dmg-val" :class="dmg.secret < 0 ? 'neg' : ''">{{ fmt(dmg.secret) }}</span>
        </div>

        <!-- Ninjutsu -->
        <div class="dmg-row">
          <span class="dmg-name">忍術</span>
          <span class="col-formula formula-text">
            {{ atk.baseMagic }} × <span class="f-drm">DRM {{ DRM }}</span> − {{ def.magicDef }}
          </span>
          <span class="col-dmg dmg-val" :class="dmg.ninjutsu < 0 ? 'neg' : ''">{{ fmt(dmg.ninjutsu) }}</span>
        </div>

        <!-- Money Dart -->
        <div class="dmg-row">
          <span class="dmg-name">錢標</span>
          <span class="col-formula formula-text">
            150 × <span class="f-cm">CM {{ CM }}</span>
          </span>
          <span class="col-dmg dmg-val" :class="dmg.moneyDart < 0 ? 'neg' : ''">{{ fmt(dmg.moneyDart) }}</span>
        </div>

        <!-- Collision -->
        <div class="dmg-row">
          <span class="dmg-name">
            衝撞
            <em class="coll-badge">{{ { normal: '通常 (30)', yaksha: '夜叉 (100)', redOgre: '紅鬼 (200)' }[collisionType] }}</em>
          </span>
          <span class="col-formula formula-text">
            {{ collBase }} × <span class="f-cm">CM {{ CM }}</span>
          </span>
          <span class="col-dmg dmg-val" :class="dmg.collision < 0 ? 'neg' : ''">{{ fmt(dmg.collision) }}</span>
        </div>

        <!-- Poison -->
        <div class="dmg-row">
          <span class="dmg-name">
            毒
            <em class="coll-badge poison">衝撞基數 × 3，無視 DRM</em>
          </span>
          <span class="col-formula formula-text">
            {{ collBase }} × <span class="f-bam">BAM {{ BAM }}</span> × 3
          </span>
          <span class="col-dmg dmg-val" :class="dmg.poison < 0 ? 'neg' : ''">{{ fmt(dmg.poison) }}</span>
        </div>
      </div>

      <p class="footnote">
        奧義/忍術傷害可為負值（防御過高時）。毒效果對變身狀態無效。所有數值向下取整。
      </p>
    </section>

    <footer class="footer">
      <p>忍道傷害計算器 · 基於遊戲內部公式實作</p>
    </footer>
  </div>
</template>

<style scoped>
/* ─── APP ─── */
.app {
  max-width: 1200px;
  margin: 0 auto;
  padding: 0 0 40px;
}

/* ─── HEADER ─── */
.header {
  background: linear-gradient(135deg, #1a0508 0%, #0c0c14 60%);
  border-bottom: 1px solid #3a1a1a;
  padding: 28px 24px 22px;
  text-align: center;
}

.header h1 {
  font-size: 2rem;
  font-weight: 700;
  letter-spacing: 0.25em;
  color: var(--gold);
  text-shadow: 0 0 20px rgba(244, 192, 48, 0.4);
}

.subtitle {
  color: var(--text3);
  font-size: 0.85rem;
  letter-spacing: 0.15em;
  margin-top: 4px;
}

/* ─── PANELS ─── */
.panels-wrap {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--border);
}

@media (max-width: 768px) {
  .panels-wrap {
    grid-template-columns: 1fr;
  }
}

.panel {
  background: var(--surface);
  padding: 20px 18px;
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border);
  margin-bottom: 16px;
}

.panel-icon {
  font-size: 1.2rem;
}

.panel-head h2 {
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text);
  letter-spacing: 0.05em;
}

.panel-atk .panel-head h2 { color: var(--red); }
.panel-def .panel-head h2 { color: var(--blue); }

/* ─── BLOCK ─── */
.block {
  margin-bottom: 18px;
}

.block-title {
  font-size: 0.72rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.12em;
  color: var(--text3);
  margin-bottom: 8px;
}

/* ─── BUFF BUTTONS ─── */
.buff-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.buff-btn {
  padding: 5px 12px;
  border-radius: 20px;
  border: 1px solid var(--border2);
  background: var(--surface2);
  color: var(--text2);
  font-size: 0.85rem;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
  position: relative;
}

.buff-btn:hover {
  border-color: var(--text3);
  color: var(--text);
}

.buff-btn.active {
  background: rgba(230, 57, 70, 0.15);
  border-color: var(--red);
  color: var(--red);
  font-weight: 600;
}

.buff-btn.active.wrath {
  background: rgba(244, 192, 48, 0.15);
  border-color: var(--gold);
  color: var(--gold);
}

.buff-btn.dimmed {
  opacity: 0.45;
  text-decoration: line-through;
}

.warn-msg {
  font-size: 0.75rem;
  color: var(--gold);
  margin-top: 6px;
  padding: 4px 8px;
  background: rgba(244, 192, 48, 0.07);
  border-radius: 4px;
  border-left: 2px solid var(--gold);
}

/* ─── TOGGLE LABEL ─── */
.toggle-label {
  display: flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  font-size: 0.85rem;
  color: var(--text2);
}

.toggle-label em {
  color: var(--text3);
  font-style: normal;
  font-size: 0.78rem;
}

.mt8 { margin-top: 8px; }
.mt4 { margin-top: 4px; }

/* ─── ELEMENT GRID ─── */
.elem-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.elem-btn {
  padding: 4px 10px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--surface2);
  color: var(--text2);
  font-size: 0.82rem;
  cursor: pointer;
  transition: all 0.12s;
  font-family: inherit;
}

.elem-btn:hover {
  border-color: var(--text3);
  color: var(--text);
}

.elem-btn.selected {
  background: color-mix(in srgb, var(--ec) 15%, transparent);
  border-color: var(--ec);
  color: var(--ec);
  font-weight: 600;
}

.elem-preview {
  display: flex;
  gap: 5px;
  margin-top: 8px;
}

.elem-badge {
  padding: 2px 10px;
  border-radius: 12px;
  border: 1px solid;
  font-size: 0.78rem;
  font-weight: 600;
}

/* ─── INPUTS ─── */
.input-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 10px;
}

.input-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 0.8rem;
  color: var(--text2);
}

/* ─── COLLISION BUTTONS ─── */
.coll-row {
  display: flex;
  gap: 6px;
}

.coll-btn {
  flex: 1;
  padding: 6px 4px;
  border-radius: var(--radius);
  border: 1px solid var(--border);
  background: var(--surface2);
  color: var(--text2);
  font-size: 0.82rem;
  cursor: pointer;
  transition: all 0.15s;
  font-family: inherit;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}

.coll-btn:hover {
  border-color: var(--text3);
}

.coll-btn.active {
  background: rgba(116, 185, 255, 0.12);
  border-color: var(--blue);
  color: var(--blue);
}

.coll-base {
  font-size: 0.7rem;
  opacity: 0.7;
}

/* ─── ELEMENT MATRIX TABLE ─── */
.matrix-table {
  border: 1px solid var(--border);
  border-radius: var(--radius);
  overflow: hidden;
  font-size: 0.78rem;
}

.matrix-row {
  display: grid;
  grid-template-columns: 50px 1fr 1fr;
  gap: 6px;
  padding: 5px 8px;
  border-bottom: 1px solid var(--border);
  align-items: center;
}

.matrix-row:last-child { border-bottom: none; }

.matrix-header {
  background: var(--surface2);
  color: var(--text3);
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.matrix-elem {
  font-weight: 600;
}

.matrix-strong, .matrix-weak {
  display: flex;
  flex-wrap: wrap;
  gap: 3px;
}

.matrix-badge {
  padding: 1px 5px;
  border-radius: 4px;
  background: rgba(255,255,255,0.05);
}

.matrix-none { color: var(--text3); }

/* ─── RESULTS SECTION ─── */
.results {
  background: var(--surface);
  margin-top: 1px;
  padding: 24px 20px;
}

.results-title {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text2);
  letter-spacing: 0.08em;
  margin-bottom: 16px;
}

.mt24 { margin-top: 24px; }

/* ─── MULTIPLIER CARDS ─── */
.mult-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
  margin-bottom: 24px;
}

.mult-card {
  background: var(--surface2);
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  padding: 14px 14px 12px;
}

.cm-card {
  border-color: rgba(230, 57, 70, 0.35);
  background: rgba(230, 57, 70, 0.04);
}

.elem-card {
  border-color: rgba(244, 192, 48, 0.25);
}

.mc-label {
  font-size: 0.72rem;
  color: var(--text3);
  text-transform: uppercase;
  letter-spacing: 0.1em;
  margin-bottom: 4px;
  display: flex;
  align-items: center;
  gap: 6px;
}

.mc-tag {
  background: var(--border);
  padding: 1px 6px;
  border-radius: 4px;
  font-size: 0.65rem;
  letter-spacing: 0.05em;
}

.mc-value {
  font-size: 1.5rem;
  font-weight: 700;
  color: var(--text);
  margin: 4px 0 8px;
}

.mc-value.large {
  font-size: 2rem;
}

.mc-value.pos { color: var(--green); }
.mc-value.neg { color: var(--red); }

.mc-steps {
  display: flex;
  flex-direction: column;
  gap: 2px;
  margin-bottom: 6px;
  font-size: 0.78rem;
}

.mc-step {
  display: flex;
  align-items: center;
  gap: 5px;
  color: var(--text2);
}

.mc-step.inactive {
  color: var(--text3);
  text-decoration: line-through;
  opacity: 0.6;
}

.mc-step.special {
  color: var(--purple);
  font-style: italic;
}

.step-delta {
  font-weight: 700;
  min-width: 32px;
  font-size: 0.8rem;
}
.step-delta.pos { color: var(--green); }
.step-delta.neg { color: var(--red); }
.step-delta.dead { color: var(--text3); }
.step-delta.note { color: var(--text3); }

.step-label {
  font-weight: 500;
}

.step-note {
  color: var(--text3);
  font-size: 0.72rem;
}

.mc-formula {
  font-size: 0.78rem;
  color: var(--text3);
  padding-top: 6px;
  border-top: 1px solid var(--border);
}

.mc-formula strong { color: var(--text2); }

.cm-formula {
  font-size: 0.82rem;
  color: var(--text2);
}

.cm-op { color: var(--text3); }

.mc-hint {
  font-size: 0.7rem;
  color: var(--text3);
  margin-top: 4px;
}

/* ─── DAMAGE TABLE ─── */
.dmg-table {
  border: 1px solid var(--border);
  border-radius: var(--radius-lg);
  overflow: hidden;
}

.dmg-row {
  display: grid;
  grid-template-columns: 1fr 2fr auto;
  gap: 12px;
  padding: 10px 14px;
  border-bottom: 1px solid var(--border);
  align-items: center;
  transition: background 0.1s;
}

.dmg-row:last-child { border-bottom: none; }

.dmg-row:hover:not(.header-row) {
  background: rgba(255,255,255,0.02);
}

.header-row {
  background: var(--surface2);
  font-size: 0.7rem;
  color: var(--text3);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-weight: 600;
}

.dmg-name {
  font-size: 0.88rem;
  font-weight: 500;
  color: var(--text);
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.col-formula {
  font-size: 0.78rem;
  color: var(--text3);
}

.col-dmg {
  text-align: right;
  min-width: 70px;
}

.formula-text {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 3px;
}

.f-cm    { color: var(--red);    font-weight: 600; }
.f-drm   { color: var(--blue);   font-weight: 600; }
.f-bam   { color: var(--gold);   font-weight: 600; }
.f-em    { color: var(--gold);   font-weight: 600; }

.dmg-val {
  font-size: 1.1rem;
  font-weight: 700;
  color: var(--green);
}

.dmg-val.neg { color: var(--red); }

.coll-badge {
  font-style: normal;
  font-size: 0.7rem;
  color: var(--blue);
  background: rgba(116, 185, 255, 0.1);
  padding: 1px 6px;
  border-radius: 4px;
  border: 1px solid rgba(116, 185, 255, 0.25);
}

.coll-badge.poison {
  color: var(--green);
  background: rgba(82, 183, 136, 0.1);
  border-color: rgba(82, 183, 136, 0.25);
}

.footnote {
  margin-top: 12px;
  font-size: 0.74rem;
  color: var(--text3);
  line-height: 1.6;
}

/* ─── FOOTER ─── */
.footer {
  background: var(--surface);
  border-top: 1px solid var(--border);
  text-align: center;
  padding: 16px;
  font-size: 0.75rem;
  color: var(--text3);
}

/* ─── RESPONSIVE ─── */
@media (max-width: 600px) {
  .input-grid { grid-template-columns: 1fr; }

  .dmg-row {
    grid-template-columns: 1fr auto;
    row-gap: 2px;
  }
  .col-formula { grid-column: 1 / -1; }

  .mult-cards { grid-template-columns: 1fr 1fr; }
}
</style>
