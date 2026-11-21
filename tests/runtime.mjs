// 运行时验证：用最小 ctx 桩驱动宿主半区，验证
// 1) 插件可加载、apply 不抛
// 2) 模型枚举：活跃 provider + settings profile 的 models 数组 + listModels 回退
// 3) 未关闭的模型放行；关闭后按 provider + model 精确拦截
// 4) 整组（*）开关拦截该供应商所有模型
// 5) 状态文件原子写 + 重启后状态保留 + v2 迁移
// 运行：node tests/runtime.mjs
import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const home = await mkdtemp(join(tmpdir(), 'dsh-mt-test-'))
process.env.DSH_HOME = home

const indexUrl = new URL('../src/index.js', import.meta.url)

// TypertRemoteService 桩（含 reflect.provide，与 cordis Service 构造一致）。
// 用一个真正的 ESM loader hook 把裸模块名映射到桩文件——Node 26 下
// register(file, parent) 会把该文件当 loader，必须有 resolve/load 钩子。
const stubImpl = `
export class TypertRemoteService {
  constructor(ctx, serviceKey, options) {
    this.ctx = ctx
    this.name = serviceKey
    this.options = options || {}
    if (typeof ctx?.reflect?.provide === 'function') ctx.reflect.provide(serviceKey, this)
  }
}
`
const stubImplPath = join(home, 'typert-impl.mjs')
await writeFile(stubImplPath, stubImpl)
const loader = `
import { pathToFileURL } from 'node:url'
const target = ${JSON.stringify(pathToFileURL(stubImplPath).href)}
export async function resolve(specifier, context, nextResolve) {
  if (specifier === '@deepseek-ai/dsh-typert-protocol') {
    return { url: target, shortCircuit: true }
  }
  return nextResolve(specifier, context)
}
`
const loaderPath = join(home, 'typert-loader.mjs')
await writeFile(loaderPath, loader)

const { register } = await import('node:module')
register(pathToFileURL(loaderPath).href, import.meta.url)

const mod = await import(indexUrl.href)

const results = []
const check = (name, fn) => {
  try { fn(); results.push(`PASS ${name}`) }
  catch (e) { results.push(`FAIL ${name}: ${e?.message}`) }
}

check('exports name', () => assert.equal(mod.name, 'dsh-provider-power-switch'))
check('exports inject llm+settings', () => assert.deepEqual(mod.inject, ['llm', 'settings']))
check('exports apply', () => assert.equal(typeof mod.apply, 'function'))

// ---- ctx 桩 ----
const listeners = new Map()
const llm = {
  stream() { throw new Error('should not be called by host half') },
  listProviders() {
    return [
      { id: 'openrouter', name: 'OpenRouter' },
      { id: 'deepseek-official', name: 'DeepSeek' },
      { id: 'magpie-anthropic', name: 'Magpie · Anthropic' },
    ]
  },
  listConfigurableProviders() {
    return [
      { provider: 'magpie-anthropic', displayName: 'Magpie · Anthropic', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'magpie-anthropic'] },
      { provider: 'opencode-free', displayName: 'OpenCode Free', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'opencode-free'] },
    ]
  },
  async listModels(provider) {
    if (provider === 'deepseek-official') {
      return [{ provider, id: 'deepseek-chat', name: 'DeepSeek V3' }]
    }
    if (provider === 'openrouter') {
      return [{ provider, id: 'openrouter/x', name: 'X' }]
    }
    throw new Error('NO_ADAPTER')
  },
}
const settings = {
  describe() {
    return [
      { ns: 'llm-pi-ai', value: {
        providers: {
          'magpie-anthropic': { displayName: 'Magpie · Anthropic', models: [
            { id: 'claude-opus-5.5', name: 'Claude Opus 5.5' },
            { id: 'claude-sonnet-5.5', name: 'Claude Sonnet 5.5' },
          ] },
          'opencode-free': { displayName: 'OpenCode Free', models: [
            { id: 'beam-free', name: 'Beam Free' },
            { id: 'deepseek-v4.1-flash-free', name: 'DeepSeek V4.1 Flash Free' },
          ] },
        },
      } },
    ]
  },
}
const ctx = {
  logger: { info() {}, warn() {}, error() {} },
  get(name) { return name === 'llm' ? llm : name === 'settings' ? settings : undefined },
  reflect: { provide() {} },
  effect(fn) { fn() },
  on(event, listener) {
    if (!listeners.has(event)) listeners.set(event, [])
    listeners.get(event).push(listener)
    return () => {}
  },
  plugin(cls) {
    try { ctx.__service = new cls(ctx) } catch (e) { ctx.__serviceError = e }
  },
}

