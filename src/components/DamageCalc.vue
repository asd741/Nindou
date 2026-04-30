<script setup>
import { ref, reactive, computed } from 'vue'

const ATTACK_TYPES = [
  { key: 'normal',   label: '普攻 / 式神' },
  { key: 'ult',      label: '奧義' },
  { key: 'ninjutsu', label: '攻擊系忍術' },
  { key: 'dart',     label: '錢標' },
  { key: 'charge',   label: '衝撞' },
]

const CHARGE_PRESETS = [
  { label: '非變身 30',  val: 30  },
  { label: '夜叉 100',   val: 100 },
  { label: '赤鬼 200',   val: 200 },
]

const ELEMENTS = ['無', '炎', '冰', '風', '雷', '地', '光', '闇', '修羅', '毒', '木']
const ELEM_COLOR = {
  '無': '#888899', '炎': '#ff6b35', '冰': '#74c0fc', '風': '#a9e34b', '雷': '#f4c030',
  '地': '#b07b45', '光': '#ffd700', '闇': '#b08fff', '修羅': '#e63946', '毒': '#2dd4bf', '木': '#52b788',
}
const ADJ = {
  '無':  { '修羅': 0.2, '毒': 0.2, '木': 0.2, '光': -0.2 },
  '炎':  { '風': 0.2, '毒': 0.2, '木': 0.2, '炎': -0.2, '冰': -0.2 },
  '冰':  { '炎': 0.2, '毒': 0.2, '木': 0.2, '冰': -0.2, '地': -0.2 },
  '風':  { '雷': 0.2, '毒': 0.2, '木': 0.2, '炎': -0.2, '風': -0.2 },
  '雷':  { '地': 0.2, '毒': 0.2, '木': 0.2, '風': -0.2, '雷': -0.2 },
  '地':  { '冰': 0.2, '毒': 0.2, '木': 0.2, '雷': -0.2, '地': -0.2 },
  '光':  { '闇': 0.2, '修羅': 0.2, '毒': 0.2, '無': -0.2, '光': -0.2 },
  '闇':  { '無': 0.2, '光': 0.2, '木': 0.2, '闇': -0.2, '修羅': -0.2 },
  '修羅': { '無': 0.2, '毒': 0.2, '木': 0.2, '闇': -0.2, '修羅': -0.2 },
  '毒':  { '無': 0.2, '炎': 0.2, '冰': 0.2, '風': 0.2, '雷': 0.2, '地': 0.2, '修羅': 0.2, '木': 0.2, '光': -0.2, '毒': -0.2 },
  '木':  { '無': 0.2, '炎': 0.2, '冰': 0.2, '風': 0.2, '雷': 0.2, '地': 0.2, '毒': 0.2, '闇': -0.2, '木': -0.2 },
}

const ATK_BTNS = [
  { key: 'hotblood',   label: '熱血',     val: '+0.5'  },
  { key: 'magicWater', label: '魔水',     val: '+1'    },
  { key: 'redBug',     label: '赤蟲',     val: '−0.5' },
  { key: 'shikigami',  label: '式神',     val: '+1'    },
  { key: 'wrathSeal',  label: '暴怒法印', val: '+3'    },
]
const DEF_BTNS = [
  { key: 'steel',      label: '鋼鐵',     val: '−0.25' },
  { key: 'magicWater', label: '魔水',     val: '−0.5'  },
  { key: 'greenBug',   label: '青蟲',     val: '+0.5'  },
  { key: 'wrathSeal',  label: '暴怒法印', val: '+3'    },
]

function getAdj(a, d) { return ADJ[a]?.[d] ?? 0 }
function r2(n) { return Math.round(n * 100) / 100 }

const attackType = ref('normal')
const baseDmg    = ref(0)
const specialDef = ref(0)
const poisonToad = ref(false)

// formula flags
const bamApplies   = computed(() => ['normal', 'dart', 'charge'].includes(attackType.value))
const elemApplies  = computed(() => ['normal', 'ult'].includes(attackType.value))
const shuraApplies = computed(() => ['normal', 'ult', 'charge'].includes(attackType.value))
const showSpecialDef = computed(() => ['ult', 'ninjutsu'].includes(attackType.value))
const specialDefLabel = computed(() => attackType.value === 'ult' ? '奧防' : '術防')

