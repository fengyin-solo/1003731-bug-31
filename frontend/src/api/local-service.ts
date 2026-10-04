import { checkEnvRow, isMissingValue, validateEnvForSave } from '@/data/env-check'
import { allRows, listRows, resetRows, saveRows } from '@/data/local-store'
import { MODULE_BY_KEY } from '@/data/modules'
import { allReviews, getReview, putReview, removeModuleReviews, removeReview } from '@/data/review-store'
import type {
  ActionResult,
  EntryRow,
  ModuleMeta,
  OverviewResult,
  PageResult,
  ReviewConclusion,
  ReviewItem,
  ReviewSource,
  StationEnvPanelRow,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

// 走环境校验链路的模块：蒸发观测按三项要素逐条核查，站房维护按站点联动蒸发记录核查。
const ENV_SYNC_MODULES = new Set(['evaporation', 'stationhouse'])

// 各模块里属于「人工改判」的流转目标：走到这些状态就等于人工下了结论。
const JUDGMENT_TARGETS: Record<string, Record<string, ReviewConclusion>> = {
  evaporation: { 已通过: '正常', 异常值: '异常' },
  stationhouse: { 已验收: '正常' },
}

export type EffectiveReview = {
  conclusion: ReviewConclusion
  source: ReviewSource
  reasons: string[]
}

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

function recordKeyOf(key: string, id: number): string {
  return `${key}:${id}`
}

function recordCodeOf(row: EntryRow): string {
  return String(row['记录编号'] ?? row['配置编号'] ?? `#${row.id}`)
}

function writeReview(
  key: string,
  row: EntryRow,
  review: EffectiveReview,
  locked: boolean,
  resolved: boolean,
): void {
  putReview({
    recordKey: recordKeyOf(key, Number(row.id)),
    moduleKey: key,
    recordId: Number(row.id),
    recordCode: recordCodeOf(row),
    station: String(row['站点编号'] ?? ''),
    conclusion: review.conclusion,
    source: review.source,
    reasons: review.reasons,
    locked,
    resolved,
    reviewedAt: new Date().toISOString(),
  })
}

// 有效结论的优先级：人工改判 > 历史审核结论 > 自动校验。
// 历史数据里已经是终态（已通过 / 异常值 / 已验收）的记录直接沿用旧结论，保持兼容。
export function effectiveReview(key: string, row: EntryRow): EffectiveReview {
  const saved = getReview(recordKeyOf(key, Number(row.id)))
  if (saved) {
    return { conclusion: saved.conclusion, source: saved.source, reasons: saved.reasons }
  }
  const judged = JUDGMENT_TARGETS[key]?.[String(row.status)]
  if (judged) {
    return { conclusion: judged, source: '历史结论', reasons: [] }
  }
  if (key === 'evaporation') {
    const auto = checkEnvRow(row)
    return { conclusion: auto.abnormal ? '异常' : '正常', source: '自动校验', reasons: auto.reasons }
  }
  return { conclusion: '正常', source: '自动校验', reasons: [] }
}

function latestEvaporationFor(station: string): EntryRow | undefined {
  const matched = listRows('evaporation').filter(
    (row) => String(row['站点编号'] ?? '') === station,
  )
  if (!matched.length) {
    return undefined
  }
  return matched.reduce((latest, row) =>
    String(row['观测日期'] ?? '') >= String(latest['观测日期'] ?? '') ? row : latest,
  )
}

// 站房记录的环境核查：顺着校验链路找到本站最新一条蒸发记录，
// 直接沿用它的有效结论（人工改判、历史结论都算），同一个根因只判一次。
function linkedEnvReview(house: EntryRow): EffectiveReview {
  const linked = latestEvaporationFor(String(house['站点编号'] ?? ''))
  if (!linked) {
    const auto = checkEnvRow({})
    return { conclusion: '异常', source: '自动校验', reasons: auto.reasons }
  }
  return effectiveReview('evaporation', linked)
}

function autoReviewFor(key: string, row: EntryRow): EffectiveReview {
  if (key === 'evaporation') {
    const auto = checkEnvRow(row)
    return { conclusion: auto.abnormal ? '异常' : '正常', source: '自动校验', reasons: auto.reasons }
  }
  return linkedEnvReview(row)
}

// 环境校验链路的统一入口：所有页面（蒸发列表、站房面板、运营概览、预警待办）
// 都只调这一个函数，结论写进同一份核查存储，预警待办自然跟着更新。
export function syncEnvChecks(): void {
  syncModuleChecks('evaporation')
  syncModuleChecks('stationhouse')
}

function syncModuleChecks(key: string): void {
  const rows = listRows(key)
  let changed = false
  const next = rows.map((row) => {
    const recordKey = recordKeyOf(key, Number(row.id))
    const saved = getReview(recordKey)
    let review: EffectiveReview
    if (saved?.locked) {
      // 已有人工或历史结论：保留复核结论，不被自动校验覆盖
      review = { conclusion: saved.conclusion, source: saved.source, reasons: saved.reasons }
    } else {
      const judged = JUDGMENT_TARGETS[key]?.[String(row.status)]
      if (judged) {
        // 历史审核结论兼容：入库时已是终态的记录转成锁定的历史结论
        review = { conclusion: judged, source: '历史结论', reasons: [] }
        writeReview(key, row, review, true, true)
      } else {
        const auto = autoReviewFor(key, row)
        review = auto
        if (auto.conclusion === '异常') {
          writeReview(key, row, review, false, false)
        } else if (saved) {
          removeReview(recordKey)
        }
      }
    }
    const abnormal = review.conclusion === '异常'
    if (Boolean(row.abnormal) === abnormal) {
      return row
    }
    changed = true
    return { ...row, abnormal }
  })
  if (changed) {
    saveRows(key, next)
  }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const judgment = JUDGMENT_TARGETS[key]?.[target]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: judgment
      ? judgment === '异常'
      : NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  if (judgment) {
    // 人工改判：结论与预警待办在同一次写入里更新，旧结论直接覆盖，不会残留
    writeReview(key, updated, { conclusion: judgment, source: '人工改判', reasons: [] }, true, true)
  }
  if (ENV_SYNC_MODULES.has(key)) {
    // 联动入口一并重查：站房等着蒸发记录的有效结论，其他入口的待办跟着更新
    syncEnvChecks()
  }
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

// 登记 / 补录保存：缺测允许入库（按异常挂预警待办），
// 无法解析或超出统一阈值标准的一律拒绝保存。
export function saveEntry(key: string, values: Record<string, string>, id?: number): ActionResult {
  const meta = moduleMeta(key)
  if (key === 'evaporation') {
    const verdict = validateEnvForSave(values)
    if (!verdict.ok) {
      return { ok: false, message: verdict.message }
    }
  }
  const rows = listRows(key)
  if (id !== undefined) {
    const index = rows.findIndex((row) => Number(row.id) === id)
    if (index < 0) {
      return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
    }
    const next = [...rows]
    next[index] = { ...rows[index], ...values }
    saveRows(key, next)
    // 数据变了，旧结论作废，按新数据重新核查
    removeReview(recordKeyOf(key, id))
  } else {
    const created: EntryRow = {
      id: rows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1,
      status: meta.statuses[0],
      pending: true,
      abnormal: false,
      ...values,
    }
    saveRows(key, [...rows, created])
  }
  if (ENV_SYNC_MODULES.has(key)) {
    syncEnvChecks()
  }
  return { ok: true, message: `${meta.entity}已保存` }
}

// 预警待办：所有入口共用同一份核查结论，待处理在前、已复核在后。
export function listWarningTodos(): ReviewItem[] {
  return Object.values(allReviews()).sort((a, b) => {
    if (a.resolved !== b.resolved) {
      return a.resolved ? 1 : -1
    }
    return b.reviewedAt.localeCompare(a.reviewedAt)
  })
}

export function countOpenTodos(): number {
  return Object.values(allReviews()).filter((item) => !item.resolved && item.conclusion === '异常')
    .length
}

function displayValue(value: unknown): string {
  return isMissingValue(value) ? '—' : String(value)
}

// 站房环境面板：每个站房记录联出本站最新一条蒸发记录的三项要素，
// 缺任何一项就显示异常；结论优先采用已锁定的复核结论。
export function stationEnvPanel(): StationEnvPanelRow[] {
  return listRows('stationhouse').map((house) => {
    const linked = latestEvaporationFor(String(house['站点编号'] ?? ''))
    const saved = getReview(recordKeyOf('stationhouse', Number(house.id)))
    const live = linkedEnvReview(house)
    return {
      id: Number(house.id),
      station: displayValue(house['站点编号']),
      evaporation: displayValue(linked?.['蒸发量']),
      waterTemp: displayValue(linked?.['水温']),
      windSpeed: displayValue(linked?.['风速']),
      conclusion: saved ? saved.conclusion : live.conclusion,
      source: saved ? saved.source : live.source,
      reasons: saved ? saved.reasons : live.reasons,
    }
  })
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  removeModuleReviews(key)
  if (ENV_SYNC_MODULES.has(key)) {
    syncEnvChecks()
  }
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
    { label: '预警待办', value: countOpenTodos() },
  ]
  return { cards, modules }
}