mod.apply(ctx)
const svc = ctx.__service
const intercepted = (listeners.get('llm/stream') || [])[0]

check('apply did not throw', () => assert.equal(ctx.__serviceError, undefined))
check('registered llm/stream listener', () => assert.equal(typeof intercepted, 'function'))
check('RPC service constructed', () => assert.ok(svc))

// ---- 模型枚举 ----
{
  const { groups } = await svc.listModels()
  const byId = Object.fromEntries(groups.map((g) => [g.provider, g]))
  check('enumerates active adapter providers', () => {
    assert.ok(byId['openrouter'] && byId['deepseek-official'])
  })
  check('reads models from settings profile (pi-ai)', () => {
    assert.deepEqual(byId['magpie-anthropic'].models.map((m) => m.id), ['claude-opus-5.5', 'claude-sonnet-5.5'])
  })
  check('reads configured-only provider with custom models', () => {
    assert.equal(byId['opencode-free'].displayName, 'OpenCode Free')
    assert.deepEqual(byId['opencode-free'].models.map((m) => m.name), ['Beam Free', 'DeepSeek V4.1 Flash Free'])
  })
  check('falls back to llm.listModels for adapters', () => {
    assert.equal(byId['deepseek-official'].models[0].id, 'deepseek-chat')
  })
  check('providers sorted account/official first', () => {
    const ids = groups.map((g) => g.provider)
    assert.equal(ids[0], 'deepseek-official')
  })
}

const mkStream = (provider, model) => intercepted({ provider, model, sessionId: 's1' }, () => 'host-stream')

// ---- 精确模型开关 ----
{
  let nextCalled = false
  const out = intercepted({ provider: 'magpie-anthropic', model: 'claude-opus-5.5', sessionId: 's1' }, () => { nextCalled = true; return 'host-stream' })
  check('enabled model passes through', () => { assert.equal(nextCalled, true); assert.equal(out, 'host-stream') })
}
{
  await svc.setModel('magpie-anthropic', 'claude-opus-5.5', true)
  check('snapshot has provider+model key', () => {
    assert.ok(svc.snapshot().disabled.some((d) => d.provider === 'magpie-anthropic' && d.model === 'claude-opus-5.5'))
  })
  let nextCalled = false
  const stream = mkStream('magpie-anthropic', 'claude-opus-5.5')
  // 上面的 mkStream 用的是固定 next，这里单独构造以观察 next
  const s2 = intercepted({ provider: 'magpie-anthropic', model: 'claude-opus-5.5', sessionId: 's1' }, () => { nextCalled = true; return 'host' })
  check('disabled model does NOT call next', () => assert.equal(nextCalled, false))
  const frames = []
  for await (const f of s2) frames.push(f)
  check('yields one finish/error frame', () => {
    assert.equal(frames.length, 1)
    assert.equal(frames[0].type, 'finish')
    assert.equal(frames[0].reason.kind, 'error')
    assert.equal(frames[0].reason.failure.code, 'MODEL_DISABLED')
    assert.ok(frames[0].reason.failure.message.includes('claude-opus-5.5'))
    assert.ok(frames[0].reason.failure.providerRetryAfterMs > 0)
  })
  check('other model of same provider still passes', () => {
    let called = false
    intercepted({ provider: 'magpie-anthropic', model: 'claude-sonnet-5.5', sessionId: 's1' }, () => { called = true; return 'host' })
    assert.equal(called, true)
  })
}

