/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

/** 核查结论：正常或异常。 */
export type ReviewConclusion = '正常' | '异常'

/** 结论来源：自动校验 / 人工改判 / 历史审核结论。 */
export type ReviewSource = '自动校验' | '人工改判' | '历史结论'

/** 一条核查结论（同一记录只留一条），同时就是预警待办的载体。 */
export type ReviewItem = {
  recordKey: string
  moduleKey: string
  recordId: number
  recordCode: string
  station: string
  conclusion: ReviewConclusion
  source: ReviewSource
  reasons: string[]
  /** 人工改判与历史结论会锁定，自动校验不得覆盖 */
  locked: boolean
  /** 已复核的不再挂在预警待办里 */
  resolved: boolean
  /** ISO 时间串，排序、展示都靠它 */
  reviewedAt: string
}

/** 站房环境面板的一行：站点 + 三项要素 + 核查结论。 */
export type StationEnvPanelRow = {
  id: number
  station: string
  evaporation: string
  waterTemp: string
  windSpeed: string
  conclusion: ReviewConclusion
  source: ReviewSource
  reasons: string[]
}