const atk = reactive({ hotblood: false, magicWater: false, redBug: false, shikigami: false, wrathSeal: false, attr1: '無', attr2: '無', useDual: false })
const def = reactive({ steel: false, magicWater: false, greenBug: false, wrathSeal: false, attr1: '無', attr2: '無', useDual: false })

const eAtk = computed(() => {
  if (atk.wrathSeal)
    return { hotblood: false, magicWater: false, redBug: atk.redBug, shikigami: atk.shikigami, wrathSeal: true }
  if (atk.magicWater)
    return { hotblood: false, magicWater: true, redBug: atk.redBug, shikigami: atk.shikigami, wrathSeal: false }
  return { hotblood: atk.hotblood, magicWater: false, redBug: atk.redBug, shikigami: atk.shikigami, wrathSeal: false }
})

const eDef = computed(() => {
  const greenBugActive = def.greenBug && !atk.wrathSeal
  if (def.wrathSeal)
    return { steel: false, magicWater: false, greenBug: false, wrathSeal: true }
  if (def.magicWater)
    return { steel: false, magicWater: true, greenBug: greenBugActive, wrathSeal: false }
  return { steel: def.steel, magicWater: false, greenBug: greenBugActive, wrathSeal: false }
})

const atkAttrs = computed(() => {
  const a = [atk.attr1]
  if (atk.useDual && atk.attr2 !== atk.attr1) a.push(atk.attr2)
  return a
})
const defAttrs = computed(() => {
  const a = [def.attr1]
  if (def.useDual && def.attr2 !== def.attr1) a.push(def.attr2)
  return a
})

const atkHasShura = computed(() => atkAttrs.value.includes('修羅'))

const BAM = computed(() => {
  const e = eAtk.value
  let v = 1
  if (e.wrathSeal)       v += 3
  else if (e.magicWater) v += 1
  else if (e.hotblood)   v += 0.5
  if (e.redBug)    v -= 0.5
  if (e.shikigami) v += 1
  return r2(v)
})

const rawDRM = computed(() => {
  const e = eDef.value
  if (e.wrathSeal) return 4
  let v = 1
  if (e.magicWater)    v -= 0.5
  else if (e.steel)    v -= 0.25
  if (e.greenBug) v += 0.5
  return r2(v)
})

const DRM = computed(() => {
  const v = rawDRM.value
  return (atkHasShura.value && shuraApplies.value && v < 1) ? 1 : v
})

const CM = computed(() => r2(BAM.value + DRM.value - 1))

const elemMult = computed(() => {
  if (!elemApplies.value) return 1
  let adj = 0
  for (const a of atkAttrs.value)
    for (const d of defAttrs.value)
      adj += getAdj(a, d)
  return r2(1 + adj)
})

const effectiveBase = computed(() => attackType.value === 'dart' ? 150 : (Number(baseDmg.value) || 0))

const finalDmg = computed(() => {
  const base = effectiveBase.value
  const sd   = Number(specialDef.value) || 0
  switch (attackType.value) {
    case 'normal':   return Math.floor(base * CM.value * elemMult.value)
    case 'ult':      return Math.max(0, Math.floor(base * DRM.value * elemMult.value) - sd)
    case 'ninjutsu': return Math.max(0, Math.floor(base * DRM.value) - sd)
    case 'dart':     return Math.floor(150 * CM.value)
    case 'charge':   return Math.floor(base * CM.value)
    default: return 0
  }
})

const poisonToadDmg = computed(() =>
  poisonToad.value && attackType.value === 'charge' ? finalDmg.value * 3 : null
)

const finalFormula = computed(() => {
  const base = effectiveBase.value
  const sd   = Number(specialDef.value) || 0
  switch (attackType.value) {
    case 'normal':   return `${base} × CM(${CM.value}) × 屬性(${elemMult.value})`
    case 'ult':      return `floor(${base} × DRM(${DRM.value}) × 屬性(${elemMult.value})) − 奧防(${sd})`
    case 'ninjutsu': return `floor(${base} × DRM(${DRM.value})) − 術防(${sd})`
    case 'dart':     return `150 × CM(${CM.value})`
    case 'charge':   return `${base} × CM(${CM.value})`
    default: return ''
  }
})

