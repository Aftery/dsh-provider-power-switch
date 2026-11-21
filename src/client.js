/**
 * dsh-provider-power-switch — client half (Web UI).
 *
 * 按供应商分组的模型开关：在「设置 → 模型开关」分节列出每个供应商，
 * 供应商下每个模型一行开关，支持搜索、全选/取消、整组开关。
 *
 * RPC 走 ctx.remote.$mount(TYPERT_REMOTE) 挂自己的 remote face，
 * 内层 ctx.inject 显式声明 'remote.dsh-provider-power-switch' 拿 face。
 *
 * 主题：只用 --dsw-alias-* token；组件内样式用注入 style 标签，卸载即清理。
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
        title: '模型开关',
        subtitle: '按供应商分组管理模型，关闭后发往该模型的请求会被立即拦截，不消耗配额。',
        search: '搜索模型或供应商…',
        noMatch: '没有匹配的模型。',
        empty: '没有检测到可切换的模型',
        emptyReason: '没有检测到可切换的模型：当前没有已注册的模型适配器或已配置的模型。若确实装了提供商，请把这条提示连同日志发给开发者。',
        groupOn: '全部启用',
        groupOff: '全部停用',
        allOn: '全部开启',
        allOff: '全部关闭',
        on: '启用',
        off: '停用',
        loadFailed: '读取失败：{err}',
        saveFailed: '保存失败：{err}',
        disabledHint: '该模型已停用：发往它的请求会被拦截并提示。',
        provider: '供应商',
        model: '模型',
        collapse: '收起该供应商',
        expand: '展开该供应商',
        status_on: '该供应商下的模型全部启用',
        status_partial: '该供应商下部分模型已停用',
        status_off: '该供应商下的模型全部停用',
        status_idle: '该供应商下没有模型',
      },
      en: {
        title: 'Model switches',
        subtitle: 'Manage models per provider. Disabled models are intercepted before any real request is sent, with no quota cost.',
        search: 'Search models or providers…',
        noMatch: 'No matching models.',
        empty: 'No switchable models detected',
        emptyReason: 'No switchable models detected: there is no registered model adapter or configured model yet.',
        groupOn: 'Enable all',
        groupOff: 'Disable all',
        allOn: 'Enable all',
        allOff: 'Disable all',
        on: 'Enable',
        off: 'Disable',
        loadFailed: 'Load failed: {err}',
        saveFailed: 'Save failed: {err}',
        disabledHint: 'This model is disabled: requests to it are intercepted with a notice.',
        provider: 'Provider',
        model: 'Model',
        collapse: 'Collapse this provider',
        expand: 'Expand this provider',
        status_on: 'All models of this provider are enabled',
        status_partial: 'Some models of this provider are disabled',
        status_off: 'All models of this provider are disabled',
        status_idle: 'This provider has no models',
      },
    }

    function t(key) {
      const dict = TEXT[localeId()] || TEXT.en
      return dict[key] || key
    }
    function fmt(key, vars) {
      let s = t(key)
      for (const [k, v] of Object.entries(vars || {})) s = s.replace(`{${k}}`, String(v))
      return s
    }

    /* ============================== 样式 ============================== */

    let styleEl = null
    function ensureStyle() {
      if (styleEl || typeof document === 'undefined') return
      styleEl = document.createElement('style')
      styleEl.id = 'dsh-provider-power-switch-style'
      styleEl.textContent = `
        .dmps-panel { display:flex; flex-direction:column; gap:12px; max-width:760px; color:var(--dsw-alias-label-primary); }
        .dmps-head { display:flex; flex-direction:column; gap:4px; }
        .dmps-title { font-size:16px; font-weight:600; line-height:24px; margin:0; }
        .dmps-sub { font-size:13px; line-height:20px; color:var(--dsw-alias-label-tertiary); margin:0; }
        .dmps-toolbar { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .dmps-search { flex:1 1 240px; min-width:0; box-sizing:border-box; height:32px; border-radius:var(--dsw-radius-md); border:.5px solid var(--dsw-alias-border-l4); background:var(--dsw-alias-bg-layer-1); color:var(--dsw-alias-label-primary); padding:0 10px; font-size:13px; }
        .dmps-search:focus { border-color:var(--dsw-alias-state-business-primary); outline:none; }
        .dmps-btn { font-size:12px; line-height:20px; padding:4px 12px; border-radius:var(--dsw-radius-md); border:.5px solid var(--dsw-alias-border-l3); background:transparent; color:var(--dsw-alias-label-primary); cursor:pointer; }
        .dmps-btn:hover { background:var(--dsw-alias-interactive-bg-hover); }
        .dmps-btn:disabled { opacity:.4; cursor:default; }
        .dmps-groups { display:flex; flex-direction:column; gap:16px; }
        .dmps-group { border:.5px solid var(--dsw-alias-settings-card-stroke); background:var(--dsw-alias-settings-card-fill); border-radius:var(--dsw-radius-xl); padding:12px 14px; display:flex; flex-direction:column; gap:8px; }
        .dmps-group-head { display:flex; align-items:center; gap:10px; }
        .dmps-collapse { display:inline-flex; align-items:center; gap:10px; min-width:0; border:none; border-radius:var(--dsw-radius-md); background:transparent; color:inherit; font:inherit; padding:2px 4px; margin-left:-6px; cursor:pointer; text-align:left; }
        .dmps-collapse:hover { background:var(--dsw-alias-interactive-bg-hover); }
        .dmps-collapse:hover .dmps-caret { color:var(--dsw-alias-label-primary); }
        .dmps-collapse:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary, #4c6ef5); outline-offset:1px; }
        .dmps-collapse:disabled { opacity:.5; cursor:default; }
        .dmps-caret { flex:0 0 auto; width:0; height:0; border-left:5px solid currentColor; border-top:4px solid transparent; border-bottom:4px solid transparent; color:var(--dsw-alias-label-secondary); transition:transform .15s; }
        .dmps-collapse[aria-expanded="true"] .dmps-caret { transform:rotate(90deg); }
        .dmps-dot { flex:0 0 auto; width:8px; height:8px; border-radius:50%; background:var(--dsw-alias-label-caption); }
        .dmps-dot[data-state="on"] { background:var(--dsw-alias-state-success-primary, #22c55e); }
        .dmps-dot[data-state="partial"] { background:var(--dsw-alias-state-warn-primary, #f59e0b); }
        .dmps-dot[data-state="off"] { background:var(--dsw-alias-state-error-primary, #ec1313); }
        .dmps-group-name { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:14px; font-weight:500; line-height:22px; }
        .dmps-group-count { font-size:11px; color:var(--dsw-alias-label-tertiary); flex:0 0 auto; }
        .dmps-group-route { font-size:11px; color:var(--dsw-alias-label-tertiary); }
        .dmps-group-actions { margin-left:auto; display:inline-flex; gap:6px; }
        .dmps-group-actions .dmps-btn { height:26px; padding:2px 10px; font-size:11px; }
        .dmps-list { display:flex; flex-direction:column; gap:2px; }
        .dmps-row { display:flex; align-items:center; gap:10px; min-height:32px; padding:4px 8px; border-radius:var(--dsw-radius-md); }
        .dmps-row:hover { background:var(--dsw-alias-interactive-bg-hover); }
        .dmps-model-name { flex:1; min-width:0; font-size:13px; line-height:20px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .dmps-model-name[data-on="false"] { color:var(--dsw-alias-label-tertiary); }
        .dmps-model-id { font-size:11px; color:var(--dsw-alias-label-caption); font-family:var(--ds-font-family-code); max-width:45%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .dmps-switch { position:relative; width:36px; height:20px; border-radius:10px; border:none; cursor:pointer; transition:background .15s; padding:0; flex:0 0 auto; }
        .dmps-switch[data-on="true"] { background:var(--dsw-alias-state-business-primary, #4c6ef5); }
        .dmps-switch[data-on="false"] { background:var(--dsw-alias-fill-tertiary, rgba(0,0,0,0.18)); }
        .dmps-switch:focus-visible { outline:2px solid var(--dsw-alias-state-business-primary, #4c6ef5); outline-offset:2px; }
        .dmps-switch:disabled { opacity:.5; cursor:default; }
        .dmps-knob { position:absolute; top:2px; left:2px; width:16px; height:16px; border-radius:50%; background:#fff; transition:left .15s; box-shadow:0 1px 2px rgba(0,0,0,0.25); }
        .dmps-switch[data-on="true"] .dmps-knob { left:18px; }
        .dmps-empty { font-size:12px; color:var(--dsw-alias-label-tertiary); margin:8px 0; }
        .dmps-error { font-size:12px; color:var(--dsw-alias-state-error-primary); margin:0; }
      `
      document.head.appendChild(styleEl)
    }
    function removeStyle() {
      if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl)
      styleEl = null
    }

    /* ============================== RPC ============================== */

    const jsonCodec = (sym) => ({ mode: 'strict', typeSymbol: sym, create: () => ({}) })
    const NS = 'dsh-provider-power-switch'

    const TYPERT_REMOTE = {
      package: 'dsh-provider-power-switch',
      descriptors: [
        { id: `${NS}#${NS}/snapshot`, service: 'ModelSwitchService', namespace: NS, method: 'snapshot', invocation: { kind: 'direct' }, parameters: [], result: { mode: 'src-json' } },
        { id: `${NS}#${NS}/listModels`, service: 'ModelSwitchService', namespace: NS, method: 'listModels', invocation: { kind: 'direct' }, parameters: [], result: { mode: 'src-json' } },
        { id: `${NS}#${NS}/setModel`, service: 'ModelSwitchService', namespace: NS, method: 'setModel', invocation: { kind: 'direct' }, parameters: [
          { name: 'provider', wire: 'provider', source: 'json', codec: jsonCodec('dsh-provider-power-switch#Provider') },
          { name: 'model', wire: 'model', source: 'json', codec: jsonCodec('dsh-provider-power-switch#Model') },
          { name: 'off', wire: 'off', source: 'json', codec: jsonCodec('dsh-provider-power-switch#Off') },
        ], result: { mode: 'src-json' } },
        { id: `${NS}#${NS}/setGroup`, service: 'ModelSwitchService', namespace: NS, method: 'setGroup', invocation: { kind: 'direct' }, parameters: [
          { name: 'provider', wire: 'provider', source: 'json', codec: jsonCodec('dsh-provider-power-switch#Provider') },
          { name: 'off', wire: 'off', source: 'json', codec: jsonCodec('dsh-provider-power-switch#Off') },
        ], result: { mode: 'src-json' } },
        { id: `${NS}#${NS}/setAll`, service: 'ModelSwitchService', namespace: NS, method: 'setAll', invocation: { kind: 'direct' }, parameters: [
          { name: 'providers', wire: 'providers', source: 'json', codec: jsonCodec('dsh-provider-power-switch#Providers') },
          { name: 'off', wire: 'off', source: 'json', codec: jsonCodec('dsh-provider-power-switch#Off') },
        ], result: { mode: 'src-json' } },
      ],
    }

    function unwrap(r) {
      if (r && typeof r === 'object' && r.ok === true && 'value' in r) return r.value
      if (r && typeof r === 'object' && r.ok === false) return null
      return r ?? null
    }

    /* ============================== 组件 ============================== */

    function Switch({ checked, onChange, disabled, label }) {
      return E('button', {
        type: 'button',
        className: 'dmps-switch',
        'data-on': String(checked),
        role: 'switch',
        'aria-checked': String(checked),
        'aria-label': label,
        title: label,
        disabled: !!disabled,
        onClick: () => onChange(!checked),
      }, E('span', { className: 'dmps-knob' }))
    }

    function ModelSwitchPanel({ rpc }) {
      const [groups, setGroups] = React.useState(null)
      const [disabled, setDisabled] = React.useState([])
      const [exceptions, setExceptions] = React.useState([])
      const [busy, setBusy] = React.useState(false)
      const [failure, setFailure] = React.useState('')
      const [query, setQuery] = React.useState('')
      const [collapsed, setCollapsed] = React.useState(() => [])

      const isCollapsed = (provider) => collapsed.includes(provider)
      const toggleGroup = (provider) => setCollapsed((prev) => (
        prev.includes(provider) ? prev.filter((p) => p !== provider) : [...prev, provider]
      ))

      const refresh = React.useCallback(async () => {
        try {
          const [gDoc, sDoc] = await Promise.all([rpc.listModels(), rpc.snapshot()])
          const list = (gDoc && gDoc.groups) || []
          setGroups(list)
          setDisabled((sDoc && sDoc.disabled) || [])
          setExceptions((sDoc && sDoc.exceptions) || [])
          setFailure(list.length === 0
            ? t('emptyReason') + (gDoc && gDoc.debug ? ` [${String(gDoc.debug).slice(0, 200)}]` : '')
            : '')
        } catch (e) {
          setGroups([])
          setFailure(fmt('loadFailed', { err: e?.message || String(e) }))
        }
      }, [rpc])

      React.useEffect(() => { refresh() }, [refresh])

      const applySnapshot = (snap) => {
        if (snap && Array.isArray(snap.disabled)) {
          setDisabled(snap.disabled)
          setExceptions(snap.exceptions || [])
        } else {
          refresh()
        }
      }

      const run = async (fn) => {
        setBusy(true)
        setFailure('')
        try { applySnapshot(unwrap(await fn())) }
        catch (e) { setFailure(fmt('saveFailed', { err: e?.message || String(e) })) }
        finally { setBusy(false) }
      }

      // 单个模型是否关闭：与服务端同一套优先级——例外（整组关后单独开的）优先于通配符。
      const isModelOff = (provider, model) => {
        if (exceptions.some((e) => e.provider === provider && e.model === model)) return false
        return disabled.some(
          (d) => d.provider === provider && (d.model === model || d.model === '*'),
        )
      }
      const isGroupOff = (provider) => disabled.some(
        (d) => d.provider === provider && d.model === '*',
      )
      // 折叠状态下靠这盏灯判断整组：全开绿 / 有关橙 / 全关红
      const groupStatus = (g) => {
        const total = g.models.length
        if (!total) return isGroupOff(g.provider) ? 'off' : 'idle'
        const off = g.models.filter((m) => isModelOff(g.provider, m.id)).length
        if (off === 0) return 'on'
        if (off === total) return 'off'
        return 'partial'
      }
      // 有关闭的模型时，计数改成「启用数/总数」，折叠时也能读出规模
      const groupCountLabel = (g) => {
        const total = g.models.length
        const off = g.models.filter((m) => isModelOff(g.provider, m.id)).length
        return off === 0 ? `${total}` : `${total - off}/${total}`
      }

      if (groups === null) {
        return E('div', { className: 'dmps-panel' }, E('p', { className: 'dmps-empty' }, '…'))
      }

      const q = query.trim().toLowerCase()
      const filtered = groups.map((g) => ({
        ...g,
        models: q
          ? g.models.filter((m) =>
              (g.displayName || g.provider).toLowerCase().includes(q)
              || g.provider.toLowerCase().includes(q)
              || m.name.toLowerCase().includes(q)
              || m.id.toLowerCase().includes(q))
          : g.models,
      })).filter((g) => g.models.length > 0)

      const allProviders = groups.map((g) => g.provider)

      return E('div', { className: 'dmps-panel' },
        E('div', { className: 'dmps-head' },
          E('h2', { className: 'dmps-title' }, t('title')),
          E('p', { className: 'dmps-sub' }, t('subtitle')),
        ),
        E('div', { className: 'dmps-toolbar' },
          E('input', {
            className: 'dmps-search',
            type: 'search',
            value: query,
            placeholder: t('search'),
            'aria-label': t('search'),
            onChange: (e) => setQuery(e.target.value),
          }),
          E('button', {
            type: 'button', className: 'dmps-btn', disabled: busy || allProviders.length === 0,
            onClick: () => run(() => rpc.setAll(allProviders, false)),
          }, t('allOn')),
          E('button', {
            type: 'button', className: 'dmps-btn', disabled: busy || allProviders.length === 0,
            onClick: () => run(() => rpc.setAll(allProviders, true)),
          }, t('allOff')),
        ),
        failure ? E('p', { className: 'dmps-error', role: 'alert' }, failure) : null,
        groups.length === 0
          ? E('p', { className: 'dmps-empty' }, t('empty'))
          : filtered.length === 0
            ? E('p', { className: 'dmps-empty' }, t('noMatch'))
            : E('div', { className: 'dmps-groups' },
                filtered.map((g) => {
                  // 搜索时忽略折叠状态，保证命中项一定可见
                  const open = q ? true : !isCollapsed(g.provider)
                  // 状态灯始终按整组模型统计，不受搜索过滤影响
                  const status = groupStatus(groups.find((x) => x.provider === g.provider) || g)
                  return E('section', { className: 'dmps-group', key: g.provider },
                    E('div', { className: 'dmps-group-head' },
                      E('button', {
                        type: 'button',
                        className: 'dmps-collapse',
                        'aria-expanded': String(open),
                        'aria-label': `${open ? t('collapse') : t('expand')}: ${g.displayName} · ${t('status_' + status)}`,
                        title: open ? t('collapse') : t('expand'),
                        disabled: busy,
                        onClick: () => toggleGroup(g.provider),
                      }, E('span', { className: 'dmps-caret' }),
                        E('span', {
                          className: 'dmps-dot',
                          'data-state': status,
                          'aria-hidden': 'true',
                          title: t('status_' + status),
                        }),
                        E('span', { className: 'dmps-group-name' }, g.displayName),
                        g.displayName !== g.provider
                          ? E('span', { className: 'dmps-group-route' }, g.provider)
                          : null,
                        E('span', { className: 'dmps-group-count' }, groupCountLabel(g))),
                      E('span', { className: 'dmps-group-actions' },
                        E('button', {
                          type: 'button', className: 'dmps-btn', disabled: busy,
                          onClick: () => run(() => rpc.setGroup(g.provider, false)),
                        }, t('groupOn')),
                        E('button', {
                          type: 'button', className: 'dmps-btn', disabled: busy,
                          onClick: () => run(() => rpc.setGroup(g.provider, true)),
                        }, t('groupOff')),
                      ),
                    ),
                    open ? E('div', { className: 'dmps-list' },
                      g.models.map((m) => {
                        const off = isModelOff(g.provider, m.id)
                        return E('div', { className: 'dmps-row', key: m.id },
                          E('span', {
                            className: 'dmps-model-name',
                            'data-on': String(!off),
                            title: off ? t('disabledHint') : undefined,
                          }, m.name),
                          m.name !== m.id
                            ? E('span', { className: 'dmps-model-id', title: m.id }, m.id)
                            : null,
                          E(Switch, {
                            checked: !off,
                            disabled: busy,
                            label: `${off ? t('on') : t('off')}: ${g.provider} / ${m.id}`,
                            onChange: (next) => run(() => rpc.setModel(g.provider, m.id, !next)),
                          }),
                        )
                      }),
                    ) : null,
                  )
                }),
              ),
      )
    }

    /* ============================== 导航图标 ============================== */

    // 设置左侧导航行的图标（settings.section.icon，按分节 id 匹配）。
    // 与 icon.svg 同一枚四芒星；用 currentColor 让外壳自己处理选中/未选中配色。
    // 控制点比 icon.svg 略靠外，让芒臂在 16px 导航行里也够粗，不至于细成一根线。
    const SPARK_PATH = 'M18 5.5 C20.6 13.2 22.8 15.4 30.5 18 C22.8 20.6 20.6 22.8 18 30.5'
      + ' C15.4 22.8 13.2 20.6 5.5 18 C13.2 15.4 15.4 13.2 18 5.5 Z'

    function NavIcon(props) {
      const edge = Number.isFinite(props?.size) ? props.size : 16
      return E('svg', {
        width: edge,
        height: edge,
        viewBox: '0 0 36 36',
        fill: 'none',
        'aria-hidden': 'true',
        focusable: 'false',
      }, E('path', { d: SPARK_PATH, fill: 'currentColor' }))
    }

    /* ---------- 导航图标的 DOM 兜底 ---------- */

    // 有些宿主（实测 dsh-tauri-ui）声明了 settings.section.icon 座位，面板里也能
    // 查到我们的注册项（active:true），但它画图标时用的是一张写死的 id 映射表
    // ——`Ft[e.id] ?? 齿轮`——从不读取该座位的注册内容。这种情况下上面的
    // slots.register 会「成功但完全不可见」。
    //
    // 所以再补一层兜底：直接找到标签匹配的那一行，隐藏宿主自己画的图标，
    // 用 CSS mask 把我们这枚四芒星画上去。mask 的可见色来自 currentColor，
    // 选中/未选中配色仍然由外壳掌控，不写死颜色。

    const NAV_ROW_SELECTOR = '[role="dialog"] nav button'
    const NAV_MARK = 'data-dmps-nav-icon'

    /** 四芒星的 mask（mask 只读 alpha，填充色值本身不参与显示）。 */
    function sparkMaskUrl() {
      const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">'
        + `<path d="${SPARK_PATH}" fill="#000"/></svg>`
      return `data:image/svg+xml,${encodeURIComponent(svg)}`
    }

    function navIconCss(url) {
      return [
        `[${NAV_MARK}] > svg { display: none; }`,
        `[${NAV_MARK}]::before {`,
        `  content: '';`,
        `  flex: none;`,
        `  width: 16px;`,
        `  height: 16px;`,
        `  background-color: currentColor;`,
        `  -webkit-mask-image: url("${url}");`,
        `  mask-image: url("${url}");`,
        `  -webkit-mask-repeat: no-repeat;`,
        `  mask-repeat: no-repeat;`,
        `  -webkit-mask-position: center;`,
        `  mask-position: center;`,
        `  -webkit-mask-size: 16px 16px;`,
        `  mask-size: 16px 16px;`,
        `}`,
      ].join('\n')
    }

    /**
     * 给当前分节的导航行换上我们的图标。
     * 只认「可见文本等于本分节 label」的那一行——空 label 一律不匹配，
     * 避免 locale 还没解析出来时把整排导航都标上。
     */
    function installNavIconStandIn(ctx) {
      if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
      ctx.effect(() => {
        const tag = document.createElement('style')
        tag.dataset.plugin = 'dsh-provider-power-switch'
        tag.dataset.pluginCss = 'dsh-provider-power-switch/settings-nav-icon'
        tag.textContent = navIconCss(sparkMaskUrl())
        document.head.appendChild(tag)

        let disposed = false
        let scheduled = false

        const sync = () => {
          scheduled = false
          if (disposed) return
          const wanted = String(t('title') ?? '').trim()
          if (!wanted) return
          for (const row of document.querySelectorAll(NAV_ROW_SELECTOR)) {
            const text = String(row.textContent ?? '').trim()
            if (text !== wanted) {
              row.removeAttribute(NAV_MARK)
              continue
            }
            // 宿主若已经画出我们的图标（同一个 36 viewBox 的四芒星），就交给它，不接管
            if (row.querySelector(':scope > svg[viewBox="0 0 36 36"]')) row.removeAttribute(NAV_MARK)
            else row.setAttribute(NAV_MARK, '')
          }
        }

        const schedule = () => {
          if (scheduled || disposed) return
          scheduled = true
          queueMicrotask(sync)
        }

        sync()
        // 只监听结构/文本变化，不监听 attribute——否则自己打标记会触发自己
        const observer = new MutationObserver(schedule)
        observer.observe(document.body, { childList: true, subtree: true, characterData: true })

        return () => {
          if (disposed) return
          disposed = true
          observer.disconnect()
          for (const row of document.querySelectorAll(`[${NAV_MARK}]`)) row.removeAttribute(NAV_MARK)
          tag.remove()
        }
      }, 'dsh-provider-power-switch: settings nav icon stand-in')
    }

    /* ============================== 注册 ============================== */

    return {
      inject: ['slots', 'remote'],
      async apply(ctx) {
        ensureStyle()
        ctx.effect(() => removeStyle, 'provider-power-switch style cleanup')

        const face = { rpcFace: null, error: '' }

        // 1) 先挂 remote namespace（可能抛错 → 降级）。
        try {
          const disposeRemote = await ctx.remote.$mount(TYPERT_REMOTE)
          ctx.effect(() => () => { void disposeRemote() }, 'provider-power-switch remote mount')
        } catch (e) {
          face.error = `RPC 挂载失败：${e?.message || String(e)}`
        }

        // 2) 经内层 inject 显式声明 namespace 键后读取 face。
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

        slots.inject('settings.section', () => {
          try {
            return slots.register({
              name: 'settings.section',
              id: 'dsh-provider-power-switch',
              order: 99,
              label: () => t('title'),
            }, (props) => E(ModelSwitchPanel, { ...props, rpc: makeRpc(face) }))
          } catch (e) {
            console.warn('[dsh-provider-power-switch] settings.section register failed', e)
            return undefined
          }
        })

        // 导航图标是独立座位，按分节 id 匹配；老宿主没声明这个座位时会被
        // slots.inject 直接跳过，不影响分节本身（外壳会退回默认齿轮）。
        slots.inject('settings.section.icon', () => {
          try {
            return slots.register({
              name: 'settings.section.icon',
              id: 'dsh-provider-power-switch',
              order: 99,
              label: () => t('title'),
            }, NavIcon)
          } catch (e) {
            console.warn('[dsh-provider-power-switch] settings.section.icon register failed', e)
            return undefined
          }
        })

        // 上面那条注册只对「读取该座位」的宿主有效。宿主不读时（实测 dsh-tauri-ui）
        // 它静默无效，所以再挂一层 DOM 兜底；两者互不冲突——宿主自己画出我们的
        // 四芒星时，兜底会主动让位。
        installNavIconStandIn(ctx)
      },
    }

    function makeRpc(face) {
      const noFace = (what) => new Error(face.error || `remote face 未就绪（${what} 不可用）`)
      return {
        async snapshot() {
          if (!face.rpcFace?.snapshot) throw noFace('snapshot')
          const r = unwrap(await face.rpcFace.snapshot())
          return r && Array.isArray(r.disabled) ? r : { disabled: [] }
        },
        async listModels() {
          if (!face.rpcFace?.listModels) throw noFace('listModels')
          const r = unwrap(await face.rpcFace.listModels())
          return r && Array.isArray(r.groups) ? r : { groups: [], debug: r?.debug }
        },
        async setModel(provider, model, off) {
          if (!face.rpcFace?.setModel) throw noFace('setModel')
          return unwrap(await face.rpcFace.setModel(provider, model, off))
        },
        async setGroup(provider, off) {
          if (!face.rpcFace?.setGroup) throw noFace('setGroup')
          return unwrap(await face.rpcFace.setGroup(provider, off))
        },
        async setAll(providers, off) {
          if (!face.rpcFace?.setAll) throw noFace('setAll')
          return unwrap(await face.rpcFace.setAll(providers, off))
        },
      }
    }
  },
})
