<template>
  <section class="page" data-module="evaporation">
    <header class="page-head">
      <div>
        <h2>蒸发观测管理</h2>
        <p class="page-desc">维护蒸发观测记录，围绕记录编号、站点编号、观测日期、蒸发量做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记蒸发观测记录</button>
        <button class="btn" type="button" @click="exportRows">导出蒸发观测清单</button>
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

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
          <th>核查结论</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td :class="reviewOf(row).conclusion === '异常' ? 'review-abnormal' : 'review-normal'">
            {{ reviewText(row) }}
          </td>
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
            <button class="link" type="button" @click="openEdit(row)">修改</button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 3" class="empty-state">暂无蒸发观测数据，可先登记蒸发观测记录</td>
        </tr>
      </tbody>
    </table>

    <footer class="page-foot">
      <span>共 {{ total }} 条蒸发观测记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>

    <div v-if="showForm" class="modal-mask" @click.self="showForm = false">
      <form class="modal-card" @submit.prevent="submitForm">
        <h3 class="modal-title">{{ editingId === null ? '登记蒸发观测记录' : '补录蒸发观测记录' }}</h3>
        <div class="modal-grid">
          <label v-for="field in formFields" :key="field" class="modal-item">
            <span>{{ field }}<em v-if="envHints[field]" class="field-hint">标准 {{ envHints[field] }}</em></span>
            <input v-model="form[field]" :placeholder="envHints[field] ? `缺测可留空，超出标准不允许保存` : `请输入${field}`" />
          </label>
        </div>
        <p v-if="formError" class="error-text">{{ formError }}</p>
        <div class="modal-actions">
          <button class="btn ghost" type="button" @click="showForm = false">取消</button>
          <button class="btn primary" type="submit" :disabled="saving">保存</button>
        </div>
      </form>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  effectiveReview,
  listEntries,
  moduleMeta,
  runAction as applyAction,
  saveEntry,
  syncEnvChecks,
} from '@/api/local-service'
import { ENV_FIELD_RULES } from '@/data/env-check'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('evaporation')
const columns = ["记录编号", "站点编号", "观测日期", "蒸发量", "水温", "气温", "风速", "记录状态"]
const actions = ["提交审核", "确认通过", "标记异常"]
const statuses = ["已采集", "待审核", "已通过", "异常值"]
const stats = [{"label": "今日观测站次", "value": 0}, {"label": "待审核记录", "value": 0}, {"label": "异常记录数", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const revision = ref(0)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

const formFields = ["记录编号", "站点编号", "观测日期", "蒸发量", "水温", "气温", "风速"]
const envHints = Object.fromEntries(
  ENV_FIELD_RULES.map((rule) => [rule.field, `${rule.min}~${rule.max}${rule.unit}`]),
)
const showForm = ref(false)
const saving = ref(false)
const editingId = ref<number | null>(null)
const form = ref<Record<string, string>>({})
const formError = ref('')

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

function openCreate() {
  editingId.value = null
  form.value = Object.fromEntries(formFields.map((field) => [field, '']))
  formError.value = ''
  showForm.value = true
}

function openEdit(row: EntryRow) {
  editingId.value = Number(row.id)
  form.value = Object.fromEntries(formFields.map((field) => [field, String(row[field] ?? '')]))
  formError.value = ''
  showForm.value = true
}

function submitForm() {
  // 并发提交只留一条有效结论：保存中的重复提交直接忽略
  if (saving.value) {
    return
  }
  saving.value = true
  formError.value = ''
  const result = saveEntry(meta.key, form.value, editingId.value ?? undefined)
  saving.value = false
  if (!result.ok) {
    formError.value = result.message
    return
  }
  showForm.value = false
  reload()
}

function reviewOf(row: EntryRow) {
  revision.value
  return effectiveReview(meta.key, row)
}

function reviewText(row: EntryRow) {
  const review = reviewOf(row)
  const detail = review.reasons.length ? `：${review.reasons.join('、')}` : ''
  return `${review.conclusion}（${review.source}${detail}）`
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

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    revision.value += 1
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '蒸发观测列表读取失败'
  }
}

onMounted(() => {
  syncEnvChecks()
  reload()
})
</script>
