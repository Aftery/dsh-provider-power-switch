# dsh-provider-power-switch

供应商级模型开关：在「设置」左侧的「模型开关」分节给每个模型供应商一个启用/停用开关。

## 功能

- 每个已注册的模型供应商一行开关：关闭后该供应商立即被拦截，不再发出任何真实请求、不消耗配额。
- 拦截发生在 `llm/stream` 中间件（带 sessionId 的 agent 步骤请求），返回明确的错误提示：
  `模型供应商 X 已停用：请到 设置 → 模型开关 开启后再试。`
- 「模型开关」分节内「全部开启 / 全部关闭」快捷操作。
- 状态保存在 `$DSH_HOME/provider-power-switch-state.json`（独立 state 文件 + 原子写，
  不写 settings——避免 settings revision 触发宿主主题全量重算白闪）。
- 与故障转移插件兼容：被关闭的供应商在 fallback-queue / failover 眼中就是一条
  立即失败的路由，会被自动跳过。

## 安装

1. 桌面端「插件」面板 → 添加本插件（本地目录或 npm 包 `dsh-provider-power-switch`）。
2. 或手动挂载（profile 的 `cordis.patch.yml`）：

```yaml
- insert:
    - id: provider-power-switch
      name: 'dsh-provider-power-switch'
```

## 关闭后的行为

- 会话中已选该供应商的模型：下一步请求被拦截并提示，不发真实请求。
- 模型选择器里该供应商仍可见（可选中后看到拦截提示）。
- API Key、模型配置原样保留，随时一键恢复。

## 数据文件

`$DSH_HOME/provider-power-switch-state.json`：

```json
{
  "version": 2,
  "disabled": ["openrouter", "qoder"]
}
```
