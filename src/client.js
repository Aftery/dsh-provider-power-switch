/**
 * dsh-provider-power-switch — client half (Web UI).
 *
 * 供应商级别模型开关：在「设置」页注册一个独立的「模型开关」分节
 * （settings.section 顶层 list 插槽，与 dsh-model-fallback-queue 同一挂载点），
 * 每个已注册的模型供应商一行开关，外加「全部开启/全部关闭」。
 *
 * 为什么用 settings.section 而不用 settings.models.footer：footer 是官方模型页
 * 内部 children 子插槽，在 Desktop 里从未成功渲染（面板静默消失、无任何错误）；
 * settings.section 由 @deepseek-ai/dsh-client-ui-settings-general 声明为
 * kind:"list"/scope:"root"，是被 dsh-model-fallback-queue 等插件验证过的稳定挂载点。
 *
 * RPC 走 ctx.remote.$mount(TYPERT_REMOTE) 挂自己的 remote face，
 * 与 dsh-model-fallback-queue 相同的机制。face 通过内层 ctx.inject 拿
 * 'remote.dsh-provider-power-switch'（外层 ctx.remote 属性链上未必有该键）。
 *
 * 主题规范：只用 --dsw-alias-* token；组件内样式用注入 style 标签，卸载即清理。
 */

