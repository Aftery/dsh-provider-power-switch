/**
 * dsh-provider-power-switch — host half.
 *
 * 供应商级别模型开关：在「设置 → 模型」页给每个模型供应商一个启用/停用开关。
 * 关闭的供应商：
 *  - 立即在 llm/stream 中间件拦截（不发真实请求、不消耗配额），
 *    返回一条明确的 finish{error} 帧："该供应商已停用"；
 *  - 故障转移插件（fallback-queue / failover）会把它当作失败路由自动跳过；
 *  - 状态存独立 JSON 文件（$DSH_HOME/provider-power-switch-state.json），
 *    不写 settings——写 settings 会推 revision，触发宿主主题全量重算（白闪）。
 *
 * 数据源：llm.listProviders() 返回所有已注册 adapter 的 provider 路由（字段 `.id`），
 * 这是「能发请求的供应商」的权威清单。
 *
 * 安全约定：
 *  - 所有监听器 try/catch 兜底，任何异常都不得拦截请求（异常时放行）；
 *  - 只拦带 sessionId 的 agent 步骤请求；本插件自己的子请求标记后放行；
 *  - 拦截帧带超大 providerRetryAfterMs，避免宿主 dsh-llm-retry 白重试。
 *  - RPC 方法只返回纯数据（不带 `ok` 字段），避免与 typert 信封的 `ok` 撞名。
 */

import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * 与 @deepseek-ai/dsh-typert-protocol 内部常量同值（该包不导出 ./remote-methods
 * 子路径，但协议仍是这个字符串键 + {version:1, methods:[...]} 结构）。
 * ⚠️ 必须给服务原型打 Remote 方法标记：gateway 的 resolveSrcDescriptor
 * （dsh-api-gateway/lib/index.js）只认带标记的方法，缺标记会抛
 * `gateway/invocation-unavailable: no active Remote method exports this endpoint`，
 * RPC 调用失败、客户端兜底成空对象、host 方法压根不执行、日志零条。
 * 这正是「面板显示没有检测到但没有任何日志」的真正根因。
 */
const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods';

/** 给原型打 Remote 方法标记（等价于 TS 装饰器编译产物）。 */
function markRemoteMethods(prototype, methods) {
  Object.defineProperty(prototype, REMOTE_METHOD_DESCRIPTOR, {
    configurable: true,
    value: Object.freeze({
      version: 1,
      methods: Object.freeze(
        methods.map((m) => Object.freeze({ method: m, invocation: Object.freeze({ kind: 'direct' }) })),
      ),
    }),
  });
}

export const name = 'dsh-provider-power-switch'

const STATE_FILENAME = 'provider-power-switch-state.json'
const STATE_VERSION = 2

let cachedPath = null
let ctxLogger = null

/** 解析状态文件绝对路径（含 DSH_HOME 兜底规则）。 */
function statePath() {
  if (!cachedPath) {
    const home = process.env.DSH_HOME
      || (process.platform === 'darwin'
        ? `${process.env.HOME}/.dsh`
        : process.env.XDG_DATA_HOME
          ? `${process.env.XDG_DATA_HOME}/dsh`
          : `${process.env.HOME}/.local/share/dsh`)
    cachedPath = `${home}/${STATE_FILENAME}`
  }
  return cachedPath
}

/** 进程内权威状态：停用的 provider 集合。 */
const disabled = new Set()

function isDisabled(provider) {
  return typeof provider === 'string' && provider.length > 0 && disabled.has(provider)
}

function snapshot() {
  return { disabled: Array.from(disabled).sort() }
}

/** 原子写：临时文件 + rename，读者只会看到旧内容或新内容。 */
async function persistState() {
  const target = statePath()
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  const payload = { version: STATE_VERSION, disabled: Array.from(disabled).sort() }
  try {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(tmp, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 })
    await rename(tmp, target)
    return true
  } catch (e) {
    ctxLogger?.warn?.('[provider-power-switch] state write failed: %s', e?.message)
    try { await rm(tmp, { force: true }) } catch { /* ignore */ }
    return false
  }
}

async function loadState() {
  let text
  try {
    text = await readFile(statePath(), 'utf8')
  } catch (e) {
    if (e?.code !== 'ENOENT') ctxLogger?.warn?.('[provider-power-switch] state read failed: %s', e?.message)
    return
  }
  try {
    const parsed = JSON.parse(text)
    const rows = Array.isArray(parsed?.disabled) ? parsed.disabled : []
    disabled.clear()
    for (const row of rows) {
      if (typeof row === 'string' && row) disabled.add(row)
      else if (row && typeof row.provider === 'string' && row.provider) disabled.add(row.provider)
    }
  } catch (e) {
    ctxLogger?.warn?.('[provider-power-switch] state parse failed: %s', e?.message)
  }
}

/** 本插件内部发起的子请求标记：绝不递归拦截。 */
const internalStreamOptions = new WeakSet()

async function* disabledStream(provider) {
  yield {
    type: 'finish',
    reason: {
      kind: 'error',
      failure: {
        code: 'MODEL_DISABLED',
        message: `模型供应商 ${provider} 已停用：请到 设置 → 模型 的「模型开关」开启后再试。`,
        // 确定性错误，重试无意义：超大重试间隔让 dsh-llm-retry 直接放弃。
        providerRetryAfterMs: 86400000 * 30,
      },
    },
  }
}

/* ============================== RPC 服务 ============================== */

/**
 * apply 闭包持有的 llm 引用（模块级桥接）。
 * ⚠️ 服务 fiber 的 static inject 必须保持 []（金标准 fallback-queue 同款）：
 * 声明 ['llm'] 会让 RPC 服务 fiber 等不到注入而不激活，RPC 调用静默返回空。
 * llm 只能由已声明 inject=['llm'] 的插件 apply() 写入此桥接变量。
 */
