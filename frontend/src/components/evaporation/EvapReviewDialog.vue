<template>
  <div v-if="open && state" class="modal-mask" @click.self="close">
    <div class="modal-card">
      <header class="modal-head">
        <h3>蒸发记录复核 · {{ state.row['记录编号'] }}</h3>
        <span class="modal-sub">{{ sourceLabel }}</span>
      </header>

      <dl class="record-meta">
        <div><dt>站点编号</dt><dd>{{ state.row['站点编号'] }}</dd></div>
        <div><dt>观测日期</dt><dd>{{ state.row['观测日期'] }}</dd></div>
        <div><dt>录入入口</dt><dd>{{ state.sourceLabel }}</dd></div>
        <div><dt>当前状态</dt><dd>{{ state.row['记录状态'] ?? state.row.status }}</dd></div>
      </dl>

      <table class="data-table check-table">
        <thead>
          <tr><th>校验项</th><th>实测值</th><th>允许范围</th><th>判定</th></tr>
        </thead>
        <tbody>
          <tr v-for="line in checkLines" :key="line.label">
            <td>{{ line.label }}</td>
            <td :class="{ 'missing-cell': line.missing && line.required }">
              {{ line.missing ? (line.required ? '缺测' : '未填') : line.valueText }}
            </td>
            <td>{{ line.rangeText }}</td>
            <td :class="line.pass ? 'normal-text' : 'error-text'">{{ line.pass ? '通过' : line.message }}</td>
          </tr>
        </tbody>
      </table>

      <section class="verdict-box">
        <p class="verdict-line">
          自动判定：
          <strong :class="state.auto.abnormal ? 'error-text' : 'normal-text'">{{ state.auto.label }}</strong>
          <span v-if="state.auto.reasons.length" class="verdict-reasons">（{{ state.auto.reasons.join('；') }}）</span>
        </p>

        <div v-if="state.conclusion" class="history-box">
          <p class="history-title">
            已保留的复核结论：{{ state.conclusion.verdictLabel }}
            · {{ state.conclusion.reviewer }}
            <template v-if="state.conclusion.reviewedAt"> · {{ state.conclusion.reviewedAt }}</template>
            <span v-if="state.conclusion.source === 'legacy'" class="legacy-tag">历史结论兼容</span>
          </p>
          <p v-if="state.conclusion.note" class="history-note">复核说明：{{ state.conclusion.note }}</p>
        </div>

        <div class="choice-row">
          <span>人工改判：</span>
          <label class="choice-item">
            <input v-model="abnormal" type="radio" :value="false" :disabled="submitting" />
            正常
          </label>
          <label class="choice-item">
            <input v-model="abnormal" type="radio" :value="true" :disabled="submitting" />
            异常
          </label>
        </div>

        <label class="form-item note-item">
          <span>复核说明<em v-if="abnormal !== state.auto.abnormal" class="required-mark">*（改判时必填）</em></span>
          <textarea v-model="note" rows="3" placeholder="记录改判依据，例如现场核查设备、补测结果等" />
        </label>

        <p v-if="message" :class="submitConflict ? 'warn-text' : 'error-text'">{{ message }}</p>
      </section>

      <footer class="modal-foot">
        <span class="form-hint">提交后所有入口的预警待办与列表结论同步更新</span>
        <div class="modal-actions">
          <button class="btn" type="button" :disabled="submitting" @click="close">取消</button>
          <button class="btn primary" type="button" :disabled="submitting" @click="submit">
            {{ submitting ? '提交中…' : '提交复核结论' }}
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import {
  getEffective,
  submitReview,
  type EffectiveState,
  type ReviewSourceKey,
  REVIEW_SOURCE_LABELS,
} from '@/data/evaporation/review'
import {
  EVAPORATION_FIELD_RULES,
  isEvaporationFieldMissing,
  parseFieldValue,
} from '@/data/evaporation/rules'
import { useSessionStore } from '@/stores/session'

const props = defineProps<{
  open: boolean
  recordId: number | null
  source: Exclude<ReviewSourceKey, 'legacy'>
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'submitted', recordId: number): void
}>()

const session = useSessionStore()
const sourceLabel = REVIEW_SOURCE_LABELS[props.source]

const state = ref<EffectiveState | null>(null)
const abnormal = ref(false)
const note = ref('')
const message = ref('')
const submitConflict = ref(false)
const submitting = ref(false)

const checkLines = computed(() => {
  if (!state.value) {
    return []
  }
  return EVAPORATION_FIELD_RULES.map((rule) => {
    const raw = state.value?.row[rule.key]
    const missing = isEvaporationFieldMissing(
      (state.value?.row ?? {}) as Record<string, unknown>,
      rule.key,
    )
    const value = parseFieldValue(raw)
    const pass = missing ? !rule.required : value !== null && value >= rule.min && value <= rule.max
    let failure = ''
    if (!pass) {
      failure = missing ? '缺测' : `超范围`
    }
    return {
      label: rule.label,
      required: rule.required,
      missing,
      valueText: value === null ? '' : `${value} ${rule.unit}`,
      rangeText: `${rule.min}~${rule.max} ${rule.unit}`,
      pass,
      message: failure,
    }
  })
})

watch(
  () => [props.open, props.recordId] as const,
  ([open]) => {
    if (open && props.recordId !== null) {
      load(props.recordId)
    }
  },
)

function load(recordId: number) {
  state.value = getEffective(recordId)
  message.value = ''
  submitConflict.value = false
  submitting.value = false
  if (state.value) {
    abnormal.value = state.value.abnormal
    // 打开复核窗时带出已保留的复核说明，返回重进也能看到原结论。
    note.value = state.value.conclusion?.note ?? ''
  }
}

function close() {
  emit('update:open', false)
}

function submit() {
  if (!state.value || submitting.value) {
    return
  }
  submitting.value = true
  message.value = ''
  submitConflict.value = false
  const baseVersion = state.value.conclusion?.manual ? state.value.conclusion.version : 0
  const result = submitReview({
    recordId: state.value.row.id as number,
    abnormal: abnormal.value,
    note: note.value,
    source: props.source,
    reviewer: session.operator,
    expectedVersion: baseVersion,
  })
  submitting.value = false
  if (!result.ok) {
    submitConflict.value = Boolean(result.conflict)
    message.value = result.message
    if (result.conflict) {
      load(state.value.row.id as number)
    }
    return
  }
  emit('submitted', state.value.row.id as number)
  emit('update:open', false)
}
</script>