const atkWarn = computed(() => {
  if (atk.wrathSeal) {
    const lost = [atk.magicWater && '魔水', atk.hotblood && '熱血'].filter(Boolean)
    return lost.length ? `暴怒法印啟動：${lost.join('、')} 失效` : ''
  }
  return (atk.magicWater && atk.hotblood) ? '魔水啟動：熱血 失效' : ''
})

const defWarn = computed(() => {
  const msgs = []
  if (def.wrathSeal) {
    const lost = [def.magicWater && '魔水', def.steel && '鋼鐵'].filter(Boolean)
    if (lost.length) msgs.push(`暴怒法印啟動：${lost.join('、')} 失效`)
  } else if (def.magicWater && def.steel) {
    msgs.push('魔水啟動：鋼鐵 失效')
  }
  if (def.greenBug && atk.wrathSeal) msgs.push('攻方暴怒法印：青蟲 無效')
  return msgs.join('　')
})

const bamDetail = computed(() => {
  const steps = [{ label: '基礎', val: '1', cls: '' }]
  if (atk.wrathSeal) {
    steps.push({ label: '暴怒法印', val: '+3', cls: 'pos' })
    if (atk.magicWater) steps.push({ label: '魔水', val: '+1', cls: 'off' })
    if (atk.hotblood)   steps.push({ label: '熱血', val: '+0.5', cls: 'off' })
  } else if (atk.magicWater) {
    steps.push({ label: '魔水', val: '+1', cls: 'pos' })
    if (atk.hotblood) steps.push({ label: '熱血', val: '+0.5', cls: 'off' })
  } else if (atk.hotblood) {
    steps.push({ label: '熱血', val: '+0.5', cls: 'pos' })
  }
  if (atk.redBug)    steps.push({ label: '赤蟲', val: '−0.5', cls: 'neg' })
  if (atk.shikigami) steps.push({ label: '式神', val: '+1', cls: 'pos' })
  return steps
})

const drmDetail = computed(() => {
  const steps = [{ label: '基礎', val: '1', cls: '' }]
  if (def.wrathSeal) {
    steps.push({ label: '暴怒法印', val: '+3', cls: 'pos' })
    if (def.magicWater) steps.push({ label: '魔水', val: '−0.5', cls: 'off' })
    if (def.steel)      steps.push({ label: '鋼鐵', val: '−0.25', cls: 'off' })
  } else if (def.magicWater) {
    steps.push({ label: '魔水', val: '−0.5', cls: 'neg' })
    if (def.steel) steps.push({ label: '鋼鐵', val: '−0.25', cls: 'off' })
  } else if (def.steel) {
    steps.push({ label: '鋼鐵', val: '−0.25', cls: 'neg' })
  }
  if (def.greenBug && !def.wrathSeal) {
    const active = eDef.value.greenBug
    steps.push({ label: '青蟲', val: '+0.5', cls: active ? 'pos' : 'off', note: active ? '' : '攻方暴怒法印，無效' })
  }
  if (atkHasShura.value && shuraApplies.value && rawDRM.value < 1)
    steps.push({ label: '修羅補正', val: '↑≥1', cls: 'shura' })
  return steps
})

const elemDetail = computed(() => {
  if (!elemApplies.value) return []
  const result = []
  for (const a of atkAttrs.value)
    for (const d of defAttrs.value) {
      const adj = getAdj(a, d)
      if (adj !== 0) result.push({ a, d, adj })
    }
  return result
})

function atkBtnCls(key) {
  if (!atk[key]) return {}
  const eff = eAtk.value[key]
  return { on: true, dim: !eff, wrath: key === 'wrathSeal' && eff, 'atk-act': key !== 'wrathSeal' && eff }
}

function defBtnCls(key) {
  if (!def[key]) return {}
  const eff = eDef.value[key]
  return { on: true, dim: !eff, wrath: key === 'wrathSeal' && eff, 'grn-act': key === 'greenBug' && eff, 'def-act': key !== 'wrathSeal' && key !== 'greenBug' && eff }
}