// ---- 整组开关 ----
{
  await svc.setGroup('opencode-free', true)
  check('group off uses wildcard', () => {
    assert.ok(svc.snapshot().disabled.some((d) => d.provider === 'opencode-free' && d.model === '*'))
  })
  for (const model of ['beam-free', 'deepseek-v4.1-flash-free']) {
    let called = false
    intercepted({ provider: 'opencode-free', model, sessionId: 's1' }, () => { called = true; return 'host' })
    check(`group off intercepts ${model}`, () => assert.equal(called, false))
  }
}

// ---- 无 sessionId 放行 / 异常安全 ----
{
  let called = false
  intercepted({ provider: 'magpie-anthropic', model: 'claude-opus-5.5' }, () => { called = true; return 'host' })
  check('request without sessionId passes through', () => assert.equal(called, true))
}
{
  let threw = false
  try { intercepted({ provider: 'x', sessionId: 's1' }, () => { throw new Error('boom') }) } catch { threw = true }
  check('listener does not swallow next() throw', () => assert.equal(threw, true))
}

// ---- 状态落盘 ----
{
  const text = await readFile(join(home, 'provider-power-switch-state.json'), 'utf8')
  const parsed = JSON.parse(text)
  check('state file version+disabled', () => {
    assert.equal(parsed.version, 3)
    assert.ok(parsed.disabled.some((d) => d.model === '*'))
    assert.ok(parsed.disabled.some((d) => d.model === 'claude-opus-5.5'))
  })
  const tmps = (await readdir(home)).filter((e) => e.endsWith('.tmp'))
  check('no leftover .tmp files', () => assert.deepEqual(tmps, []))
}

// ---- v2 迁移（重启后旧纯 provider 字符串变成整组关闭）----
{
  await writeFile(join(home, 'provider-power-switch-state.json'), JSON.stringify({ version: 2, disabled: ['legacy-provider'] }))
  // 重新载入模块以触发 loadState（用新的缓存键绕过 ESM 缓存）
  const mod2 = await import(indexUrl.href + '?migration=1')
  const ctx2 = {
    logger: ctx.logger,
    get: ctx.get,
    reflect: ctx.reflect,
    effect(fn) { fn() },
    on() { return () => {} },
    plugin(cls) { ctx2.__service = new cls(ctx2) },
  }
  mod2.apply(ctx2)
  await new Promise((r) => setTimeout(r, 50))
  const snap = ctx2.__service.snapshot()
  check('v2 state migrated to wildcard', () => {
    assert.ok(snap.disabled.some((d) => d.provider === 'legacy-provider' && d.model === '*'))
  })
}

// ---- 回归：整组关闭后单独开启某个模型必须真的放行 ----
// 曾经的 bug：setAll/setGroup 写入通配符 provider/*，之后 setModel(..., false)
// 只删精确键，通配符仍在 → 该模型继续被拦截，开关点了看起来没反应。
{
  await svc.setAll(['opencode-free'], true)
  check('setAll closed group via wildcard', () => {
    assert.ok(svc.snapshot().disabled.some((d) => d.provider === 'opencode-free' && d.model === '*'))
  })

  const snapOff = await svc.setModel('opencode-free', 'beam-free', false)
  check('re-enabling one model after group-off records an exception', () => {
    assert.ok((snapOff.exceptions || []).some(
      (e) => e.provider === 'opencode-free' && e.model === 'beam-free',
    ))
    // 通配符仍在（整组仍是关的），但该模型不该再被列为关闭
    assert.ok(snapOff.disabled.some((d) => d.provider === 'opencode-free' && d.model === '*'))
  })
  check('re-enabled model actually passes through', () => {
    let called = false
    intercepted({ provider: 'opencode-free', model: 'beam-free', sessionId: 's1' }, () => {
      called = true; return 'host'
    })
    assert.equal(called, true)
  })
  check('sibling model of that group stays blocked', () => {
    let called = false
    intercepted({ provider: 'opencode-free', model: 'deepseek-v4.1-flash-free', sessionId: 's1' }, () => {
      called = true; return 'host'
    })
    assert.equal(called, false)
  })
}

