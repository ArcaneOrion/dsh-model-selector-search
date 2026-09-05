# @arcaneorion/dsh-model-selector-search

DSH 会话模型选择器（搜索增强），**独立 cordis client 插件**。替换原生 `conversation.input.model` 座位（`priority: -1` 遮蔽原生 0，官方 shadows-shipped-ui 路径），提供：

- **布局对齐原生 ModelSelect**：38px 两行行（名称 14/500 + 描述 tertiary 换行）、选中无填充只留尾部 ✓、sticky 分组头、菜单卡片用原生 Menu 材质 token（specific-menu 面 + lv3 阴影 + 自适应宽度 min 240/max 420）、触发器 28px 无边框胶囊 + chevron 120ms
- 搜索框：模型名 / id / 描述 / 供应商名子串匹配（不区分大小写），匹配片段高亮；组名匹配时显示全组模型；匹配字段随目录快照预小写（useMemo）
- **结构对齐原生三级面板**：打开先见 root 两行入口（「模型」/「推理档位」，推理档位在底部、仅当前模型有 reasoning 元数据时渲染，原生 .cell 40px 样式）→ 钻入模型列表（搜索在这里）或档位子列表（「供应商默认」行仅在未声明 defaultEffort 时出现）；Escape 从子面板回 root 再关闭；负载对齐原生——选模型 `{provider, model}`，换档保留 provider/model 只带 `reasoningEffort`，供应商默认省略该键；触发器显示「模型名 · 档位」
- 失败可见化：`failures` 每供应商警告行；选择被拒（注入面 false）时读 store.error 在菜单内显示，列表保留（load 失败才整页报错，用 lastAction 区分——select 失败也会把 status 置 error）
- 置顶：近 7 天健康流水最近成功调用的 provider 按 lastTs 降序去重。**缓存优先**：打开菜单先用缓存即时渲染（无 RPC 阻塞、无重排跳变）；缓存超 2 分钟才后台刷新且仅在顺序变化时应用；插件挂载 8s 后空闲预热
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

## 挂载

`~/.dsh/profiles/web/package.json`：
- `dependencies` 加 `"@arcaneorion/dsh-model-selector-search": "link:/home/arcaneorion/AI/AI-DSH/plugin/model-selector-search"`
- `dsh.profile.bundles` 加 `"@arcaneorion/dsh-model-selector-search"`
- `pnpm install` 后重启 `dsh --profile web`

client-only 插件：无 host 半、无 cordis.patch.yml（client-modules 经 `exports['./client']` 自动扫描挂载）。

## 已知边界

- /model 弹窗入口仍是原生平铺
- 选择失败提示为菜单内错误行（原生是锚定 composer 的 Toast）
- 置顶数据源是真实渠道 provider；`roundrobin/<组>` 虚拟路由自身不入健康流水，虚拟组不会出现在「最近」置顶

## 测试

```
node tests/search-select.test.cjs   # 置顶排序/过滤四维/7 天聚合/组名全组显示（10 用例）
node tests/slot-priority.test.cjs   # 复刻 ui-slots SlotCore occupancy + 选举语义（4 用例，T4 静态断言本包源码）
```

## 踩坑速记

1. **single slot 换占必须传负 priority**：同 cell 多 entry 按 priority 升序、数值最小者渲染；原生 = 0，插件传 `-1`。同 id/同 cell + 同 priority 精确撞格直接抛错 → 整插件加载失败。mock 验证不暴露（mock 的 register 不做 occupancy 检查）——必须复刻真实 SlotCore 语义（tests/slot-priority.test.cjs）。
2. **注册必须补 inject 契约**：injected face 读的是注册 options 的 inject，与 slot 声明无关；缺失 → directory null → `useSyncExternalStore` 当场 TypeError → slot entry crashed，且原生已被遮蔽、无 fallback，座位整体消失。
3. **菜单方向**：座位在底部 composer，CSS 用 `bottom: calc(100% + 6px)` 向上展开；`top: calc(100% + 6px)` 会把 420px 菜单整体弹到视口外。
4. **目录加载失败必须显式报错**：directory.load 失败时 store 置 `status:'error'` + `error`（`code: message`），组件若不渲染该分支会把连接断开显示成「暂无可用模型」——与「真的没有模型」无法区分（实测：服务器死亡后残留标签页里打开菜单就是空列表）。渲染 `status==='error'` 分支后，断连一目了然。
5. **诊断临时实例必须独立 home**：`DSH_HOME=/tmp/dsh-diag dsh --profile web --no-open --port 3081`。临时实例与主实例共用 `~/.dsh` 时会并发写同一会话日志（appendLines 是 O_APPEND 追加，两进程各自的 seq 计数器交错 → 日志中出现重复 seq → `corrupt session log: seq gap in committed region`，resume 直接拒绝）和同一 `session_projcache.json`。实测踩坑：一次共享 home 的临时实例验证把主实例某会话日志写出了 seq 重复，选择器在该会话内表现为「暂无可用模型」。
