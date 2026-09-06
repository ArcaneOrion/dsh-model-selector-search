/** @arcaneorion/dsh-model-selector-search — 独立 client 插件：会话模型选择器（搜索增强）。
 * 从 model-channel-manager 拆出（DSH 理念：一个占座者一个插件单元，可独立启停/替换）。
 * 仅遮蔽原生 conversation.input.model 座位（priority -1 < 原生 0，lowest renders），
 * 复刻 ui-model-selection 的 inject 契约（available/directory/load/select），
 * 数据流与原生 /model 弹窗共享同一 SnapshotStore。
 * 布局/交互对齐原生 ModelSelect（38px 两行行、sticky 组头、菜单材质 token、
 * 触发器胶囊、chevron 120ms），选择负载与原生逐字段一致。
 * 「近 7 天置顶」经 settings 公共 seam 读 model-channel-health；打开菜单先用缓存
 * 即时渲染、后台刷新且仅在顺序变化时应用（消除打开跳变）；无数据时优雅降级。
 */
window.__ModuleLoader__.load({
  id: '@arcaneorion/dsh-model-selector-search',
  factory: (require) => {
    const { createElement: el, useState, useEffect, useRef, useMemo, useSyncExternalStore } = require('react')
    let apiRef = null

    const CSS = `
.mcm-sel-root { position:relative; min-width:0; }
/* 触发器：对齐原生 ToggleButton 胶囊——28px、无边框透明、13/20/500 secondary */
.mcm-sel-trigger { box-sizing:border-box; display:flex; align-items:center; gap:4px; min-width:0; max-width:min(360px, 45cqw); height:28px; padding:0 4px 0 8px; border:none; border-radius:24px; outline:none; background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:13px; line-height:20px; font-weight:500; cursor:pointer; transition:background-color 0.12s ease; }
.mcm-sel-trigger:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
.mcm-sel-trigger:focus-visible { box-shadow:0 0 0 2px var(--dsw-alias-border-l3); }
.mcm-sel-trigger:disabled { color:var(--dsw-alias-label-dimmed); cursor:default; }
.mcm-sel-trigger-label { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.mcm-sel-trigger-eff { flex:0 0 auto; color:var(--dsw-alias-label-caption); }
.mcm-sel-caret { flex:0 0 auto; color:var(--dsw-alias-label-caption); transition:transform 120ms ease; }
/* 座位固定在底部 composer：菜单必须向上展开（top 向下弹会整体落到视口外，实测踩坑）。
   材质对齐 ui-primitives Menu 卡片：specific-menu 面 + lv3 阴影 + inverted 边框。 */
.mcm-sel-menu { position:absolute; right:0; bottom:calc(100% + 8px); z-index:1200; display:flex; flex-direction:column; width:max-content; min-width:min(280px, calc(100vw - 32px)); max-width:min(420px, calc(100vw - 32px)); max-height:min(420px, calc(100vh - 96px)); overflow:hidden; padding:4px; border:1px solid var(--dsw-alias-border-inverted); border-radius:12px; background:var(--dsw-specific-menu); box-shadow:var(--dsw-shadow-lv3); color:var(--dsw-alias-label-primary); --dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2); --dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2); }
.mcm-sel-search { display:flex; gap:6px; align-items:center; padding:2px 4px 6px; border-bottom:1px solid var(--dsw-alias-border-l1); margin-bottom:2px; flex-shrink:0; }
.mcm-sel-search input { flex:1; box-sizing:border-box; min-width:200px; border:1px solid var(--dsw-alias-border-l2); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); border-radius:8px; height:30px; padding:0 10px; font:inherit; font-size:12px; outline:none; }
.mcm-sel-search input:focus { border-color:var(--dsw-alias-brand-primary); }
.mcm-sel-clear { border:none; background:none; color:var(--dsw-alias-label-tertiary); cursor:pointer; font-size:12px; padding:2px 4px; }
.mcm-sel-clear:hover { color:var(--dsw-alias-label-primary); }
.mcm-sel-list { min-height:0; overflow-y:auto; overscroll-behavior:contain; }
/* 组头：sticky 钉在滚动容器顶部（对齐原生 groupTitle） */
.mcm-sel-group { position:sticky; top:0; z-index:1; padding:5px 8px 3px; background:var(--dsw-specific-menu); color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:18px; font-weight:500; display:flex; align-items:center; gap:6px; min-width:0; }
.mcm-sel-group-id { flex:0 1 auto; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--dsw-alias-label-dimmed); font-size:10px; font-weight:400; font-family:var(--ds-font-family-code); }
.mcm-sel-group + * { margin-top:0; }
.mcm-sel-recent { color:var(--dsw-alias-brand-primary); font-size:10px; font-weight:500; }
/* 模型行：38px 两行式——名称 14/20/500，描述 12/18 tertiary 排名称下方；
   选中态对齐原生：无填充，只靠尾部 ✓ */
.mcm-sel-opt { box-sizing:border-box; display:flex; align-items:center; gap:8px; width:auto; min-width:100%; min-height:38px; padding:6px 8px; border:none; border-radius:10px; background:transparent; color:inherit; font:inherit; text-align:left; cursor:pointer; }
.mcm-sel-opt:hover:not(:disabled), .mcm-sel-opt:focus-visible { background:var(--dsw-alias-interactive-bg-hover); }
.mcm-sel-opt:disabled { color:var(--dsw-alias-label-dimmed); cursor:default; }
.mcm-sel-copy { display:flex; flex:1; flex-direction:column; min-width:0; }
.mcm-sel-name { overflow:hidden; color:inherit; font-size:14px; line-height:20px; font-weight:500; text-overflow:ellipsis; white-space:nowrap; }
.mcm-sel-desc { overflow:hidden; color:var(--dsw-alias-label-tertiary); font-size:12px; line-height:18px; text-overflow:ellipsis; white-space:nowrap; }
.mcm-sel-check { display:grid; place-items:center; flex:0 0 18px; color:var(--dsw-alias-label-primary); font-size:12px; }
.mcm-sel-hl { color:var(--dsw-alias-brand-primary); font-weight:600; }
.mcm-sel-rrtag { color:var(--dsw-alias-brand-primary); font-size:10px; font-weight:500; flex-shrink:0; }
/* 档位入口行：对齐原生 .cell——40px、label 左 / 当前档右对齐 tertiary、右 chevron */
.mcm-sel-effrow { box-sizing:border-box; display:flex; align-items:center; gap:8px; width:auto; min-width:100%; height:40px; padding:0 10px; border:none; border-radius:10px; background:transparent; color:var(--dsw-alias-label-primary); font:inherit; font-size:14px; line-height:22px; cursor:pointer; text-align:left; }
.mcm-sel-effrow:hover { background:var(--dsw-alias-interactive-bg-hover); }
.mcm-sel-effrow-label { flex:0 0 auto; white-space:nowrap; }
.mcm-sel-effrow-value { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:right; color:var(--dsw-alias-label-tertiary); }
.mcm-sel-effrow-caret { flex:0 0 auto; color:var(--dsw-alias-label-tertiary); }
/* root 面板入口行：对齐原生 .cell——40px、14/22、label 左 / 值右对齐 tertiary、右 chevron */
.mcm-sel-cell { box-sizing:border-box; display:flex; align-items:center; gap:8px; width:auto; min-width:100%; height:40px; padding:0 10px; border:none; border-radius:10px; background:transparent; color:var(--dsw-alias-label-primary); font:inherit; font-size:14px; line-height:22px; cursor:pointer; text-align:left; }
.mcm-sel-cell:hover { background:var(--dsw-alias-interactive-bg-hover); }
.mcm-sel-cell-label { flex:0 0 auto; white-space:nowrap; }
.mcm-sel-cell-value { flex:1 1 auto; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; text-align:right; color:var(--dsw-alias-label-tertiary); }
.mcm-sel-cell-chevron { flex:0 0 auto; color:var(--dsw-alias-label-tertiary); }
/* 返回行 / 状态条：对齐原生 .cell 高度与 .status/.error token */
.mcm-sel-back { box-sizing:border-box; display:flex; align-items:center; gap:6px; width:auto; min-width:100%; height:32px; padding:0 10px; border:none; border-radius:10px; background:transparent; color:var(--dsw-alias-label-secondary); font:inherit; font-size:13px; cursor:pointer; text-align:left; }
.mcm-sel-back:hover { background:var(--dsw-alias-interactive-bg-hover); color:var(--dsw-alias-label-primary); }
.mcm-sel-failrow { display:flex; align-items:center; gap:6px; margin:0 4px 4px; padding:7px 8px; border-radius:8px; background:var(--dsw-alias-bg-module-platform); color:var(--dsw-alias-state-warn-label); font-size:12px; line-height:18px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.mcm-sel-error { margin:0 4px 4px; padding:7px 8px; border-radius:8px; background:var(--dsw-alias-interactive-bg-hover-danger); color:var(--dsw-alias-state-error-primary); font-size:12px; line-height:18px; }
.mcm-sel-status { padding:10px; color:var(--dsw-alias-label-tertiary); font-size:13px; line-height:20px; text-align:center; }
.mcm-sel-foot { display:flex; justify-content:space-between; gap:8px; padding:4px 8px 2px; color:var(--dsw-alias-label-caption); font-size:10px; flex-shrink:0; }
`

    // 置顶数据源：model-channel-health records 最近 7 天成功调用的 provider，按 lastTs 降序去重。
    // 打开菜单先用缓存即时渲染（不阻塞、不跳变）；后台刷新且仅在顺序真正变化时应用；
    // 缓存 2 分钟内不重复打 RPC。
    let selHealthCache = { at: 0, order: [] }
    const RECENT_TTL = 120000
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
    const refreshRecent = (onOrder) => {
      if (!apiRef || !apiRef.settings || typeof apiRef.settings.describe !== 'function') return
      apiRef.settings.describe({}).then((resp) => {
        const r = resp && resp.result ? resp.result : resp
        if (r && r.ok === false) return
        const d = r && r.value !== undefined ? r.value : r
        const hn = ((d && d.namespaces) || []).find((n) => n && n.ns === 'model-channel-health')
        const order = computeRecentOrder((hn && hn.value && hn.value.records) || {}, Date.now())
        selHealthCache = { at: Date.now(), order }
        if (onOrder) onOrder(order)
      }).catch(() => {})
    }

    // 高亮匹配片段：返回 children 数组（文本 + 高亮 span）
    const hlParts = (text, q) => {
      if (!q || !text) return [text]
      const s = String(text)
      const i = s.toLowerCase().indexOf(q)
      if (i < 0) return [s]
      return [s.slice(0, i), el('span', { className: 'mcm-sel-hl' }, s.slice(i, i + q.length)), s.slice(i + q.length)]
    }

    // 轮询组标记：model-channel-manager 的虚拟路由 id 以 roundrobin/ 开头。
    // 显示层加「轮询·」前缀（组头/模型行/pill），不改目录数据——原生 /model 弹窗不受影响
    const RR_PREFIX = 'roundrobin/'
    const isRRGroup = (g) => typeof (g && g.id) === 'string' && g.id.startsWith(RR_PREFIX)
    const rrTag = () => el('span', { className: 'mcm-sel-rrtag' }, '轮询·')

    function SearchModelSelect(props) {
      const available = props.available !== false
      const directory = props.directory
      const load = props.load
      const select = props.select
      const locked = props.locked === true
      const useStore = (directory && typeof directory.subscribe === 'function' && typeof directory.getSnapshot === 'function') ? directory : null
      // directory 缺失时用哑 store 兜底：uSES 的 subscribe/getSnapshot 是惰性调用的，
      // 传 null 会当场 TypeError（slot entry crashed）——哑 store 保持 hooks 顺序合法，
      // 组件体后续对 useStore 为 null 的分支直接返回 null
      const dummyStore = { subscribe: () => () => {}, getSnapshot: () => ({ groups: [], current: null, status: 'idle', failures: [], error: null, routable: null }) }
      const safeStore = useStore || dummyStore
      const state = useSyncExternalStore((fn) => safeStore.subscribe(fn), () => safeStore.getSnapshot())
      const [open, setOpen] = useState(false)
      const [q, setQ] = useState('')
      const [recent, setRecent] = useState([])
      const [pane, setPane] = useState('root') // 'root' | 'models' | 'effort'（对齐原生两级 root 面板）
      const [selError, setSelError] = useState(null)
      const rootRef = useRef(null)
      const searchRef = useRef(null)
      const listRef = useRef(null)
      // 最近动作（对齐原生 lastActionRef）：决定 status==='error' 是「目录加载失败」
      // （整页错误）还是「选择失败」（列表保留，只显示错误行）——directory.select 失败
      // 也会把 store.status 置成 'error'
      const lastActionRef = useRef('load')
      const qLower = q.trim().toLowerCase()

      // 挂载/换会话即加载目录：pill 立刻显示会话当前模型（含继承的默认），
      // 而不是等首次打开菜单后才从「模型」占位变成具体名
      useEffect(() => {
        if (!available) return
        lastActionRef.current = 'load'
        if (load) load()
      }, [available, load])
      // 打开菜单时：置顶用缓存即时渲染（消除打开跳变）；缓存过期才后台刷新；
      // 目录加载 + 复位面板
      useEffect(() => {
        if (!open) return
        if (load) load()
        setRecent(selHealthCache.order)
        if (Date.now() - selHealthCache.at >= RECENT_TTL) {
          refreshRecent((order) => setRecent((prev) => (prev.join('\u0000') === order.join('\u0000') ? prev : order)))
        }
        setPane('root')
        setSelError(null)
      }, [open])
      // 进入模型列表时聚焦搜索框
      useEffect(() => {
        if (open && pane === 'models') queueMicrotask(() => { if (searchRef.current) searchRef.current.focus() })
      }, [open, pane])
      // 外点关闭
      useEffect(() => {
        if (!open) return
        const closeOutside = (e) => { if (rootRef.current && !rootRef.current.contains(e.target)) setOpen(false) }
        document.addEventListener('mousedown', closeOutside)
        return () => document.removeEventListener('mousedown', closeOutside)
      }, [open])
      // 关闭时清空搜索
      useEffect(() => { if (!open) setQ('') }, [open])

      // 全部 hooks 必须在 available 早退之前（hooks 顺序合法性）
      const groups = (state && state.groups) || []
      const current = state && state.current
      const busy = state && state.status === 'selecting'
      // 搜索索引：匹配字段随目录快照预小写，键击过滤不再逐字段 toLowerCase。
      // 组匹配含路由 id（轮询组呈现名可能全部相同，搜 id 片段才能定位到组）
      const matchIndex = useMemo(() => groups.map((g) => ({
        g,
        gname: (g.name || g.id || '').toLowerCase(),
        gid: (g.id || '').toLowerCase(),
        models: (g.models || []).map((m) => ({
          m,
          name: (m.name || '').toLowerCase(),
          id: (m.id || '').toLowerCase(),
          desc: (m.description || '').toLowerCase(),
        })),
      })), [groups])
      // 展示名重复计数：重名组（如多个都叫 RoundRobin 的轮询组）在组头补充路由 id 后缀
      const dupNames = useMemo(() => {
        const counts = new Map()
        for (const g of groups) {
          const n = g.name || g.id
          counts.set(n, (counts.get(n) || 0) + 1)
        }
        return counts
      }, [groups])
      if (!available) return null
      // 渲染体：过滤后的组列表（组名或路由 id 命中显示全组模型=provider 维度搜索意图；
      // 无搜索时全量+置顶标记）
      const sections = []
      for (const gi of matchIndex) {
        const all = gi.models.map((x) => x.m)
        const rows = !qLower
          ? all
          : (gi.gname.includes(qLower) || gi.gid.includes(qLower)
            ? all
            : gi.models.filter((mi) => mi.name.includes(qLower) || mi.id.includes(qLower) || mi.desc.includes(qLower)).map((x) => x.m))
        if (rows.length === 0) continue
        const isTop = !qLower && recent.includes(gi.g.id)
        const isDup = (dupNames.get(gi.g.name || gi.g.id) || 0) > 1
        sections.push({ g: gi.g, rows, isTop, isDup })
      }
      // 置顶重排：仅无搜索时按 recent 顺序提升（未提及的按原序 append）
      let ordered = sections
      if (!qLower && recent.length > 0) {
        const rank = new Map(recent.map((p, i) => [p, i]))
        ordered = sections.slice().sort((a, b) => {
          const ra = rank.has(a.g.id) ? rank.get(a.g.id) : 1e9
          const rb = rank.has(b.g.id) ? rank.get(b.g.id) : 1e9
          return ra - rb
        })
      }
      const currentChoice = (() => {
        for (const g of groups) {
          if (g.id === (current && current.provider)) {
            const m = (g.models || []).find((mm) => mm.id === (current && current.model))
            if (m) return { g, m }
          }
        }
        return null
      })()
      // 推理档位：语义对齐原生 ModelSelect（current.reasoningEffort ?? defaultEffort）
      const reasoning = currentChoice ? currentChoice.m.reasoning : undefined
      const effectiveEffort = (current && current.reasoningEffort != null)
        ? current.reasoningEffort
        : (reasoning && reasoning.defaultEffort != null ? reasoning.defaultEffort : undefined)
      const effortLabel = !reasoning
        ? undefined
        : effectiveEffort === undefined
          ? '供应商默认'
          : ((reasoning.efforts || []).find((l) => l.id === effectiveEffort) || {}).name || effectiveEffort
      // 档位选项：仅当供应商未声明 defaultEffort 时提供「供应商默认」行（提交时不带 reasoningEffort 键）
      const effortChoices = !reasoning ? [] : [
        ...((reasoning.defaultEffort == null) ? [{ key: 'provider-default', effort: undefined, label: '供应商默认', description: '不随请求发送 reasoning_effort' }] : []),
        ...(reasoning.efforts || []).map((l) => ({ key: 'effort:' + l.id, effort: l.id, label: l.name, description: l.description })),
      ]
      const modelLabel = currentChoice ? (currentChoice.m.name || currentChoice.m.id) : '模型'
      // 展示名重复（如多个轮询组都叫 RoundRobin）时，模型行/触发器/root 值都要
      // 能自证身份：补充模型 id（对轮询组即组 id，如 minimax-m3）
      const chosenDup = currentChoice ? (dupNames.get(currentChoice.m.name || currentChoice.m.id) || 0) > 1 : false
      const modelDisplay = (currentChoice && isRRGroup(currentChoice.g) ? '轮询·' : '')
        + (currentChoice && chosenDup && currentChoice.m.id !== modelLabel
          ? modelLabel + ' · ' + currentChoice.m.id
          : modelLabel)
      // 注入面的 select 把失败吞成 false 值（不 reject），错误详情在 store.error——
      // 对齐原生 settleSelection：false 时读 store.error 展示，成功才关菜单
      const settleSelection = (accepted) => {
        if (accepted) { setOpen(false); return }
        const msg = safeStore.getSnapshot().error
        setSelError(msg || '选择未被接受')
      }
      // 选新模型的默认思考档：含 max 用 max，否则取档位列表最高档（末项）；
      // 无 reasoning 元数据不带 effort 键（交供应商默认）。用户多数场景用 max，
      // 免去每次手动调档。
      const pickDefaultEffort = (m) => {
        if (!m || !m.reasoning) return undefined
        const ids = (m.reasoning.efforts || []).map((l) => l.id)
        if (ids.length === 0) return undefined
        return ids.includes('max') ? 'max' : ids[ids.length - 1]
      }
      const choose = (provider, model) => {
        if (current && current.provider === provider && current.model === model) { setOpen(false); return }
        if (!select) return
        setSelError(null)
        lastActionRef.current = 'select'
        const g = groups.find((x) => x.id === provider)
        const m = g && (g.models || []).find((mm) => mm.id === model)
        const effort = pickDefaultEffort(m)
        const payload = { provider, model }
        if (effort !== undefined) payload.reasoningEffort = effort
        Promise.resolve(select(payload)).then(settleSelection).catch((e) => {
          setSelError(String((e && e.message) || e))
        })
      }
      // 换档：保留当前 provider/model，只改 reasoningEffort；供应商默认 = 省略该键（对齐原生 chooseEffort）
      const chooseEffort = (effort) => {
        if (!current || !select) return
        if (effectiveEffort === effort) { setOpen(false); return }
        setSelError(null)
        lastActionRef.current = 'select'
        const payload = { provider: current.provider, model: current.model }
        if (effort !== undefined) payload.reasoningEffort = effort
        Promise.resolve(select(payload)).then(settleSelection).catch((e) => {
          setSelError(String((e && e.message) || e))
        })
      }
      // 键盘：Escape 从子面板先回 root 面板、再按才关闭（对齐原生）；↑↓ 在列表项间移动焦点
      const onKeyDown = (e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          if (pane !== 'root') setPane('root')
          else setOpen(false)
        }
        else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && listRef.current) {
          e.preventDefault()
          const items = listRef.current.querySelectorAll('.mcm-sel-opt, .mcm-sel-cell')
          const arr = Array.from(items)
          if (arr.length === 0) return
          const active = arr.findIndex((it) => it === document.activeElement)
          const next = (Math.max(active, 0) + (e.key === 'ArrowDown' ? 1 : -1) + arr.length) % arr.length
          arr[next].focus()
        }
      }

      const selErrorNode = selError ? el('div', { className: 'mcm-sel-error' }, '选择失败：' + selError) : null
      const failureRows = (((state && state.failures) || [])).map((f) =>
        el('div', { key: 'fail_' + f.id, className: 'mcm-sel-failrow', title: f.message }, '⚠ ' + (f.name || f.id) + '：' + f.message))
      const modelRow = (g, m, q2) => {
        const sel = current && current.provider === g.id && current.model === m.id
        // 重名组的模型行描述位显示模型 id（自证身份）；已有描述或 id===name 不重复
        const groupDup = (dupNames.get(g.name || g.id) || 0) > 1
        const desc = m.description || (groupDup && m.id !== m.name ? m.id : null)
        return el('button', {
          key: g.id + '::' + m.id, className: 'mcm-sel-opt', type: 'button', role: 'menuitemradio', 'aria-checked': sel,
          title: m.id, disabled: busy,
          onClick: () => choose(g.id, m.id)
        },
          el('span', { className: 'mcm-sel-copy' },
            el('span', { className: 'mcm-sel-name' },
              isRRGroup(g) ? rrTag() : null,
              hlParts(m.name || m.id, q2)),
            desc ? el('span', { className: 'mcm-sel-desc' }, desc) : null
          ),
          sel ? el('span', { className: 'mcm-sel-check' }, '✓') : null
        )
      }

      const modelsChildren = [selErrorNode]
      if (state && state.status === 'loading') {
        modelsChildren.push(el('div', { className: 'mcm-sel-status' }, '加载目录中…'))
      } else if (state && state.status === 'error' && lastActionRef.current === 'load') {
        // 仅「加载目录」失败才整页报错；select 失败同样置 status='error'，但列表要保留
        modelsChildren.push(el('div', { className: 'mcm-sel-status', style: { color: 'var(--dsw-alias-state-error-primary)' } },
          '目录加载失败：' + ((state && state.error) || '未知错误'),
          el('div', { style: { marginTop: 6, fontSize: 11, color: 'var(--dsw-alias-label-tertiary)' } }, '检查 DSH 服务是否在线后重新打开菜单')
        ))
      } else {
        modelsChildren.push(el('button', {
          className: 'mcm-sel-back', type: 'button', onClick: () => setPane('root')
        }, '‹ 返回'))
        modelsChildren.push(...failureRows)
        if (ordered.length === 0) {
          modelsChildren.push(el('div', { className: 'mcm-sel-status' }, qLower ? '无匹配「' + q.trim() + '」的模型' : '暂无可用模型'))
        } else {
          for (const { g, rows, isTop, isDup } of ordered) {
            modelsChildren.push(el('div', { key: g.id },
              el('div', { className: 'mcm-sel-group' },
                isRRGroup(g) ? rrTag() : null,
                el('span', null, hlParts(g.name || g.id, qLower)),
                // 展示名重复的组补充路由 id 后缀（如多个轮询组都叫 RoundRobin）
                isDup && g.id !== g.name ? el('span', { className: 'mcm-sel-group-id', title: g.id }, g.id) : null,
                isTop ? el('span', { className: 'mcm-sel-recent' }, '· 最近') : null
              ),
              rows.map((m) => modelRow(g, m, qLower))
            ))
          }
        }
      }

      const effortChildren = [
        el('button', { className: 'mcm-sel-back', type: 'button', onClick: () => setPane('root') }, '‹ 返回'),
        selErrorNode,
        effortChoices.length === 0
          ? el('div', { className: 'mcm-sel-status' }, '当前模型没有可选的推理档位')
          : effortChoices.map((l) => el('button', {
            key: l.key, className: 'mcm-sel-opt', type: 'button', role: 'menuitemradio', 'aria-checked': effectiveEffort === l.effort,
            disabled: busy, onClick: () => chooseEffort(l.effort)
          },
            el('span', { className: 'mcm-sel-copy' },
              el('span', { className: 'mcm-sel-name' }, l.label),
              l.description ? el('span', { className: 'mcm-sel-desc' }, l.description) : null
            ),
            effectiveEffort === l.effort ? el('span', { className: 'mcm-sel-check' }, '✓') : null
          ))
      ]

      // root 面板：对齐原生两级入口——「模型」在上、「推理档位」在下（仅当前模型有
      // reasoning 元数据时渲染），值右对齐 tertiary，点击钻入子面板
      const rootChildren = [
        el('button', { className: 'mcm-sel-cell', type: 'button', onClick: () => setPane('models') },
          el('span', { className: 'mcm-sel-cell-label' }, '模型'),
          el('span', { className: 'mcm-sel-cell-value' }, modelDisplay),
          el('span', { className: 'mcm-sel-cell-chevron' }, '›')
        ),
        reasoning ? el('button', { className: 'mcm-sel-cell', type: 'button', onClick: () => { setSelError(null); setPane('effort') } },
          el('span', { className: 'mcm-sel-cell-label' }, '推理档位'),
          el('span', { className: 'mcm-sel-cell-value' }, effortLabel || '供应商默认'),
          el('span', { className: 'mcm-sel-cell-chevron' }, '›')
        ) : null,
      ]

      return el('div', { className: 'mcm-sel-root', ref: rootRef, onKeyDown },
        el('button', {
          className: 'mcm-sel-trigger', type: 'button', disabled: locked, title: effortLabel !== undefined ? modelDisplay + ' · ' + effortLabel : modelDisplay,
          'aria-haspopup': 'menu', 'aria-expanded': open,
          onClick: () => setOpen((v) => !v)
        },
          el('span', { className: 'mcm-sel-trigger-label' }, modelDisplay),
          effortLabel !== undefined ? el('span', { className: 'mcm-sel-trigger-eff' }, effortLabel) : null,
          el('span', { className: 'mcm-sel-caret', style: open ? { transform: 'rotate(180deg)' } : undefined }, '▼')
        ),
        open ? el('div', { className: 'mcm-sel-menu', role: 'menu' },
          pane === 'models' ? el('div', { className: 'mcm-sel-search' },
            el('input', {
              ref: searchRef, placeholder: '搜索模型 / 供应商…', value: q,
              onChange: (e) => setQ(e.target.value),
              onKeyDown: (e) => {
                if (e.key === 'Escape') { e.preventDefault(); setPane('root') }
                else if (e.key === 'ArrowDown') { e.preventDefault(); const it = listRef.current && listRef.current.querySelector('.mcm-sel-opt'); if (it) it.focus() }
              }
            }),
            q ? el('button', { className: 'mcm-sel-clear', type: 'button', onClick: () => setQ('') }, '✕') : null
          ) : null,
          el('div', { className: 'mcm-sel-list', ref: listRef },
            pane === 'root' ? rootChildren : pane === 'effort' ? effortChildren : modelsChildren
          ),
          pane !== 'root' ? el('div', { className: 'mcm-sel-foot' },
            el('span', null, pane === 'effort'
              ? '推理档位 · ' + modelDisplay
              : sections.reduce((n, s) => n + s.rows.length, 0) + ' 个模型'),
            el('span', null, pane === 'models' && recent.length > 0 && !qLower ? '置顶：近 7 天使用' : '')
          ) : null
        ) : null
      )
    }

    function apply(ctx) {
      const connection = ctx.get('connection')
      apiRef = connection && connection.api ? connection.api : null
      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.mcmStyle = ''
        tag.textContent = CSS
        document.head.appendChild(tag)
        return () => tag.remove()
      }, 'model-selector: styles')
      // 空闲预热置顶缓存：首次打开菜单大概率已有数据，不打断渲染
      if (apiRef) setTimeout(() => refreshRecent(), 8000)
      const slots = ctx.get('slots')
      if (!slots) return
      // 会话模型选择器座位替换。契约要点（实测踩坑沉淀）：
      // 1. conversation.input.model 是 single slot，cell = slot 本身；原生无 priority（= 0），
      //    同名注册不传 priority → exact-priority 撞格直接抛错 → 插件加载失败。同 cell 按
      //    priority 升序、数值最小者渲染，遮蔽原生必须传负数（-1）。slot-catalog 的
      //    「Do NOT pass priority」只适用于动态包（guard 自动分配）；静态 bundle 必须自己传。
      // 2. injected face 来自注册 options 的 inject 字段（renderer 的 runInject 读 entry.inject）：
      //    不传 → directory/load/select 全空 → uSES 崩 → slot entry crashed。
      //    必须复刻原生 ui-model-selection 的 inject 契约。
      // 3. modelDirectories/sessions 是 context 仓库服务（ui-model-selection 注册的全局键），
      //    静态 bundle 同树可 get。
      ctx.inject(['modelDirectories', 'sessions'], (scope) => {
        const models = scope.get('modelDirectories')
        const sessions = scope.get('sessions')
        if (!models || !sessions) return
        slots.inject('conversation.input.model', () => slots.register(
          {
            name: 'conversation.input.model',
            id: 'mcm-selector-search',
            priority: -1,
            inject: (sessionId) => {
              const directory = models.directoryFor(sessionId)
              const available = sessions.subagentAddress(sessionId) === undefined
              return {
                available,
                directory: directory.store,
                load: () => {
                  if (available) directory.load().catch(() => { /* surfaced on the store */ })
                },
                select: (selection) => available
                  ? directory.select(selection).then(() => true, () => false)
                  : Promise.resolve(false),
              }
            },
          },
          (p) => el(SearchModelSelect, p)
        ))
      })
    }

    return { name: 'model-selector-search', inject: ['slots', 'connection'], apply }
  },
})
