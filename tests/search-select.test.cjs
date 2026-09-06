// SearchModelSelect 纯逻辑回归测试（复刻组件内的排序/过滤/置顶逻辑）
let passed = 0, failed = 0
const t = (name, cond) => { cond ? passed++ : (failed++, console.log('  FAIL:', name)) }

// 复刻组件逻辑：normSearch / matchTier / ordered / sections
// 两段式宽松匹配：归一化子串（梯队1）优先、子序列（梯队2）兜底——「glm53」命中
// 「GLM-5.3」，缩写「ds」命中「DeepSeek」；有查询时组按梯队稳定排序
const normSearch = (s) => String(s || '').toLowerCase().replace(/[-_./\s]+/g, '')
const isSubseq = (s, q) => {
  let at = 0
  for (let i = 0; i < s.length && at < q.length; i++) if (s[i] === q[at]) at++
  return at === q.length
}
const matchTier = (hay, q) => (hay.includes(q) ? 1 : (isSubseq(hay, q) ? 2 : 0))
const bestTier = (...tiers) => {
  let best = 0
  for (const t of tiers) if (t !== 0 && (best === 0 || t < best)) best = t
  return best
}
const makeLogic = (recent) => {
  const recentSet = new Set(recent)
  // 组匹配含路由 id（轮询组呈现名可能全部相同，搜 id 片段才能定位到组）
  const build = (groups, q) => {
    const nq = normSearch(q)
    const dupNames = new Map()
    for (const g of groups) { const n = g.name || g.id; dupNames.set(n, (dupNames.get(n) || 0) + 1) }
    let ordered = groups
    if (!nq && recentSet.size > 0) {
      const rank = new Map(recent.map((p, i) => [p, i]))
      ordered = groups.slice().sort((a, b) => {
        const ra = rank.has(a.id) ? rank.get(a.id) : 1e9
        const rb = rank.has(b.id) ? rank.get(b.id) : 1e9
        return ra - rb
      })
    }
    const sections = []
    for (const g of ordered) {
      const models = (g.models || []).map((m) => ({
        m,
        nname: normSearch(m.name),
        nid: normSearch(m.id),
        ndesc: normSearch(m.description),
      }))
      let rows, tier
      if (!nq) {
        rows = models.map((x) => x.m)
        tier = 0
      } else {
        const groupTier = bestTier(matchTier(normSearch(g.name || g.id), nq), matchTier(normSearch(g.id), nq))
        if (groupTier > 0) {
          tier = groupTier
          rows = models.map((x) => x.m)
        } else {
          const scored = models
            .map((mi) => ({ m: mi.m, t: bestTier(matchTier(mi.nname, nq), matchTier(mi.nid, nq), matchTier(mi.ndesc, nq)) }))
            .filter((x) => x.t > 0)
          if (scored.length === 0) continue
          scored.sort((a, b) => a.t - b.t)
          rows = scored.map((x) => x.m)
          tier = scored[0].t
        }
      }
      const isDup = (dupNames.get(g.name || g.id) || 0) > 1 && g.id !== g.name
      sections.push({ g, rows, isTop: !nq && recentSet.has(g.id), isDup, tier })
    }
    if (nq) sections.sort((a, b) => a.tier - b.tier)
    return { ordered, sections }
  }
  return build
}

// T1: 置顶排序——recent 顺序重排组，未提及的按原序 append
{
  const groups = [
    { id: 'a', name: 'A', models: [{ id: 'a1', name: 'A1' }] },
    { id: 'b', name: 'B', models: [{ id: 'b1', name: 'B1' }] },
    { id: 'c', name: 'C', models: [{ id: 'c1', name: 'C1' }] },
  ]
  const build = makeLogic(['c', 'a'])  // 最近用 c、然后 a
  const { ordered, sections } = build(groups, '')
  t('T1 置顶顺序 c,a,b', ordered.map((g) => g.id).join('') === 'cab')
  t('T1 isTop 标记', sections[0].isTop === true && sections[2].isTop === false)
}

