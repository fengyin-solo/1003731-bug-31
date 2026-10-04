import { listRows, saveRows } from '@/data/local-store'
import type { EntryRow } from '@/data/types'
import { evaluateEvaporation, validateForSave, type EvaporationValues, type Verdict } from './rules'

// 蒸发环境核查的统一结论存储：
// 无论从蒸发记录列表、站房面板还是预警待办进入，复核结论只写这一份；
// 预警待办不再单独存结论，全部由「自动判定 + 复核结论」实时派生，改判后不会残留旧结论。

const EVAPORATION_KEY = 'evaporation'
const REVIEW_STORAGE_KEY = 'hydrology-monitor-station:evaporation-reviews:v1'

export type ReviewSourceKey = 'evaporation-list' | 'stationhouse-panel' | 'warning-todo' | 'legacy'

export const REVIEW_SOURCE_LABELS: Record<ReviewSourceKey, string> = {
  'evaporation-list': '蒸发记录列表',
  'stationhouse-panel': '站房面板',
  'warning-todo': '预警待办',
  legacy: '历史审核结论',
}

export type ReviewConclusion = {
  recordId: number
  source: ReviewSourceKey
  /** 生效结论：人工可以覆盖自动判定 */
  abnormal: boolean
  verdictLabel: string
  /** 提交复核时的自动判定原因快照 */
  reasons: string[]
  note: string
  reviewer: string
  reviewedAt: string
  /** 历史迁移结论为 false，人工复核为 true；待办只认「尚未人工复核」 */
  manual: boolean
  /** 乐观锁版本：并发提交时只接受一个，其余判定为冲突 */
  version: number
}

type ReviewStorePayload = {
  version: 1
  conclusions: ReviewConclusion[]
}

export type EffectiveState = {
  row: EntryRow
  auto: Verdict
  conclusion: ReviewConclusion | null
  /** 预警待办：自动判定异常且尚无人工复核结论 */
  pending: boolean
  abnormal: boolean
  verdictLabel: string
  reasons: string[]
  sourceLabel: string
}

export type SubmitReviewInput = {
  recordId: number
  abnormal: boolean
  note: string
  source: Exclude<ReviewSourceKey, 'legacy'>
  reviewer: string
  expectedVersion: number
}

export type SubmitReviewResult = {
  ok: boolean
  message: string
  conflict?: boolean
  version?: number
}

export type CreateRecordInput = EvaporationValues & {
  站点编号: string
  观测日期: string
  source: Exclude<ReviewSourceKey, 'legacy'>
}

function nowText(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function toMap(conclusions: ReviewConclusion[]): Map<number, ReviewConclusion> {
  return new Map(conclusions.map((item) => [Number(item.recordId), item]))
}

/** 始终读取持久化中的最新结论，提交时据此做并发比对。 */
function readMap(): Map<number, ReviewConclusion> | null {
  if (typeof window === 'undefined' || !window.localStorage) {
    return null
  }
  const raw = window.localStorage.getItem(REVIEW_STORAGE_KEY)
  if (!raw) {
    return new Map()
  }
  try {
    const payload = JSON.parse(raw) as ReviewStorePayload
    return toMap(payload.conclusions ?? [])
  } catch {
    return new Map()
  }
}

function persist(map: Map<number, ReviewConclusion>): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    const payload: ReviewStorePayload = { version: 1, conclusions: [...map.values()] }
    window.localStorage.setItem(REVIEW_STORAGE_KEY, JSON.stringify(payload))
  }
}

function legacyConclusion(row: EntryRow): ReviewConclusion | null {
  const status = String(row.status)
  const auto = evaluateEvaporation(verdictInput(row))
  if (status === '已通过') {
    return {
      recordId: Number(row.id),
      source: 'legacy',
      abnormal: false,
      verdictLabel: '正常',
      reasons: [],
      note: '历史审核结论为「已通过」，迁移时原样保留',
      reviewer: '历史审核',
      reviewedAt: '',
      manual: false,
      version: 0,
    }
  }
  if (status === '异常值') {
    return {
      recordId: Number(row.id),
      source: 'legacy',
      abnormal: true,
      verdictLabel: auto.abnormal ? auto.label : '人工判异',
      reasons: auto.reasons,
      note: '历史审核结论为「异常值」，迁移时原样保留，可重新复核',
      reviewer: '历史审核',
      reviewedAt: '',
      manual: false,
      version: 0,
    }
  }
  return null
}

let migrated = false

/**
 * 读取最新的复核结论：
 * 首次使用时迁移历史审核结论（只迁一次）；之后始终以持久化中的数据为准，
 * 这样同一页面里从蒸发列表、站房面板、预警待办任一入口改判，其它入口立刻读到新结论。
 */
function ensureMap(): Map<number, ReviewConclusion> {
  if (migrated) {
    return readMap() ?? new Map()
  }
  const existed = typeof window !== 'undefined' && window.localStorage
  const hadStore = existed && window.localStorage.getItem(REVIEW_STORAGE_KEY) !== null
  const map = readMap() ?? new Map<number, ReviewConclusion>()
  if (!hadStore) {
    for (const row of listRows(EVAPORATION_KEY)) {
      if (map.has(Number(row.id))) {
        continue
      }
      const conclusion = legacyConclusion(row)
      if (conclusion) {
        map.set(Number(row.id), conclusion)
      }
    }
    persist(map)
  }
  migrated = true
  return map
}

export function verdictInput(row: EntryRow): EvaporationValues {
  return {
    蒸发量: row['蒸发量'],
    水温: row['水温'],
    气温: row['气温'],
    风速: row['风速'],
  }
}

