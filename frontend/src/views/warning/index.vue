<template>
  <section class="page" data-module="warning">
    <header class="page-head">
      <div>
        <h2>预警阈值管理</h2>
        <p class="page-desc">蒸发环境预警待办由统一判定与复核结论实时派生：任何入口改判后此处立即同步，不再残留旧结论。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记预警阈值配置</button>
        <button class="btn" type="button" @click="exportRows">导出预警阈值清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in overviewCards" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="item.danger ? 'error-text' : ''">{{ item.value }}</strong>
      </article>
    </div>

    <p class="rule-tip">统一环境校验标准：{{ thresholdSummary() }}</p>

    <div class="todo-tabs">
      <button
        class="btn"
        :class="{ primary: tab === 'pending' }"
        type="button"
        @click="tab = 'pending'"
      >
        待复核预警（{{ pendingTodos.length }}）
      </button>
      <button
        class="btn"
        :class="{ primary: tab === 'handled' }"
        type="button"
        @click="tab = 'handled'"
      >
        已处理结论（{{ reviewed.length }}）
      </button>
    </div>

    <table v-if="tab === 'pending'" class="data-table">
      <thead>
        <tr>
          <th>记录编号</th>
          <th>站点编号</th>
          <th>观测日期</th>
          <th>蒸发量/水温/气温/风速</th>
          <th>自动判定</th>
          <th>缺测与超范围原因</th>
          <th>来源入口</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in pendingTodos" :key="String(item.row.id)">
          <td>{{ item.row['记录编号'] }}</td>
          <td>{{ item.row['站点编号'] }}</td>
          <td>{{ item.row['观测日期'] }}</td>
          <td>{{ metricText(item) }}</td>
          <td class="error-text">{{ item.verdictLabel }}</td>
          <td class="error-text">{{ item.reasons.join('；') }}</td>
          <td>{{ item.sourceLabel }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openReview(item)">复核改判</button>
            <RouterLink
              class="link"
              :to="{ path: '/evaporation', query: { evapId: String(item.row.id), evapAction: 'review' } }"
            >
              到蒸发列表处理
            </RouterLink>
          </td>
        </tr>
        <tr v-if="!pendingTodos.length">
          <td colspan="8" class="empty-state">暂无待复核预警：各入口提交的结论已全部同步</td>
        </tr>
      </tbody>
    </table>

    <table v-else class="data-table">
      <thead>
        <tr>
          <th>记录编号</th>
          <th>站点编号</th>
          <th>观测日期</th>
          <th>有效结论</th>
          <th>复核来源</th>
          <th>复核人</th>
          <th>复核时间</th>
          <th>复核说明</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in reviewed" :key="String(item.row.id)">
          <td>{{ item.row['记录编号'] }}</td>
          <td>{{ item.row['站点编号'] }}</td>
          <td>{{ item.row['观测日期'] }}</td>
          <td :class="item.abnormal ? 'error-text' : 'normal-text'">
            {{ item.verdictLabel }}
            <span v-if="item.conclusion?.source === 'legacy'" class="conclusion-tag">历史兼容</span>
          </td>
          <td>{{ item.conclusion ? REVIEW_SOURCE_LABELS[item.conclusion.source] : '—' }}</td>
          <td>{{ item.conclusion?.reviewer ?? '—' }}</td>
          <td>{{ item.conclusion?.reviewedAt || '历史迁移' }}</td>
          <td>{{ item.conclusion?.note || '—' }}</td>
          <td>
            <button class="link" type="button" @click="openReview(item)">查看/再次改判</button>
          </td>
        </tr>
        <tr v-if="!reviewed.length">
          <td colspan="9" class="empty-state">暂无已处理结论</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>待办数量随各入口复核操作实时变化，刷新页面结论仍保留</span>
      <span v-if="flashMessage" class="success-text">{{ flashMessage }}</span>
    </footer>

    <EvapReviewDialog
      v-model:open="reviewOpen"
      :record-id="reviewRecordId"
      source="warning-todo"
      @submitted="onReviewSubmitted"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import EvapReviewDialog from '@/components/evaporation/EvapReviewDialog.vue'
import { downloadEntries, moduleMeta } from '@/api/local-service'
import { thresholdSummary } from '@/data/evaporation/rules'
import {
  listEffective,
  REVIEW_SOURCE_LABELS,
  type EffectiveState,
} from '@/data/evaporation/review'

const meta = moduleMeta('warning')

const tab = ref<'pending' | 'handled'>('pending')
const states = ref<EffectiveState[]>([])
const reviewOpen = ref(false)
const reviewRecordId = ref<number | null>(null)
const flashMessage = ref('')

const pendingTodos = computed(() => states.value.filter((item) => item.pending))
const reviewed = computed(() =>
  states.value
    .filter((item) => item.conclusion !== null)
    .sort((a, b) =>
      String(b.conclusion?.reviewedAt ?? '').localeCompare(String(a.conclusion?.reviewedAt ?? '')),
    ),
)

const overviewCards = computed(() => [
  { label: '阈值配置总数', value: 3, danger: false },
  { label: '待复核蒸发预警', value: pendingTodos.value.length, danger: pendingTodos.value.length > 0 },
  { label: '异常记录数', value: states.value.filter((item) => item.abnormal).length, danger: true },
  { label: '已保留结论', value: reviewed.value.length, danger: false },
])

function metricText(item: EffectiveState): string {
  const value = (key: string) => {
    const raw = item.row[key]
    if (raw === undefined || raw === null || String(raw).trim() === '') {
      return key === '气温' ? '未填' : '缺测'
    }
    return String(raw)
  }
  return `${value('蒸发量')} / ${value('水温')} / ${value('气温')} / ${value('风速')}`
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  flashMessage.value = ''
}

function openReview(item: EffectiveState) {
  flashMessage.value = ''
  reviewRecordId.value = Number(item.row.id)
  reviewOpen.value = true
}

function onReviewSubmitted() {
  reload()
  flashMessage.value = '改判已生效：待办与蒸发列表、站房面板同步更新，历史结论已归档保留'
}

function reload() {
  states.value = listEffective()
}

onMounted(reload)
</script>
