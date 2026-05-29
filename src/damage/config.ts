/* ════════════════════════════════════════════════════════════════════════════
   忍豆風雲4 傷害規則 — 唯一編輯入口（config）

   要改規則就改這裡，且每個功能保證「單一位置」：
     • 新增/移除一個攻擊增益、承受狀態 → 增刪 ATTACKER_BUFFS / DEFENDER_STATES 的一個物件
     • 新增/移除一種攻擊類型           → 增刪 ATTACK_TYPES 的一個物件（公式、輸入、說明都在內）
     • 新增/移除一條獨立規則（如毒遁） → 增刪 SPECIAL_RULES 的一個物件
   想暫時關閉而不刪除：把該物件的 enabled 設為 false（按鈕、計算、規則一覽會一起消失）。

   數值與規則來源：本專案 notion.md「傷害計算」。每個物件的 rule 欄即該條規則摘要，
   並會自動出現在 app 內的「規則一覽」—— 計算與說明永遠同源。

   引擎機械在 engine.ts；型別在 types.ts。一般改規則不需動那兩個檔。
   ════════════════════════════════════════════════════════════════════════════ */
import { round2 } from './engine'
import type { ModifierDef, ModifierCategory, ShuraCorrection, AttackType, SpecialRule } from './types'

/* ── 狀態來源分類 ─────────────────────────────────────────────────────────────
   純 UI 分區用，不影響任何計算。此陣列的順序＝面板中各分區由上到下的排列順序；
   某分類下若無任何啟用中的狀態，該分區會自動隱藏。 */
export const MODIFIER_CATEGORIES: readonly ModifierCategory[] = ['道具效果', '忍術效果', '職業特性'] as const

/* ── 元素與相剋 ───────────────────────────────────────────────────────────────
   單向相剋 ±0.2（冰剋火：冰打火 ×1.2、火打冰 ×0.8）。
   雙屬性時，攻守各屬性兩兩配對的 adj 全部相加。屬性倍率 = 1 + Σ adj。
   外鍵 = 攻方屬性，內鍵 = 守方屬性；查不到視為 0（無相剋）。 */
export const ELEMENTS = ['無', '炎', '冰', '風', '雷', '地', '光', '闇', '修羅', '毒', '木'] as const
export type Element = (typeof ELEMENTS)[number]

export const ELEM_COLOR: Record<Element, string> = {
  '無': '#888899', '炎': '#ff6b35', '冰': '#74c0fc', '風': '#a9e34b', '雷': '#f4c030',
  '地': '#b07b45', '光': '#ffd700', '闇': '#b08fff', '修羅': '#e63946', '毒': '#2dd4bf', '木': '#52b788',
}

