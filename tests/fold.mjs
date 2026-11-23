// 默认折叠规则：供应商的模型全部关闭时，该组默认处于收起状态。
//
// 这里不跑真实 React（测试环境没有 react 包），而是把 client.js 里那几段
// 纯函数（modelOffFrom / groupStatusFrom / groupOpenByDefault / groupOpenFromChoice）
// 单独抠出来跑——它们是折叠判定的全部逻辑，UI 只是照结果渲染。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

const src = await readFile(new URL('../src/client.js', import.meta.url), 'utf8')

// 拿函数源码片段：从 function 名到下一个空行 + 顶层 function。
// 比正则硬啃整棵树稳，也不会在插件升级时静默失效——名字对不上就抛错。
function grab(name) {
  const start = src.indexOf(`function ${name}(`)
  if (start < 0) throw new Error(`function ${name} not found in client.js`)
  // 找配对的右花括号
  let depth = 0
  let i = src.indexOf('{', start)
  const bodyStart = i
  for (; i < src.length; i++) {
    const c = src[i]
    if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error(`unbalanced braces in ${name}`)
}

const names = ['modelOffFrom', 'groupStatusFrom', 'groupOpenByDefault', 'groupOpenFromChoice', 'pruneFoldChoices']
const code = names.map(grab).join('\n')

const sandbox = { Object, Array, String, Number, Boolean, Error }
vm.createContext(sandbox)
vm.runInContext(`${code}\nObject.assign(globalThis, { ${names.join(', ')} })`, sandbox)

const {
  modelOffFrom,
  groupStatusFrom,
  groupOpenByDefault,
  groupOpenFromChoice,
  pruneFoldChoices,
} = sandbox

const results = []
const check = (name, fn) => {
  try { fn(); results.push(`PASS ${name}`) }
  catch (e) { results.push(`FAIL ${name}: ${e?.message}`) }
}

const group = (provider, models) => ({ provider, models: models.map((id) => ({ id, name: id })) })
const two = group('magpie-anthropic', ['claude-opus-5.5', 'claude-sonnet-5.5'])
const one = group('qoder-global', ['qmodel_latest'])

// ---- 状态灯 ----
check('no disabled rows → group status on', () => {
  assert.equal(groupStatusFrom([], [], two), 'on')
})
check('wildcard → group status off', () => {
  assert.equal(groupStatusFrom([{ provider: 'magpie-anthropic', model: '*' }], [], two), 'off')
})
check('every model disabled individually → group status off', () => {
  const rows = ['claude-opus-5.5', 'claude-sonnet-5.5'].map((m) => ({ provider: 'magpie-anthropic', model: m }))
  assert.equal(groupStatusFrom(rows, [], two), 'off')
})
check('one of two disabled → partial', () => {
  assert.equal(groupStatusFrom([{ provider: 'magpie-anthropic', model: 'claude-opus-5.5' }], [], two), 'partial')
})
check('exception keeps a wildcard-closed group out of "off"', () => {
  const rows = [{ provider: 'magpie-anthropic', model: '*' }]
  const except = [{ provider: 'magpie-anthropic', model: 'claude-opus-5.5' }]
  // 还有另一只模型被关着 → 不是全关
  assert.equal(groupStatusFrom(rows, except, two), 'partial')
})
check('exception on every model of a wildcard-closed group → on', () => {
  const rows = [{ provider: 'magpie-anthropic', model: '*' }]
  const except = [
    { provider: 'magpie-anthropic', model: 'claude-opus-5.5' },
    { provider: 'magpie-anthropic', model: 'claude-sonnet-5.5' },
  ]
  assert.equal(groupStatusFrom(rows, except, two), 'on')
})

// ---- 默认折叠：全关 → 收起 ----
check('default: fully-off group starts collapsed', () => {
  const rows = [{ provider: 'qoder-global', model: '*' }]
  const status = groupStatusFrom(rows, [], one)
  assert.equal(status, 'off')
  assert.equal(groupOpenFromChoice(undefined, status), false, 'all-off group should default to collapsed')
  assert.equal(groupOpenByDefault(status), false)
})
check('default: enabled group starts expanded', () => {
  const status = groupStatusFrom([], [], two)
  assert.equal(status, 'on')
  assert.equal(groupOpenFromChoice(undefined, status), true, 'enabled group should default to expanded')
})
check('default: partially-disabled group starts expanded', () => {
  const rows = [{ provider: 'magpie-anthropic', model: 'claude-opus-5.5' }]
  const status = groupStatusFrom(rows, [], two)
  assert.equal(status, 'partial')
  assert.equal(groupOpenFromChoice(undefined, status), true)
})
check('default: empty group starts expanded (idle is not "all off")', () => {
  const idle = group('empty-provider', [])
  const status = groupStatusFrom([], [], idle)
  assert.equal(status, 'idle')
  assert.equal(groupOpenFromChoice(undefined, status), true)
})

// ---- 用户手点的选择 ----
check('user can expand an all-off group', () => {
  const off = groupStatusFrom([{ provider: 'qoder-global', model: '*' }], [], one)
  // 点一下展开
  const choice = { open: !groupOpenFromChoice(undefined, off), status: off }
  assert.equal(choice.open, true)
  assert.equal(groupOpenFromChoice(choice, off), true)
})
check('manual collapse of an enabled group sticks', () => {
  const on = groupStatusFrom([], [], two)
  const choice = { open: !groupOpenFromChoice(undefined, on), status: on }
  assert.equal(choice.open, false)
  assert.equal(groupOpenFromChoice(choice, on), false)
})
check('stale choice is dropped once the status changes', () => {
  const on = groupStatusFrom([], [], two)
  const expanded = { open: true, status: on }
  // 整组停用后状态变成 off —— 旧选择（按 on 记的）不再生效，回到默认收起
  const off = groupStatusFrom([{ provider: 'magpie-anthropic', model: '*' }], [], two)
  assert.equal(off, 'off')
  assert.equal(groupOpenFromChoice(expanded, off), false,
    'a choice made while enabled must not keep a now-all-off group open')
})
check('re-enabling returns to the default expansion', () => {
  const on = groupStatusFrom([], [], two)
  const collapsed = { open: false, status: on }
  // 状态还是 on，手点收起继续生效
  assert.equal(groupOpenFromChoice(collapsed, on), false)
  // 跨状态的选择一律无效
  const offStatus = groupStatusFrom([{ provider: 'magpie-anthropic', model: '*' }], [], two)
  assert.equal(groupOpenFromChoice({ open: true, status: offStatus }, on), true,
    'status mismatch → default (expanded for an enabled group)')
})

// ---- 手点记录的生命周期 ----
check('prune drops choices whose group is gone', () => {
  const on = groupStatusFrom([], [], two)
  const next = pruneFoldChoices({ gone: { open: true, status: 'on' } }, [two], [], [])
  // 跨 vm realm 的对象原型不同，deepEqual 会误判；比较键集合即可
  assert.deepEqual(Object.keys(next), [])
})
check('prune keeps a choice made under the current status', () => {
  const on = groupStatusFrom([], [], two)
  const choices = { 'magpie-anthropic': { open: false, status: on } }
  assert.equal(pruneFoldChoices(choices, [two], [], []), choices, 'unchanged input should be returned by reference')
})
check('prune drops the stale choice after the group turns off', () => {
  const on = groupStatusFrom([], [], two)
  const offRows = [{ provider: 'magpie-anthropic', model: '*' }]
  const choices = { 'magpie-anthropic': { open: true, status: on } }
  assert.deepEqual(Object.keys(pruneFoldChoices(choices, [two], offRows, [])), [],
    'the expanded choice from the enabled state must be forgotten')
})
check('on → off → on does not resurrect the old choice', () => {
  const on = groupStatusFrom([], [], two)
  const offRows = [{ provider: 'magpie-anthropic', model: '*' }]
  const expandedWhileOn = { open: true, status: on }
  // 先全关：清理掉这条记录
  const afterOff = pruneFoldChoices({ 'magpie-anthropic': expandedWhileOn }, [two], offRows, [])
  assert.deepEqual(Object.keys(afterOff), [])
  // 再全开：没有记录了，回到默认展开
  const status = groupStatusFrom([], [], two)
  assert.equal(status, 'on')
  assert.equal(groupOpenFromChoice(afterOff['magpie-anthropic'], status), true)
})

// ---- modelOffFrom 与服务端优先级一致 ----
check('exception wins over wildcard for a single model', () => {
  const rows = [{ provider: 'p', model: '*' }]
  assert.equal(modelOffFrom(rows, [{ provider: 'p', model: 'm1' }], 'p', 'm1'), false)
  assert.equal(modelOffFrom(rows, [{ provider: 'p', model: 'm1' }], 'p', 'm2'), true)
})

console.log(results.join('\n'))
const failed = results.filter((r) => r.startsWith('FAIL'))
console.log(`\n${results.length - failed.length}/${results.length} passed`)
if (failed.length) process.exit(1)
