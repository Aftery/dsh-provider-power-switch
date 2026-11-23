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
    const ReactDOM = require('react-dom')
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
        ctxWindow: '上下文窗口',
        selectorFallback: '模型选择器加载中…',
        selectModel: '选择模型',
        noModels: '暂无可用模型',
        loading: '正在加载…',
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
        ctxWindow: 'Context window',
        selectorFallback: 'Loading model selector…',
        selectModel: 'Select model',
        noModels: 'No models available',
        loading: 'Loading…',
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
        .dmps-ctx-window { flex:0 0 auto; margin-left:auto; padding-left:10px; font-size:11px; line-height:20px; color:var(--dsw-alias-label-caption); font-variant-numeric:tabular-nums; }
        .dmps-sel { position:relative; min-width:0; }
        .dmps-sel-trigger { display:inline-flex; align-items:center; gap:4px; height:28px; padding:0 8px; border-radius:var(--dsw-radius-sm); border:none; background:transparent; color:var(--dsw-alias-label-secondary); font-size:13px; line-height:20px; cursor:pointer; max-width:360px; }
        .dmps-sel-trigger:hover:not(:disabled) { background:var(--dsw-alias-interactive-bg-hover); }
        .dmps-sel-trigger:disabled { color:var(--dsw-alias-label-dimmed); cursor:default; }
        .dmps-sel-name { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0; }
        .dmps-sel-caret { flex:0 0 auto; color:var(--dsw-alias-label-caption); }
        .dmps-sel-menu { z-index:99999; min-width:240px; max-width:360px; overflow:auto; background:var(--dsw-alias-bg-layer-2, var(--dsw-alias-settings-card-fill)); border:.5px solid var(--dsw-alias-border-l3); border-radius:var(--dsw-radius-lg); padding:4px; box-shadow:0 8px 24px rgba(0,0,0,0.18); }
        .dmps-sel-group { padding:4px 0; }
        .dmps-sel-group-title { padding:4px 10px; font-size:11px; line-height:16px; color:var(--dsw-alias-label-caption); }
        .dmps-sel-item { display:flex; align-items:center; gap:8px; width:100%; padding:5px 10px; border:none; border-radius:var(--dsw-radius-md); background:transparent; color:var(--dsw-alias-label-primary); font-size:13px; line-height:20px; cursor:pointer; text-align:left; }
        .dmps-sel-item:hover { background:var(--dsw-alias-interactive-bg-hover); }
        .dmps-sel-item[data-selected="true"] { color:var(--dsw-alias-state-business-primary); }
        .dmps-sel-item-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .dmps-sel-check { flex:0 0 auto; }
        .dmps-sel-empty { padding:12px 10px; font-size:12px; color:var(--dsw-alias-label-tertiary); }
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
        { id: `${NS}#${NS}/contextWindowFor`, service: 'ModelSwitchService', namespace: NS, method: 'contextWindowFor', invocation: { kind: 'direct' }, parameters: [
          { name: 'provider', wire: 'provider', source: 'json', codec: jsonCodec('dsh-provider-power-switch#Provider') },
          { name: 'model', wire: 'model', source: 'json', codec: jsonCodec('dsh-provider-power-switch#Model') },
        ], result: { mode: 'src-json' } },
      ],
    }

    function unwrap(r) {
      if (r && typeof r === 'object' && r.ok === true && 'value' in r) return r.value
      if (r && typeof r === 'object' && r.ok === false) return null
      return r ?? null
    }

    /* ======================= 共享开关状态（设置页 ↔ 选择器） ======================= */

    // 选择器要同步、无 RPC 地判断「某模型是否已停用」，所以把快照缓存到模块内，
    // 设置页每次改开关都推一份过来；选择器座位挂载时再从 RPC 拉一次作初始化。
    let switchState = { disabled: [], exceptions: [] }
    const switchListeners = new Set()
    function setSwitchState(next) {
      switchState = {
        disabled: Array.isArray(next?.disabled) ? next.disabled : [],
        exceptions: Array.isArray(next?.exceptions) ? next.exceptions : [],
      }
      for (const l of switchListeners) l()
    }
    function subscribeSwitch(listener) {
      switchListeners.add(listener)
      return () => switchListeners.delete(listener)
    }
    function isDisabledFrom(state, provider, model) {
      if (state.exceptions.some((e) => e.provider === provider && e.model === model)) return false
      return state.disabled.some((d) =>
        d.provider === provider && (d.model === model || d.model === '*'))
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

    /**
     * 单个模型是否关闭（纯函数，服务端/设置页/选择器同一套优先级）：
     * 例外（整组关后又单独开的）优先于通配符，通配符优先于精确键。
     */
    function modelOffFrom(disabledList, exceptionList, provider, model) {
      if ((exceptionList || []).some((e) => e.provider === provider && e.model === model)) return false
      return (disabledList || []).some(
        (d) => d.provider === provider && (d.model === model || d.model === '*'),
      )
    }

    /** 整组状态灯：on 全开 / partial 部分停用 / off 全停 / idle 无模型。 */
    function groupStatusFrom(disabledList, exceptionList, group) {
      const models = (group && group.models) || []
      if (models.length === 0) {
        const wildcard = (disabledList || []).some(
          (d) => d.provider === group.provider && d.model === '*',
        )
        return wildcard ? 'off' : 'idle'
      }
      const off = models.filter((m) => modelOffFrom(disabledList, exceptionList, group.provider, m.id)).length
      if (off === 0) return 'on'
      return off === models.length ? 'off' : 'partial'
    }

    /**
     * 默认折叠规则：整组模型全部关闭 → 默认收起，其余展开。
     * 一键「全部关闭」之后满屏都是躺平的组，按默认收起后整页只剩
     * 供应商名 + 状态灯 + 计数，需要时再点开。
     */
    function groupOpenByDefault(status) {
      return status !== 'off'
    }

    /**
     * 用户手点过的折叠选择只在「点下去那一刻的整组状态灯」下有效；
     * 状态变了（例如刚被整组停用、又重新启用）旧选择就作废，回到默认规则，
     * 这样「全部关闭」后该组一定听话地收起，不用逐组再点一次。
     * choice = { open, status }
     */
    function groupOpenFromChoice(choice, status) {
      if (!choice || choice.status !== status) return groupOpenByDefault(status)
      return choice.open === true
    }

    /**
     * 清掉因为状态变化而失效的手点记录。
     * 单看 status 相等还不够：on → off → on 会让状态回到同一个值，旧记录
     * 就会诈尸。所以状态一变就把它删掉，谁也别想记住两个状态之前的意图。
     */
    function pruneFoldChoices(choices, groups, disabledList, exceptionList) {
      const next = {}
      let changed = false
      for (const [provider, choice] of Object.entries(choices || {})) {
        const group = (groups || []).find((g) => g.provider === provider)
        if (!group || !choice) { changed = true; continue }
        if (groupStatusFrom(disabledList, exceptionList, group) !== choice.status) { changed = true; continue }
        next[provider] = choice
      }
      return changed ? next : choices
    }

    function ModelSwitchPanel({ rpc }) {
      const [groups, setGroups] = React.useState(null)
      const [disabled, setDisabled] = React.useState([])
      const [exceptions, setExceptions] = React.useState([])
      const [busy, setBusy] = React.useState(false)
      const [failure, setFailure] = React.useState('')
      const [query, setQuery] = React.useState('')
      // 折叠状态只记「用户亲手点过的那一下」：provider → { open, status }，
      // status 是点下去那一刻该组的状态灯值（on/partial/off）。
      // 状态一旦变了（例如刚被整组停用），旧选择就作废，回到默认规则。
      const [foldChoice, setFoldChoice] = React.useState(() => ({}))

      const isGroupOpen = (provider, status) => (
        groupOpenFromChoice(foldChoice[provider], status)
      )
      const toggleGroup = (provider, status) => setFoldChoice((prev) => ({
        ...prev,
        [provider]: { open: !isGroupOpen(provider, status), status },
      }))

      // 组的状态一变，旧的手点记录立即作废：否则「全关时手点展开」会留到
      // 下一次全关，把本该默认收起的组又撑开。这里只做清理，不改折叠结果。
      React.useEffect(() => {
        if (!Array.isArray(groups)) return
        setFoldChoice((prev) => pruneFoldChoices(prev, groups, disabled, exceptions))
      }, [groups, disabled, exceptions])

      const refresh = React.useCallback(async () => {
        try {
          const [gDoc, sDoc] = await Promise.all([rpc.listModels(), rpc.snapshot()])
          const list = (gDoc && gDoc.groups) || []
          setGroups(list)
          setDisabled((sDoc && sDoc.disabled) || [])
          setExceptions((sDoc && sDoc.exceptions) || [])
          setSwitchState(sDoc || {})
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
          setSwitchState(snap)
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
      const isModelOff = (provider, model) => modelOffFrom(disabled, exceptions, provider, model)
      // 折叠状态下靠这盏灯判断整组：全开绿 / 有关橙 / 全关红
      const groupStatus = (g) => groupStatusFrom(disabled, exceptions, g)
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
                  // 状态灯始终按整组模型统计，不受搜索过滤影响
                  const status = groupStatus(groups.find((x) => x.provider === g.provider) || g)
                  // 搜索时忽略折叠状态，保证命中项一定可见
                  const open = q ? true : isGroupOpen(g.provider, status)
                  return E('section', { className: 'dmps-group', key: g.provider },
                    E('div', { className: 'dmps-group-head' },
                      E('button', {
                        type: 'button',
                        className: 'dmps-collapse',
                        'aria-expanded': String(open),
                        'aria-label': `${open ? t('collapse') : t('expand')}: ${g.displayName} · ${t('status_' + status)}`,
                        title: open ? t('collapse') : t('expand'),
                        disabled: busy,
                        onClick: () => toggleGroup(g.provider, status),
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

    /* ======================= 模型选择器：包一层 ======================= */

    const SEAT = 'conversation.input.model'

    /**
     * 子槽降级策略：label/options 子槽完全不渲染第三方组件。
     *
     * 为什么不再手动重渲染子槽组件：这些组件（TeamModeToggle、qoder 徽标等）依赖
     * 框架注入的一整套 hooks（useSession/useProjection/useSessions/…）和它们各自的
     * inject(sessionId)，靠兄弟插件手抄转发必然遗漏，一旦缺一项就整格崩溃、被框架
     * 弃权回退宿主——这正是前面三次踩坑（useSession / t / manualRenderSlot）的根源。
     *
     * 放弃第三方 options/label 装饰，换取「绝不崩溃」；核心需求（隐藏停用模型 +
     * 上下文窗口长度）不受影响。模型名用 model.name 纯文本渲染，与宿主 fallback 一致。
     */

    // 上下文窗口缓存 + 订阅（异步 RPC，回来后触发选择器重渲染）。
    const windowCache = new Map()
    const windowPending = new Set()
    const windowListeners = new Set()
    let selectorRpc = null
    function formatWindow(n) {
      if (n >= 1_000_000) return `${Number((n / 1_000_000).toFixed(1))}M`
      if (n >= 1_000) return `${Math.round(n / 1_000)}K`
      return String(n)
    }

    /**
     * 包住宿主目录 store：getSnapshot 里剔除停用模型，并为当前已选中的停用模型
     * 留一格（否则触发按钮会退回"请选择模型"）。用稳定引用做记忆，避免
     * useSyncExternalStore 因每次新对象而无限重渲染。
     */
    function makeFilteredDirectory(store) {
      const listeners = new Set()
      let lastRaw = Symbol('init')
      let lastSwitch = null
      let lastResult = null
      const notify = () => { for (const l of listeners) l() }
      const unsubStore = typeof store.subscribe === 'function' ? store.subscribe(notify) : () => {}
      const unsubSwitch = subscribeSwitch(notify)
      return {
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener) },
        getSnapshot() {
          const raw = store.getSnapshot()
          if (raw === lastRaw && switchState === lastSwitch) return lastResult
          lastRaw = raw
          lastSwitch = switchState
          const groups = Array.isArray(raw?.groups)
            ? raw.groups.map((g) => ({
                ...g,
                models: (g.models || []).filter((m) =>
                  !isDisabledFrom(switchState, g.id, m.id)
                  || (raw.current && raw.current.provider === g.id && raw.current.model === m.id)),
              })).filter((g) => g.models.length > 0)
            : raw?.groups
          lastResult = raw ? { ...raw, groups } : raw
          return lastResult
        },
        dispose() { unsubStore(); unsubSwitch(); listeners.clear() },
      }
    }

    let ctxLocale = null

    /**
     * 完全自研的模型选择器（对齐 neartoken 的 A2 路线）：只消费座位注入的
     * plain props（available/directory/load/select/resolveText/t/locked），
     * 不渲染任何第三方子槽组件，因此不可能因别的插件缺 hooks 而崩溃。
     *
     * 功能：
     *  - 隐藏已停用模型（store 已被 makeFilteredDirectory 过滤）；
     *  - 每个模型行尾显示上下文窗口长度（128K / 64K，取不到就不显示）。
     * 代价：qoder 徽标 / agent-team「团队模式」行不再出现在这个选择器里
     * ——这是换取「绝不崩溃」的取舍，后续可再按需补。
     */
    function FilteredModelSelect(props) {
      const { locked, available, directory, load, select } = props
      const tt = props.t || t
      const state = React.useSyncExternalStore(
        (cb) => (typeof directory?.subscribe === 'function' ? directory.subscribe(cb) : () => {}),
        () => (typeof directory?.getSnapshot === 'function' ? directory.getSnapshot() : null),
      )
      const [open, setOpen] = React.useState(false)
      const [anchor, setAnchor] = React.useState(null)
      const [, force] = React.useState(0)
      const rootRef = React.useRef(null)
      const triggerRef = React.useRef(null)
      const menuRef = React.useRef(null)

      // 菜单是固定浮层：必须 portal 到 body（composer 有包含块会裁切），
      // 并按触发器的实际位置算坐标；下方空间不够就向上弹。
      const place = React.useCallback(() => {
        const el = triggerRef.current
        if (!el) return
        const rect = el.getBoundingClientRect()
        const gap = 6
        const MENU_PREF = 380
        const below = window.innerHeight - rect.bottom
        const above = rect.top
        const flipUp = below < Math.min(MENU_PREF, 200) && above > below
        const room = Math.max(120, (flipUp ? above : below) - gap * 2)
        const top = flipUp ? Math.max(gap, rect.top - gap) : rect.bottom + gap
        setAnchor({
          position: 'fixed',
          top,
          left: Math.max(8, Math.min(rect.left, window.innerWidth - 368)),
          maxHeight: Math.min(room, 420),
          // 向上弹时用 bottom 定位，避免高度未知导致的偏移
          ...(flipUp ? { top: 'auto', bottom: window.innerHeight - rect.top + gap } : {}),
        })
      }, [])

      // useLayoutEffect：在绘制前算好坐标，避免首帧闪现到左上角。
      React.useLayoutEffect(() => {
        if (!open) return
        place()
        const onScrollOrResize = () => place()
        window.addEventListener('resize', onScrollOrResize)
        // capture=true：composer 内部滚动也能收到
        window.addEventListener('scroll', onScrollOrResize, true)
        return () => {
          window.removeEventListener('resize', onScrollOrResize)
          window.removeEventListener('scroll', onScrollOrResize, true)
        }
      }, [open, place])

      React.useEffect(() => {
        if (!selectorRpc) return
        // 挂载时拉一次开关快照（设置页可能从未打开过）。
        selectorRpc.snapshot().then((s) => setSwitchState(s)).catch(() => {})
        const fn = () => force((n) => n + 1)
        windowListeners.add(fn)
        return () => windowListeners.delete(fn)
      }, [])

      React.useEffect(() => {
        if (open) load()
      }, [open, load])

      React.useEffect(() => {
        if (!open) return
        const onDoc = (e) => {
          // 菜单已 portal 到 body，两个容器都要判
          if (rootRef.current?.contains(e.target)) return
          if (menuRef.current?.contains(e.target)) return
          setOpen(false)
        }
        document.addEventListener('mousedown', onDoc)
        return () => document.removeEventListener('mousedown', onDoc)
      }, [open])

      const groups = state?.groups || []
      const current = state?.current
      const status = state?.status

      // 打开后为可见模型补齐上下文窗口长度。
      React.useEffect(() => {
        if (!selectorRpc || !open) return
        for (const g of groups) {
          for (const m of g.models) {
            const key = `${g.id}\n${m.id}`
            if (windowCache.has(key) || windowPending.has(key)) continue
            windowPending.add(key)
            selectorRpc.contextWindowFor(g.id, m.id).then((v) => {
              windowCache.set(key, v)
              windowPending.delete(key)
              for (const l of windowListeners) l()
            }).catch(() => { windowPending.delete(key) })
          }
        }
      }, [groups, open])

      if (!available) return null

      const currentName = current
        ? (groups.find((g) => g.id === current.provider)?.models.find((m) => m.id === current.model)?.name)
          || current.model
        : null

      const choose = (g, m) => {
        const selection = {
          provider: g.id,
          model: m.id,
          ...(m.reasoning?.defaultEffort !== undefined ? { reasoningEffort: m.reasoning.defaultEffort } : {}),
        }
        setOpen(false)
        if (select) Promise.resolve(select(selection)).catch(() => {})
      }

      const trigger = E('button', {
        type: 'button',
        className: 'dmps-sel-trigger',
        disabled: !!locked,
        ref: triggerRef,
        'aria-haspopup': 'menu',
        'aria-expanded': String(open),
        'aria-label': tt('selectModel'),
        onClick: () => setOpen((v) => !v),
      },
        E('span', { className: 'dmps-sel-name' }, currentName || tt('selectModel')),
        E('span', { className: 'dmps-sel-caret' }, open ? '▲' : '▼'))

      const shell = E('div', { className: 'dmps-sel', ref: rootRef }, trigger)
      if (!open) return shell

      const menuBody = groups.length === 0
        ? E('div', { className: 'dmps-sel-empty' }, status === 'loading' ? tt('loading') : tt('noModels'))
        : groups.map((g) => E('div', { className: 'dmps-sel-group', key: g.id },
            E('div', { className: 'dmps-sel-group-title' }, g.name),
            g.models.map((m) => {
              const win = windowCache.get(`${g.id}\n${m.id}`)
              const sel = current && current.provider === g.id && current.model === m.id
              return E('button', {
                type: 'button',
                className: 'dmps-sel-item',
                'data-selected': String(!!sel),
                role: 'menuitemradio',
                'aria-checked': String(!!sel),
                key: m.id,
                onClick: () => choose(g, m),
              },
                E('span', { className: 'dmps-sel-item-name' }, m.name),
                typeof win === 'number' && win > 0
                  ? E('span', { className: 'dmps-ctx-window', title: `${tt('ctxWindow')}: ${win.toLocaleString()} tokens` }, formatWindow(win))
                  : null,
                sel ? E('span', { className: 'dmps-sel-check' }, '✓') : null)
            }),
          ))

      // portal 到 body：composer 有包含块，留在原地会被裁切/撑开页面。
      const menu = E('div', {
        className: 'dmps-sel-menu',
        ref: menuRef,
        role: 'menu',
        style: anchor || { position: 'fixed', top: 0, left: 0, visibility: 'hidden' },
      }, menuBody)

      const host = typeof document !== 'undefined' ? document.body : null
      return E('div', { className: 'dmps-sel', ref: rootRef },
        trigger,
        host && typeof ReactDOM !== 'undefined' && ReactDOM.createPortal
          ? ReactDOM.createPortal(menu, host)
          : menu)
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
      inject: ['slots', 'remote', 'locale'],
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
        try { ctxLocale = ctx.get('locale') } catch { ctxLocale = null }
        selectorRpc = makeRpc(face)

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

        // 4) 模型选择器：包一层宿主选择器，隐藏已停用模型 + 显示上下文窗口。
        // 通过 ctx.inject 显式声明 modelDirectories（未进 inspect 目录的真实服务，
        // 宿主选择器和 neartoken 都在用），拿到按会话的目录解析器。
        const seatDispose = tryInjectSelectorSeat(ctx, slots)
        if (seatDispose) ctx.effect(() => seatDispose, 'provider-power-switch model seat cleanup')

        // 上面那条注册只对「读取该座位」的宿主有效。宿主不读时（实测 dsh-tauri-ui）
        // 它静默无效，所以再挂一层 DOM 兜底；两者互不冲突——宿主自己画出我们的
        // 四芒星时，兜底会主动让位。
        installNavIconStandIn(ctx)
      },
    }

    /**
     * 注册 conversation.input.model 座位：优先级 -2（宿主 0、neartoken/workbuddy -1），
     * 不传 children（子槽已由宿主声明，重复声明会抛 already declared）。
     * inject 返回的 directory 是我们过滤后的 store；组件委托宿主自带的选择器。
     */
    function tryInjectSelectorSeat(ctx, slots) {
      const install = (scope) => {
        const models = scope?.modelDirectories
        const sessions = scope?.sessions
        if (!models || typeof models.directoryFor !== 'function'
          || !sessions || typeof sessions.subagentAddress !== 'function') {
          console.warn('[dsh-provider-power-switch] model seat skipped: modelDirectories/sessions unavailable')
          return
        }
        try {
          // slots.inject 自己管理声明生命周期（collapse/re-mount 自动重跑 callback），
          // 里面 slots.register 的 disposer 由该 effect 自动回收，无需额外持有。
          slots.inject(SEAT, () => slots.register({
            name: SEAT,
            priority: -2,
            inject: (sessionId) => {
              const directory = models.directoryFor(sessionId)
              const available = sessions.subagentAddress(sessionId) === void 0
              const filtered = makeFilteredDirectory(directory.store)
              return {
                available,
                directory: filtered,
                load: () => { if (available) directory.load().catch(() => {}) },
                resolveText: (text) => {
                  try { return ctxLocale?.resolveText?.(text) ?? text } catch { return text }
                },
                select: (selection) => available ? directory.select(selection) : Promise.resolve(void 0),
              }
            },
          }, FilteredModelSelect))
        } catch (e) {
          console.warn('[dsh-provider-power-switch] model seat register failed', e)
        }
      }
      if (typeof ctx.inject === 'function') {
        return ctx.inject(['slots', 'modelDirectories', 'sessions'], install)
      }
      console.warn('[dsh-provider-power-switch] ctx.inject unavailable, model seat not installed')
      return undefined
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
        async contextWindowFor(provider, model) {
          if (!face.rpcFace?.contextWindowFor) return null
          const r = unwrap(await face.rpcFace.contextWindowFor(provider, model))
          return typeof r === 'number' && Number.isFinite(r) && r > 0 ? r : null
        },
      }
    }
  },
})