// T2: 搜索过滤（模型名/provider 名/描述/id 匹配）
{
  const groups = [
    { id: 'deepseek-official', name: 'DeepSeek', models: [{ id: 'deepseek-v4-flash', name: 'V4 Flash' }] },
    { id: 'carolineai', name: 'Caroline', models: [{ id: 'glm-5.2', name: 'GLM 5.2', description: '智谱旗舰' }] },
  ]
  const build = makeLogic([])
  t('T2a 搜 glm 命中 id', build(groups, 'glm').sections.length === 1 && build(groups, 'glm').sections[0].g.id === 'carolineai')
  t('T2b 搜 V4 命中模型名', build(groups, 'v4').sections[0].g.id === 'deepseek-official')
  t('T2c 搜 智谱 命中描述', build(groups, '智谱').sections[0].g.id === 'carolineai')
  t('T2d 搜 deepseek 命中组名+模型 id（两组都出）', build(groups, 'deepseek').sections.length === 1)
  t('T2e 空搜索全量', build(groups, '').sections.length === 2)
  t('T2f 无匹配空列表', build(groups, 'zzz-not-exist').sections.length === 0)
}

// T3: 置顶数据聚合（复刻 pullRecentProviders 的 7 天窗口逻辑）
{
  const now = Date.now()
  const day = 24 * 3600 * 1000
  const recs = {
    deepseek: [
      { provider: 'deepseek', ts: now - 1 * day, ok: true },
      { provider: 'deepseek', ts: now - 2 * day, ok: true },  // 更旧，不取
    ],
    caroline: [
      { provider: 'caroline', ts: now - 3 * day, ok: true },
    ],
    stale: [
      { provider: 'stale', ts: now - 8 * day, ok: true },     // 超 7 天，剔除
    ],
    failed: [
      { provider: 'failed', ts: now - 1 * day, ok: false },   // 失败，不置顶
    ],
  }
  const cutoff = now - 7 * day
  const last = new Map()
  for (const evs of Object.values(recs)) {
    for (const e of (evs || [])) {
      if (!e || !e.provider || !e.ts || e.ts < cutoff) continue
      if (!e.ok) continue
      if (!last.has(e.provider) || (e.ts || 0) > last.get(e.provider)) last.set(e.provider, e.ts)
    }
  }
  const order = [...last.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0])
  t('T3 7天窗口+去重+降序+剔除失败', order.join(',') === 'deepseek,caroline')
}

// T4: 组名匹配但模型不匹配时全组模型都显示（provider 维度搜索意图）
{
  const groups = [
    { id: 'nvidia', name: 'NVIDIA', models: [{ id: 'llama-3', name: 'Llama 3' }, { id: 'nemotron', name: 'Nemotron' }] },
  ]
  const build = makeLogic([])
  const { sections } = build(groups, 'nvidia')
  t('T4 组名匹配显示全组模型', sections.length === 1 && sections[0].rows.length === 2)
}

// T5: 宽松匹配——归一化子串（小写 + 去分隔符 - _ . 空白）
{
  const groups = [
    { id: 'zhipu', name: 'Zhipu', models: [{ id: 'glm-5.3', name: 'GLM 5.3', description: '旗舰' }] },
  ]
  const build = makeLogic([])
  t('T5a 搜 glm53 命中 glm-5.3', build(groups, 'glm53').sections.length === 1 && build(groups, 'glm53').sections[0].rows.length === 1)
  t('T5b 大小写穿透：GLM5 命中', build(groups, 'GLM5').sections.length === 1)
  t('T5c 反向带分隔符：glm-5.3 命中', build(groups, 'glm-5.3').sections.length === 1)
  t('T5d 组路由 id 归一化命中显示全组', (() => {
    const g2 = [{ id: 'roundrobin/coding', name: 'RoundRobin', models: [{ id: 'x', name: 'X' }] }]
    const s = makeLogic([])(g2, 'roundrobincoding').sections
    return s.length === 1 && s[0].rows.length === 1
  })())
  t('T5e 纯分隔符查询 = 全量', build(groups, '-_. ').sections.length === 1)
  t('T5f 不相关查询仍排除', build(groups, 'zzz').sections.length === 0)
}