let llmRef = null

class ModelSwitchService extends TypertRemoteService {
  static inject = []

  constructor(ctx) {
    super(ctx, 'ModelSwitchService', { namespace: 'dsh-provider-power-switch' })
  }

  /** 当前停用的供应商清单。 */
  snapshot() {
    return snapshot()
  }

  /**
   * 所有可切换的供应商。
   * 合并两个来源并去重：
   *  - llm.listProviders()：有活跃 adapter 的路由（能立刻发请求）；
   *  - llm.listConfigurableProviders()：已声明但适配器可能尚未激活的供应商。
   * 兼容字段：provider 对象可能是 {id} 或 {provider}，也可能直接是字符串。
   */
  listProviders() {
    const found = new Set()
    let active = -1
    let declared = -1
    try {
      const llm = llmRef
      if (llm && typeof llm.listProviders === 'function') {
        const rows = llm.listProviders() || []
        active = rows.length
        for (const p of rows) {
          const id = typeof p === 'string' ? p
            : (typeof p?.id === 'string' ? p.id : (typeof p?.provider === 'string' ? p.provider : ''))
          if (id) found.add(id)
        }
      }
      if (llm && typeof llm.listConfigurableProviders === 'function') {
        const rows = llm.listConfigurableProviders() || []
        declared = rows.length
        for (const p of rows) {
          const id = typeof p === 'string' ? p
            : (typeof p?.provider === 'string' ? p.provider : (typeof p?.id === 'string' ? p.id : ''))
          if (id) found.add(id)
        }
      }
    } catch (e) {
      ctxLogger?.warn?.('[provider-power-switch] listProviders failed: %s', e?.message)
    }
    const debug = `source=bridge,active=${active},declared=${declared},llm=${typeof llmRef}`
    // warn 级诊断会进 harness.log，空列表时可直接看到两个来源的计数。
    if (found.size === 0) {
      ctxLogger?.warn?.('[provider-power-switch] listProviders EMPTY: %s', debug)
    }
    return { providers: Array.from(found).sort(), debug }
  }

  /** 单个供应商开/关。返回最新快照。 */
  async setProvider(provider, off) {
    if (typeof provider === 'string' && provider) {
      if (off) disabled.add(provider)
      else disabled.delete(provider)
      await persistState()
    }
    return snapshot()
  }

  /** 批量开/关。 */
  async setAll(providers, off) {
    if (Array.isArray(providers)) {
      for (const p of providers) {
        if (typeof p !== 'string' || !p) continue
        if (off) disabled.add(p)
        else disabled.delete(p)
      }
      await persistState()
    }
    return snapshot()
  }
}

// 给服务原型打 Remote 方法标记——缺这个标记 gateway 会抛 invocation-unavailable，
// RPC 全部不可达（client 只能拿到兜底的空对象）。
markRemoteMethods(ModelSwitchService.prototype, ['snapshot', 'listProviders', 'setProvider', 'setAll'])

/* ============================== 插件入口 ============================== */

/**
 * ⚠️ inject 必须声明 'llm'：cordis 的 ctx.get('llm') 只在当前 fiber 的 inject
 * 里声明过才合法，缺声明会抛 `cannot get property "llm" without inject`
 * （日志实锤过：漏声明直接导致整个插件 apply 失败、被 safe-mode 禁用）。
 * 声明 inject 同时保证了 apply fiber 上的服务可见性——时序由 cordis 的
 * 注入等待机制解决（apply 会等 llm 激活后才执行），这不是需要绕开的坑。
 */
export const inject = ['llm']

export function apply(ctx) {
  const log = ctx?.logger
  ctxLogger = log

  // apply fiber 已声明 inject ['llm']，这里 ctx.get('llm') 合法且必然拿到
  // 激活后的服务（cordis 等待注入完成才跑 apply）。
  const llm = ctx.get('llm')
  llmRef = llm

  if (!llm || typeof llm.listProviders !== 'function') {
    // 理论上不可达（inject 保证），出现即说明宿主结构异常——warn 级让日志桥记录。
    log?.warn?.('[provider-power-switch] apply: llm unexpected state=%s (listProviders=%s)',
      typeof llm, typeof llm?.listProviders)
  }

  // 启动载入状态文件（异步，不阻塞装配）。
  ctx.effect(() => {
    void loadState().catch((e) => log?.warn?.('[provider-power-switch] boot load failed: %s', e?.message))
  })

  // ---- 核心：llm/stream 中间件拦截 ----
  // 拦截判定读的是 disabled 集合（内存），不依赖 llm 引用。
  ctx.effect(() => ctx.on('llm/stream', (options, next) => {
    try {
      if (!options || typeof options !== 'object') return next()
      if (internalStreamOptions.has(options)) return next()
      const sessionId = options.sessionId
      if (typeof sessionId !== 'string' || sessionId.length === 0) return next()
      if (!isDisabled(options.provider)) return next()
      log?.info?.('[provider-power-switch] intercepted provider=%s model=%s', options.provider, options.model)
      return disabledStream(options.provider)
    } catch (e) {
      log?.warn?.('[provider-power-switch] llm/stream wrap failed: %s', e?.message)
      try { return next() } catch { return disabledStream('unknown') }
    }
  }), 'provider-power-switch llm/stream middleware')

  // ---- RPC 服务 ----
  ctx.effect(() => ctx.plugin(ModelSwitchService), 'provider-power-switch rpc service')
  ctx.effect(() => () => {
    llmRef = null
    ctxLogger = null
  }, 'provider-power-switch bridge cleanup')

  return { snapshot, isDisabled }
}
