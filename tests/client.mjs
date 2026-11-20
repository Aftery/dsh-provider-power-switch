// 在 Node 里模拟浏览器最小环境，执行 client.js，验证
// __ModuleLoader__.load 被调用、factory 可执行、插槽注册逻辑不抛错。
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const src = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')

let loaded = null
const registrations = []
const injectedSlots = []
const effects = []

const fakeSlots = {
  register(options, component) { registrations.push({ options, component }); return () => {} },
  inject(hole, callback) { injectedSlots.push(hole); try { return callback() } catch (e) { throw e } },
  subscribe() { return () => {} },
  entries() { return [] },
}

const fakeRemote = {
  async $mount(desc) { return async () => {} },
  'dsh-provider-power-switch': {
    async snapshot() { return { disabled: [] } },
    async listProviders() { return { providers: ['openrouter', 'deepseek-official', 'qoder'] } },
    async setProvider(p, off) { return { disabled: off ? [p] : [] } },
    async setAll(ps, off) { return { disabled: off ? ps : [] } },
  },
}

const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
}
const ctx = {
  get(name) { return name === 'slots' ? fakeSlots : undefined },
  remote: fakeRemote,
  effect(fn) { effects.push(fn) },
  inject(deps, cb) { return cb({ ...ctx, remote: fakeRemote, get: ctx.get }) },
  logger: { info() {}, warn() {}, error() {} },
}

const sandbox = {
  window: { __ModuleLoader__: { load(spec) { loaded = spec } } },
  document: {
    documentElement: { lang: 'zh-CN' },
    head: { appendChild() {} },
    createElement: () => ({ set id(v) {}, get id() { return '' }, textContent: '', parentNode: null }),
    getElementById: () => null,
  },
  navigator: { language: 'zh-CN' },
  console,
  setTimeout, clearTimeout,
  Symbol, Object, Array, JSON, String, Number, Boolean, Error, Promise, Map, Set,
}
sandbox.globalThis = sandbox

vm.createContext(sandbox)
vm.runInContext(src, sandbox, { filename: 'client.js' })

const results = []
const check = (n, fn) => { try { fn(); results.push('PASS ' + n) } catch (e) { results.push('FAIL ' + n + ': ' + e.message) } }

check('ModuleLoader.load called', () => { if (!loaded) throw new Error('not loaded') })
check('module id correct', () => { if (loaded.id !== 'dsh-provider-power-switch') throw new Error(loaded.id) })
check('factory is function', () => { if (typeof loaded.factory !== 'function') throw new Error('not fn') })

const requireStub = (name) => {
  if (name === 'react') return React
  throw new Error('unexpected require: ' + name)
}
const plugin = loaded.factory(requireStub)
check('factory returns object', () => { if (!plugin || typeof plugin !== 'object') throw new Error('bad') })
check('declares inject slots+remote', () => {
  if (!Array.isArray(plugin.inject)) throw new Error('no inject array')
  if (!plugin.inject.includes('slots')) throw new Error('missing slots')
  if (!plugin.inject.includes('remote')) throw new Error('missing remote')
})

await plugin.apply(ctx)
await new Promise((r) => setTimeout(r, 100))

check('injected settings.section', () => {
  if (!injectedSlots.includes('settings.section')) throw new Error('settings.section not injected: ' + injectedSlots.join(','))
})
check('registered at least one slot', () => {
  if (registrations.length < 1) throw new Error('none registered')
})
check('settings.section registration has id/order', () => {
  const section = registrations.find((r) => r.options.name === 'settings.section')
  if (!section) throw new Error('no settings.section registration')
  if (!section.options.id) throw new Error('no id')
  if (typeof section.options.order !== 'number') throw new Error('no order')
})

console.log(results.join('\n'))
const failed = results.filter((r) => r.startsWith('FAIL'))
console.log('\n' + (results.length - failed.length) + '/' + results.length + ' passed')
if (failed.length) process.exit(1)

// ---- 回归：RPC 挂载失败时，面板仍必须注册（否则整块静默消失）----
async function scenario(name, remote) {
  let loaded2 = null
  const regs2 = []
  const inj2 = []
  const slots2 = {
    register(o, c) { regs2.push(o); return () => {} },
    inject(hole, cb) { inj2.push(hole); return cb() },
  }
  const ctx2 = {
    get: (n) => (n === 'slots' ? slots2 : undefined),
    remote,
    effect() {},
    inject(deps, cb) { return cb({ ...ctx2, get: ctx2.get }) },
  }
  const sandbox2 = { ...sandbox, window: { __ModuleLoader__: { load(s) { loaded2 = s } } } }
  sandbox2.globalThis = sandbox2
  vm.createContext(sandbox2)
  vm.runInContext(src, sandbox2, { filename: 'client.js' })
  const p = loaded2.factory(requireStub)
  let threw = null
  try { await p.apply(ctx2) } catch (e) { threw = e }
  await new Promise((r) => setTimeout(r, 50))
  const ok = !threw && inj2.includes('settings.section') && regs2.some((o) => o.name === 'settings.section')
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}` + (ok ? '' : ` (threw=${threw?.message}, injected=${inj2}, regs=${regs2.length})`))
  if (!ok) process.exitCode = 1
}

// $mount 直接抛错
await scenario('section still registers when $mount throws', {
  async $mount() { throw new Error('namespace conflicts with an existing Remote namespace') },
})
// $mount 成功但 namespace 没出现（face 未挂上）
await scenario('section still registers when remote face missing', {
  async $mount() { return async () => {} },
})

