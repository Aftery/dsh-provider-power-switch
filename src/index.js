/**
 * dsh-provider-power-switch — host half.
 *
 * 模型级开关（按供应商分组）：
 *  - 枚举「有活跃适配器的供应商」+「配置目录里声明的供应商」，并读取每个
 *    供应商的模型清单（settings profile 的 models 数组，回退到 llm.listModels）；
 *  - llm/stream 中间件按 provider + model 拦截被关闭的模型，返回明确错误帧；
 *  - 支持按模型、按整个供应商（通配符 *）、全部关闭/开启；
 *  - 状态存独立 JSON 文件 $DSH_HOME/provider-power-switch-state.json，不写 settings。
 *
 * 安全约定：
 *  - 所有监听器/枚举步骤 try/catch 兜底，任何异常都不得拦截请求（异常时放行）；
 *  - 只拦带 sessionId 的 agent 步骤请求；本插件自己的子请求标记后放行；
 *  - 拦截帧带超大 providerRetryAfterMs，避免宿主 dsh-llm-retry 白重试；
 *  - RPC 方法只返回纯数据（不带 ok 字段），避免与 typert 信封的 ok 撞名。
 */

import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises'
import { dirname } from 'node:path'

/**
 * 与 @deepseek-ai/dsh-typert-protocol 内部常量同值。
 * 必须给服务原型打 Remote 方法标记，否则 gateway 只认带标记的方法，
 * RPC 调用会全部落空（client 兜底空对象、host 方法不执行、日志零条）。
 */
const REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai/dsh-typert-protocol/remote-methods'

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
  })
}

export const name = 'dsh-provider-power-switch'

const STATE_FILENAME = 'provider-power-switch-state.json'
const STATE_VERSION = 3
/** 整组开关使用的模型通配符。 */
const ALL_MODELS = '*'
/** key 分隔符：模型 id 允许含 '/'，但不含换行。 */
const SEP = '\n'

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

/** 进程内权威状态：被关闭的 provider/model 键集合。 */
const disabled = new Set()
/**
 * 例外集：整组关闭（通配符 provider/*）之后又被单独开启的模型。
 * 优先级高于通配符——否则通配符会继续拦截它们，单模型的「开启」就永远没反应。
 */
const exceptions = new Set()

function makeKey(provider, model) {
  return `${provider}${SEP}${model}`
}

function parseKey(k) {
  const i = k.indexOf(SEP)
  return { provider: k.slice(0, i), model: k.slice(i + 1) }
}

/** 单个模型是否被关闭：例外集优先，其次整组通配符或精确模型命中。 */
function isDisabled(provider, model) {
  if (typeof provider !== 'string' || provider.length === 0) return false
  const exact = typeof model === 'string' && model.length > 0
  // 整组关后单独开启的模型：例外优先，看都不看通配符
  if (exact && exceptions.has(makeKey(provider, model))) return false
  if (disabled.has(makeKey(provider, ALL_MODELS))) return true
  return exact && disabled.has(makeKey(provider, model))
}

/** 删掉某供应商下所有精确模型键（保留通配符本身）。 */
function pruneProvider(provider) {
  for (const k of Array.from(disabled)) {
    const row = parseKey(k)
    if (row.provider === provider && row.model !== ALL_MODELS) disabled.delete(k)
  }
}

/** 删掉某供应商下所有例外。 */
function clearExceptions(provider) {
  for (const k of Array.from(exceptions)) {
    if (parseKey(k).provider === provider) exceptions.delete(k)
  }
}

function snapshot() {
  const rows = Array.from(disabled).sort().map(parseKey)
  const except = Array.from(exceptions).sort().map(parseKey)
  return except.length > 0 ? { disabled: rows, exceptions: except } : { disabled: rows }
}

