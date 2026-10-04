import type { ReviewItem } from './types'

// 核查结论与预警待办的本地持久化：和业务数据一样放 localStorage，刷新、关掉再打开都还在。
// 同一记录只留一条有效结论——以 recordKey 为槽位，写入即覆盖；
// 并发或重复提交最终只剩最后一次结论，不会残留旧结论。
const STORAGE_KEY = 'hydrology-monitor-station:reviews'

function readStorage(): Record<string, ReviewItem> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return {}
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return {}
  }
  try {
    return JSON.parse(raw) as Record<string, ReviewItem>
  } catch {
    return {}
  }
}

let cache: Record<string, ReviewItem> | null = null

export function allReviews(): Record<string, ReviewItem> {
  if (cache === null) {
    cache = readStorage()
  }
  return cache
}

export function getReview(recordKey: string): ReviewItem | undefined {
  return allReviews()[recordKey]
}

function persist(next: Record<string, ReviewItem>): void {
  cache = next
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  }
}

export function putReview(item: ReviewItem): ReviewItem {
  persist({ ...allReviews(), [item.recordKey]: item })
  return item
}

export function removeReview(recordKey: string): void {
  if (!(recordKey in allReviews())) {
    return
  }
  const next = { ...allReviews() }
  delete next[recordKey]
  persist(next)
}

export function removeModuleReviews(moduleKey: string): void {
  const next = Object.fromEntries(
    Object.entries(allReviews()).filter(([, item]) => item.moduleKey !== moduleKey),
  )
  persist(next)
}

export function reviewStorageKey(): string {
  return STORAGE_KEY
}
