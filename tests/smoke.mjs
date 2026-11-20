// 冒烟测试：宿主半区在无 cordis 环境下能否安全加载 + 新 RPC 形状检查。
// 运行：node --test tests/smoke.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

test('module shape', async () => {
  const src = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/index.js', import.meta.url), 'utf8'))
  assert.match(src, /export const name = 'dsh-provider-power-switch'/)
  assert.match(src, /export const inject = \['llm', 'settings'\]/)
  assert.match(src, /export function apply\(ctx\)/)
  assert.match(src, /llm\/stream/)
  assert.match(src, /statePath\(\)/)
  assert.match(src, /setModel/)
  assert.match(src, /setGroup/)
  assert.match(src, /listModels/)
})

test('RPC 服务原型必须打 Remote 方法标记（含新方法）', async () => {
  const src = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/index.js', import.meta.url), 'utf8'))
  assert.match(src, /markRemoteMethods\(ModelSwitchService\.prototype, \[/)
  assert.match(src, /'snapshot', 'listModels', 'listProviders', 'setModel', 'setGroup', 'setProvider', 'setAll'/)
  assert.match(src, /REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai\/dsh-typert-protocol\/remote-methods'/)
})

test('RPC 服务 fiber 的 inject 必须为空数组', async () => {
  const src = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/index.js', import.meta.url), 'utf8'))
  assert.match(src, /static inject = \[\]/)
})

test('state path logic', async () => {
  const src = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/index.js', import.meta.url), 'utf8'))
  assert.match(src, /provider-power-switch-state\.json/)
  assert.match(src, /process\.env\.DSH_HOME/)
  assert.match(src, /rename\(tmp, target\)/)
})

test('client half shape', async () => {
  const src = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/client.js', import.meta.url), 'utf8'))
  assert.match(src, /__ModuleLoader__\.load/)
  assert.match(src, /settings\.section/)
  assert.match(src, /TYPERT_REMOTE/)
  assert.match(src, /id: `\$\{NS\}#\$\{NS\}\/listModels`/)
  assert.match(src, /id: `\$\{NS\}#\$\{NS\}\/setModel`/)
  assert.match(src, /id: `\$\{NS\}#\$\{NS\}\/setGroup`/)
  assert.match(src, /dmps-group/)
  assert.match(src, /dmps-switch/)
})