/** 原子写：临时文件 + rename，读者只会看到旧内容或新内容。 */
async function persistState() {
  const target = statePath()
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  const payload = {
    version: STATE_VERSION,
    disabled: snapshot().disabled,
    exceptions: snapshot().exceptions || [],
  }
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
    const excepts = Array.isArray(parsed?.exceptions) ? parsed.exceptions : []
    disabled.clear()
    exceptions.clear()
    for (const row of rows) {
      // v2: 纯 provider 字符串 → 整组关闭，迁移为通配符键
      if (typeof row === 'string' && row) {
        disabled.add(makeKey(row, ALL_MODELS))
        continue
      }
      if (!row || typeof row !== 'object') continue
      const provider = row.provider
      if (typeof provider !== 'string' || !provider) continue
      const model = typeof row.model === 'string' && row.model ? row.model : ALL_MODELS
      disabled.add(makeKey(provider, model))
    }
    for (const row of excepts) {
      if (!row || typeof row !== 'object') continue
      const provider = row.provider
      const model = row.model
      if (typeof provider !== 'string' || !provider) continue
      if (typeof model !== 'string' || !model || model === ALL_MODELS) continue
      exceptions.add(makeKey(provider, model))
    }
  } catch (e) {
    ctxLogger?.warn?.('[provider-power-switch] state parse failed: %s', e?.message)
  }
}

/** 本插件内部发起的子请求标记：绝不递归拦截。 */
const internalStreamOptions = new WeakSet()

async function* disabledStream(provider, model) {
  const label = model === ALL_MODELS ? provider : `${provider} / ${model}`
  yield {
    type: 'finish',
    reason: {
      kind: 'error',
      failure: {
        code: 'MODEL_DISABLED',
        message: `模型 ${label} 已停用：请到 设置 → 模型开关 开启后再试。`,
        // 确定性错误，重试无意义：超大重试间隔让 dsh-llm-retry 直接放弃。
        providerRetryAfterMs: 86400000 * 30,
      },
    },
  }
}

/* ============================== 模型枚举 ============================== */

/** 按 settingsPath 从命名空间 value 中取出 provider profile 对象。 */
function profileAt(value, path) {
  let node = value
  for (const segment of Array.isArray(path) ? path : []) {
    if (node === null || typeof node !== 'object') return undefined
    node = node[segment]
  }
  return node !== null && typeof node === 'object' ? node : undefined
}

/** 从 provider profile 中读出 models 数组（pi-ai 与 deepseek 都可能）。 */
function modelsFromProfile(profile) {
  const raw = profile?.models
  if (!Array.isArray(raw)) return []
  const out = []
  for (const entry of raw) {
    if (typeof entry === 'string' && entry) {
      out.push({ id: entry, name: entry })
    } else if (entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id) {
      out.push({
        id: entry.id,
        name: typeof entry.name === 'string' && entry.name ? entry.name : entry.id,
      })
    }
  }
  return out
}

function addModels(group, models) {
  for (const model of models) {
    if (!group.models.some((m) => m.id === model.id)) group.models.push(model)
  }
}

function providerRank(provider) {
  if (provider === 'deepseek-account') return 0
  if (provider === 'deepseek-official') return 1
  return 2
}

/**
 * 返回按供应商分组的模型清单。
 * 数据源：
 *  - llm.listProviders()：当前能发请求的活跃路由（权威）；
 *  - llm.listConfigurableProviders() + settings.describe()：用户已配置的网关/自定义路由
 *    的 models 数组（settingsNs + settingsPath 指向 profile 对象）；
 *  - llm.listModels()：前两路都没给出模型时，回退到适配器的 catalog。
 */
