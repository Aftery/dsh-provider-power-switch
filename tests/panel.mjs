// 面板集成验证：装一个够用的迷你 React，真的渲染 ModelSwitchPanel，断言
// 「整组模型全部关闭 → 该组默认收起」这条新规则在真实组件里成立，
// 并且用户手点、整组开关之后折叠状态不会卡住。
//
// 用迷你渲染器而不是真 React：测试环境没有 react 包，且这里只需要
// useState/useEffect/useCallback 三个钩子。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const src = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')

/* ============================== 迷你 React ============================== */

function createRenderer() {
  let hooks = []
  let cursor = 0
  let dirty = false
  let rootNode = null
  // 本轮渲染登记下来的 effect，渲染结束后统一比对依赖并执行
  let registered = []

  const sameDeps = (a, b) => {
    if (!a || !b || a.length !== b.length) return false
    return a.every((v, i) => Object.is(v, b[i]))
  }

  const React = {
    createElement: (type, props, ...children) => ({ type, props: props || {}, children: children.flat(Infinity) }),
    useState(init) {
      const i = cursor++
      if (!(i in hooks)) hooks[i] = typeof init === 'function' ? init() : init
      const set = (next) => {
        const value = typeof next === 'function' ? next(hooks[i]) : next
        if (Object.is(value, hooks[i])) return
        hooks[i] = value
        dirty = true
      }
      return [hooks[i], set]
    },
    useEffect(fn, deps) {
      const i = cursor++
      registered.push({ i, fn, deps })
    },
    useLayoutEffect() {},
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
    useRef: (value) => {
      const i = cursor++
      if (!(i in hooks)) hooks[i] = { current: value }
      return hooks[i]
    },
    useSyncExternalStore: (_sub, get) => get(),
  }

  function renderNode(node) {
    if (node === null || node === undefined || node === false || node === true) return null
    if (typeof node === 'string' || typeof node === 'number') return String(node)
    if (Array.isArray(node)) return node.map(renderNode).filter((n) => n !== null)
    if (typeof node.type === 'function') {
      // 只有一个有状态组件：直接把 hook 游标让给它
      const saved = cursor
      cursor = 0
      const out = node.type({ ...node.props, children: node.children })
      cursor = saved
      return renderNode(out)
    }
    return {
      type: node.type,
      props: node.props,
      children: node.children.map(renderNode).filter((n) => n !== null).flat(Infinity),
    }
  }

  /** 渲染一轮 + 把本轮登记的 effect 按依赖判断跑掉。 */
  function renderOnce() {
    dirty = false
    registered = []
    cursor = 0
    const tree = renderNode(rootNode)
    const batch = registered
    for (const effect of batch) {
      const slot = hooks[effect.i]
      const prev = slot && typeof slot === 'object' && 'deps' in slot ? slot : undefined
      if (prev && sameDeps(prev.deps, effect.deps)) continue
      try { prev?.cleanup?.() } catch { /* ignore */ }
      hooks[effect.i] = { deps: effect.deps, cleanup: undefined }
      const cleanup = effect.fn()
      hooks[effect.i].cleanup = typeof cleanup === 'function' ? cleanup : undefined
    }
    return tree
  }

  /** 让 Promise 落地，并把由此触发的重渲染跑干净。 */
  async function settle(tree) {
    let current = tree
    for (let round = 0; round < 8; round++) {
      for (let i = 0; i < 12; i++) await Promise.resolve()
      if (!dirty) break
      current = renderOnce()
    }
    return current
  }

  async function mount(node) {
    rootNode = node
    return settle(renderOnce())
  }

  async function rerender() {
    return settle(renderOnce())
  }

  return { React, mount, rerender }
}

/* ============================== DOM 工具 ============================== */

function walk(node, visit) {
  if (!node || typeof node === 'string') return
  if (Array.isArray(node)) { for (const n of node) walk(n, visit); return }
  visit(node)
  for (const child of node.children || []) walk(child, visit)
}

function find(node, pred) {
  let hit = null
  walk(node, (n) => { if (!hit && pred(n)) hit = n })
  return hit
}

function findAll(node, pred) {
  const out = []
  walk(node, (n) => { if (pred(n)) out.push(n) })
  return out
}

