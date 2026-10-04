<template>
  <section class="page" data-module="evaporation">
    <header class="page-head">
      <div>
        <h2>蒸发观测管理</h2>
        <p class="page-desc">蒸发量、水温、风速为必测项，缺任意一项即判定异常；阈值与判定规则全系统统一，超出标准范围不允许保存。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记蒸发观测记录</button>
        <button class="btn" type="button" @click="exportRows">导出蒸发观测清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value" :class="item.danger ? 'error-text' : ''">{{ item.value }}</strong>
      </article>
    </div>

    <p class="rule-tip">统一环境校验标准：{{ thresholdSummary() }}</p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <label class="filter-item">
        <span>结论</span>
        <select v-model="verdictFilter">
          <option value="">全部</option>
          <option value="pending">待复核</option>
          <option value="abnormal">异常</option>
          <option value="normal">正常</option>
          <option value="reviewed">已复核</option>
        </select>
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>自动判定</th>
          <th>有效结论</th>
          <th>当前状态</th>
          <th>操作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="item in filtered" :key="String(item.row.id)">
          <td>{{ item.row['记录编号'] }}</td>
          <td>{{ item.row['站点编号'] }}</td>
          <td>{{ item.row['观测日期'] }}</td>
          <td
            v-for="key in metricKeys"
            :key="key"
            :class="{ 'missing-cell': isEvaporationFieldMissing(item.row, key) }"
          >
            {{ formatCell(item.row, key) }}
          </td>
          <td>
            <span :class="item.auto.abnormal ? 'error-text' : 'normal-text'">{{ item.auto.label }}</span>
          </td>
          <td>
            <span :class="item.abnormal ? 'error-text' : 'normal-text'">{{ item.verdictLabel }}</span>
            <span v-if="item.conclusion" class="conclusion-tag">
              {{ item.conclusion.source === 'legacy' ? '历史结论' : '已人工复核' }}
            </span>
          </td>
          <td>{{ item.row.status }}</td>
          <td class="row-actions">
            <button class="link" type="button" @click="openReview(item)">
              {{ item.pending ? '复核处理' : '查看/改判' }}
            </button>
          </td>
        </tr>
        <tr v-if="!filtered.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无符合条件的蒸发观测记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ filtered.length }} 条蒸发观测记录</span>
      <span v-if="flashMessage" class="success-text">{{ flashMessage }}</span>
    </footer>

    <EvapEntryDialog v-model:open="entryOpen" source="evaporation-list" @saved="onRecordSaved" />
    <EvapReviewDialog
      v-model:open="reviewOpen"
      :record-id="reviewRecordId"
      source="evaporation-list"
      @submitted="onReviewSubmitted"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'

import EvapEntryDialog from '@/components/evaporation/EvapEntryDialog.vue'
import EvapReviewDialog from '@/components/evaporation/EvapReviewDialog.vue'
import { downloadEntries, moduleMeta } from '@/api/local-service'
import {
  isEvaporationFieldMissing,
  thresholdSummary,
  type EvaporationFieldKey,
} from '@/data/evaporation/rules'
import {
  listEffective,
  type EffectiveState,
} from '@/data/evaporation/review'

const route = useRoute()
const router = useRouter()
const meta = moduleMeta('evaporation')
const columns = ['记录编号', '站点编号', '观测日期', '蒸发量(mm)', '水温(℃)', '气温(℃)', '风速(m/s)']
const metricKeys: EvaporationFieldKey[] = ['蒸发量', '水温', '气温', '风速']
const filterFields = ['记录编号', '站点编号', '观测日期']

const items = ref<EffectiveState[]>([])
const filters = ref<Record<string, string>>({})
const verdictFilter = ref('')
const entryOpen = ref(false)
const reviewOpen = ref(false)
const reviewRecordId = ref<number | null>(null)
const flashMessage = ref('')

const filtered = computed(() => {
  const pairs = Object.entries(filters.value).filter(([, value]) => value.trim() !== '')
  return items.value.filter((item) => {
    const matchText = pairs.every(([field, value]) =>
      String(item.row[field] ?? '').includes(value.trim()),
    )
    if (!matchText) {
      return false
    }
    if (verdictFilter.value === 'pending') {
      return item.pending
    }
    if (verdictFilter.value === 'abnormal') {
      return item.abnormal
    }
    if (verdictFilter.value === 'normal') {
      return !item.abnormal
    }
    if (verdictFilter.value === 'reviewed') {
      return item.conclusion !== null
    }
    return true
  })
})

const stats = computed(() => [
  { label: '记录总数', value: items.value.length, danger: false },
  { label: '待复核预警', value: items.value.filter((item) => item.pending).length, danger: true },
  {
    label: '异常记录',
    value: items.value.filter((item) => item.abnormal).length,
    danger: true,
  },
  {
    label: '已人工复核',
    value: items.value.filter((item) => item.conclusion?.manual).length,
    danger: false,
  },
])

function formatCell(item: EffectiveState['row'], key: EvaporationFieldKey): string {
  const value = item[key]
  if (value === undefined || value === null || String(value).trim() === '') {
    return key === '气温' ? '—' : '缺测'
  }
  return String(value)
}

function resetFilters() {
  filters.value = {}
  verdictFilter.value = ''
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  entryOpen.value = true
}

function openReview(item: EffectiveState) {
  flashMessage.value = ''
  reviewRecordId.value = Number(item.row.id)
  reviewOpen.value = true
}

function onRecordSaved(recordId: number) {
  reload()
  reviewRecordId.value = recordId
  flashMessage.value = '记录已通过统一环境校验并保存，自动判定为正常'
}

function onReviewSubmitted(recordId: number) {
  reload()
  reviewRecordId.value = recordId
  flashMessage.value = '复核结论已生效，各入口预警待办已同步更新'
}

function maybeOpenFromRoute() {
  const id = Number(route.query.evapId)
  const action = route.query.evapAction
  if (Number.isFinite(id) && id > 0 && action === 'review') {
    reviewRecordId.value = id
    reviewOpen.value = true
    flashMessage.value = '已带回所选预警待办，当前结论如下，可继续改判'
    router.replace({ path: route.path })
  }
}

function reload() {
  items.value = listEffective()
}

onMounted(() => {
  reload()
  maybeOpenFromRoute()
})
</script>
