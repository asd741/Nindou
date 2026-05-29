/* ════════════════════════════════════════════════════════════════════════════
   傷害模組 — 引擎（純機械）
   不認得任何具體規則：只吃 config.ts 的定義資料，吐出計算結果。
   平常新增／移除功能時不需要動這個檔。
   ════════════════════════════════════════════════════════════════════════════ */
import type { ModifierDef, ModifierResult, ModifierContext } from './types'

/** 四捨五入到小數點兩位（倍率運算用，避免浮點誤差）。 */
export const round2 = (n: number): number => Math.round(n * 100) / 100

/** 把可能為空字串/NaN 的輸入安全轉成數字。 */
export const num = (x: unknown): number => Number(x) || 0

/** 帶正負號的顯示文字，如 +0.5 / −0.25。 */
export const signed = (d: number): string => (d > 0 ? '+' : '−') + Math.abs(d)

/**
 * 解算一組狀態定義（攻擊倍率或承受倍率共用）。
 *   exclusive：同組互斥，只取 priority 最小（最高優先）者生效，其餘標 suppressed。
 *   additive ：獨立加總，可與互斥群組共存；disabledWhen 成立時標 disabled、不計入。
 * 回傳的 steps 供 UI 顯示每個狀態是 on / suppressed / disabled。
 */
export function resolveModifiers(
  defs: ModifierDef[],
  active: Record<string, boolean>,
  ctx: ModifierContext = { attackerWrath: false },
): ModifierResult {
  const exclusiveOn = defs.filter(d => d.group === 'exclusive' && active[d.id])
  const winner = exclusiveOn.reduce<ModifierDef | null>(
    (best, d) => (!best || (d.priority ?? 0) < (best.priority ?? 0) ? d : best),
    null,
  )

  let value = 1
  const steps: ModifierResult['steps'] = []
  for (const d of defs) {
    if (!active[d.id]) continue
    if (d.group === 'exclusive') {
      if (d === winner) {
        value += d.delta
        steps.push({ id: d.id, label: d.label, delta: d.delta, status: 'on' })
      } else {
        steps.push({
          id: d.id, label: d.label, delta: d.delta, status: 'suppressed',
          note: winner && d.priority === winner.priority ? '同組不疊加' : `被${winner?.label}壓制`,
        })
      }
    } else {
      if (d.disabledWhen?.(ctx)) {
        steps.push({ id: d.id, label: d.label, delta: d.delta, status: 'disabled', note: d.disabledNote })
      } else {
        value += d.delta
        steps.push({ id: d.id, label: d.label, delta: d.delta, status: 'on' })
      }
    }
  }
  return { value: round2(value), steps }
}
