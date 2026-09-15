# @arcaneorion/dsh-model-selector-search

DSH 会话模型选择器（搜索增强），**独立 cordis client 插件**。替换原生 `conversation.input.model` 座位（`priority: -1` 遮蔽原生 0，官方 shadows-shipped-ui 路径），提供：

- **布局对齐原生 ModelSelect**：38px 两行行（名称 14/500 + 描述 tertiary 换行）、选中无填充只留尾部 ✓、sticky 分组头、菜单卡片用原生 Menu 材质 token（specific-menu 面 + lv3 阴影 + 自适应宽度 min 240/max 420）、触发器 28px 无边框胶囊 + chevron 120ms
- 搜索框：模型名 / id / 描述 / 供应商名（含**路由 id**，轮询组呈现名可能全部相同）**两段式宽松匹配**——先归一化子串（小写 + 去分隔符 `-`/`_`/`.`/`/`/空格，「glm53」命中「GLM-5.3」），未命中再退**子序列**兜底（fzf 式按序不连续，「ds」命中「DeepSeek」）；有查询时命中组按梯队稳定排序（子串命中组在前，组内模型行同样子串优先）；纯分隔符查询视为无搜索；匹配片段高亮仅对原始子串命中生效（归一化/子序列才命中的不高亮）；组名或 id 命中时显示全组模型；匹配字段随目录快照预归一化（useMemo）
- **轮询组标记**：model-channel-manager 的虚拟路由（id 以 `roundrobin/` 开头）在组头、模型行、pill/root 展示名统一加「轮询·」品牌色前缀（显示层标记，不改目录数据，原生 /model 弹窗不受影响）
- **展示名重复消歧**：多个组重名（如多个轮询组都叫 RoundRobin）时，组头自动补充路由 id 后缀（等宽小字）；组 id 与展示名相同时不重复显示
- **结构对齐原生三级面板**：打开先见 root 两行入口（「模型」/「推理档位」，推理档位在底部、仅当前模型有 reasoning 元数据时渲染，原生 .cell 40px 样式）→ 钻入模型列表（搜索在这里）或档位子列表（「供应商默认」行仅在未声明 defaultEffort 时出现）；Escape 从子面板回 root 再关闭；负载对齐原生——选模型 `{provider, model}`，换档保留 provider/model 只带 `reasoningEffort`，供应商默认省略该键；触发器显示「模型名 · 档位」
- 失败可见化：`failures` 每供应商警告行；选择被拒（注入面 false）时读 store.error 在菜单内显示，列表保留（load 失败才整页报错，用 lastAction 区分——select 失败也会把 status 置 error）
- 置顶：近 7 天健康流水最近成功调用的 provider 按 lastTs 降序去重。**缓存优先**：打开菜单先用缓存即时渲染（无 RPC 阻塞、无重排跳变）；缓存超 2 分钟才后台刷新且仅在顺序变化时应用；插件挂载 8s 后空闲预热
- **思考档位记忆**：包装 `modelDirectories` 服务实例的 `directoryFor(...).select`（原生 `/model` 弹窗与 composer 座位的共同 seam，原生代码零改动）——**选模型 = 该模型上次显式档位 ?? max**（无 max 声明取最高声明档）；显式换档（≠ 声明 defaultEffort）在选择**成功后**写入记忆，选择失败不污染；记忆值须仍在模型声明档位集内，配置变更后失效回落 max。本插件 `choose()` 不再自动填档（策略统一收口在拦截层，「未填档位」即自动语义）。原生弹窗对新模型自动填 `defaultEffort` 的行为在此归一为同一策略
- a11y：Escape / 外点关闭（effort 面板先返回模型列表）、↑↓ 列表导航、aria-haspopup / expanded / menuitemradio
- 菜单**向上展开**（座位固定在底部 composer，向下弹会整体落到视口外——从 model-channel-manager 拆出时修复）；列表 `overscroll-behavior: contain` 滚动不穿透

## 为什么是独立插件