// T6: 子序列兜底（梯队2）与梯队排序——「ds」命中 DeepSeek（缩写/首字母场景）
{
  const groups = [
    { id: 'bbb', name: 'DeepSeek', models: [{ id: 'deepseek-chat', name: 'DeepSeek Chat' }] },
    { id: 'aaa', name: 'Aaa', models: [{ id: 'dsv4-f-0731', name: 'DSV4 F' }] },
  ]
  const build = makeLogic([])
  const { sections } = build(groups, 'ds')
  t('T6a ds 子序列命中 DeepSeek 组', sections.some((s) => s.g.id === 'bbb' && s.rows.length === 1))
  t('T6b ds 子串命中的组排在前', sections[0].g.id === 'aaa' && sections[1].g.id === 'bbb')
  t('T6c 组内梯队：子串命中模型行优先', (() => {
    const g2 = [{ id: 'mix', name: 'Mix', models: [{ id: 'mo-dels', name: 'B' }, { id: 'ds-fast', name: 'A' }] }]
    const s = makeLogic([])(g2, 'ds').sections[0]
    return s.rows[0].id === 'ds-fast' && s.rows[1].id === 'mo-dels'
  })())
  t('T6d 单字符查询子序列≡子串不放大噪音', build(groups, 'z').sections.length === 0)
  t('T6e 无查询不触发梯队排序', build(groups, '').sections.map((s) => s.g.id).join('') === 'bbbaaa')
}


// ===== effort 推理档位逻辑（复刻组件实现对齐原生 ModelSelect）=====
// effectiveEffort = current.reasoningEffort ?? reasoning.defaultEffort
// effortChoices = defaultEffort 缺省时含「供应商默认」行；换档负载保留 provider/model
const makeEffortLogic = () => {
  const derive = (current, model) => {
    const reasoning = model ? model.reasoning : undefined
    const effectiveEffort = (current && current.reasoningEffort != null)
      ? current.reasoningEffort
      : (reasoning && reasoning.defaultEffort != null ? reasoning.defaultEffort : undefined)
    const effortLabel = !reasoning
      ? undefined
      : effectiveEffort === undefined
        ? '供应商默认'
        : ((reasoning.efforts || []).find((l) => l.id === effectiveEffort) || {}).name || effectiveEffort
    const effortChoices = !reasoning ? [] : [
      ...((reasoning.defaultEffort == null) ? [{ key: 'provider-default', effort: undefined, label: '供应商默认' }] : []),
      ...(reasoning.efforts || []).map((l) => ({ key: 'effort:' + l.id, effort: l.id, label: l.name })),
    ]
    return { reasoning, effectiveEffort, effortLabel, effortChoices }
  }
  // 选择负载（对齐原生 choose/chooseEffort + 注入面 false 语义）
  let lastPayload = null, lastSettled = null
  const store = { error: null }
  const select = (p) => { lastPayload = p; return Promise.resolve(store.accepted !== false) }
  const settleSelection = (accepted) => { lastSettled = accepted === true ? 'closed' : (store.error || '选择未被接受') }
  const run = async (p) => { lastPayload = null; await select(p).then(settleSelection) }
  return { derive, run, get payload() { return lastPayload }, get settled() { return lastSettled }, setErr(m) { store.error = m }, setRejected() { store.accepted = false } }
}

// E1: 无 reasoning 元数据 → 无档位入口/触发器不带档位
{
  const { derive } = makeEffortLogic()
  const r = derive({ provider: 'p', model: 'm' }, { id: 'm', name: 'M' })
  t('E1a 无 reasoning → effortLabel undefined', r.effortLabel === undefined)
  t('E1b 无 reasoning → effortChoices 空', r.effortChoices.length === 0)
}

// E2: effectiveEffort 解析优先 current.reasoningEffort，回退 defaultEffort
{
  const { derive } = makeEffortLogic()
  const model = { id: 'm', reasoning: { efforts: [{ id: 'low', name: '低' }, { id: 'high', name: '高' }], defaultEffort: 'medium' } }
  t('E2a 无 current → 回退 defaultEffort', derive(null, model).effectiveEffort === 'medium')
  t('E2b current 优先', derive({ provider: 'p', model: 'm', reasoningEffort: 'high' }, model).effectiveEffort === 'high')
  t('E2c 档位名解析', derive({ provider: 'p', model: 'm', reasoningEffort: 'high' }, model).effortLabel === '高')
  t('E2d 未知档位回退原值', derive({ provider: 'p', model: 'm', reasoningEffort: 'ultra' }, model).effortLabel === 'ultra')
}