const cls = (n, name) => typeof n.props?.className === 'string' && n.props.className.split(/\s+/).includes(name)
const textOf = (node) => {
  let s = ''
  walk(node, (n) => { for (const c of n.children || []) if (typeof c === 'string') s += c })
  return s
}

/** 某供应商卡片：靠卡片内可见的供应商名定位。 */
function groupCard(tree, displayName) {
  return findAll(tree, (n) => n.type === 'section' && cls(n, 'dmps-group'))
    .find((section) => textOf(section).includes(displayName))
}
function collapseButton(card) {
  return find(card, (n) => n.type === 'button' && cls(n, 'dmps-collapse'))
}
function isExpanded(tree, displayName) {
  const card = groupCard(tree, displayName)
  assert.ok(card, `group card not found: ${displayName}`)
  return collapseButton(card).props['aria-expanded'] === 'true'
}
function groupButton(tree, displayName, label) {
  const card = groupCard(tree, displayName)
  return findAll(card, (n) => n.type === 'button' && cls(n, 'dmps-btn'))
    .find((b) => textOf(b) === label)
}

/* ============================== 假后端 ============================== */

function makeBackend(groups, initial = []) {
  const state = { disabled: [...initial], exceptions: [] }
  const snap = () => ({ disabled: state.disabled.map((r) => ({ ...r })), exceptions: state.exceptions.map((r) => ({ ...r })) })
  const key = (provider, model) => state.disabled.some((d) => d.provider === provider && (d.model === model || d.model === '*'))
  const face = {
    async snapshot() { return snap() },
    async listModels() { return { groups: JSON.parse(JSON.stringify(groups)) } },
    async setModel(provider, model, off) {
      state.disabled = state.disabled.filter((d) => !(d.provider === provider && d.model === model))
      state.exceptions = state.exceptions.filter((e) => !(e.provider === provider && e.model === model))
      if (off) {
        state.disabled.push({ provider, model })
      } else if (key(provider, '*')) {
        state.exceptions.push({ provider, model })
      }
      return snap()
    },
    async setGroup(provider, off) {
      state.disabled = state.disabled.filter((d) => d.provider !== provider)
      state.exceptions = state.exceptions.filter((e) => e.provider !== provider)
      if (off) state.disabled.push({ provider, model: '*' })
      return snap()
    },
    async setAll(providers, off) {
      for (const provider of providers) {
        state.disabled = state.disabled.filter((d) => d.provider !== provider)
        state.exceptions = state.exceptions.filter((e) => e.provider !== provider)
        if (off) state.disabled.push({ provider, model: '*' })
      }
      return snap()
    },
    async contextWindowFor() { return null },
  }
  return { face, state }
}

/* ============================== 装配 ============================== */

async function mount(face) {
  const renderer = createRenderer()
  const registrations = []
  const slots = {
    register(options, component) { registrations.push({ options, component }); return () => {} },
    inject(hole, cb) { return cb() },
    subscribe() { return () => {} },
    entries() { return [] },
  }
  const realRemote = { async $mount() { return async () => {} }, 'dsh-provider-power-switch': face }
  const sandbox = {
    window: { __ModuleLoader__: { load(spec) { sandbox.__spec = spec } } },
    document: {
      documentElement: { lang: 'zh-CN' },
      head: { appendChild() {} },
      createElement: () => ({ dataset: {}, textContent: '', remove() {}, parentNode: null }),
      querySelectorAll: () => [],
      body: {},
    },
    navigator: { language: 'zh-CN' },
    console: { warn() {}, info() {}, error() {}, log() {} },
    setTimeout, clearTimeout, queueMicrotask,
    Symbol, Object, Array, JSON, String, Number, Boolean, Error, Promise, Map, Set}
  sandbox.globalThis = sandbox
  vm.createContext(sandbox)
  vm.runInContext(src, sandbox, { filename: 'client.js' })

  const plugin = sandbox.__spec.factory((name) => {
    if (name === 'react') return renderer.React
    if (name === 'react-dom') return { createPortal: (node) => node }
    throw new Error('unexpected require: ' + name)
  })
  const ctx = {
    get: (n) => (n === 'slots' ? slots : undefined),
    remote: realRemote,
    effect() {},
    inject(deps, cb) { return cb({ ...ctx, get: ctx.get }) },
  }
  await plugin.apply(ctx)
  const section = registrations.find((r) => r.options.name === 'settings.section')
  assert.ok(section, 'settings.section not registered')
  const root = renderer.React.createElement(section.component, {})
  const tree = await renderer.mount(root)
  return { renderer, tree }
}