function setAttackType(type) {
  attackType.value = type
  specialDef.value = 0
  poisonToad.value = false
  if (type === 'dart') baseDmg.value = 150
  else if (type === 'charge') baseDmg.value = 30
  else baseDmg.value = 0
}

function resetAll() {
  attackType.value = 'normal'
  baseDmg.value = 0
  specialDef.value = 0
  poisonToad.value = false
  Object.assign(atk, { hotblood: false, magicWater: false, redBug: false, shikigami: false, wrathSeal: false, attr1: '無', attr2: '無', useDual: false })
  Object.assign(def, { steel: false, magicWater: false, greenBug: false, wrathSeal: false, attr1: '無', attr2: '無', useDual: false })
}
</script>

<template>
  <div class="dc">

    <!-- ATTACK TYPE SELECTOR -->
    <div class="type-bar">
      <button
        v-for="t in ATTACK_TYPES" :key="t.key"
        class="type-btn" :class="{ active: attackType === t.key }"
        @click="setAttackType(t.key)"
      >{{ t.label }}</button>
    </div>

    <!-- BASE DAMAGE + SPECIAL DEF -->
    <div class="base-sec">
      <div class="base-inner">
        <span class="base-lbl">基礎傷害</span>

        <!-- 錢標 fixed -->
        <span v-if="attackType === 'dart'" class="base-fixed">150（固定）</span>
        <!-- others: input -->
        <input v-else type="number" v-model.number="baseDmg" min="0" placeholder="0" class="base-inp" />

        <!-- 衝撞 presets -->
        <div v-if="attackType === 'charge'" class="presets">
          <button
            v-for="p in CHARGE_PRESETS" :key="p.val"
            class="pre-btn" :class="{ 'pre-active': baseDmg === p.val }"
            @click="baseDmg = p.val"
          >{{ p.label }}</button>
        </div>

        <!-- 奧防 / 術防 -->
        <template v-if="showSpecialDef">
          <span class="base-lbl base-lbl-def">{{ specialDefLabel }}</span>
          <input type="number" v-model.number="specialDef" min="0" placeholder="0" class="base-inp base-inp-sm" />
        </template>

        <!-- 毒遁 toggle -->
        <label v-if="attackType === 'charge'" class="toad-lbl">
          <input type="checkbox" v-model="poisonToad" />
          <span>毒遁</span>
        </label>

        <button class="pre-btn rst-btn" @click="resetAll">重置</button>
      </div>
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
            <span v-if="!bamApplies" class="na-hint">（BAM 不計入此類型；暴怒法印仍影響防方青蟲）</span>
          </div>
          <div class="btn-row">
            <button
              v-for="b in ATK_BTNS" :key="b.key"
              class="sbtn" :class="atkBtnCls(b.key)"
              @click="atk[b.key] = !atk[b.key]"
            >
              <span class="sb-name">{{ b.label }}</span>
              <span class="sb-val">{{ b.val }}</span>
            </button>
          </div>
          <div v-if="atkWarn" class="warn">{{ atkWarn }}</div>
        </div>

        <div class="pblk" :class="{ 'pblk-na': !elemApplies }">
          <div class="pblk-hd">
            元素屬性
            <span v-if="!elemApplies" class="na-hint">（屬性不計入此類型；修羅仍影響 DRM 補正）</span>
          </div>
          <div class="egrid">
            <button
              v-for="e in ELEMENTS" :key="e"
              class="ebtn" :class="{ 'ebtn-on': atk.attr1 === e }"
              :style="atk.attr1 === e ? { '--ec': ELEM_COLOR[e] } : {}"
              @click="atk.attr1 = e"
            >{{ e }}</button>
          </div>
          <label class="dual-lbl">
            <input type="checkbox" v-model="atk.useDual" />
            <span>雙屬性</span>
          </label>
          <div v-if="atk.useDual" class="egrid mt4">
            <button
              v-for="e in ELEMENTS" :key="e"
              class="ebtn"
              :class="{ 'ebtn-on': atk.attr2 === e, 'ebtn-same': e === atk.attr1 && e !== '無' }"
              :style="atk.attr2 === e ? { '--ec': ELEM_COLOR[e] } : {}"
              @click="atk.attr2 = e"
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
          <div class="pblk-hd">承受狀態</div>
          <div class="btn-row">
            <button
              v-for="b in DEF_BTNS" :key="b.key"
              class="sbtn" :class="defBtnCls(b.key)"
              @click="def[b.key] = !def[b.key]"
            >
              <span class="sb-name">{{ b.label }}</span>
              <span class="sb-val">{{ b.val }}</span>
            </button>
          </div>
          <div v-if="defWarn" class="warn">{{ defWarn }}</div>
        </div>

        <div class="pblk" :class="{ 'pblk-na': !elemApplies }">
          <div class="pblk-hd">
            元素屬性
            <span v-if="!elemApplies" class="na-hint">（屬性不計入此類型）</span>
          </div>
          <div class="egrid">
            <button
              v-for="e in ELEMENTS" :key="e"
              class="ebtn" :class="{ 'ebtn-on': def.attr1 === e }"
              :style="def.attr1 === e ? { '--ec': ELEM_COLOR[e] } : {}"
              @click="def.attr1 = e"
            >{{ e }}</button>
          </div>
          <label class="dual-lbl">
            <input type="checkbox" v-model="def.useDual" />
            <span>雙屬性</span>
          </label>
          <div v-if="def.useDual" class="egrid mt4">
            <button
              v-for="e in ELEMENTS" :key="e"
              class="ebtn"
              :class="{ 'ebtn-on': def.attr2 === e, 'ebtn-same': e === def.attr1 && e !== '無' }"
              :style="def.attr2 === e ? { '--ec': ELEM_COLOR[e] } : {}"
              @click="def.attr2 = e"
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
        <div class="fcard" :class="{ 'fcard-na': !bamApplies }">
          <div class="fc-name">
            攻擊倍率 <span class="tag">BAM</span>
            <span v-if="!bamApplies" class="na-tag">不計入公式</span>
          </div>
          <div class="fc-val" :class="bamApplies ? (BAM > 1 ? 'v-pos' : BAM < 1 ? 'v-neg' : '') : 'v-na'">
            {{ BAM }}
          </div>
          <div class="steps">
            <div v-for="(s, i) in bamDetail" :key="i" class="step" :class="{ 'step-off': s.cls === 'off' }">
              <span class="sv" :class="'sv-' + s.cls">{{ s.val }}</span>
              <span class="sl">{{ s.label }}</span>
            </div>
          </div>
          <div class="fc-eq">= {{ BAM }}</div>
        </div>

        <!-- DRM -->
        <div class="fcard">
          <div class="fc-name">承受倍率 <span class="tag">DRM</span></div>
          <div class="fc-val" :class="DRM > 1 ? 'v-pos' : DRM < 1 ? 'v-neg' : ''">{{ DRM }}</div>
          <div class="steps">
            <div v-for="(s, i) in drmDetail" :key="i" class="step" :class="{ 'step-off': s.cls === 'off' }">
              <span class="sv" :class="'sv-' + s.cls">{{ s.val }}</span>
              <span class="sl">{{ s.label }}</span>
              <span v-if="s.note" class="sn">{{ s.note }}</span>
            </div>
          </div>
          <div class="fc-eq">
            = {{ DRM }}
            <span v-if="atkHasShura && shuraApplies && rawDRM < 1" class="shura-note">（修羅補正）</span>
          </div>
        </div>

        <!-- CM -->
        <div class="fcard fcard-cm" :class="{ 'fcard-na': !bamApplies }">
          <div class="fc-name">
            綜合倍率 <span class="tag">CM</span>
            <span v-if="!bamApplies" class="na-tag">不計入公式</span>
          </div>
          <div class="fc-val fc-val-lg" :class="bamApplies ? (CM > 1 ? 'v-pos' : CM < 1 ? 'v-neg' : '') : 'v-na'">
            {{ CM }}
          </div>
          <div class="cm-formula">BAM({{ BAM }}) + DRM({{ DRM }}) − 1</div>
        </div>

        <!-- 屬性相剋 -->
        <div class="fcard fcard-elem" :class="{ 'fcard-na': !elemApplies }">
          <div class="fc-name">
            屬性相剋
            <span v-if="!elemApplies" class="na-tag">不計入公式</span>
          </div>
          <div class="fc-val fc-val-lg" :class="elemApplies ? (elemMult > 1 ? 'v-pos' : elemMult < 1 ? 'v-neg' : '') : 'v-na'">
            {{ elemApplies ? elemMult + 'x' : '—' }}
          </div>
          <div class="elem-parts">
            <template v-if="elemApplies">
              <span v-if="!elemDetail.length" class="ep-none">無相剋</span>
              <span
                v-for="(p, i) in elemDetail" :key="i"
                class="ep"
                :class="p.adj > 0 ? 'ep-pos' : p.adj < 0 ? 'ep-neg' : 'ep-neu'"
              >{{ p.adj > 0 ? '+' : p.adj < 0 ? '−' : '±' }}0.2 {{ p.a }}→{{ p.d }}</span>
            </template>
            <span v-else class="ep-none">此類型不受屬性影響</span>
          </div>
        </div>

      </div>

      <!-- FINAL DAMAGE -->
      <div class="final-box">
        <div class="final-formula">{{ finalFormula }}</div>
        <div class="final-label">最終傷害</div>
        <div class="final-num" :class="finalDmg > 0 ? 'num-hi' : ''">
          {{ finalDmg.toLocaleString() }}
        </div>
      </div>

      <!-- 毒遁 RESULT -->
      <div v-if="attackType === 'charge'" class="toad-box">
        <label class="toad-toggle">
          <input type="checkbox" v-model="poisonToad" />
          <span>毒遁傷害（衝撞最終 × 3，對變身系無效，無視 DRM 與術防）</span>
        </label>
        <div v-if="poisonToadDmg !== null" class="toad-result">
          {{ finalDmg.toLocaleString() }} × 3 =
          <span class="toad-num">{{ poisonToadDmg.toLocaleString() }}</span>
        </div>
      </div>

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

