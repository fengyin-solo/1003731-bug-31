// 环境校验链路：蒸发量、水温、风速三项要素的统一阈值范围与判定规则。
// 蒸发记录列表、站房面板、预警待办都从这里取结论，任何入口不再各自写一套，
// 阈值与口径只在这一处维护。

export type EnvFieldRule = {
  field: string
  min: number
  max: number
  unit: string
}

// 统一阈值范围：超出即判异常；保存时超出标准直接拒绝。
export const ENV_FIELD_RULES: EnvFieldRule[] = [
  { field: '蒸发量', min: 0, max: 100, unit: 'mm' },
  { field: '水温', min: 0, max: 40, unit: '℃' },
  { field: '风速', min: 0, max: 50, unit: 'm/s' },
]

// 缺值口径：undefined / null / 去空白后的空串 / 占位符「—」一律按缺测处理。
export function isMissingValue(value: unknown): boolean {
  if (value === undefined || value === null) {
    return true
  }
  const text = String(value).trim()
  return text === '' || text === '—'
}

export function parseEnvNumber(value: unknown): number | null {
  if (isMissingValue(value)) {
    return null
  }
  const parsed = Number(String(value).trim())
  return Number.isFinite(parsed) ? parsed : null
}

export type EnvCheckResult = {
  abnormal: boolean
  reasons: string[]
}

// 统一判定规则：任一要素缺测、无法解析或超出阈值范围，整条记录判为异常。
export function checkEnvRow(row: Record<string, unknown>): EnvCheckResult {
  const reasons: string[] = []
  for (const rule of ENV_FIELD_RULES) {
    const raw = row[rule.field]
    if (isMissingValue(raw)) {
      reasons.push(`${rule.field}缺测`)
      continue
    }
    const parsed = parseEnvNumber(raw)
    if (parsed === null) {
      reasons.push(`${rule.field}不是有效数值`)
      continue
    }
    if (parsed < rule.min || parsed > rule.max) {
      reasons.push(`${rule.field}超出标准（${rule.min}~${rule.max}${rule.unit}）`)
    }
  }
  return { abnormal: reasons.length > 0, reasons }
}

// 保存前校验：缺测允许保存（入库后按异常挂预警待办），
// 无法解析或超出标准的一律拒绝保存。
export function validateEnvForSave(values: Record<string, unknown>): { ok: boolean; message: string } {
  for (const rule of ENV_FIELD_RULES) {
    const raw = values[rule.field]
    if (isMissingValue(raw)) {
      continue
    }
    const parsed = parseEnvNumber(raw)
    if (parsed === null) {
      return { ok: false, message: `${rule.field}不是有效数值，不允许保存` }
    }
    if (parsed < rule.min || parsed > rule.max) {
      return { ok: false, message: `${rule.field}超出标准范围（${rule.min}~${rule.max}${rule.unit}），不允许保存` }
    }
  }
  return { ok: true, message: '' }
}
