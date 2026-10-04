// 环境校验链路的运行时验证：用 esbuild 把真实模块打进来跑断言。
// 运行：node scripts/verify-env-chain.mjs
import { build } from 'esbuild'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'env-chain-'))
const outfile = join(dir, 'bundle.mjs')

await build({
  entryPoints: ['src/api/local-service.ts'],
  bundle: true,
  format: 'esm',
  outfile,
  alias: { '@': new URL('../src', import.meta.url).pathname },
  logLevel: 'silent',
})

// localStorage 垫片：模拟浏览器持久化
const storage = new Map()
globalThis.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
  },
}

const svc = await import(pathToFileURL(outfile).href)

let failures = 0
function check(name, cond) {
  if (cond) {
    console.log(`  ok  ${name}`)
  } else {
    failures += 1
    console.log(`FAIL  ${name}`)
  }
}

// 1. 初始同步：缺风速的 EVAP-0002 判异常并挂待办；联动的站房 STAT-0002 一并写入核查
svc.syncEnvChecks()
let todos = svc.listWarningTodos()
const evap2 = todos.find((t) => t.recordKey === 'evaporation:2')
const house2 = todos.find((t) => t.recordKey === 'stationhouse:2')
check('缺风速的蒸发记录判异常（缺一项即异常）', evap2?.conclusion === '异常' && evap2.reasons.includes('风速缺测'))
check('站房入口一并写入核查（同一根因）', house2?.conclusion === '异常' && house2.reasons.includes('风速缺测'))
check('两条待办都处于待处理', !evap2?.resolved && !house2?.resolved)
check('历史审核结论兼容：EVAP-0003 已通过 → 锁定的历史结论',
  todos.find((t) => t.recordKey === 'evaporation:3')?.source === '历史结论' &&
  todos.find((t) => t.recordKey === 'evaporation:3')?.locked === true)
check('正常记录不产生待办', !todos.some((t) => t.recordKey === 'evaporation:1'))
check('预警待办数为 2', svc.countOpenTodos() === 2)

// 2. 人工改判：确认通过后旧结论不残留，其他入口的待办跟着更新
const judged = svc.runAction('evaporation', 2, '确认通过')
check('人工改判动作成功', judged.ok)
todos = svc.listWarningTodos()
const evap2After = todos.find((t) => t.recordKey === 'evaporation:2')
check('改判后结论为正常（人工改判）', evap2After?.conclusion === '正常' && evap2After?.source === '人工改判')
check('改判后不再挂待处理', evap2After?.resolved === true)
check('站房入口的待办跟着更新（联动消除）', !todos.some((t) => t.recordKey === 'stationhouse:2'))
check('预警待办数清零', svc.countOpenTodos() === 0)

// 3. 并发/重复提交：同一记录只留一条有效结论
const dup = svc.runAction('evaporation', 2, '确认通过')
check('重复改判被拒绝（幂等）', !dup.ok)
const conflict = svc.runAction('evaporation', 2, '标记异常')
check('冲突改判允许但覆盖同一槽位', conflict.ok)
todos = svc.listWarningTodos()
check('同一记录仍只有一条结论', todos.filter((t) => t.recordKey === 'evaporation:2').length === 1)
check('最后一次改判生效', todos.find((t) => t.recordKey === 'evaporation:2')?.conclusion === '异常')
svc.runAction('evaporation', 2, '确认通过')

// 4. 保存校验：超出标准不允许保存，缺测允许保存
const over = svc.saveEntry('evaporation', { 记录编号: 'EVAP-0004', 站点编号: 'STAT-0001', 观测日期: '2026-09-04', 蒸发量: '120', 水温: '18', 气温: '20', 风速: '2' })
check('蒸发量超出标准不允许保存', !over.ok && over.message.includes('超出标准'))
const invalid = svc.saveEntry('evaporation', { 记录编号: 'EVAP-0004', 站点编号: 'STAT-0001', 观测日期: '2026-09-04', 蒸发量: 'abc', 水温: '18', 气温: '20', 风速: '2' })
check('非数值不允许保存', !invalid.ok && invalid.message.includes('不是有效数值'))
const missing = svc.saveEntry('evaporation', { 记录编号: 'EVAP-0004', 站点编号: 'STAT-0001', 观测日期: '2026-09-04', 蒸发量: '4.1', 水温: '', 气温: '20', 风速: '2.0' })
check('缺测允许保存', missing.ok)
todos = svc.listWarningTodos()
check('缺测新记录保存后自动挂待办', todos.some((t) => t.recordKey === 'evaporation:4' && !t.resolved && t.reasons.includes('水温缺测')))

// 5. 复核结论保留：自动校验不得覆盖人工/历史结论
svc.syncEnvChecks()
todos = svc.listWarningTodos()
check('再次同步后人工改判结论仍保留', todos.find((t) => t.recordKey === 'evaporation:2')?.source === '人工改判')
check('历史结论仍锁定', todos.find((t) => t.recordKey === 'evaporation:3')?.locked === true)

// 6. 补录修改：数据变更后旧结论作废、按新数据重查
const created = svc.listEntries('evaporation').items.find((r) => r['记录编号'] === 'EVAP-0004')
svc.runAction('evaporation', Number(created.id), '确认通过')
svc.saveEntry('evaporation', { 记录编号: 'EVAP-0004', 站点编号: 'STAT-0001', 观测日期: '2026-09-04', 蒸发量: '4.1', 水温: '19.0', 气温: '20', 风速: '2.0' }, Number(created.id))
todos = svc.listWarningTodos()
check('补录齐全后待办自动消除', !todos.some((t) => t.recordKey === `evaporation:${created.id}` && !t.resolved))
check('补录后预警待办数为零', svc.countOpenTodos() === 0)

// 7. 持久化：核查结论与业务数据都落在 localStorage
check('复核结论已持久化', storage.has('hydrology-monitor-station:reviews'))
check('业务数据已持久化', storage.has('hydrology-monitor-station:entries'))

console.log(failures === 0 ? '\n全部通过' : `\n${failures} 项失败`)
process.exit(failures === 0 ? 0 : 1)