// ---- 回归：整组关闭时有例外，再点「全部启用」必须全部放行 ----
// 曾经的 bug：setGroup(..., false) 只删通配符，之前逐个关闭的精确键残留。
{
  await svc.setGroup('qoder', true)
  await svc.setModel('qoder', 'qmodel_latest', false)   // 组内单独开一个
  await svc.setGroup('qoder', false)                    // 再点全部启用

  const snap = svc.snapshot()
  check('enable-all clears wildcard, exact keys and exceptions', () => {
    assert.equal(snap.disabled.some((d) => d.provider === 'qoder'), false)
    assert.equal((snap.exceptions || []).some((e) => e.provider === 'qoder'), false)
  })
  for (const model of ['qmodel_latest', 'qmodel_38max']) {
    let called = false
    intercepted({ provider: 'qoder', model, sessionId: 's1' }, () => { called = true; return 'host' })
    check(`enable-all unblocks ${model}`, () => assert.equal(called, true))
  }
}

// ---- 例外集必须跟着状态一起落盘并在重启后生效 ----
{
  await svc.setGroup('opencode-free', true)
  await svc.setModel('opencode-free', 'beam-free', false)

  const text = await readFile(join(home, 'provider-power-switch-state.json'), 'utf8')
  const parsed = JSON.parse(text)
  check('exceptions persisted to state file', () => {
    assert.ok(Array.isArray(parsed.exceptions))
    assert.ok(parsed.exceptions.some(
      (e) => e.provider === 'opencode-free' && e.model === 'beam-free',
    ))
  })

  const mod3 = await import(indexUrl.href + '?exceptions=1')
  const listeners3 = new Map()
  const ctx3 = {
    logger: ctx.logger,
    get: ctx.get,
    reflect: ctx.reflect,
    effect(fn) { fn() },
    on(event, listener) {
      if (!listeners3.has(event)) listeners3.set(event, [])
      listeners3.get(event).push(listener)
      return () => {}
    },
    plugin(cls) { ctx3.__service = new cls(ctx3) },
  }
  mod3.apply(ctx3)
  await new Promise((r) => setTimeout(r, 50))
  const reloadedIntercept = (listeners3.get('llm/stream') || [])[0]
  check('exception survives a restart', () => {
    let called = false
    reloadedIntercept({ provider: 'opencode-free', model: 'beam-free', sessionId: 's1' }, () => {
      called = true; return 'host'
    })
    assert.equal(called, true)
  })
  check('restart still blocks non-excepted sibling', () => {
    let called = false
    reloadedIntercept({ provider: 'opencode-free', model: 'deepseek-v4.1-flash-free', sessionId: 's1' }, () => {
      called = true; return 'host'
    })
    assert.equal(called, false)
  })
}

// ---- 恢复 ----
{
  await svc.setModel('magpie-anthropic', 'claude-opus-5.5', false)
  await svc.setGroup('opencode-free', false)
  const snap = svc.snapshot()
  check('re-enable clears keys', () => {
    assert.equal(snap.disabled.some((d) => d.provider === 'magpie-anthropic'), false)
    assert.equal(snap.disabled.some((d) => d.provider === 'opencode-free'), false)
  })
}

console.log(results.join('\n'))
const failed = results.filter((r) => r.startsWith('FAIL'))
console.log(`\n${results.length - failed.length}/${results.length} passed`)
await rm(home, { recursive: true, force: true })
if (failed.length) process.exit(1)
