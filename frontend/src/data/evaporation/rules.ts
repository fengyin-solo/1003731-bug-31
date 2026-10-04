// 蒸发观测环境校验的唯一规则来源：
// 蒸发记录列表、站房面板核查、预警待办改判都走这里，不再各写一套口径。
//
// 缺值口径（统一约定）：蒸发量、水温、风速三项为必测项，缺任意一项即判「缺测异常」；
// 气温为选填项，缺测不判异常，仅在有值时校验阈值。

export type EvaporationFieldKey = '蒸发量' | '水温' | '气温' | '风速'

export type FieldRule = {
  key: EvaporationFieldKey
  /** 录入界面展示的名称，含单位 */
  label: string
  min: number
  max: number
  unit: string
  required: boolean
}

// 阈值范围为站内统一执行的环境校验标准（标准口径以监测规范为准，此处固化为系统统一值）。
export const EVAPORATION_FIELD_RULES: FieldRule[] = [
  { key: '蒸发量', label: '蒸发量(mm)', min: 0, max: 30, unit: 'mm', required: true },
  { key: '水温', label: '水温(℃)', min: 0, max: 45, unit: '℃', required: true },
  { key: '气温', label: '气温(℃)', min: -40, max: 50, unit: '℃', required: false },
  { key: '风速', label: '风速(m/s)', min: 0, max: 40, unit: 'm/s', required: true },
]

export const REQUIRED_EVAPORATION_FIELDS = EVAPORATION_FIELD_RULES.filter((rule) => rule.required).map(
  (rule) => rule.key,
)

export type VerdictKind = 'normal' | 'missing' | 'over-limit'
export type VerdictLabel = '正常' | '缺测异常' | '超阈值异常'

export type Verdict = {
  kind: VerdictKind
  label: VerdictLabel
  abnormal: boolean
  reasons: string[]
}

export const NORMAL_VERDICT: Verdict = { kind: 'normal', label: '正常', abnormal: false, reasons: [] }

export type EvaporationValues = Partial<Record<EvaporationFieldKey, unknown>>

/** 把单元格原始值解析成数字：空串、null、undefined、无法解析的内容都视为缺测。 */
export function parseFieldValue(raw: unknown): number | null {
  if (raw === null || raw === undefined) {
    return null
  }
  const text = String(raw).trim()
  if (text === '' || text === '—' || text === '-') {
    return null
  }
  const value = Number(text)
  return Number.isFinite(value) ? value : null
}

/**
 * 自动判定：先查必测项缺测，再查阈值范围。
 * 缺测与超阈值是两类异常，原因全部列出来，列表与待办展示同一份结论。
 */
export function evaluateEvaporation(values: EvaporationValues): Verdict {
  const reasons: string[] = []
  let kind: VerdictKind = 'normal'

  for (const rule of EVAPORATION_FIELD_RULES) {
    const value = parseFieldValue(values[rule.key])
    if (value === null) {
      if (rule.required) {
        kind = 'missing'
        reasons.push(`${rule.label}缺测`)
      }
      continue
    }
    if (value < rule.min || value > rule.max) {
      if (kind !== 'missing') {
        kind = 'over-limit'
      }
      reasons.push(`${rule.label}=${value}${rule.unit}，超出允许范围 ${rule.min}~${rule.max}${rule.unit}`)
    }
  }

  if (reasons.length === 0) {
    return { ...NORMAL_VERDICT }
  }
  return {
    kind,
    label: kind === 'missing' ? '缺测异常' : '超阈值异常',
    abnormal: true,
    reasons,
  }
}

export type SaveValidation = {
  ok: boolean
  errors: string[]
}

/**
 * 录入保存校验：必测项缺一不可，且任何一项（含选填的气温）不得超出阈值。
 * 任一条不满足都不允许保存，错误信息直接回显在表单上。
 */
export function validateForSave(values: EvaporationValues): SaveValidation {
  const errors: string[] = []
  for (const rule of EVAPORATION_FIELD_RULES) {
    const value = parseFieldValue(values[rule.key])
    if (value === null) {
      if (rule.required) {
        errors.push(`${rule.label}为必测项，缺测时不允许保存`)
      }
      continue
    }
    if (value < rule.min || value > rule.max) {
      errors.push(`${rule.label}必须在 ${rule.min}~${rule.max}${rule.unit} 之间，当前为 ${value}${rule.unit}`)
    }
  }
  return { ok: errors.length === 0, errors }
}

export function isEvaporationFieldMissing(values: Record<string, unknown>, key: EvaporationFieldKey): boolean {
  return parseFieldValue(values[key]) === null
}

/** 统一阈值说明，供各入口表单直接展示，避免文案各写一套。 */
export function thresholdSummary(): string {
  return EVAPORATION_FIELD_RULES.map(
    (rule) =>
      `${rule.label} ${rule.required ? '必测' : '选填'}，允许范围 ${rule.min}~${rule.max}${rule.unit}`,
  ).join('；')
}