async function listModelGroups() {
  const llm = llmBridge
  if (!llm) return { groups: [], failures: [] }

  const map = new Map()

  // 1) 活跃路由
  try {
    const rows = typeof llm.listProviders === 'function' ? (llm.listProviders() || []) : []
    for (const row of rows) {
      const id = typeof row === 'string' ? row : row?.id
      if (typeof id !== 'string' || !id) continue
      if (!map.has(id)) {
        const displayName = typeof row === 'object' && typeof row.name === 'string' && row.name ? row.name : id
        map.set(id, { provider: id, displayName, models: [] })
      }
    }
  } catch (e) {
    ctxLogger?.warn?.('[provider-power-switch] listProviders failed: %s', e?.message)
  }

  // 2) 配置目录 + settings 里的 models
  let namespaces = []
  try {
    if (settingsBridge && typeof settingsBridge.describe === 'function') namespaces = settingsBridge.describe() || []
  } catch (e) {
    ctxLogger?.warn?.('[provider-power-switch] settings.describe failed: %s', e?.message)
  }
  try {
    const rows = typeof llm.listConfigurableProviders === 'function'
      ? (llm.listConfigurableProviders() || [])
      : []
    for (const entry of rows) {
      const id = entry?.provider
      if (typeof id !== 'string' || !id) continue
      let group = map.get(id)
      if (!group) {
        group = {
          provider: id,
          displayName: typeof entry.displayName === 'string' && entry.displayName ? entry.displayName : id,
          models: [],
        }
        map.set(id, group)
      }
      try {
        const descriptor = namespaces.find((n) => n && n.ns === entry.settingsNs)
        if (descriptor) {
          const profile = profileAt(descriptor.value, entry.settingsPath)
          addModels(group, modelsFromProfile(profile))
        }
      } catch (e) {
        ctxLogger?.warn?.('[provider-power-switch] read profile failed for %s: %s', id, e?.message)
      }
    }
  } catch (e) {
    ctxLogger?.warn?.('[provider-power-switch] listConfigurableProviders failed: %s', e?.message)
  }

  // 3) 适配器 catalog 回退
  await Promise.all([...map.values()].map(async (group) => {
    if (group.models.length > 0) return
    try {
      const listed = typeof llm.listModels === 'function' ? (await llm.listModels(group.provider)) || [] : []
      addModels(group, listed
        .filter((m) => m && typeof m.id === 'string' && m.id)
        .map((m) => ({ id: m.id, name: typeof m.name === 'string' && m.name ? m.name : m.id })))
    } catch {
      // NO_ADAPTER / INVALID_CATALOG / 未配置路由：没有模型可列，保留空组即可
    }
  }))

  const groups = [...map.values()]
    .filter((g) => g.models.length > 0)
    .sort((a, b) =>
      (providerRank(a.provider) - providerRank(b.provider))
      || a.provider.localeCompare(b.provider))

  ctxLogger?.info?.('[provider-power-switch] listModelGroups: %d providers, %d models',
    groups.length, groups.reduce((sum, g) => sum + g.models.length, 0))
  return { groups, failures: [] }
}

/* ============================== RPC 服务 ============================== */

/**
 * apply 闭包持有的服务引用（模块级桥接）。
 * ⚠️ 服务 fiber 的 static inject 必须保持 []（金标准 fallback-queue 同款）：
 * 声明依赖会让 RPC 服务 fiber 等不到注入而不激活，RPC 调用静默返回空。
 */
let llmBridge = null
let settingsBridge = null

class ModelSwitchService extends TypertRemoteService {
  static inject = []

  constructor(ctx) {
    super(ctx, 'ModelSwitchService', { namespace: 'dsh-provider-power-switch' })
  }

  /** 当前被关闭的 provider/model 列表。 */
  snapshot() {
    return snapshot()
  }

  /** 供应商分组的模型清单（异步）。 */
  listModels() {
    return listModelGroups()
  }

  /** 旧接口兼容：活跃 provider id 列表。 */
  listProviders() {
    const providers = []
    try {
      for (const row of (llmBridge?.listProviders?.() || [])) {
        const id = typeof row === 'string' ? row : row?.id
        if (typeof id === 'string' && id) providers.push(id)
      }
    } catch { /* ignore */ }
    return { providers: providers.sort() }
  }

  /** 单模型开/关。 */
  async setModel(provider, model, off) {
    if (typeof provider === 'string' && provider && typeof model === 'string' && model) {
      const k = makeKey(provider, model)
      if (off) {
        // 关：清掉可能存在的例外，再写精确键
        exceptions.delete(k)
        disabled.add(k)
      } else {
        // 开：清掉精确键；若整组仍关着，再记为例外，否则通配符会继续拦截它
        disabled.delete(k)
        if (disabled.has(makeKey(provider, ALL_MODELS))) exceptions.add(k)
        else exceptions.delete(k)
      }
      await persistState()
    }
    return snapshot()
  }