function sourceLabelOf(row: EntryRow): string {
  const value = row['来源入口']
  return value === undefined || value === null || String(value).trim() === ''
    ? REVIEW_SOURCE_LABELS.legacy
    : String(value)
}

export function effectiveState(row: EntryRow): EffectiveState {
  const map = ensureMap()
  const auto = evaluateEvaporation(verdictInput(row))
  const conclusion = map.get(Number(row.id)) ?? null
  if (conclusion) {
    return {
      row,
      auto,
      conclusion,
      pending: false,
      abnormal: conclusion.abnormal,
      verdictLabel: conclusion.verdictLabel,
      reasons: conclusion.reasons,
      sourceLabel: sourceLabelOf(row),
    }
  }
  return {
    row,
    auto,
    conclusion: null,
    pending: auto.abnormal,
    abnormal: auto.abnormal,
    verdictLabel: auto.label,
    reasons: auto.reasons,
    sourceLabel: sourceLabelOf(row),
  }
}

export function listEffective(): EffectiveState[] {
  return listRows(EVAPORATION_KEY).map(effectiveState)
}

/** 待复核预警待办：自动判定异常、且还没有人工复核结论的记录。 */
export function listPendingTodos(): EffectiveState[] {
  return listEffective().filter((item) => item.pending)
}

/** 已处理：任何已有复核结论（含迁移保留的历史结论）。 */
export function listReviewed(): EffectiveState[] {
  return listEffective().filter((item) => item.conclusion !== null)
}

export function getEffective(recordId: number): EffectiveState | null {
  const row = listRows(EVAPORATION_KEY).find((item) => Number(item.id) === Number(recordId))
  return row ? effectiveState(row) : null
}

/**
 * 提交复核结论（CAS 乐观锁）：
 * - expectedVersion 必须与存储中最新的人工结论版本一致，否则判冲突，本次结论不落库；
 * - 多个入口并发提交时只有第一条生效，从根上保证同一条记录只留一条有效结论。
 */
export function submitReview(input: SubmitReviewInput): SubmitReviewResult {
  const rows = listRows(EVAPORATION_KEY)
  const index = rows.findIndex((row) => Number(row.id) === Number(input.recordId))
  if (index < 0) {
    return { ok: false, message: '蒸发观测记录不存在，可能已被删除' }
  }

  // 始终读持久化中的最新结论，覆盖同一页面连续点击与多入口同时提交的情况。
  const fresh = ensureMap()
  const current = fresh.get(Number(input.recordId))
  const baseVersion = current && current.manual ? current.version : 0
  if (Number(input.expectedVersion) !== baseVersion) {
    return {
      ok: false,
      conflict: true,
      message: `该记录已由其他入口完成复核（最新版本 ${baseVersion}），请刷新后查看最新结论`,
    }
  }

  const row = rows[index]
  const auto = evaluateEvaporation(verdictInput(row))
  const note = input.note.trim()
  if (input.abnormal !== auto.abnormal && note === '') {
    return { ok: false, message: '人工改判与自动判定不一致时，必须填写复核说明' }
  }

  const verdictLabel = input.abnormal
    ? auto.abnormal
      ? auto.label
      : '人工判异'
    : '正常'
  const conclusion: ReviewConclusion = {
    recordId: Number(input.recordId),
    source: input.source,
    abnormal: input.abnormal,
    verdictLabel,
    reasons: auto.reasons,
    note,
    reviewer: input.reviewer,
    reviewedAt: nowText(),
    manual: true,
    version: baseVersion + 1,
  }
  fresh.set(Number(input.recordId), conclusion)
  persist(fresh)

  // 复核结论回写记录主状态：所有列表读到的状态、异常标记与结论存储保持一致。
  const terminalStatus = input.abnormal ? '异常值' : '已通过'
  const updated: EntryRow = {
    ...row,
    status: terminalStatus,
    pending: false,
    abnormal: input.abnormal,
    记录状态: terminalStatus,
  }
  const next = [...rows]
  next[index] = updated
  saveRows(EVAPORATION_KEY, next)

  return { ok: true, message: `复核结论已保存：${verdictLabel}`, version: conclusion.version }
}

/**
 * 统一登记入口（蒸发记录列表与站房面板共用）：
 * 先跑统一保存校验，必测项缺失或超出标准范围一律不允许落库。
 */
export function createEvaporationRecord(
  input: CreateRecordInput,
): { ok: boolean; errors: string[]; recordId?: number } {
  const station = input.站点编号.trim()
  const date = input.观测日期.trim()
  const errors: string[] = []
  if (station === '') {
    errors.push('站点编号不能为空')
  }
  if (date === '') {
    errors.push('观测日期不能为空')
  }
  const validation = validateForSave(input)
  if (!validation.ok) {
    errors.push(...validation.errors)
  }
  if (errors.length > 0) {
    return { ok: false, errors }
  }

  const rows = listRows(EVAPORATION_KEY)
  const recordId = rows.reduce((max, row) => Math.max(max, Number(row.id)), 0) + 1
  const airTemperature = input.气温 === undefined || String(input.气温).trim() === '' ? '' : Number(input.气温)
  const row: EntryRow = {
    id: recordId,
    status: '待审核',
    pending: true,
    abnormal: false,
    记录编号: `EVAP-${String(recordId).padStart(4, '0')}`,
    站点编号: station,
    观测日期: date,
    蒸发量: Number(input.蒸发量),
    水温: Number(input.水温),
    气温: airTemperature,
    风速: Number(input.风速),
    记录状态: '待审核',
    来源入口: REVIEW_SOURCE_LABELS[input.source],
  }
  saveRows(EVAPORATION_KEY, [...rows, row])
  // 新记录通过保存校验后自动判定即为正常，无需额外写结论；结论仍统一由复核链路产生。
  return { ok: true, errors: [], recordId }
}
