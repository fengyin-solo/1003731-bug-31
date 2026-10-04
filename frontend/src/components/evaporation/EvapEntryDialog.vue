<template>
  <div v-if="open" class="modal-mask" @click.self="close">
    <div class="modal-card">
      <header class="modal-head">
        <h3>登记蒸发观测记录</h3>
        <span class="modal-sub">{{ sourceLabel }}</span>
      </header>

      <p class="rule-tip">统一环境校验标准：{{ thresholdSummary() }}</p>

      <form @submit.prevent="submit">
        <div class="form-grid">
          <label class="form-item">
            <span>站点编号 *</span>
            <input v-model="form.站点编号" placeholder="如 STAT-0001" />
          </label>
          <label class="form-item">
            <span>观测日期 *</span>
            <input v-model="form.观测日期" type="date" />
          </label>
          <label v-for="rule in fieldRules" :key="rule.key" class="form-item">
            <span>
              {{ rule.label }}
              <em v-if="rule.required" class="required-mark">*</em>
              <em v-else class="optional-mark">选填</em>
            </span>
            <input
              v-model="form[rule.key]"
              type="number"
              step="0.1"
              :placeholder="`${rule.min}~${rule.max}`"
            />
          </label>
        </div>

        <ul v-if="errors.length" class="error-list">
          <li v-for="error in errors" :key="error">{{ error }}</li>
        </ul>

        <footer class="modal-foot">
          <span class="form-hint">必测项缺测或超出标准范围时不允许保存</span>
          <div class="modal-actions">
            <button class="btn" type="button" @click="close">取消</button>
            <button class="btn primary" type="submit">保存并核查</button>
          </div>
        </footer>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, watch } from 'vue'

import {
  createEvaporationRecord,
  type ReviewSourceKey,
  REVIEW_SOURCE_LABELS,
} from '@/data/evaporation/review'
import {
  EVAPORATION_FIELD_RULES,
  thresholdSummary,
  type EvaporationFieldKey,
} from '@/data/evaporation/rules'

const props = defineProps<{
  open: boolean
  source: Extract<ReviewSourceKey, 'evaporation-list' | 'stationhouse-panel'>
}>()

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void
  (e: 'saved', recordId: number): void
}>()

const fieldRules = EVAPORATION_FIELD_RULES
const sourceLabel = REVIEW_SOURCE_LABELS[props.source]

type EntryForm = Record<EvaporationFieldKey, string> & { 站点编号: string; 观测日期: string }

function emptyForm(): EntryForm {
  return {
    站点编号: '',
    观测日期: new Date().toISOString().slice(0, 10),
    蒸发量: '',
    水温: '',
    气温: '',
    风速: '',
  }
}

const form = reactive<EntryForm>(emptyForm())
const errors = ref<string[]>([])

watch(
  () => props.open,
  (open) => {
    if (open) {
      Object.assign(form, emptyForm())
      errors.value = []
    }
  },
)

function close() {
  emit('update:open', false)
}

function submit() {
  errors.value = []
  const result = createEvaporationRecord({
    站点编号: form.站点编号,
    观测日期: form.观测日期,
    蒸发量: form.蒸发量,
    水温: form.水温,
    气温: form.气温,
    风速: form.风速,
    source: props.source,
  })
  if (!result.ok || result.recordId === undefined) {
    errors.value = result.errors
    return
  }
  emit('saved', result.recordId)
  emit('update:open', false)
}
</script>
