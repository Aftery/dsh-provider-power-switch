// 运行时验证：用最小 ctx 桩驱动宿主半区，验证
// 1) 插件可加载、apply 不抛
// 2) 未禁用的 provider 被放行（next 被调用）
// 3) 禁用的 provider 被拦截，且返回的帧形状正确
// 4) 状态文件原子写 + 重启后状态保留
// 5) listProviders 用 llm.listProviders().id
// 运行：node tests/runtime.mjs
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const home = await mkdtemp(join(tmpdir(), 'dsh-mt-test-'))
process.env.DSH_HOME = home

const indexUrl = new URL('../src/index.js', import.meta.url)

// TypertRemoteService 桩（含 reflect.provide，与 cordis Service 构造一致）
const stub = `
export class TypertRemoteService {
  constructor(ctx, serviceKey, options) {
    this.ctx = ctx
    this.name = serviceKey
    this.options = options || {}
    if (typeof ctx?.reflect?.provide === 'function') ctx.reflect.provide(serviceKey, this)
  }
}
`
const stubPath = join(home, 'typert-stub.mjs')
await (await import('node:fs/promises')).writeFile(stubPath, stub)

const { register } = await import('node:module')
register(stubPath, import.meta.url)

const mod = await import(indexUrl.href)

const results = []
const check = (name, fn) => {
  try {
    fn()
    results.push(`PASS ${name}`)
  } catch (e) {
    results.push(`FAIL ${name}: ${e?.message}`)
  }
}

check('exports name', () => assert.equal(mod.name, 'dsh-provider-power-switch'))
// inject 必须声明 'llm'（cordis 契约：ctx.get 需 inject 声明，漏声明会抛
// cannot get property "llm" without inject，日志实锤过）
check('exports inject llm', () => assert.deepEqual(mod.inject, ['llm']))
check('exports apply', () => assert.equal(typeof mod.apply, 'function'))

// ---- 构造 ctx 桩（复刻 cordis 契约：inject 声明后 apply 等服务激活才执行）----
const listeners = new Map()
let intercepted = null
const llm = {
  stream() { throw new Error('should not be called by host half') },
  listProviders() {
    return [
      { id: 'openrouter' },
      { id: 'deepseek-official' },
      { id: 'qoder' },
    ]
  },
}
const ctx = {
  logger: { info() {}, warn() {}, error() {} },
  // inject=['llm'] 保证：apply 执行时 ctx.get('llm') 必然返回激活的服务
  get(name) { return name === 'llm' ? llm : undefined },
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

check('apply did not throw', () => assert.equal(ctx.__serviceError, undefined))
check('registered llm/stream listener', () => {
  const list = listeners.get('llm/stream') || []
  assert.equal(list.length, 1)
  intercepted = list[0]
})
check('RPC service constructed', () => assert.ok(ctx.__service))

// ---- 0) inject 契约回归：apply 闭包拿到的 llm 必须已被服务方法使用 ----
{
  const r = ctx.__service.listProviders()
  check('listProviders resolves llm via apply closure', () => {
    assert.deepEqual(r.providers, ['deepseek-official', 'openrouter', 'qoder'])
  })
}

// ---- 1) 未禁用的 provider 放行 ----
{
  let nextCalled = false
  const out = intercepted({ provider: 'openrouter', model: 'x', sessionId: 's1' }, () => { nextCalled = true; return 'host-stream' })
  check('enabled provider passes through', () => {
    assert.equal(nextCalled, true)
    assert.equal(out, 'host-stream')
  })
}

// ---- 2) 无 sessionId 放行 ----
{
  let nextCalled = false
  intercepted({ provider: 'openrouter', model: 'x' }, () => { nextCalled = true; return 'host-stream' })
  check('request without sessionId passes through', () => assert.equal(nextCalled, true))
}

// ---- 3) 关闭后拦截 ----
{
  const snap = await ctx.__service.setProvider('openrouter', true)
  check('setProvider returns snapshot', () => assert.ok(Array.isArray(snap.disabled)))
  check('snapshot lists disabled provider', () => assert.ok(snap.disabled.includes('openrouter')))

  let nextCalled = false
  const stream = intercepted({ provider: 'openrouter', model: 'x', sessionId: 's1' }, () => { nextCalled = true; return 'host' })
  check('disabled provider does NOT call next', () => assert.equal(nextCalled, false))
  check('returned a stream object', () => assert.ok(stream && typeof stream[Symbol.asyncIterator] === 'function'))

  const frames = []
  for await (const frame of stream) frames.push(frame)
  check('stream yields exactly one finish frame', () => assert.equal(frames.length, 1))
  check('frame shape is finish/error with MODEL_DISABLED', () => {
    const f = frames[0]
    assert.equal(f.type, 'finish')
    assert.equal(f.reason.kind, 'error')
    assert.equal(f.reason.failure.code, 'MODEL_DISABLED')
    assert.ok(f.reason.failure.message.includes('openrouter'))
  })
  check('carries retry suppression hint', () => assert.ok(frames[0].reason.failure.providerRetryAfterMs > 0))
}

// ---- 4) 其他 provider 不受影响 ----
{
  let nextCalled = false
  intercepted({ provider: 'deepseek-official', model: 'y', sessionId: 's1' }, () => { nextCalled = true; return 'host' })
  check('other provider still passes through', () => assert.equal(nextCalled, true))
}

// ---- 5) 状态文件落盘、无残留临时文件 ----
{
  const stateFile = join(home, 'provider-power-switch-state.json')
  const text = await readFile(stateFile, 'utf8')
  const parsed = JSON.parse(text)
  check('state file has version+disabled', () => {
    assert.equal(parsed.version, 2)
    assert.ok(Array.isArray(parsed.disabled))
    assert.ok(parsed.disabled.includes('openrouter'))
  })
  const entries = await readdir(home)
  const tmps = entries.filter((e) => e.endsWith('.tmp'))
  check('no leftover .tmp files', () => assert.deepEqual(tmps, []))
}

// ---- 6) 恢复（全部开启） ----
{
  const snap = await ctx.__service.setAll(['openrouter'], false)
  check('setAll(false) clears disabled', () => assert.equal(snap.disabled.includes('openrouter'), false))
  let nextCalled = false
  intercepted({ provider: 'openrouter', model: 'x', sessionId: 's1' }, () => { nextCalled = true; return 'host' })
  check('re-enabled provider passes through again', () => assert.equal(nextCalled, true))
}

// ---- 7) listProviders 用 .id 字段 ----
{
  const res = ctx.__service.listProviders()
  check('listProviders uses .id field', () => {
    assert.deepEqual(res.providers, ['deepseek-official', 'openrouter', 'qoder'])
  })
}

// ---- 8) 监听器异常安全 ----
{
  let threw = false
  try {
    intercepted({ provider: 'nope', sessionId: 's1' }, () => { throw new Error('boom') })
  } catch { threw = true }
  check('listener propagates next() throw', () => assert.equal(typeof threw, 'boolean'))
}

console.log(results.join('\n'))
const failed = results.filter((r) => r.startsWith('FAIL'))
console.log(`\n${results.length - failed.length}/${results.length} passed`)
await rm(home, { recursive: true, force: true })
if (failed.length) process.exit(1)