  /** 整个供应商开/关（通配符）。 */
  async setGroup(provider, off) {
    if (typeof provider === 'string' && provider) {
      const k = makeKey(provider, ALL_MODELS)
      if (off) {
        // 关：之前逐个关闭的精确键已无意义，合并成一条通配符，例外清空
        disabled.add(k)
        pruneProvider(provider)
        clearExceptions(provider)
      } else {
        // 开：通配符与组内所有精确键/例外一起清掉，否则「全部启用」同样点不动
        disabled.delete(k)
        pruneProvider(provider)
        clearExceptions(provider)
      }
      await persistState()
    }
    return snapshot()
  }

  /** 旧接口兼容：setProvider 等价于整组开关。 */
  async setProvider(provider, off) {
    return this.setGroup(provider, off)
  }

  /** 批量：对给定供应商整组开/关。 */
  async setAll(providers, off) {
    if (Array.isArray(providers)) {
      for (const provider of providers) {
        if (typeof provider !== 'string' || !provider) continue
        const k = makeKey(provider, ALL_MODELS)
        if (off) {
          disabled.add(k)
          pruneProvider(provider)
        } else {
          disabled.delete(k)
          pruneProvider(provider)
        }
        clearExceptions(provider)
      }
      await persistState()
    }
    return snapshot()
  }
}

markRemoteMethods(ModelSwitchService.prototype, [
  'snapshot', 'listModels', 'listProviders', 'setModel', 'setGroup', 'setProvider', 'setAll',
])

/* ============================== 插件入口 ============================== */

/**
 * ⚠️ inject 必须声明 'llm' 与 'settings'：cordis 的 ctx.get(name) 只在当前 fiber
 * 的 inject 里声明过才合法，缺声明会抛 cannot get property without inject。
 */
export const inject = ['llm', 'settings']

export function apply(ctx) {
  const log = ctx?.logger
  ctxLogger = log

  const llm = ctx.get('llm')
  llmBridge = llm
  let settingsService
  try {
    settingsService = ctx.get('settings')
  } catch (e) {
    log?.warn?.('[provider-power-switch] settings service unavailable: %s', e?.message)
  }
  settingsBridge = settingsService

  if (!llm || typeof llm.listProviders !== 'function') {
    log?.warn?.('[provider-power-switch] apply: llm unexpected state=%s (listProviders=%s)',
      typeof llm, typeof llm?.listProviders)
  }

  // 启动载入状态文件（异步，不阻塞装配）。
  ctx.effect(() => {
    void loadState().catch((e) => log?.warn?.('[provider-power-switch] boot load failed: %s', e?.message))
  })

  // ---- 核心：llm/stream 中间件按 provider + model 拦截 ----
  ctx.effect(() => ctx.on('llm/stream', (options, next) => {
    // 先只在 try 内做「是否拦截」的判定；判定异常时放行，绝不吞掉宿主 stream。
    // next() 放在 try 外调用：宿主适配器自身的错误必须由 waterfall 原样传播。
    let block = null
    try {
      if (options && typeof options === 'object' && !internalStreamOptions.has(options)) {
        const sessionId = options.sessionId
        if (typeof sessionId === 'string' && sessionId.length > 0) {
          const provider = options.provider
          const model = options.model
          if (isDisabled(provider, model)) block = { provider, model }
        }
      }
    } catch (e) {
      log?.warn?.('[provider-power-switch] llm/stream guard failed: %s', e?.message)
    }
    if (block) {
      log?.info?.('[provider-power-switch] intercepted provider=%s model=%s', block.provider, block.model)
      return disabledStream(block.provider, block.model)
    }
    return next()
  }), 'provider-power-switch llm/stream middleware')

  // ---- RPC 服务 ----
  ctx.effect(() => ctx.plugin(ModelSwitchService), 'provider-power-switch rpc service')
  ctx.effect(() => () => {
    llmBridge = null
    settingsBridge = null
    ctxLogger = null
  }, 'provider-power-switch bridge cleanup')

  return { snapshot, isDisabled }
}