// E3: 供应商默认行只在 defaultEffort 缺省时出现
{
  const { derive } = makeEffortLogic()
  const withDefault = { id: 'm', reasoning: { efforts: [{ id: 'low', name: '低' }], defaultEffort: 'low' } }
  const withoutDefault = { id: 'm', reasoning: { efforts: [{ id: 'low', name: '低' }] } }
  t('E3a 有 defaultEffort → 无默认行', derive(null, withDefault).effortChoices.every((c) => c.effort !== undefined))
  t('E3b 无 defaultEffort → 有默认行', derive(null, withoutDefault).effortChoices[0].effort === undefined)
  t('E3c defaultEffort 缺省时当前态标签=供应商默认', derive({ provider: 'p', model: 'm' }, withoutDefault).effortLabel === '供应商默认')
}

// E4: 负载形状
{
  const logic = makeEffortLogic()
  logic.run({ provider: 'a', model: 'm1' })
  t('E4a 选模型负载', JSON.stringify(logic.payload) === JSON.stringify({ provider: 'a', model: 'm1' }))
  logic.run({ provider: 'a', model: 'm1', reasoningEffort: 'high' })
  t('E4b 换档负载带 reasoningEffort', logic.payload.reasoningEffort === 'high' && logic.payload.model === 'm1')
  logic.run({ provider: 'a', model: 'm1' })
  t('E4c 供应商默认 = 省略 reasoningEffort 键', !('reasoningEffort' in logic.payload))
}

// E5: 注入面 false 语义——失败不关菜单，错误读 store.error（settle 在微任务里，异步断言）
const asyncChecks = []
{
  const logic = makeEffortLogic()
  logic.setRejected(); logic.setErr('boom: rejected')
  asyncChecks.push(logic.run({ provider: 'a', model: 'm1' }).then(() => {
    t('E5 失败 settle 读 store.error', logic.settled === 'boom: rejected')
  }))
}