window.__ModuleLoader__.load({
  id: 'dsh-provider-power-switch',
  factory: (require) => {
    const React = require('react')
    const E = React.createElement

    /* ============================== i18n ============================== */

    function localeId() {
      const raw = (typeof document !== 'undefined' && document.documentElement && document.documentElement.lang)
        || (typeof navigator !== 'undefined' && navigator.language) || 'en'
      return String(raw).toLowerCase().startsWith('zh') ? 'zh' : 'en'
    }

    const TEXT = {
      zh: {
        on: '已启用',
        off: '已停用',
        enable: '启用',
        disable: '停用',
        enableAll: '全部开启',
        disableAll: '全部关闭',
        footerTitle: '模型开关',
        empty: '没有检测到可切换的模型供应商',
        emptyReason: '没有检测到可切换的模型供应商：宿主当前没有已注册的模型适配器。若确实装了提供商，请把这条提示连同日志发给开发者。',
        loadFailed: '读取失败：{err}',
        saveFailed: '保存失败：{err}',
        disabledHint: '该供应商已停用：发往它的请求会被拦截并提示。',
      },
      en: {
        on: 'Enabled',
        off: 'Disabled',
        enable: 'Enable',
        disable: 'Disable',
        enableAll: 'Enable all',
        disableAll: 'Disable all',
        footerTitle: 'Model switches',
        empty: 'No switchable model providers detected',
        emptyReason: 'No switchable model providers detected: the host currently has no registered model adapters.',
        loadFailed: 'Load failed: {err}',
        saveFailed: 'Save failed: {err}',
        disabledHint: 'This provider is disabled: requests to it are intercepted with a notice.',
      },
    }

    function t(key) {
      const dict = TEXT[localeId()] || TEXT.en
      return dict[key] || key
    }

    /* ============================== 样式 ============================== */

    let styleEl = null
    function ensureStyle() {
      if (styleEl || typeof document === 'undefined') return
      styleEl = document.createElement('style')
      styleEl.id = 'dsh-provider-power-switch-style'
      styleEl.textContent = `
        .dmps-panel { display:flex; flex-direction:column; gap:6px; margin-top:4px; }
        .dmps-title { font-size:12px; font-weight:600; color: var(--dsw-alias-text-secondary, #6b7280); }
        .dmps-rows { display:flex; flex-direction:column; gap:4px; }
        .dmps-row { display:flex; align-items:center; gap:10px; padding:6px 8px; border-radius:8px; }
        .dmps-row:hover { background: var(--dsw-alias-fill-secondary, rgba(0,0,0,0.03)); }
        .dmps-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; color: var(--dsw-alias-text-primary, inherit); }
        .dmps-name[data-on="false"] { opacity:.55; }
        .dmps-switch { position:relative; width:36px; height:20px; border-radius:10px; border:none; cursor:pointer; transition:background .15s; padding:0; flex:0 0 auto; }
        .dmps-switch[data-on="true"] { background: var(--dsw-alias-accent, #4c6ef5); }
        .dmps-switch[data-on="false"] { background: var(--dsw-alias-fill-tertiary, rgba(0,0,0,0.18)); }
        .dmps-switch:focus-visible { outline:2px solid var(--dsw-alias-accent, #4c6ef5); outline-offset:2px; }
        .dmps-switch:disabled { opacity:.5; cursor:default; }
        .dmps-knob { position:absolute; top:2px; left:2px; width:16px; height:16px; border-radius:50%; background:#fff; transition:left .15s; box-shadow:0 1px 2px rgba(0,0,0,0.25); }
        .dmps-switch[data-on="true"] .dmps-knob { left:18px; }
        .dmps-label { font-size:12px; line-height:20px; color: var(--dsw-alias-text-secondary, #6b7280); }
        .dmps-toolbar { display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
        .dmps-btn { font-size:12px; line-height:1; padding:6px 12px; border-radius:999px; border:1px solid var(--dsw-alias-border-subtle, rgba(0,0,0,0.12)); background:transparent; color: var(--dsw-alias-text-primary, inherit); cursor:pointer; }
        .dmps-btn:hover { border-color: var(--dsw-alias-accent, #4c6ef5); color: var(--dsw-alias-accent, #4c6ef5); }
        .dmps-btn:disabled { opacity:.5; cursor:default; }
        .dmps-empty { font-size:12px; color: var(--dsw-alias-text-secondary, #6b7280); }
      `
      document.head.appendChild(styleEl)
    }
    function removeStyle() {
      if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl)
      styleEl = null
    }

    /* ============================== RPC ============================== */

    const jsonCodec = (sym) => ({ mode: 'strict', typeSymbol: sym, create: () => ({}) })

    // ⚠️ descriptor.id 的格式必须是 `<package>#<namespace>/<method>`：
    // typert 用 `endpoint.indexOf("/")` 切分 namespace 与 method，缺了 "/"
    // 时 indexOf 返回 -1，namespace 被切成 endpoint.slice(0,-1)（丢掉末字符），
    // RPC 调用全部落空、面板静默拿到空数据。参照 dsh-model-fallback-queue 的写法。
    const NS = 'dsh-provider-power-switch'

    const TYPERT_REMOTE = {
      package: 'dsh-provider-power-switch',
      descriptors: [
        {
          id: `${NS}#${NS}/snapshot`,
          service: 'ModelSwitchService',
          namespace: NS,
          method: 'snapshot',
          invocation: { kind: 'direct' },
          parameters: [],
          result: { mode: 'src-json' },
        },
        {
          id: `${NS}#${NS}/listProviders`,
          service: 'ModelSwitchService',
          namespace: NS,
          method: 'listProviders',
          invocation: { kind: 'direct' },
          parameters: [],
          result: { mode: 'src-json' },
        },
        {
          id: `${NS}#${NS}/setProvider`,
          service: 'ModelSwitchService',
          namespace: NS,
          method: 'setProvider',
          invocation: { kind: 'direct' },
          parameters: [
            { name: 'provider', wire: 'provider', source: 'json', codec: jsonCodec('dsh-provider-power-switch#Provider') },
            { name: 'off', wire: 'off', source: 'json', codec: jsonCodec('dsh-provider-power-switch#Off') },
          ],
          result: { mode: 'src-json' },
        },
        {
          id: `${NS}#${NS}/setAll`,
          service: 'ModelSwitchService',
          namespace: NS,
          method: 'setAll',
          invocation: { kind: 'direct' },
          parameters: [
            { name: 'providers', wire: 'providers', source: 'json', codec: jsonCodec('dsh-provider-power-switch#Providers') },
            { name: 'off', wire: 'off', source: 'json', codec: jsonCodec('dsh-provider-power-switch#Off') },
          ],
          result: { mode: 'src-json' },
        },
      ],
    }

    /**
     * typert face 返回值可能是 {ok,value} 信封，也可能是裸值。
     * 只拆「{ok:true, value}」这种真信封；裸对象（无 value 字段，即使有 ok）
     * 原样返回——宿主方法现在直接返回纯数据，不带 ok 字段，不会误伤。
     */
    function unwrap(r) {
      if (r && typeof r === 'object' && r.ok === true && 'value' in r) return r.value
      if (r && typeof r === 'object' && r.ok === false) return null
      return r ?? null
    }

    /* ============================== 组件 ============================== */

    function ModelSwitchPanel({ rpc }) {
      const [providers, setProviders] = React.useState(null)
      const [disabled, setDisabled] = React.useState(new Set())
      const [busy, setBusy] = React.useState(false)
      const [failure, setFailure] = React.useState('')

      const refresh = React.useCallback(async () => {
        try {
          const [pDoc, sDoc] = await Promise.all([
            rpc.listProviders(),
            rpc.snapshot(),
          ])
          const list = (pDoc && pDoc.providers) || []
          const dis = new Set((sDoc && sDoc.disabled) || [])
          setProviders(list)
          setDisabled(dis)
          // 列表为空时把宿主返回的原始对象显示出来：
          //  - 无 debug 字段 → host 仍是旧版 index.js
          //  - debug=source=...,active=...,declared=... → host 是新版，两路计数可判根因
          let raw = ''
          try { raw = JSON.stringify(pDoc) } catch { raw = String(pDoc) }
          setFailure(list.length === 0
            ? `${t('emptyReason')} [RAW:${String(raw).slice(0, 400)}]`
            : '')
        } catch (e) {
          setProviders([])
          setFailure(t('loadFailed').replace('{err}', e?.message || String(e)))
        }
      }, [rpc])

      React.useEffect(() => {
        refresh()
      }, [refresh])

      const toggle = async (provider) => {
        const isOn = !disabled.has(provider)
        setBusy(true)
        setFailure('')
        try {
          const snap = unwrap(await rpc.setProvider(provider, isOn))
          if (snap && Array.isArray(snap.disabled)) setDisabled(new Set(snap.disabled))
          else refresh()
        } catch (e) {
          setFailure(t('saveFailed').replace('{err}', e?.message || String(e)))
        } finally {
          setBusy(false)
        }
      }

      const setAll = async (off) => {
        if (!providers || providers.length === 0) return
        setBusy(true)
        setFailure('')
        try {
          const snap = unwrap(await rpc.setAll(providers, off))
          if (snap && Array.isArray(snap.disabled)) setDisabled(new Set(snap.disabled))
          else refresh()
        } catch (e) {
          setFailure(t('saveFailed').replace('{err}', e?.message || String(e)))
        } finally {
          setBusy(false)
        }
      }

      if (providers === null) return E('div', { className: 'dmps-panel' }, E('span', { className: 'dmps-empty' }, '…'))

      return E('div', { className: 'dmps-panel' },
        E('div', { className: 'dmps-toolbar' },
          E('span', { className: 'dmps-title' }, t('footerTitle')),
          E('button', { type: 'button', className: 'dmps-btn', disabled: busy || !providers.length, onClick: () => setAll(false) }, t('enableAll')),
          E('button', { type: 'button', className: 'dmps-btn', disabled: busy || !providers.length, onClick: () => setAll(true) }, t('disableAll')),
        ),
        providers.length === 0
          ? null
          : E('div', { className: 'dmps-rows' },
              providers.map((p) => {
                const isOn = !disabled.has(p)
                return E('div', { className: 'dmps-row', key: p },
                  E('span', { className: 'dmps-name', 'data-on': String(isOn), title: isOn ? p : `${p} — ${t('disabledHint')}` }, p),
                  E('span', { className: 'dmps-label' }, isOn ? t('on') : t('off')),
                  E('button', {
                    type: 'button',
                    className: 'dmps-switch',
                    'data-on': String(isOn),
                    role: 'switch',
                    'aria-checked': String(isOn),
                    'aria-label': `${t(isOn ? 'disable' : 'enable')}: ${p}`,
                    disabled: busy,
                    onClick: () => toggle(p),
                  }, E('span', { className: 'dmps-knob' })),
                )
              }),
            ),
        // 空列表 / 失败原因：统一在这里显示，不再只说"没有检测到"
        failure
          ? E('div', { className: 'dmps-empty', style: { color: 'var(--dsw-alias-danger, #dc2626)' } }, failure)
          : null,
      )
    }

    /* ============================== 注册 ============================== */

    return {
      inject: ['slots', 'remote'],
      async apply(ctx) {
        ensureStyle()
        ctx.effect(() => removeStyle, 'provider-power-switch style cleanup')

        // ⚠️ 关键教训（前两版踩坑）：挂载点必须是「settings.section」这个顶层
        // list 插槽（由 @deepseek-ai/dsh-client-ui-settings-general 声明），
        // 而不是 settings.models.footer 那种依赖官方模型页内部 children 的子插槽——
        // 后者在 Desktop 里从未成功渲染过（面板静默消失、无任何错误）。
        // 参照本机已稳定工作的 dsh-model-fallback-queue，它正是用 settings.section
        // 注册一个独立分节（id 唯一、order 靠后、label 出导航项）。
        //
        // ⚠️ 0.1.2 实锤 bug：直接在 apply 的 ctx 上读 `ctx.remote['dsh-provider-power-switch']`
        // 会抛 `cannot get property "remote.dsh-provider-power-switch" without inject`。
        // 原因：外层 inject 只声明了 'remote'，而 `ctx.remote.<ns>` 是 cordis 的动态
        // namespace 取值，等价于 ctx.get('remote.<ns>')，必须把 `remote.<ns>` 单独
        // 声明进当前 fiber 的 inject。正确做法（同 fallback-queue）是 $mount 之后
        // 用内层 `ctx.inject([... 'remote.dsh-provider-power-switch'], cb)` 拿 face。
        //
        // face 用可变 holder，让面板方法在「调用时」读到最终结果，而不是注册瞬间
        // 的陈旧快照；无论 RPC 成败，分节都必须注册（失败降级成面板内红字）。
        const face = { rpcFace: null, error: '' }

        // 1) 先挂 remote namespace（可能抛错 → 降级）。
        try {
          const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
          ctx.effect(() => () => { void disposeRemote() }, 'provider-power-switch remote mount')
        } catch (e) {
          face.error = `RPC 挂载失败：${e?.message || String(e)}`
        }

        // 2) 经内层 inject 显式声明 namespace 键后读取 face（绝不能直接读 ctx.remote[ns]）。
        if (!face.error) {
          try {
            if (typeof ctx.inject === 'function') {
              await ctx.inject(
                ['remote', 'remote.dsh-provider-power-switch'],
                (rctx) => { face.rpcFace = rctx.remote?.['dsh-provider-power-switch'] || null },
              )
            }
            if (!face.rpcFace) face.error = 'remote face 未就绪（$mount 成功但 namespace 未出现）'
          } catch (e) {
            face.error = `RPC 挂载失败：${e?.message || String(e)}`
          }
        }

        // 3) 无论 RPC 成败，分节都必须注册（红字降级而非整块消失）。
        const slots = ctx.get('slots')
        if (!slots || typeof slots.register !== 'function') return

        // settings.section 是 list 插槽：注册成设置页左侧导航里的独立「模型开关」分节。
        slots.inject('settings.section', () => {
          try {
            return slots.register({
              name: 'settings.section',
              id: 'dsh-provider-power-switch',
              order: 99,
              label: () => t('footerTitle'),
            }, (props) => E(ModelSwitchPanel, { ...props, rpc: makeRpc(face) }))
          } catch (e) {
            console.warn('[dsh-provider-power-switch] settings.section register failed', e)
            return undefined
          }
        })
      },
    }

    function makeRpc(face) {
      // face 是可变 holder：调用时读最新值，避免把注册瞬间的 null 固化进面板。
      // face.rpcFace 可能一直是 undefined（face 未挂上）：每个调用都把失败明确抛出，
      // 由面板显示具体原因，绝不静默返回空数组。
      const noFace = (what) => new Error(face.error || `remote face 未就绪（${what} 不可用）`)
      return {
        async snapshot() {
          if (!face.rpcFace?.snapshot) throw noFace('snapshot')
          const r = unwrap(await face.rpcFace.snapshot())
          return r && Array.isArray(r.disabled) ? r : { disabled: [] }
        },
        async listProviders() {
          if (!face.rpcFace?.listProviders) throw noFace('listProviders')
          const r = unwrap(await face.rpcFace.listProviders())
          return r && Array.isArray(r.providers) ? r : { providers: [] }
        },
        async setProvider(provider, off) {
          if (!face.rpcFace?.setProvider) throw noFace('setProvider')
          return unwrap(await face.rpcFace.setProvider(provider, off))
        },
        async setAll(providers, off) {
          if (!face.rpcFace?.setAll) throw noFace('setAll')
          return unwrap(await face.rpcFace.setAll(providers, off))
        },
      }
    }
  },
})