export const ELEMENT_ADJ: Record<Element, Partial<Record<Element, number>>> = {
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
export const ELEMENT_RULE =
  '單向相剋 ±0.2（冰剋火：冰打火 ×1.2、火打冰 ×0.8）。雙屬性各配對 adj 相加。屬性倍率 = 1 + Σ adj。僅普攻／奧義適用。'

/** 屬性倍率：攻守屬性陣列 → 倍率（與 ELEMENT_ADJ 同源的評估函式）。 */
export function elementMult(atkAttrs: Element[], defAttrs: Element[]): number {
  let adj = 0
  for (const a of atkAttrs)
    for (const d of defAttrs)
      adj += ELEMENT_ADJ[a]?.[d] ?? 0
  return round2(1 + adj)
}

/* ── 攻擊倍率 BAM（攻擊方狀態）────────────────────────────────────────────────
   group:'exclusive' → 同組互斥取最高優先；group:'additive' → 獨立加總。 */
export const ATTACKER_BUFFS: ModifierDef[] = [
  { id: 'wrathSeal',  label: '暴怒法印', category: '道具效果', delta: 3,    group: 'exclusive', priority: 1, tone: 'wrath',
    rule: '暴怒法印：攻擊倍率 +3。啟動後使自身魔水／熱血／爆殺失效（互斥取最高）。' },
  { id: 'magicWater', label: '魔水',     category: '道具效果', delta: 1,    group: 'exclusive', priority: 2, tone: 'atk',
    rule: '魔水：攻擊倍率 +1。啟動後使自身熱血／爆殺失效。' },
  { id: 'hotblood',   label: '熱血',     category: '忍術效果', delta: 0.5,  group: 'exclusive', priority: 3, tone: 'atk',
    rule: '熱血：攻擊倍率 +0.5。與爆殺同組互斥，不疊加。' },
  { id: 'redBug',     label: '赤蟲',     category: '忍術效果', delta: -0.5, group: 'additive', tone: 'atk',
    rule: '赤蟲：攻擊倍率 −0.5，可與互斥群組疊加。' },
  { id: 'bloodlust',  label: '爆殺',     category: '職業特性', delta: 0.5,  group: 'exclusive', priority: 3, tone: 'atk',
    rule: '爆殺：攻擊倍率 +0.5。與熱血同組互斥，不疊加。' },
  // 以下兩個職業特性需求尚未確定，暫不開放（enabled: false → 不出現於 UI 與計算）。
  // 待規格底定，補上 delta／group／rule 並移除 enabled 即可上線。
  { id: 'yomiBreath', label: '黃泉之息', category: '職業特性', enabled: false, delta: 0, group: 'additive', tone: 'atk',
    rule: '黃泉之息：職業特性，需求未定，暫不開放。' },
  { id: 'mindsEye',   label: '心之眼',   category: '職業特性', enabled: false, delta: 0, group: 'additive', tone: 'atk',
    rule: '心之眼：職業特性，需求未定，暫不開放。' },
]

/* ── 承受倍率 DRM（受擊方狀態）────────────────────────────────────────────────
   自身暴怒法印只壓制同組的「魔水／鋼鐵」，不影響青蟲；
   青蟲是獨立加項，只有「攻方」暴怒法印時才失效（攻方暴怒無視受擊方青蟲）。 */
export const DEFENDER_STATES: ModifierDef[] = [
  { id: 'wrathSeal',  label: '暴怒法印', category: '道具效果', delta: 3,     group: 'exclusive', priority: 1, tone: 'wrath',
    rule: '暴怒法印：承受倍率 +3。啟動後使自身魔水／鋼鐵失效；不影響青蟲。' },
  { id: 'magicWater', label: '魔水',     category: '道具效果', delta: -0.5,  group: 'exclusive', priority: 2, tone: 'def',
    rule: '魔水：承受倍率 −0.5。啟動後使自身鋼鐵失效。' },
  { id: 'steel',      label: '鋼鐵',     category: '忍術效果', delta: -0.25, group: 'exclusive', priority: 3, tone: 'def',
    rule: '鋼鐵：承受倍率 −0.25。' },
  { id: 'greenBug',   label: '青蟲',     category: '忍術效果', delta: 0.5,   group: 'additive', tone: 'grn',
    disabledWhen: ctx => ctx.attackerWrath, disabledNote: '攻方暴怒法印，無效',
    rule: '青蟲：承受倍率 +0.5。可與魔水／鋼鐵／自身暴怒疊加；攻方暴怒法印時失效（攻方暴怒無視受擊方青蟲）。' },
]

/* ── 修羅補正（受擊方下限保護）────────────────────────────────────────────────
   攻方屬性含「修羅」且該攻擊類型適用時，承受倍率 < 1 會被補正為 1。 */
export const SHURA_CORRECTION: ShuraCorrection = {
  label: '修羅補正',
  rule: '攻方屬性含修羅，且為普攻／奧義／衝撞時：承受倍率若 < 1 補正為 1（受擊方下限保護）。',
  apply: (rawDRM, { attackerHasShura, applies }) =>
    (attackerHasShura && applies && rawDRM < 1) ? 1 : rawDRM,
}

/* ── 攻擊類型 ─────────────────────────────────────────────────────────────────
   uses 決定哪些倍率計入公式、UI 哪些卡片亮起；formula 為純函式吃 ctx 吐數字。
   刪掉一個物件即移除該攻擊類型（分頁、輸入、公式一起消失）。 */
export const ATTACK_TYPES: AttackType[] = [
  {
    id: 'normal', label: '普攻',
    uses: { bam: true, drm: true, cm: true, element: true, shura: true },
    inputs: [{ id: 'base', label: '基礎傷害', default: 0 }],
    formula:     ({ i, CM, elem }) => Math.floor(i.base * CM * elem),
    formulaText: ({ i, CM, elem }) => `floor(${i.base} × CM(${CM}) × 屬性(${elem}))`,
    rule: '最終 = floor(原始 × 綜合倍率 CM × 屬性倍率)。修羅補正適用。',
  },
  {
    id: 'ult', label: '奧義',
    uses: { bam: false, drm: true, cm: false, element: true, shura: true },
    inputs: [{ id: 'base', label: '奧義原始', default: 0 }, { id: 'specialDef', label: '奧防', default: 0 }],
    formula:     ({ i, DRM, elem }) => Math.max(0, Math.floor(i.base * DRM * elem) - i.specialDef),
    formulaText: ({ i, DRM, elem }) => `max(0, floor(${i.base} × DRM(${DRM}) × 屬性(${elem})) − 奧防(${i.specialDef}))`,
    rule: '最終 = floor(原始 × 承受倍率 × 屬性) − 奧防，最低 0。不吃攻擊倍率(BAM)。修羅補正適用。',
  },
  {
    id: 'ninjutsu', label: '攻擊系忍術',
    uses: { bam: false, drm: true, cm: false, element: false, shura: false, attackerWrathVoidsGreenBug: false },
    inputs: [{ id: 'base', label: '術攻原始', default: 0 }, { id: 'specialDef', label: '術防', default: 0 }],
    formula:     ({ i, DRM }) => Math.max(0, Math.floor(i.base * DRM) - i.specialDef),
    formulaText: ({ i, DRM }) => `max(0, floor(${i.base} × DRM(${DRM})) − 術防(${i.specialDef}))`,
    rule: '最終 = floor(原始 × 承受倍率) − 術防，最低 0。攻擊方使用任何狀態都不影響此傷害（含攻方暴怒不再無視受擊方青蟲）；只有受擊方自身狀態正常生效。不吃攻擊倍率、不受屬性、無修羅補正。',
  },
  {
    id: 'dart', label: '錢標',
    uses: { bam: true, drm: true, cm: true, element: false, shura: false },
    inputs: [], baseNote: '原始固定 150',
    formula:     ({ CM }) => Math.floor(150 * CM),
    formulaText: ({ CM }) => `floor(150 × CM(${CM}))`,
    rule: '錢標原始固定 150。最終 = floor(150 × 綜合倍率)。不受屬性影響、無修羅補正。',
  },
  {
    id: 'charge', label: '衝撞',
    uses: { bam: true, drm: true, cm: true, element: false, shura: true },
    inputs: [{ id: 'base', label: '原始衝撞', default: 30,
      presets: [{ label: '非變身 30', val: 30 }, { label: '夜叉 100', val: 100 }, { label: '赤鬼 200', val: 200 }] }],
    formula:     ({ i, CM }) => Math.floor(i.base * CM),
    formulaText: ({ i, CM }) => `floor(${i.base} × CM(${CM}))`,
    rule: '最終 = floor(原始衝撞 × 綜合倍率)。原始：非變身 30 / 夜叉 100 / 赤鬼 200。不受屬性、修羅補正適用。',
  },
  {
    id: 'doton', label: '土遁',
    uses: { bam: false, drm: true, cm: false, element: false, shura: false },
    inputs: [{ id: 'atkStat', label: '術攻', default: 0 }, { id: 'specialDef', label: '術防', default: 0 }],
    formula:     ({ i, DRM }) => Math.max(0, Math.floor((250 + i.atkStat) * DRM) - i.specialDef),
    formulaText: ({ i, DRM }) => `max(0, floor((250 + ${i.atkStat}) × DRM(${DRM})) − 術防(${i.specialDef}))`,
    rule: '原始 = 250 + 術攻。最終 = floor(原始 × 承受倍率) − 術防，最低 0。不吃攻擊倍率、不受屬性。',
    caution: '土遁與承受倍率的互動於 notion 標註「待測試」，此處暫採承受倍率生效、不套修羅補正。',
  },
]

/* ── 獨立附加規則（依附在某攻擊類型結果之上）────────────────────────────────── */
export const SPECIAL_RULES: SpecialRule[] = [
  {
    id: 'poisonToad', label: '毒遁', appliesTo: ['charge'],
    compute: ({ finalDmg }) => finalDmg * 3,
    exprText: ({ finalDmg }) => `${finalDmg} × 3`,
    note: '衝撞最終 × 3，對變身系無效，無視承受倍率與術防（可疊加）',
    rule: '毒遁 = 承受「衝撞最終傷害」× 3。對變身系無效；無視承受倍率與術防；多個毒遁可疊加。',
  },
]