/* ============================== 用例 ============================== */

const results = []
async function check(name, fn) {
  try { await fn(); results.push(`PASS ${name}`) }
  catch (e) { results.push(`FAIL ${name}: ${e?.message}`) }
}

const groups = [
  { provider: 'magpie-anthropic', displayName: 'Magpie · Anthropic', models: [
    { id: 'claude-opus-5.5', name: 'Claude Opus 5.5' },
    { id: 'claude-sonnet-5.5', name: 'Claude Sonnet 5.5' },
  ] },
  { provider: 'qoder-global', displayName: 'Qoder Global', models: [
    { id: 'qmodel_latest', name: 'QModel Latest' },
  ] },
]

// ---- 1) 全关的组默认收起，开着的组默认展开 ----
{
  const { face } = makeBackend(groups, [{ provider: 'qoder-global', model: '*' }])
  const { tree } = await mount(face)
  await check('all-off provider is collapsed on first render', () => {
    assert.equal(isExpanded(tree, 'Qoder Global'), false)
  })
  await check('enabled provider is expanded on first render', () => {
    assert.equal(isExpanded(tree, 'Magpie · Anthropic'), true)
  })
  await check('collapsed group renders no model rows', () => {
    const card = groupCard(tree, 'Qoder Global')
    assert.equal(find(card, (n) => cls(n, 'dmps-row')), null)
    // 头部信息还在：供应商名、红灯、计数
    assert.match(textOf(card), /Qoder Global/)
    assert.equal(find(card, (n) => cls(n, 'dmps-dot')).props['data-state'], 'off')
  })
  await check('expanded group still renders its model rows', () => {
    const card = groupCard(tree, 'Magpie · Anthropic')
    assert.equal(findAll(card, (n) => cls(n, 'dmps-row')).length, 2)
  })
}

// ---- 2) 手点能展开全关的组，并且点「全部启用」后保持展开 ----
{
  const { face, state } = makeBackend(groups, [{ provider: 'qoder-global', model: '*' }])
  const { renderer, tree } = await mount(face)
  let current = tree
  await check('clicking the collapse header expands an all-off group', async () => {
    collapseButton(groupCard(current, 'Qoder Global')).props.onClick()
    current = await renderer.rerender()
    assert.equal(isExpanded(current, 'Qoder Global'), true)
    assert.equal(findAll(groupCard(current, 'Qoder Global'), (n) => cls(n, 'dmps-row')).length, 1)
  })
  await check('"enable all" on that group keeps it expanded', async () => {
    groupButton(current, 'Qoder Global', '全部启用').props.onClick()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    current = await renderer.rerender()
    assert.deepEqual(state.disabled, [], 'group should be fully enabled')
    assert.equal(isExpanded(current, 'Qoder Global'), true, 'enabled group must be expanded')
  })
  await check('"disable all" on it collapses it again', async () => {
    groupButton(current, 'Qoder Global', '全部停用').props.onClick()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    current = await renderer.rerender()
    assert.deepEqual(state.disabled, [{ provider: 'qoder-global', model: '*' }])
    assert.equal(isExpanded(current, 'Qoder Global'), false,
      'a group that just became all-off must collapse without another click')
  })
  await check('the stale expand choice does not come back after off→on→off', async () => {
    groupButton(current, 'Qoder Global', '全部启用').props.onClick()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    current = await renderer.rerender()
    assert.equal(isExpanded(current, 'Qoder Global'), true)
    groupButton(current, 'Qoder Global', '全部停用').props.onClick()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    current = await renderer.rerender()
    assert.equal(isExpanded(current, 'Qoder Global'), false)
  })
}

