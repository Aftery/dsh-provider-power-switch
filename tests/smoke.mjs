// 冒烟测试：宿主半区在无 cordis 环境下能否安全加载。
// 运行：node --test tests/smoke.mjs
import test from 'node:test'
import assert from 'node:assert/strict'

test('module shape', async () => {
  const src = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/index.js', import.meta.url), 'utf8'))
  assert.match(src, /export const name = 'dsh-provider-power-switch'/)
  // inject 必须声明 'llm'（cordis 契约：ctx.get 需 inject 声明，漏声明会抛
  // cannot get property "llm" without inject）
  assert.match(src, /export const inject = \['llm'\]/)
  assert.match(src, /export function apply\(ctx\)/)
  assert.match(src, /llm\/stream/)
  assert.match(src, /statePath\(\)/)
  assert.match(src, /setProvider/)
  assert.match(src, /setAll/)
  assert.match(src, /listProviders/)
})

test('RPC 服务原型必须打 Remote 方法标记', async () => {
  const src = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/index.js', import.meta.url), 'utf8'))
  // gateway（dsh-api-gateway/lib/index.js resolveSrcDescriptor）只认带标记的方法；
  // 缺标记会抛 gateway/invocation-unavailable，RPC 全部不可达、host 方法不执行、
  // 客户端只能拿到兜底空对象且无任何日志。这是 0.1.x 长期"空列表无日志"的真根因。
  assert.match(src, /markRemoteMethods\(ModelSwitchService\.prototype, \['snapshot', 'listProviders', 'setProvider', 'setAll'\]\)/)
  assert.match(src, /REMOTE_METHOD_DESCRIPTOR = '@deepseek-ai\/dsh-typert-protocol\/remote-methods'/)
})

test('RPC 服务 fiber 的 inject 必须为空数组', async () => {
  const src = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../src/index.js', import.meta.url), 'utf8'))
  // TypertRemoteService 子类声明 inject 会让服务 fiber 等不到注入而不激活；
  // 金标准 dsh-model-fallback-queue 的 service 也是 static inject = [] + 模块级桥接。
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
  assert.match(src, /settings\.models\.footer/)
  assert.match(src, /TYPERT_REMOTE/)
  // descriptor.id 必须是 `<package>#<namespace>/<method>` 格式：
  // typert 用 endpoint.indexOf('/') 切分，缺 '/' 会让 namespace 错位、RPC 全落空。
  assert.match(src, /id: `\$\{NS\}#\$\{NS\}\/snapshot`/)
  assert.match(src, /id: `\$\{NS\}#\$\{NS\}\/listProviders`/)
  assert.match(src, /id: `\$\{NS\}#\$\{NS\}\/setProvider`/)
  assert.match(src, /id: `\$\{NS\}#\$\{NS\}\/setAll`/)
})
