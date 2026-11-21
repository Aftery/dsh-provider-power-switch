// 验证导航图标的 DOM 兜底（installNavIconStandIn）：
// 模拟 dsh-tauri-ui 的导航结构——它声明了 settings.section.icon 却从不读取，
// 只按自己的静态映射表画齿轮。本测试断言兜底逻辑只标记「标签匹配」的那一行，
// 并且宿主若已画出我们的四芒星则主动让位。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const src = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')

/** 最小元素桩：足够让 sync() 的选择器逻辑跑通。 */
function makeRow(label, { withSpark = false } = {}) {
  const attrs = new Map()
  const spark = { tag: 'svg', viewBox: '0 0 36 36' }
  const other = { tag: 'svg', viewBox: '0 0 24 24' }
  return {
    textContent: label,
    getAttribute: (k) => (attrs.has(k) ? attrs.get(k) : null),
    setAttribute: (k, v) => { attrs.set(k, v) },
    removeAttribute: (k) => { attrs.delete(k) },
    has: (k) => attrs.has(k),
    // 宿主是否已经画出我们的四芒星（36 视框）
    querySelector: (sel) => (sel.includes('36 36') ? (withSpark ? spark : null) : other),
  }
}

function buildSandbox(rows) {
  const listeners = []
  const styleTags = []
  const document = {
    documentElement: { lang: 'zh-CN' },
    head: { appendChild: (el) => styleTags.push(el) },
    createElement: () => {
      const el = { dataset: {}, textContent: '', removed: false }
      el.remove = () => { el.removed = true }
      return el
    },
    body: {},
    querySelectorAll: (sel) => {
      if (sel === '[role="dialog"] nav button') return rows
      if (sel === '[data-dmps-nav-icon]') return rows.filter((r) => r.has('data-dmps-nav-icon'))
      return []
    },
    getElementById: () => null,
  }
  const sandbox = {
    window: { __ModuleLoader__: { load(spec) { sandbox.__spec = spec } } },
    document,
    navigator: { language: 'zh-CN' },
    console,
    setTimeout, clearTimeout, queueMicrotask,
    MutationObserver: class {
      constructor(cb) { this.cb = cb; listeners.push(cb) }
      observe() {}
      disconnect() {}
    },
    Symbol, Object, Array, JSON, String, Number, Boolean, Error, Promise, Map, Set,
  }
  sandbox.globalThis = sandbox
  return { sandbox, listeners, styleTags }
}

const React = {
  createElement: (type, props, ...children) => ({ type, props: props || {}, children }),
  useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
}

/** 跑一次 apply，收集 effect，并手工执行 effect 回调（模拟插件激活）。 */
async function run(rows, opts = {}) {
  const { sandbox, listeners, styleTags } = buildSandbox(rows)
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox, { filename: 'client.js' })
  const plugin = sandbox.__spec.factory((n) => (n === 'react' ? React : {}))
  const effects = []
  const slots = {
    register: () => () => {},
    inject: (hole, cb) => cb(),
  }
  const ctx = {
    get: (n) => (n === 'slots' ? slots : undefined),
    remote: {
      async $mount() { return async () => {} },
    },
    effect(fn) { effects.push(fn) },
    inject: (deps, cb) => cb({ ...ctx, get: ctx.get }),
    logger: { info() {}, warn() {}, error() {} },
  }
  await plugin.apply(ctx)
  // 执行所有 effect，拿到 cleanup（兜底逻辑就在 effect 里挂载）
  const cleanups = effects.map((fn) => { try { return fn() } catch { return undefined } })
  await new Promise((r) => setTimeout(r, 0))
  return { rows, cleanups, listeners, styleTags, sandbox }
}

const results = []
const check = (name, fn) => {
  try { fn(); results.push(`PASS ${name}`) }
  catch (e) { results.push(`FAIL ${name}: ${e?.message}`) }
}

// ---- 1) 只有标签匹配的行被标记 ----
{
  const mine = makeRow('模型开关')
  const otherA = makeRow('通用')
  const otherB = makeRow('插件')
  const { cleanups, styleTags } = await run([otherA, mine, otherB])

  check('marks only the row whose label matches the section', () => {
    assert.equal(mine.has('data-dmps-nav-icon'), true, 'matching row not marked')
    assert.equal(otherA.has('data-dmps-nav-icon'), false, 'wrong row marked')
    assert.equal(otherB.has('data-dmps-nav-icon'), false, 'wrong row marked')
  })
  check('injects a mask stylesheet with our spark path', () => {
    const maskTag = styleTags.find((t) => /mask-image/.test(t.textContent))
    assert.ok(maskTag, 'no mask stylesheet injected')
    const css = maskTag.textContent
    assert.match(css, /mask-image/)
    assert.match(css, /M18%205\.5/, 'spark path missing from mask')
    // 隐藏宿主自己画的图标
    assert.match(css, /display: none/)
  })

  // ---- 2) cleanup 必须把标记和样式都撤掉 ----
  // 取真正管图标那个 effect 的 cleanup（会移除挂载标记的那个）
  const cleanup = cleanups.filter((c) => typeof c === 'function').pop()
  check('cleanup removes the marker and the style tag', () => {
    assert.ok(cleanup, 'no cleanup returned')
    const maskTag = styleTags.find((t) => /mask-image/.test(t.textContent))
    cleanup()
    assert.equal(mine.has('data-dmps-nav-icon'), false, 'marker not removed')
    assert.equal(maskTag.removed, true, 'mask style tag not removed')
  })
}

// ---- 3) 宿主已经画出四芒星时主动让位（不接管） ----
{
  const done = makeRow('模型开关', { withSpark: true })
  await run([done])
  check('yields when the host already paints our spark', () => {
    assert.equal(done.has('data-dmps-nav-icon'), false, 'stand-in should stand down')
  })
}

// ---- 4) 空 label 不得把整排导航标上 ----
{
  const rows = [makeRow(''), makeRow('   ')]
  await run(rows)
  check('empty label marks nothing', () => {
    for (const r of rows) assert.equal(r.has('data-dmps-nav-icon'), false)
  })
}

console.log(results.join('\n'))
const failed = results.filter((r) => r.startsWith('FAIL'))
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
