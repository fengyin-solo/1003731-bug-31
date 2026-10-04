<template>
  <section class="page" data-module="stationhouse">
    <header class="page-head">
      <div>
        <h2>站房维护管理</h2>
        <p class="page-desc">站房面板与蒸发记录列表共用同一套环境校验规则与复核存储：在此登记的蒸发观测与列表登记完全等价。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记站房维护记录</button>
        <button class="btn" type="button" @click="exportRows">导出站房维护清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <!-- 蒸发观测环境核查面板：与蒸发记录列表共用规则、校验、结论存储 -->
    <section class="check-panel">
      <header class="check-panel-head">
        <div>
          <h3>蒸发观测环境核查（站房入口）</h3>
          <p class="rule-tip">{{ thresholdSummary() }}</p>
        </div>
        <div class="panel-actions">
          <button class="btn primary" type="button" @click="entryOpen = true">站房登记蒸发观测</button>
          <RouterLink class="btn" :to="{ path: '/warning' }">前往预警待办（{{ pendingCount }}）</RouterLink>
        </div>
      </header>

      <div class="panel-columns">
        <div class="panel-block">
          <h4 class="block-title">待复核预警（{{ pendingTodos.length }}）</h4>
          <table class="data-table">
            <thead>
              <tr><th>记录编号</th><th>站点</th><th>观测日期</th><th>判定</th><th>操作</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in pendingTodos" :key="String(item.row.id)">
                <td>{{ item.row['记录编号'] }}</td>
                <td>{{ item.row['站点编号'] }}</td>
                <td>{{ item.row['观测日期'] }}</td>
                <td class="error-text">{{ item.verdictLabel }}（{{ item.reasons.join('；') }}）</td>
                <td>
                  <button class="link" type="button" @click="openReview(item)">复核处理</button>
                </td>
              </tr>
              <tr v-if="!pendingTodos.length">
                <td colspan="5" class="empty-state">暂无待复核预警</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div class="panel-block">
          <h4 class="block-title">本站房最近核查记录</h4>
          <table class="data-table">
            <thead>
              <tr><th>记录编号</th><th>结论</th><th>来源</th><th>复核人</th><th>时间</th></tr>
            </thead>
            <tbody>
              <tr v-for="item in recentReviewed" :key="String(item.row.id)">
                <td>{{ item.row['记录编号'] }}</td>
                <td :class="item.abnormal ? 'error-text' : 'normal-text'">{{ item.verdictLabel }}</td>
                <td>{{ item.sourceLabel }}</td>
                <td>{{ item.conclusion?.reviewer ?? '—' }}</td>
                <td>{{ item.conclusion?.reviewedAt || '历史迁移' }}</td>
              </tr>
              <tr v-if="!recentReviewed.length">
                <td colspan="5" class="empty-state">暂无核查记录</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <p v-if="flashMessage" class="success-text">{{ flashMessage }}</p>
    </section>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无站房维护数据，可先登记站房维护记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条站房维护记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <EvapEntryDialog v-model:open="entryOpen" source="stationhouse-panel" @saved="onRecordSaved" />
    <EvapReviewDialog
      v-model:open="reviewOpen"
      :record-id="reviewRecordId"
      source="stationhouse-panel"
      @submitted="onReviewSubmitted"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import EvapEntryDialog from '@/components/evaporation/EvapEntryDialog.vue'
import EvapReviewDialog from '@/components/evaporation/EvapReviewDialog.vue'
import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import { thresholdSummary } from '@/data/evaporation/rules'
import {
  listEffective,
  type EffectiveState,
} from '@/data/evaporation/review'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('stationhouse')
const columns = ['记录编号', '站点编号', '维护类型', '维护内容', '维护单位', '维护日期', '费用支出', '维护状态']
const actions = ['安排维护', '确认完工', '通过验收']
const statuses = ['待安排', '已安排', '施工中', '已完成', '已验收']

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)

const evapStates = ref<EffectiveState[]>([])
const entryOpen = ref(false)
const reviewOpen = ref(false)
const reviewRecordId = ref<number | null>(null)
const flashMessage = ref('')

const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const stats = computed(() => [
  { label: '待维护项数', value: rows.value.filter((row) => String(row.status) === '待安排').length },
  { label: '施工中项数', value: rows.value.filter((row) => ['已安排', '施工中'].includes(String(row.status))).length },
  { label: '蒸发待复核预警', value: pendingTodos.value.length },
])

const pendingTodos = computed(() => evapStates.value.filter((item) => item.pending))
const pendingCount = computed(() => pendingTodos.value.length)
const recentReviewed = computed(() =>
  evapStates.value
    .filter((item) => item.conclusion !== null)
    .sort((a, b) => String(b.conclusion?.reviewedAt ?? '').localeCompare(String(a.conclusion?.reviewedAt ?? '')))
    .slice(0, 6),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  errorMessage.value = '站房维护记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function openReview(item: EffectiveState) {
  flashMessage.value = ''
  reviewRecordId.value = Number(item.row.id)
  reviewOpen.value = true
}

function onRecordSaved(recordId: number) {
  reload()
  flashMessage.value = `站房入口登记的记录 EVAP-${String(recordId).padStart(4, '0')} 已通过统一校验并写入核查链路`
}

function onReviewSubmitted() {
  reload()
  flashMessage.value = '复核结论已保存，蒸发列表与预警待办已同步更新'
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    evapStates.value = listEffective()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '站房维护列表读取失败'
  }
}

onMounted(reload)
</script>