DSH 理念：一切皆插件、slots 即替换 seam、每个占座者一个独立单元。此前选择器耦合在 model-channel-manager 的 client bundle 里（同一个 apply 同时注册 `conversation.view` 页签与座位遮蔽），导致无法独立启停/替换。拆出后：

- 只依赖 `inject: ['slots', 'connection']`（+ `ctx.inject(['modelDirectories','sessions'])` 拿原生目录服务）
- 禁用本插件 → 原生选择器自动回归（原生 priority 0 重新成为 lowest）
- 后续任何插件可用更小 priority 再遮蔽本插件，替换链成立

## 数据通道（全走公共 seam）

- 目录数据流 = 复刻原生 ui-model-selection 的 inject 契约：`inject(sessionId)` 返回 `{available, directory: directoryFor(sessionId).store, load, select}`——injected face 来自**注册 options 的 inject 字段**，不传 → directory null → uSES 崩（踩坑 #20）
- 置顶 = `api.settings.describe()` 过滤 `model-channel-health` 命名空间。该 ns 由 model-channel-manager（host 半）写入；**不存在时优雅降级为不置顶**，本插件不依赖 model-channel-manager 也能独立工作
- 档位记忆 = `model-channels` ns 的 `effortMemory` 字段（`{['provider::model']: effortId}`）。该 ns 已过 apiproxy 白名单（mcm 面板同用它保存轮询组），schema loose 保留未知字段；读写失败静默降级为无记忆（max 兜底不受影响）。档位写路径本身仍是 `directory.select` → `sessions.selectModel`（per-session，host 单一事实源），记忆层只改写/旁听负载

## 挂载

从 npm 装（发布版）：

```bash
dsh plugin --profile web add @arcaneorion/dsh-model-selector-search
# 然后重启 dsh --profile web 并刷新页面
```

本地开发用 `link:`（改源码即时生效）——`~/.dsh/profiles/web/package.json`：
- `dependencies` 加 `"@arcaneorion/dsh-model-selector-search": "link:/home/arcaneorion/AI/AI-DSH/plugin/model-selector-search"`
- `dsh.profile.bundles` 加 `"@arcaneorion/dsh-model-selector-search"`
- `pnpm install` 后重启 `dsh --profile web`

client-only 插件：无 host 半、无 cordis.patch.yml（client-modules 经 `exports['./client']` 自动扫描挂载）。

## 兼容性（DSH 版本）

本包在 **DSH `0.1.1-rc.2`**（`dsh --version`）上开发与实测，宿主侧依赖按该版本**精确钉住**：

| 宿主包 | 声明 | 用途 |
|---|---|---|
| `@deepseek-ai/dsh-client-ui-model-selection` | `0.1.1-rc.2` | 复刻其 `inject(sessionId)` 契约、包装 `modelDirectories.directoryFor().select`（档位记忆拦截层） |
| `@deepseek-ai/dsh-client-ui-conversation` | `0.1.1-rc.2` | 座位 `conversation.input.model`（`priority: -1` 遮蔽） |
| `@deepseek-ai/dsh-client-connection` | `0.1.1-rc.2` | `settings.describe` 读健康流水（近 7 天置顶、档位记忆） |
| `@deepseek-ai/cordis` | `^4.0.2` | 插件生命周期 |
| `react` | `^18.3.1` | client 半 `require('react')`（平台模块表键名） |

本插件是最吃宿主契约的一个：它刻意贴着 `dsh-client-ui-model-selection` 的 private-ish seam 工作，
**跨 DSH 版本最先失效的就是它**。换版本请先跑一遍「打开菜单 / 搜索 / 换档记忆」再放宽 peer。

## 已知边界