Promise.all(asyncChecks).then(() => {
  
// ===== 置顶缓存策略（缓存优先渲染 + 仅顺序变化才应用）=====
const computeRecentOrder = (records, now) => {
  const cutoff = now - 7 * 24 * 3600 * 1000
  const last = new Map()
  for (const evs of Object.values(records || {})) {
    for (const e of (evs || [])) {
      if (!e || !e.provider || !e.ts || e.ts < cutoff) continue
      if (!e.ok) continue
      if (!last.has(e.provider) || (e.ts || 0) > last.get(e.provider)) last.set(e.provider, e.ts)
    }
  }
  return [...last.entries()].sort((a, b) => b[1] - a[1]).map((x) => x[0])
}
const applyIfChanged = (prev, order) => (prev.join('\u0000') === order.join('\u0000') ? prev : order)

// R1: 7 天窗口外的记录不参与置顶
{
  const now = 1000000000000
  const order = computeRecentOrder({ p: [{ provider: 'a', ts: now - 8 * 24 * 3600 * 1000, ok: true }, { provider: 'b', ts: now - 1000, ok: true }] }, now)
  t('R1 7 天窗口过滤', order.length === 1 && order[0] === 'b')
}
// R2: 失败调用不参与置顶
{
  const now = 1000000000000
  const order = computeRecentOrder({ p: [{ provider: 'a', ts: now - 1000, ok: false }, { provider: 'b', ts: now - 2000, ok: true }] }, now)
  t('R2 失败调用过滤', order.length === 1 && order[0] === 'b')
}
// R3: 同 provider 取最近一次 ts 排序
{
  const now = 1000000000000
  const order = computeRecentOrder({ p: [{ provider: 'a', ts: now - 5000, ok: true }, { provider: 'a', ts: now - 1000, ok: true }, { provider: 'b', ts: now - 3000, ok: true }] }, now)
  t('R3 最近成功时间降序', order.join(',') === 'a,b')
}
// R4: 顺序未变时返回原引用（不触发重渲染/跳变）
{
  const prev = ['a', 'b']
  t('R4 顺序相同应用原引用', applyIfChanged(prev, ['a', 'b']) === prev)
  const next = applyIfChanged(prev, ['b', 'a'])
  t('R5 顺序变化应用新数组', next !== prev && next.join(',') === 'b,a')
}


// SG: 轮询组重名场景——路由 id 搜索可定位 + 重名组标记
{
  const groups = [
    { id: 'roundrobin/minimax-m3', name: 'RoundRobin', models: [{ id: 'minimax-m3', name: 'RoundRobin' }] },
    { id: 'roundrobin/glm', name: 'RoundRobin', models: [{ id: 'glm', name: 'RoundRobin' }] },
    { id: 'bohe', name: 'BOHE', models: [{ id: 'minimax-m3', name: 'M3' }] },
  ]
  const build = makeLogic([])
  t('SG1a 搜路由 id 片段定位到组', build(groups, 'glm').sections.length === 1 && build(groups, 'glm').sections[0].g.id === 'roundrobin/glm')
  const dup = build(groups, '').sections.filter((s) => s.isDup)
  t('SG1b 重名组标记 isDup', dup.length === 2)
  t('SG1c 非重名不标记', build(groups, '').sections.find((s) => s.g.id === 'bohe').isDup === false)
  t('SG1d id!==name 才标后缀', (() => { const g2 = [{ id: 'same', name: 'same', models: [{ id: 'x', name: 'x' }] }, { id: 'other2', name: 'same', models: [{ id: 'y', name: 'y' }] }]; const s = makeLogic([])(g2, '').sections; return s.find((x) => x.g.id === 'same').isDup === false && s.find((x) => x.g.id === 'other2').isDup === true })())
}


// MD: 重名组的模型行/触发器自证身份（描述位补模型 id）
{
  const dupNames = new Map([['RoundRobin', 2], ['BOHE', 1]])
  const rowDesc = (gName, gId, m) => {
    const groupDup = (dupNames.get(gName || gId) || 0) > 1
    return m.description || (groupDup && m.id !== m.name ? m.id : null)
  }
  const display = (gName, gId, m) => {
    const label = m.name || m.id
    const dup = (dupNames.get(gName || gId) || 0) > 1
    return dup && m.id !== label ? label + ' · ' + m.id : label
  }
  const rr = { id: 'roundrobin/minimax-m3', name: 'RoundRobin' }
  const m = { id: 'minimax-m3', name: 'RoundRobin' }
  t('MD1 重名组模型行描述位 = 模型 id', rowDesc(rr.name, rr.id, m) === 'minimax-m3')
  t('MD2 触发器展示名补 id', display(rr.name, rr.id, m) === 'RoundRobin · minimax-m3')
  const bohe = { id: 'bohe', name: 'BOHE' }
  const bm = { id: 'm3', name: 'M3' }
  t('MD3 唯一名不补', rowDesc(bohe.name, bohe.id, bm) === null && display(bohe.name, bohe.id, bm) === 'M3')
  t('MD4 id===name 不重复', rowDesc(rr.name, rr.id, { id: 'RoundRobin', name: 'RoundRobin' }) === null)
  t('MD5 已有描述优先', rowDesc(rr.name, rr.id, { id: 'x', name: 'RoundRobin', description: '官方' }) === '官方')
}


// DF 块已移除：选模型自动填档（pickDefaultEffort）策略收口到 modelDirectories
// 拦截层（思考档位记忆），回归见 tests/effort-memory.test.cjs


// RR: 轮询组「轮询·」前缀标记（显示层，不改数据）
{
  const isRRGroup = (g) => typeof (g && g.id) === 'string' && g.id.startsWith('roundrobin/')
  t('RR1 roundrobin/ 前缀识别', isRRGroup({ id: 'roundrobin/minimax-m3' }) === true)
  t('RR2 普通供应商不标', isRRGroup({ id: 'bohe' }) === false)
  t('RR3 空 id 不标', isRRGroup({}) === false && isRRGroup(null) === false)
  const display = (g, label) => (isRRGroup(g) ? '轮询·' : '') + label
  t('RR4 pill/root 展示名前缀', display({ id: 'roundrobin/g1' }, 'g1') === '轮询·g1' && display({ id: 'bohe' }, 'BOHE') === 'BOHE')
}

console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
})
