// 思考档位记忆回归测试（复刻拦截层纯逻辑 + 源码静态断言，同仓测试风格）
// 规则：选模型 = 该模型上次显式档位 ?? max；显式选择（≠ 声明 defaultEffort）成功后记忆；
// 未填档 / === defaultEffort 视为自动（原生 /model 弹窗对新模型自动填 defaultEffort，
// 与显式选同值在负载上不可区分——固有近似）。
const fs = require('fs')
let passed = 0, failed = 0
const t = (name, cond) => { cond ? passed++ : (failed++, console.log('  FAIL:', name)) }

const src = fs.readFileSync(__dirname + '/../src/client.js', 'utf8')

// ---- 复刻拦截层纯逻辑（src/client.js 模块级 maxEffortOf / augmentRule） ----
const maxEffortOf = (reasoning) => {
  const efforts = (reasoning && Array.isArray(reasoning.efforts)) ? reasoning.efforts : []
  if (efforts.length === 0) return undefined
  return efforts.some((l) => l.id === 'max') ? 'max' : efforts[efforts.length - 1].id
}
const augmentRule = (groups, selection, memory) => {
  const g = (groups || []).find((x) => x.id === selection.provider)
  const m = g && (g.models || []).find((mm) => mm.id === selection.model)
  const declared = m && m.reasoning
  if (!declared || !Array.isArray(declared.efforts) || declared.efforts.length === 0)
    return { payload: selection }
  const key = selection.provider + '::' + selection.model
  const incoming = selection.reasoningEffort
  if (incoming !== undefined && incoming !== declared.defaultEffort)
    return { payload: selection, remember: { key, effort: incoming } }
  const remembered = memory ? memory[key] : undefined
  const effort = (remembered != null && declared.efforts.some((l) => l.id === remembered))
    ? remembered
    : maxEffortOf(declared)
  if (effort === incoming) return { payload: selection }
  return { payload: Object.assign({}, selection, { reasoningEffort: effort }) }
}

// 轮询组（defaultEffort=max，7 档）与未声明 defaultEffort 的模型
const rrGroup = { id: 'roundrobin/g1', models: [{ id: 'm1', reasoning: { defaultEffort: 'max', efforts: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].map((id) => ({ id, name: id })) } }] }
const plainGroup = { id: 'g2', models: [{ id: 'm2', reasoning: { defaultEffort: null, efforts: [{ id: 'low', name: 'Low' }, { id: 'high', name: 'High' }] } }] }
const groups = [rrGroup, plainGroup, { id: 'g3', models: [{ id: 'm3' }] }]

// ---- T1: 显式选择（≠ defaultEffort）原样放行并标记记忆 ----
{
  const sel = { provider: 'roundrobin/g1', model: 'm1', reasoningEffort: 'medium' }
  const r = augmentRule(groups, sel, null)
  t('T1a 显式 medium 放行不改写', r.payload === sel)
  t('T1b 标记记忆 g::m1=medium', r.remember && r.remember.key === 'roundrobin/g1::m1' && r.remember.effort === 'medium')
}

// ---- T2: 自动路径（未填 / === defaultEffort）→ 记忆 ?? max ----
{
  const r = augmentRule(groups, { provider: 'roundrobin/g1', model: 'm1' }, null)
  t('T2a 未填档无记忆 → max', r.payload.reasoningEffort === 'max' && !r.remember)
  const sel2 = { provider: 'roundrobin/g1', model: 'm1', reasoningEffort: 'max' }
  const r2 = augmentRule(groups, sel2, null)
  t('T2b ===defaultEffort(max) 归自动且值相同不改写原对象', r2.payload === sel2)
  t('T2c ===defaultEffort 不标记记忆', !r2.remember)
}

// ---- T3/T4: 记忆优先且须仍在声明档位集内 ----
{
  const r = augmentRule(groups, { provider: 'roundrobin/g1', model: 'm1' }, { 'roundrobin/g1::m1': 'medium' })
  t('T3 有记忆 → 恢复 medium', r.payload.reasoningEffort === 'medium')
  const r2 = augmentRule(groups, { provider: 'roundrobin/g1', model: 'm1' }, { 'roundrobin/g1::m1': 'bogus' })
  t('T4 失效记忆回落 max', r2.payload.reasoningEffort === 'max')
}

// ---- T5: 无 reasoning 元数据原样放行 ----
t('T5 无 reasoning 不干预', augmentRule(groups, { provider: 'g3', model: 'm3', reasoningEffort: 'low' }, null).payload.reasoningEffort === 'low'
  && augmentRule(groups, { provider: 'g3', model: 'm3' }, null).remember === undefined)

// ---- T6: 未声明 defaultEffort 的模型：记忆 ?? 最高声明档 ----
{
  const r = augmentRule(groups, { provider: 'g2', model: 'm2' }, { 'g2::m2': 'low' })
  t('T6a 有记忆 → low', r.payload.reasoningEffort === 'low')
  const r2 = augmentRule(groups, { provider: 'g2', model: 'm2' }, null)
  t('T6b 无记忆 → 最高声明档 high', r2.payload.reasoningEffort === 'high')
}

// ---- T7: maxEffortOf ----
t('T7a 声明含 max 优先', maxEffortOf(rrGroup.models[0].reasoning) === 'max')
t('T7b 无 max 取末项', maxEffortOf(plainGroup.models[0].reasoning) === 'high')
t('T7c 空 efforts / 无 reasoning → undefined', maxEffortOf({ efforts: [] }) === undefined && maxEffortOf(undefined) === undefined)

// ---- T8: 源码静态断言——seam / 策略落点 ----
t('S1 directoryFor 服务层包装 + WeakSet 防重', src.includes('models.directoryFor = (sessionId)') && src.includes('wrappedDirs.has(dir)'))
t('S2 choose 只带 {provider, model} 不再自动填档', /select\(\{ provider, model \}\)/.test(src) && !src.includes('pickDefaultEffort'))
t('S3 记忆存 model-channels ns', src.includes("EFFORT_MEMORY_NS = 'model-channels'"))
t('S4 成功后才 record（失败不污染记忆）', /if \(rule\.remember\) p\.then\(\(\) => recordEffortMemory/.test(src))
t('S5 select 失败静默旁路', /p\.then\(\(\) => recordEffortMemory\([^\n]*\), \(\) => \{\}\)/.test(src))

console.log('\n' + passed + ' passed, ' + failed + ' failed')
process.exit(failed > 0 ? 1 : 0)