- /model 弹窗入口仍是原生平铺（其选择负载经本插件拦截层归一档位策略，弹窗 UI 未改）
- 选择失败提示为菜单内错误行（原生是锚定 composer 的 Toast）
- 置顶数据源是真实渠道 provider；`roundrobin/<组>` 虚拟路由自身不入健康流水，虚拟组不会出现在「最近」置顶
- **显式选「声明 defaultEffort 同值」会被当作自动**（原生弹窗负载不可区分）：该选择被改写为记忆 ?? max 且不入记忆。轮询组 defaultEffort=max 时选 max 本就是目标值，无感知；其他模型若需锁声明默认值，请改其声明
- 记忆按 `provider::model` 键：mcm 面板重命名 provider 后旧键失配 → 回落 max（与历史健康流水同理，不随改名迁移）
- 停用本插件：记忆失效；轮询组仍因 mcm 声明 defaultEffort=max 而默认 max，真实模型回到原生 defaultEffort 行为
- 依赖 `modelDirectories.directoryFor` 服务面 seam：原生重构该方法需重审（包装带 `__mcmEffortMemWrapped` 幂等标记 + WeakSet 防重复包）

## 测试

```
node tests/search-select.test.cjs   # 置顶排序/过滤四维/7 天聚合/组名全组显示（10 用例）
node tests/slot-priority.test.cjs   # 复刻 ui-slots SlotCore occupancy + 选举语义（4 用例，T4 静态断言本包源码）
node tests/effort-memory.test.cjs   # 档位记忆：augmentRule 纯逻辑（显式放行/自动改写/记忆校验/回落）+ seam 静态断言
```

## 踩坑速记

1. **single slot 换占必须传负 priority**：同 cell 多 entry 按 priority 升序、数值最小者渲染；原生 = 0，插件传 `-1`。同 id/同 cell + 同 priority 精确撞格直接抛错 → 整插件加载失败。mock 验证不暴露（mock 的 register 不做 occupancy 检查）——必须复刻真实 SlotCore 语义（tests/slot-priority.test.cjs）。
2. **注册必须补 inject 契约**：injected face 读的是注册 options 的 inject，与 slot 声明无关；缺失 → directory null → `useSyncExternalStore` 当场 TypeError → slot entry crashed，且原生已被遮蔽、无 fallback，座位整体消失。
3. **菜单方向**：座位在底部 composer，CSS 用 `bottom: calc(100% + 6px)` 向上展开；`top: calc(100% + 6px)` 会把 420px 菜单整体弹到视口外。
4. **目录加载失败必须显式报错**：directory.load 失败时 store 置 `status:'error'` + `error`（`code: message`），组件若不渲染该分支会把连接断开显示成「暂无可用模型」——与「真的没有模型」无法区分（实测：服务器死亡后残留标签页里打开菜单就是空列表）。渲染 `status==='error'` 分支后，断连一目了然。
5. **诊断临时实例必须独立 home**：`DSH_HOME=/tmp/dsh-diag dsh --profile web --no-open --port 3081`。临时实例与主实例共用 `~/.dsh` 时会并发写同一会话日志（appendLines 是 O_APPEND 追加，两进程各自的 seq 计数器交错 → 日志中出现重复 seq → `corrupt session log: seq gap in committed region`，resume 直接拒绝）和同一 `session_projcache.json`。实测踩坑：一次共享 home 的临时实例验证把主实例某会话日志写出了 seq 重复，选择器在该会话内表现为「暂无可用模型」。
6. **/model 弹窗与 pill 是两个选择器，宽松搜索必须打两处**：pill 是本插件 face；`/model` 是原生 commandUi `popupSelect` shell——`register` 同名抛错、`decorate` 只挂 host 目录命令、`filterOptions` 是 shell 模块内部函数（ESM 绑定插件侧改不了），插件 seam 覆盖不到，只能补丁原生。已改两处（2026-09，归一化子串 + 子序列两段式，与本插件同一语义）：① harness 源码 `packages/client/ui-commands/src/client/popup.ts` 的 `filterOptions`（未提交源码补丁，与 apiproxy `PLUGIN_SETTINGS_NAMESPACES` 同模式；`popup.client.spec.ts` 已补宽松断言，vitest 24/24 过）；② 运行时安装产物 `Agent-workerspace/pnpm-packages/node_modules/.pnpm/@deepseek-ai+dsh-client-ui-commands@0.1.1-rc.2_*/lib/client.js`（**pnpm install/升级会冲掉，需按源码重打**）。改后需重启 DSH 生效。
