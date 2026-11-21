# dsh-provider-power-switch

按供应商分组的模型开关：在「设置」左侧的「模型开关」分节，每个供应商一张卡片，旗下每个模型一行开关。

## 功能

- 供应商分组：活跃适配器供应商 + 已配置的网关/自定义供应商都列出；每个供应商下的模型逐行显示。
- 每模型开关：关闭某个模型后，发往 `provider + model` 的请求在 `llm/stream` 中间件被立即拦截，返回明确错误提示，不发真实请求、不消耗配额。
- 整组开关：每个供应商卡片上有「全部启用 / 全部停用」（写入通配符 `provider/*`）。
- 全局开关：分节顶部「全部开启 / 全部关闭」。
- 搜索：按供应商名、路由 id、模型名或模型 id 过滤。
- 供应商折叠：点击卡片头部的供应商名即可收起/展开该组，卡片之间留有间距；搜索时命中项自动展开。
- 状态灯：供应商名前有一盏圆点，折叠状态下也能看出这组的开关情况——全绿=全部启用，橙=部分停用，红=全部停用。有停用项时计数显示为「启用数/总数」。
- 与故障转移插件兼容：被关闭的模型在 fallback-queue / failover 眼中就是一条立即失败的路由，会被自动跳过。

## 图标

两处图标是两件事，都在本插件里：

- **设置导航行的图标**：主路径是通过 `settings.section.icon` 座位注册（id 必须等于分节的
  `dsh-provider-power-switch`），画的是四芒星，用 `currentColor` 跟随外壳的选中/未选中配色。
- **插件面板里的图标**：包根 `icon.svg`，经 `package.json` 的 `./icon` 导出。

### 为什么要额外挂一层 DOM 兜底

实测某些宿主（如 `dsh-tauri-ui`）**声明了** `settings.section.icon` 座位，面板里也能查到我们的
注册项（`active: true`），但它渲染导航图标时用的是一张写死的 id 映射表——`Ft[sectionId] ?? 齿轮`——
**从不读取该座位的注册内容**。这种宿主上，正式注册会「成功但完全不可见」。

所以再补一层兜底（`installNavIconStandIn`）：按可见文本找到标签匹配的那一行，隐藏宿主自己画的
图标，用 CSS `mask-image` 把四芒星画上去。mask 的可见色来自 `currentColor`，配色仍由外壳掌控。
两条路径互不冲突——宿主若已经画出同一个 36 视框的四芒星，兜底会主动让位。

## 数据来源

- `llm.listProviders()`：能立刻发请求的活跃路由。
- `llm.listConfigurableProviders()` + `settings.describe()`：读取 `settingsNs` + `settingsPath` 指向的 profile 里的 `models` 数组（自定义网关的模型清单）。
- `llm.listModels()`：前两路没有模型时，回退到适配器的 catalog。

## 安装

桌面端「插件」面板 → 添加本插件（本地目录）。

## 关闭后的行为

- 会话中已选该模型：下一步请求被拦截并提示，不发真实请求。
- 模型选择器里该模型仍可见（可选中后看到拦截提示），API Key / 模型配置原样保留，随时一键恢复。

## 数据文件

`$DSH_HOME/provider-power-switch-state.json`：

```json
{
  "version": 3,
  "disabled": [
    { "provider": "magpie-anthropic", "model": "claude-opus-5.5" },
    { "provider": "opencode-free", "model": "*" }
  ],
  "exceptions": [
    { "provider": "opencode-free", "model": "beam-free" }
  ]
}
```

`model: "*"` 表示整组关闭。v2 的旧格式（纯 provider 字符串）在启动时自动迁移为此格式。

`exceptions` 记录「整组关闭之后又被单独开启」的模型，优先级高于通配符——没有它，
整组关掉之后再点单个模型的开关就不会有任何效果。点「全部启用」或在组内逐个恢复时会清空对应条目。

## 分支状态说明

禁用状态由两组词表叠加而成，判断顺序与服务端、客户端一致：

1. `exceptions` 命中 → **启用**（哪怕该供应商整组关着）
2. `disabled` 里该供应商有 `*` 通配 → 停用
3. `disabled` 里精确命中 `provider + model` → 停用

「全部关闭」把整组折叠成一条 `provider/*`；「全部启用」会同时清掉通配符、组内精确键与例外。
