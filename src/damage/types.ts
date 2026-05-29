/* ════════════════════════════════════════════════════════════════════════════
   傷害模組 — 型別定義
   只描述「規則物件的形狀」，不含任何規則資料或計算邏輯。
   ════════════════════════════════════════════════════════════════════════════ */

/** 互斥群組（同組取最高優先者）或獨立加項（各自加總）。 */
export type ModifierGroup = 'exclusive' | 'additive'

/** 按鈕配色語意。 */
export type ModifierTone = 'atk' | 'def' | 'grn' | 'wrath'

/** 狀態來源分類（純 UI 分區用；不影響計算）。實際順序見 config 的 MODIFIER_CATEGORIES。 */
export type ModifierCategory = '道具效果' | '忍術效果' | '職業特性'

/** 解算時的情境（目前只需要「攻方是否暴怒」供青蟲判定）。 */
export interface ModifierContext {
  attackerWrath: boolean
}

/** 一個攻擊倍率／承受倍率的「狀態」定義。新增一個狀態 = 多一個此物件。 */
export interface ModifierDef {
  /** 預設啟用；設為 false 即從計算與 UI 一併移除（不必刪整塊）。 */
  enabled?: boolean
  id: string
  label: string
  /** 來源分類（道具效果／忍術效果／職業特性）—— 決定在 UI 哪個分區出現。 */
  category: ModifierCategory
  /** 對倍率的加減值。 */
  delta: number
  group: ModifierGroup
  /** 互斥群組用：數字越小優先級越高。 */
  priority?: number
  tone: ModifierTone
  /** 此規則的白話說明（同時供程式註解與 app 內「規則一覽」使用）。 */
  rule: string
  /** 獨立加項的失效條件（如青蟲遇攻方暴怒）。 */
  disabledWhen?: (ctx: ModifierContext) => boolean
  /** 失效時顯示的原因。 */
  disabledNote?: string
}

/** 單一狀態解算後的明細：on 生效、suppressed 被同組壓制、disabled 條件不符。 */
export interface ModifierStep {
  id: string
  label: string
  delta: number
  status: 'on' | 'suppressed' | 'disabled'
  note?: string
}

export interface ModifierResult {
  value: number
  steps: ModifierStep[]
}

/** 修羅補正（受擊方承受倍率下限保護）。 */
export interface ShuraCorrection {
  label: string
  rule: string
  apply: (rawDRM: number, opts: { attackerHasShura: boolean; applies: boolean }) => number
}

/** 攻擊類型「計入哪些倍率」—— 同時決定公式取值與 UI 哪些卡片亮起。 */
export interface AttackTypeUses {
  /** 攻擊倍率是否進入公式（→ 走綜合倍率 CM）。 */
  bam: boolean
  /** 承受倍率是否進入公式。 */
  drm: boolean
  /** 是否使用綜合倍率 CM = BAM + DRM − 1。 */
  cm: boolean
  /** 是否受屬性相剋影響。 */
  element: boolean
  /** 修羅補正是否適用。 */
  shura: boolean
  /**
   * 攻方暴怒法印是否能無視（壓制）受擊方青蟲——這是攻方對「承受倍率」的唯一干涉管道。
   * 省略視為 true（沿用一般行為）。
   * 設為 false → 承受倍率純由受擊方自身狀態決定，攻方完全不介入（攻擊系忍術即如此：
   * 不論攻方使用什麼都不會更強，受擊方自身狀態正常生效）。
   */
  attackerWrathVoidsGreenBug?: boolean
}

/** 攻擊類型需要的數值輸入欄位。 */
export interface AttackInput {
  id: string
  label: string
  default?: number
  presets?: { label: string; val: number }[]
}

/** 計算公式可取用的全部數值。 */
export interface FormulaContext {
  /** 使用者輸入（base / specialDef / atkStat …）。 */
  i: Record<string, number>
  BAM: number
  rawDRM: number
  DRM: number
  CM: number
  elem: number
}

/** 一種攻擊類型。新增一種攻擊 = 多一個此物件（公式、輸入、說明都在此）。 */
export interface AttackType {
  enabled?: boolean
  id: string
  label: string
  uses: AttackTypeUses
  inputs: AttackInput[]
  /** 固定值類型（錢標 150、佛滅 200…）在輸入列顯示的說明文字。 */
  baseNote?: string
  /** 提醒（如土遁規則待測試）。 */
  caution?: string
  formula: (ctx: FormulaContext) => number
  formulaText: (ctx: FormulaContext) => string
  rule: string
}

/** 依附在某攻擊結果之上的獨立規則（如毒遁）。 */
export interface SpecialRule {
  enabled?: boolean
  id: string
  label: string
  /** 在哪些攻擊類型 id 出現。 */
  appliesTo: string[]
  compute: (a: { finalDmg: number }) => number
  exprText: (a: { finalDmg: number }) => string
  note: string
  rule: string
}