/* 毒遁 toggle in base row */
.toad-lbl {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 0.8rem;
  color: var(--text2);
  cursor: pointer;
  border: 1px solid var(--border2);
  border-radius: 20px;
  padding: 4px 12px;
  background: var(--surface);
  transition: all 0.12s;
}
.toad-lbl:has(input:checked) {
  border-color: var(--purple);
  color: var(--purple);
  background: rgba(176,143,255,0.08);
}

/* PANELS */
.panels {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 1px;
  background: var(--border);
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

/* STATUS BUTTONS */
.btn-row { display: flex; flex-wrap: wrap; gap: 6px; }
.sbtn {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1px;
  padding: 6px 11px 5px;
  border-radius: 7px;
  border: 1px solid var(--border2);
  background: var(--surface2);
  color: var(--text2);
  cursor: pointer;
  font-family: inherit;
  transition: all 0.13s;
}
.sbtn:hover { border-color: var(--text3); color: var(--text); }
.sb-name { font-size: 0.83rem; font-weight: 500; }
.sb-val  { font-size: 0.63rem; color: var(--text3); font-variant-numeric: tabular-nums; }

.sbtn.on { opacity: 1; }
.sbtn.dim { opacity: 0.35; text-decoration: line-through; }
.sbtn.atk-act { background: rgba(230,57,70,0.1); border-color: var(--red); color: var(--red); }
.sbtn.atk-act .sb-val { color: rgba(230,57,70,0.55); }
.sbtn.def-act { background: rgba(116,185,255,0.1); border-color: var(--blue); color: var(--blue); }
.sbtn.def-act .sb-val { color: rgba(116,185,255,0.55); }
.sbtn.grn-act { background: rgba(82,183,136,0.1); border-color: var(--green); color: var(--green); }
.sbtn.grn-act .sb-val { color: rgba(82,183,136,0.55); }
.sbtn.wrath { background: rgba(244,192,48,0.1); border-color: var(--gold); color: var(--gold); }
.sbtn.wrath .sb-val { color: rgba(244,192,48,0.55); }

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

/* 毒遁 */
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
</style>