// ---- 3) 逐只模型关到最后一个时，该组也默认收起 ----
{
  const { face, state } = makeBackend(groups, [])
  const { renderer, tree } = await mount(face)
  let current = tree
  await check('disabling models one by one collapses the group at the last one', async () => {
    assert.equal(isExpanded(current, 'Qoder Global'), true)
    const card = groupCard(current, 'Qoder Global')
    const sw = find(card, (n) => n.type === 'button' && cls(n, 'dmps-switch'))
    sw.props.onClick()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    current = await renderer.rerender()
    assert.deepEqual(state.disabled, [{ provider: 'qoder-global', model: 'qmodel_latest' }])
    assert.equal(isExpanded(current, 'Qoder Global'), false)
  })
  await check('and re-enabling it from the header expands it back', async () => {
    // 组已收起，模型行不可见 —— 用组头按钮恢复
    groupButton(current, 'Qoder Global', '全部启用').props.onClick()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    current = await renderer.rerender()
    assert.deepEqual(state.disabled, [])
    assert.equal(isExpanded(current, 'Qoder Global'), true)
  })
}

// ---- 4) 部分停用的组保持展开（规则只针对「全部关闭」）----
{
  const { face } = makeBackend(groups, [{ provider: 'magpie-anthropic', model: 'claude-opus-5.5' }])
  const { tree } = await mount(face)
  await check('partially disabled group stays expanded', () => {
    assert.equal(isExpanded(tree, 'Magpie · Anthropic'), true)
    const card = groupCard(tree, 'Magpie · Anthropic')
    assert.equal(find(card, (n) => cls(n, 'dmps-dot')).props['data-state'], 'partial')
  })
}

// ---- 5) 全局「全部关闭」之后，所有组都收起 ----
{
  const { face } = makeBackend(groups, [{ provider: 'qoder-global', model: '*' }])
  const { renderer, tree } = await mount(face)
  let current = tree
  await check('global "disable all" collapses every group', async () => {
    const allOff = find(current, (n) => n.type === 'button' && cls(n, 'dmps-btn') && textOf(n) === '全部关闭')
    assert.ok(allOff, 'global disable-all button missing')
    allOff.props.onClick()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    current = await renderer.rerender()
    assert.equal(isExpanded(current, 'Magpie · Anthropic'), false)
    assert.equal(isExpanded(current, 'Qoder Global'), false)
  })
  await check('global "enable all" expands them again', async () => {
    const allOn = find(current, (n) => n.type === 'button' && cls(n, 'dmps-btn') && textOf(n) === '全部开启')
    allOn.props.onClick()
    for (let i = 0; i < 10; i++) await Promise.resolve()
    current = await renderer.rerender()
    assert.equal(isExpanded(current, 'Magpie · Anthropic'), true)
    assert.equal(isExpanded(current, 'Qoder Global'), true)
  })
}

// ---- 6) 搜索时全关的组也必须展开，否则搜到了却看不见 ----
{
  const { face } = makeBackend(groups, [
    { provider: 'qoder-global', model: '*' },
    { provider: 'magpie-anthropic', model: '*' },
  ])
  const { renderer, tree } = await mount(face)
  let current = tree
  await check('search expands an all-off group so the hit is visible', async () => {
    assert.equal(isExpanded(current, 'Qoder Global'), false, 'baseline: collapsed')
    const search = find(current, (n) => n.type === 'input' && cls(n, 'dmps-search'))
    assert.ok(search, 'search input missing')
    search.props.onChange({ target: { value: 'qmodel' } })
    current = await renderer.rerender()
    assert.equal(isExpanded(current, 'Qoder Global'), true)
    assert.equal(findAll(groupCard(current, 'Qoder Global'), (n) => cls(n, 'dmps-row')).length, 1)
  })
  await check('clearing the search returns to the default collapse', async () => {
    const search = find(current, (n) => n.type === 'input' && cls(n, 'dmps-search'))
    search.props.onChange({ target: { value: '' } })
    current = await renderer.rerender()
    assert.equal(isExpanded(current, 'Qoder Global'), false)
  })
}

console.log(results.join('\n'))
const failed = results.filter((r) => r.startsWith('FAIL'))
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
