/**
 * Command Code usage pill: the browser half of this plugin.
 *
 * Hand-written rather than bundled. The shell seeds a static module table that
 * already contains `react` and `react/jsx-runtime`, so a cell needs no bundler,
 * no React install and no JSX transform — only `createElement` calls against
 * modules the host guarantees. `dsh-client-modules` requires the `id` below to
 * equal the package name and `exports["./client"]` to point at this file.
 *
 * The ring and the panel copy the shipped context meter's geometry, spacing and
 * tokens (viewBox 14x14, radius 5.5, 2px stroke, `rotate(-90 7 7)`; a menu
 * surface at z-index 1100) under this plugin's own class prefix. Only
 * `--dsw-alias-*` / `--dsw-*` tokens are referenced, so the host theme stays the
 * single shared styling dependency and a renamed token degrades appearance
 * instead of breaking rendering.
 *
 * Visible text is deliberately language-neutral (`5h`, `7d`, percentages, a
 * `2h13m` countdown). Routing it through the Client locale service needs a
 * locale namespace this plugin does not register yet; that is tracked as a
 * follow-up rather than guessed at with hardcoded sentences.
 *
 * The read goes through this plugin's own Host namespace
 * (`ctx.remote.commandcodeUsage.snapshot()`). A failed read renders a muted
 * placeholder rather than disappearing: "cannot read right now" is information
 * the user needs.
 */
window.__ModuleLoader__.load({
  id: '@local/commandcode-plans-provider',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    /**
     * The composer dock: an ambient list slot below the composer card, already
     * occupied by the shipped turn-stats pill (`client-ui-chat StatsPills` id
     * `stats`). Registering a fresh id adds a cell beside it instead of
     * replacing anything.
     */
    const SLOT = 'conversation.composer.dock'

    /** Our cell key inside that slot. */
    const CELL_ID = 'commandcode-usage'

    /** Package name: also the module-loader id and this slot's key. */
    const PKG = '@local/commandcode-plans-provider'

    /** The Remote namespace this plugin's Host half registers. */
    const NS = 'commandcodeUsage'

    /**
     * The bundle-configuration seat, keyed by this package's name. dsh gives the
     * row a configure control on the bundle's own page and renders the entry's
     * `page` view there.
     */
    const CONFIG_SLOT = 'plugins.bundle.config'

    /**
     * The row-configuration seat, keyed by `<package>#<row id>`: it gives that
     * row a configure control opening the entry's own page. Registered beside
     * the bundle seat because a row is bound to a settings namespace while a
     * bundle page may hand the entry no form at all.
     */
    const ROW_CONFIG_SLOT = 'plugins.row.config'

    /**
     * Settings namespace this plugin's entry owns. A patch row's configuration
     * is addressed by the row id, which is also the entry's settings namespace.
     */
    const SETTINGS_NS = 'commandcode-plans-provider'

    /**
     * Hand-written strict codecs.
     *
     * The browser assembly refuses a descriptor whose field carries no strict
     * codec — it answers "generated Remote … has no strict codec" for
     * `src-json` — while a `TypertSchema` only has to answer `parse`. That is
     * what keeps this free of a zod dependency and of the generated artifact a
     * hand-written plugin cannot produce.
     */
    const BOOLEAN_SCHEMA = {
      parse(value) {
        if (typeof value !== 'boolean') throw new Error('expected a boolean')
        return value
      },
    }
    const JSON_SCHEMA = {
      parse(value) {
        return value
      },
    }

    /**
     * The invocation this plugin exposes to the browser, described with the
     * same field shape its Host half registers.
     */
    const USAGE_DESCRIPTOR = {
      id: `${PKG}#${NS}/snapshot`,
      service: NS,
      namespace: NS,
      method: 'snapshot',
      invocation: { kind: 'direct' },
      parameters: [{
        name: 'force',
        wire: 'force',
        source: 'json',
        codec: {
          mode: 'strict',
          typeSymbol: `${PKG}#${NS}/snapshot:force`,
          create: () => BOOLEAN_SCHEMA,
        },
      }],
      result: {
        mode: 'strict',
        typeSymbol: `${PKG}#${NS}/snapshot:result`,
        create: () => JSON_SCHEMA,
      },
      sourceLocation: { file: 'client/index.js', line: 1, column: 1 },
    }

    /**
     * Outcome of mounting this plugin's namespace into the browser assembly,
     * surfaced in the configuration card's diagnostics line.
     *
     * `$mount` settles asynchronously, so the value is published through a
     * listener set: a plain variable would leave the card showing a stale
     * `pending` until some unrelated re-render happened.
     */
    let mountState = 'pending'
    const mountListeners = new Set()

    /**
     * Record the mount outcome and wake every card watching it.
     * @param next - the new outcome text.
     */
    function setMountState(next) {
      mountState = next
      for (const listener of mountListeners) listener()
    }

    /** Credential reference the Host resolves per request. */
    const KEY_REF = 'COMMANDCODE_API_KEY'

    /** Selectable plan tiers, cheapest first. `max` hides nothing. */
    const TIERS = ['go', 'goat', 'pro', 'max']

    /** Ring geometry, identical to the shipped context meter's. */
    const RADIUS = 5.5
    const CIRCUMFERENCE = 2 * Math.PI * RADIUS

    /** At or above this percentage a bar or ring turns red. */
    const DANGER_PERCENT = 90

    /** Above this percentage it turns amber. */
    const WARN_PERCENT = 75

    /** How often the pill re-reads the Host snapshot. */
    const POLL_MS = 60_000

    /** Component-local styles; they unmount with the component. */
    const CSS = [
      '.ccu_root{flex:none;display:inline-flex;position:relative}',
      '.ccu_trigger{border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);',
      'font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);',
      'font-variant-numeric:tabular-nums;line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));',
      'white-space:nowrap;cursor:pointer;background:0 0;border:none;flex:none;align-items:center;gap:6px;',
      'padding:1px 8px;display:inline-flex}',
      '.ccu_trigger:hover,.ccu_trigger[aria-expanded=true]',
      '{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}',
      '.ccu_track{fill:none;stroke:var(--dsw-alias-border-l3);stroke-width:2px}',
      '.ccu_fill{fill:none;stroke-width:2px;stroke-linecap:round}',
      '.ccu_ok{stroke:var(--dsw-alias-state-success-primary)}',
      '.ccu_warn{stroke:var(--dsw-alias-state-success-secondary)}',
      '.ccu_danger{stroke:var(--dsw-alias-state-error-primary)}',
      '.ccu_reset{color:var(--dsw-alias-label-caption)}',
      '.ccu_panel{z-index:1100;box-sizing:border-box;border-radius:var(--dsw-radius-lg);',
      'background:var(--dsw-specific-menu);backdrop-filter:var(--dsw-menu-backdrop-filter);',
      '--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);box-shadow:var(--dsw-elevation-prominent);',
      'color:var(--dsw-alias-label-secondary);cursor:default;border:0;padding:12px;',
      'font-size:12px;line-height:20px;position:fixed;width:min(280px,100vw - 24px)}',
      '.ccu_head{display:flex;align-items:center;gap:6px}',
      '.ccu_title{color:var(--dsw-alias-label-primary);font-weight:500}',
      '.ccu_plan{margin-left:auto;color:var(--dsw-alias-label-tertiary)}',
      '.ccu_row{margin-top:8px}',
      '.ccu_rowHead{display:flex;align-items:center;gap:6px}',
      '.ccu_label{color:var(--dsw-alias-label-tertiary)}',
      '.ccu_figures{margin-left:auto;color:var(--dsw-alias-label-primary);font-weight:500;',
      'font-variant-numeric:tabular-nums}',
      '.ccu_barTrack{margin-top:4px;height:4px;border-radius:2px;background:var(--dsw-alias-border-l3);overflow:hidden}',
      '.ccu_barFill{height:100%;border-radius:2px}',
      '.ccu_barFill[data-level=ok]{background:var(--dsw-alias-state-success-primary)}',
      '.ccu_barFill[data-level=warn]{background:var(--dsw-alias-state-success-secondary)}',
      '.ccu_barFill[data-level=danger]{background:var(--dsw-alias-state-error-primary)}',
      '.ccu_note{margin-top:2px;color:var(--dsw-alias-label-caption)}',
      '.ccu_err{margin-top:8px;color:var(--dsw-alias-state-error-primary)}',
    ].join('')

    /**
     * Format a reset timestamp as a short countdown.
     * @param iso - ISO reset time, when disclosed.
     * @returns `2h13m` / `47m` / `3d4h`, or undefined when there is nothing to count to.
     */
    function countdown(iso) {
      if (typeof iso !== 'string') return undefined
      const target = new Date(iso).getTime()
      if (!Number.isFinite(target)) return undefined
      const minutes = Math.floor((target - Date.now()) / 60_000)
      if (minutes <= 0) return undefined
      const hours = Math.floor(minutes / 60)
      if (hours >= 24) return `${Math.floor(hours / 24)}d${hours % 24}h`
      return hours > 0 ? `${hours}h${minutes % 60}m` : `${minutes}m`
    }

    /** Two-decimal, trailing-zero-free figure for a credit amount. */
    function amount(value) {
      return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
    }

    /** Severity bucket for one percentage. */
    function levelOf(percent) {
      if (percent >= DANGER_PERCENT) return 'danger'
      if (percent >= WARN_PERCENT) return 'warn'
      return 'ok'
    }

    /** One window as a tooltip line. */
    function describe(label, window) {
      if (window === undefined) return `${label}：不可用`
      const text = `${label}：${window.percent}%（${amount(window.used)}/${amount(window.cap)}）`
      const left = countdown(window.resetAt)
      return left === undefined ? text : `${text}，${left} 后重置`
    }

    /** One window row: label, figures, bar and reset note. */
    function windowRow(label, window) {
      if (window === undefined) {
        return h('div', { className: 'ccu_row', key: label },
          h('div', { className: 'ccu_rowHead' },
            h('span', { className: 'ccu_label' }, label),
            h('span', { className: 'ccu_figures' }, '—'),
          ),
        )
      }
      const left = countdown(window.resetAt)
      return h('div', { className: 'ccu_row', key: label },
        h('div', { className: 'ccu_rowHead' },
          h('span', { className: 'ccu_label' }, label),
          h('span', { className: 'ccu_figures' },
            `${window.percent}% · ${amount(window.used)}/${amount(window.cap)}`),
        ),
        h('div', { className: 'ccu_barTrack' },
          h('div', {
            className: 'ccu_barFill',
            'data-level': levelOf(window.percent),
            style: { width: `${Math.max(2, window.percent)}%` },
          }),
        ),
        left === undefined
          ? null
          : h('div', { className: 'ccu_note' }, `${left} 后重置`),
      )
    }

    /**
     * Resolve the Typert Remote facade.
     *
     * `ctx.<service>` exists only for injected services and a failed probe
     * throws, while cordis's `ctx.get()` reads the store "without the inject
     * requirement" — so the store read is tried first and either probe failing
     * leaves the cell degraded instead of broken.
     * @param ctx - the client plugin context.
     * @returns the remote facade, or undefined when this page has none.
     */
    function remoteOf(ctx) {
      try {
        const direct = ctx.remote
        if (direct !== undefined && direct !== null) return direct
      } catch (error) {
        // Not injected here; fall through to the store read.
      }
      try {
        const viaGet = typeof ctx.get === 'function' ? ctx.get('remote') : undefined
        if (viaGet !== undefined && viaGet !== null) return viaGet
      } catch (error) {
        return undefined
      }
      return undefined
    }

    /**
     * Resolve this plugin's own Remote namespace.
     * @param ctx - the client plugin context.
     * @returns the namespace facade, or undefined when it is not registered.
     */
    function namespaceOf(ctx) {
      // Every namespace is its own service keyed `remote.<namespace>`. Reading
      // it through `ctx.get` — which reads the store without the inject
      // requirement — is what lets this plugin both mount and consume its own
      // namespace: injecting it would park the entry on a service it provides
      // itself, and cordis resolves injects before `apply` runs.
      try {
        const direct = typeof ctx.get === 'function' ? ctx.get(`remote.${NS}`) : undefined
        if (direct !== undefined && direct !== null) return direct
      } catch (error) {
        // Fall through to the nested property.
      }
      const remote = remoteOf(ctx)
      if (remote === undefined) return undefined
      try {
        return remote[NS]
      } catch (error) {
        return undefined
      }
    }

    /**
     * Resolve the credential facade the configuration card writes through.
     * @param ctx - the client plugin context.
     * @returns the credential facade, or undefined when this page has none.
     */
    function credentialsOf(ctx) {
      const remote = remoteOf(ctx)
      if (remote === undefined) return undefined
      try {
        return remote.credentials
      } catch (error) {
        return undefined
      }
    }

    /**
     * Unwrap one Remote Result envelope.
     *
     * A remote call answers `{ ok, value }` or `{ ok, error }` instead of
     * throwing, and that outer `ok` is the transport verdict — the snapshot's
     * own `ok` lives inside `value`. Reading the envelope as if it were the
     * snapshot yields an "unavailable" panel out of a perfectly good answer.
     * @param answer - the Remote Result.
     * @returns the payload, or the refusal reason.
     */
    function unwrapRemote(answer) {
      if (answer === undefined || answer === null) return { error: '没有收到应答' }
      if (answer.ok === true) return { value: answer.value }
      const error = answer.error
      const message = error !== undefined && error !== null && typeof error.message === 'string'
        ? error.message
        : '宿主拒绝了该调用'
      return { error: message }
    }

    /**
     * Read `planTier` out of a settings namespace view.
     * @param view - one `SettingsNamespaceView`, when the call answered one.
     * @returns the tier string, or undefined.
     */
    function readTier(view) {
      if (view === null || view === undefined) return undefined
      const value = view.value
      if (value === null || value === undefined) return undefined
      const tier = value.planTier
      return typeof tier === 'string' ? tier : undefined
    }

    /**
     * Build the pill bound to one client context.
     * @param ctx - the client plugin context.
     * @returns the slot component.
     */
    function pillFor(ctx) {

      return function UsagePill() {
        const [snapshot, setSnapshot] = React.useState(null)
        const [failed, setFailed] = React.useState(false)
        const [open, setOpen] = React.useState(false)
        const [anchor, setAnchor] = React.useState(null)
        const rootRef = React.useRef(null)
        // The trigger alone anchors the panel: the root also holds the panel,
        // so measuring it would move the anchor once the panel is open.
        const buttonRef = React.useRef(null)

        const apply = (answer) => {
          const result = unwrapRemote(answer)
          if (result.error !== undefined) {
            setFailed(true)
            return
          }
          const next = result.value
          if (next !== undefined && next !== null && next.ok === true) {
            setSnapshot(next)
            setFailed(false)
          } else {
            setFailed(true)
          }
        }

        const read = React.useCallback(async (force) => {
          const remote = namespaceOf(ctx)
          if (remote === undefined || remote === null || typeof remote.snapshot !== 'function') {
            setFailed(true)
            return
          }
          try {
            apply(await remote.snapshot(force === true))
          } catch (error) {
            setFailed(true)
          }
        }, [])

        React.useEffect(() => {
          let live = true
          const tick = async () => {
            const remote = namespaceOf(ctx)
            if (remote === undefined || remote === null || typeof remote.snapshot !== 'function') {
              if (live) setFailed(true)
              return
            }
            try {
              const next = await remote.snapshot(false)
              if (live) apply(next)
            } catch (error) {
              if (live) setFailed(true)
            }
          }
          tick()
          const timer = setInterval(tick, POLL_MS)
          return () => {
            live = false
            clearInterval(timer)
          }
        }, [])

        // Dismiss on outside pointer and on Escape, the same contract the
        // shipped meter panel keeps.
        React.useEffect(() => {
          if (!open) return undefined
          const onPointerDown = (event) => {
            if (rootRef.current !== null && !rootRef.current.contains(event.target)) setOpen(false)
          }
          const onKeyDown = (event) => {
            if (event.key === 'Escape') setOpen(false)
          }
          document.addEventListener('pointerdown', onPointerDown)
          document.addEventListener('keydown', onKeyDown)
          return () => {
            document.removeEventListener('pointerdown', onPointerDown)
            document.removeEventListener('keydown', onKeyDown)
          }
        }, [open])

        const toggle = () => {
          if (open) {
            setOpen(false)
            return
          }
          const node = buttonRef.current
          if (node !== null) {
            const rect = node.getBoundingClientRect()
            const width = Math.min(280, window.innerWidth - 24)
            const left = Math.min(Math.max(12, rect.right - width), window.innerWidth - width - 12)
            setAnchor({ left, bottom: Math.max(12, window.innerHeight - rect.top + 8) })
          }
          setOpen(true)
          read(true)
        }

        const fiveHour = snapshot === null ? undefined : snapshot.fiveHour
        const percent = fiveHour === undefined ? undefined : fiveHour.percent
        const danger = percent !== undefined && percent >= DANGER_PERCENT
        const reading = percent === undefined ? '—' : `${percent}%`
        const left = fiveHour === undefined ? undefined : countdown(fiveHour.resetAt)

        const title = snapshot === null
          ? (failed ? 'Command Code：用量读取失败' : 'Command Code：正在读取用量…')
          : [describe('5 小时', snapshot.fiveHour), describe('7 天', snapshot.weekly)].join('\n')

        const ring = h('svg', {
          viewBox: '0 0 14 14',
          width: '14',
          height: '14',
          'aria-hidden': true,
        }, [
          h('circle', { key: 'track', className: 'ccu_track', cx: '7', cy: '7', r: RADIUS }),
          percent === undefined
            ? null
            : h('circle', {
              key: 'fill',
              className: `ccu_fill ${levelOf(percent) === 'ok' ? 'ccu_ok'
                : levelOf(percent) === 'warn' ? 'ccu_warn' : 'ccu_danger'}`,
              cx: '7',
              cy: '7',
              r: RADIUS,
              strokeDasharray: `${CIRCUMFERENCE * percent / 100} ${CIRCUMFERENCE}`,
              transform: 'rotate(-90 7 7)',
            }),
        ])

        const triggerChildren = [
          h('span', { key: 'label' }, 'Command Code'),
          ring,
          h('span', { key: 'reading' }, reading),
        ]
        if (left !== undefined) {
          triggerChildren.push(h('span', { key: 'reset', className: 'ccu_reset' }, left))
        }

        const panel = open ? h('div', {
          className: 'ccu_panel',
          role: 'dialog',
          'aria-label': title,
          style: anchor === null ? { visibility: 'hidden', left: 0, bottom: 0 } : anchor,
        }, [
          h('div', { className: 'ccu_head', key: 'head' },
            h('span', { className: 'ccu_title' }, 'Command Code'),
            snapshot !== null && typeof snapshot.planId === 'string'
              ? h('span', { className: 'ccu_plan' }, snapshot.planId)
              : null,
          ),
          windowRow('5 小时', fiveHour),
          windowRow('7 天', snapshot === null ? undefined : snapshot.weekly),
          snapshot !== null && snapshot.planId === undefined
            ? h('div', { className: 'ccu_note', key: 'limit' },
              snapshot.limited === true ? '滚动限额生效中' : '未报告滚动限额')
            : null,
          snapshot === null && failed
            ? h('div', { className: 'ccu_err', key: 'err' },
              '用量读取失败 —— 请查看宿主日志')
            : null,
          snapshot !== null && typeof snapshot.error === 'string'
            ? h('div', { className: 'ccu_note', key: 'partial' }, snapshot.error)
            : null,
        ]) : null

        return h(React.Fragment, null,
          h('style', { key: 'css' }, CSS),
          h('span', { className: 'ccu_root', ref: rootRef }, [
            h('button', {
              key: 'trigger',
              ref: buttonRef,
              type: 'button',
              className: 'ccu_trigger',
              title,
              'aria-label': title,
              'aria-haspopup': 'dialog',
              'aria-expanded': open,
              onClick: toggle,
            }, triggerChildren),
            // Inside the root so the outside-pointer check sees panel clicks as
            // inside; `position: fixed` keeps it out of the dock's flow.
            panel,
          ]),
        )
      }
    }

    /** Card-local styles: host tokens only, under this plugin's own prefix. */
    const CARD_CSS = [
      '.ccc_root{display:flex;flex-direction:column;gap:12px;max-width:560px;',
      'color:var(--dsw-alias-label-secondary);font-size:13px}',
      '.ccc_field{display:flex;flex-direction:column;gap:6px}',
      '.ccc_label{color:var(--dsw-alias-label-tertiary)}',
      '.ccc_row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}',
      '.ccc_input{flex:1;min-width:160px;box-sizing:border-box;padding:4px 8px;height:28px;',
      'border-radius:var(--dsw-radius-sm);background:var(--dsw-alias-bg-base);',
      'color:var(--dsw-alias-label-primary);border:1px solid var(--dsw-alias-border-l2);font:inherit}',
      '.ccc_btn{height:28px;padding:1px 12px;border-radius:var(--dsw-radius-sm);cursor:pointer;',
      'background:0 0;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-primary);font:inherit}',
      '.ccc_btn:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}',
      '.ccc_btn:disabled{opacity:.5;cursor:default}',
      '.ccc_seg{display:inline-flex;border:1px solid var(--dsw-alias-border-l2);',
      'border-radius:var(--dsw-radius-sm);overflow:hidden}',
      '.ccc_segBtn{padding:3px 14px;height:28px;cursor:pointer;background:0 0;border:0;',
      'color:var(--dsw-alias-label-secondary);font:inherit}',
      '.ccc_segBtn+.ccc_segBtn{border-left:1px solid var(--dsw-alias-border-l2)}',
      '.ccc_segBtn[aria-pressed=true]{background:var(--dsw-alias-interactive-bg-hover);',
      'color:var(--dsw-alias-label-primary);font-weight:600;',
      'box-shadow:inset 0 0 0 1px var(--dsw-alias-label-tertiary)}',
      '.ccc_segBtn:disabled{opacity:.5;cursor:default}',
      '.ccc_status{display:flex;align-items:center;gap:6px;color:var(--dsw-alias-label-caption)}',
      '.ccc_dot{width:6px;height:6px;border-radius:50%;flex:none}',
      '.ccc_dot[data-on=true]{background:var(--dsw-alias-state-success-primary)}',
      '.ccc_dot[data-on=false]{background:var(--dsw-alias-state-error-primary)}',
      '.ccc_note{color:var(--dsw-alias-label-caption)}',
      '.ccc_err{color:var(--dsw-alias-state-error-primary)}',
      '.ccc_ok{color:var(--dsw-alias-state-success-primary)}',
    ].join('')

    /**
     * Build the configuration card bound to one client context.
     *
     * The API key is written through the credential service — the same call the
     * shipped provider pages make — so the secret stays in the credential store
     * rather than in a settings document. The plan tier is an ordinary config
     * field, so it goes through the Host-owned form the page injects.
     * @param ctx - the client plugin context.
     * @returns the slot component.
     */
    function configFor(ctx) {
      /** Unwrap the remote Result envelope: remote calls answer, they do not throw. */
      const unwrap = (response) => {
        if (response !== undefined && response !== null && response.ok === true) {
          return { value: response.value }
        }
        const error = response === undefined || response === null ? undefined : response.error
        const message = error !== undefined && error !== null && typeof error.message === 'string'
          ? error.message
          : '宿主拒绝了请求'
        return { error: message }
      }

      const messageOf = (error) => (error !== undefined && error !== null && typeof error.message === 'string'
        ? error.message
        : String(error))

      return function CommandCodeConfig(props) {
        const view = props === undefined ? undefined : props.view
        const form = props === undefined ? undefined : props.form
        const [keyState, setKeyState] = React.useState(null)
        const [draft, setDraft] = React.useState('')
        const [busy, setBusy] = React.useState(false)
        const [notice, setNotice] = React.useState(null)
        const [test, setTest] = React.useState(null)
        const [keyHint, setKeyHint] = React.useState(undefined)
        const [tierFromSettings, setTierFromSettings] = React.useState(undefined)

        const credentials = () => credentialsOf(ctx)

        // One-line availability probe rendered at the card's foot: it is what
        // turns "the card does not work" into a named missing facade.
        const diagnostics = () => {
          const remote = remoteOf(ctx)
          const hasCredentials = remote !== undefined
            && remote.credentials !== undefined
            && remote.credentials !== null
          return `remote: ${remote === undefined ? 'none' : 'ok'}`
            + ` · credentials: ${hasCredentials ? 'yes' : 'no'}`
            + ` · commandcodeUsage: ${namespaceOf(ctx) === undefined ? 'no' : 'yes'}`
            + ` · mount: ${mountState}`
            + ` · form: ${form === undefined ? 'none' : status}`
        }

        const describeKey = React.useCallback(async () => {
          const api = credentials()
          if (api === undefined || typeof api.describe !== 'function') {
            setNotice({ kind: 'error', text: '本页无法访问凭据服务' })
            return
          }
          try {
            const result = unwrap(await api.describe([KEY_REF]))
            if (result.error !== undefined) {
              setNotice({ kind: 'error', text: result.error })
              return
            }
            const described = result.value === undefined || result.value === null
              ? undefined
              : result.value[KEY_REF]
            setKeyState(described === undefined || described === null
              ? { configured: false, writable: true }
              : described)
          } catch (error) {
            setNotice({ kind: 'error', text: messageOf(error) })
          }
        }, [])

        React.useEffect(() => {
          describeKey()
        }, [describeKey])

        // Repaint when the namespace mount settles, so the diagnostics line
        // never reports a stale outcome.
        const [, bumpMount] = React.useState(0)
        React.useEffect(() => {
          const listener = () => bumpMount(count => count + 1)
          mountListeners.add(listener)
          return () => {
            mountListeners.delete(listener)
          }
        }, [])

        // A stored secret never crosses back to the page, so the only
        // identification on offer is the masked hint the Host derives while it
        // resolves the key for a real read. One cached read is enough.
        React.useEffect(() => {
          let live = true
          const read = async () => {
            const remote = namespaceOf(ctx)
            if (remote === undefined || typeof remote.snapshot !== 'function') return
            try {
              const result = unwrapRemote(await remote.snapshot(false))
              if (!live || result.error !== undefined) return
              const snapshot = result.value
              if (snapshot !== null && snapshot !== undefined
                && typeof snapshot.keyHint === 'string') setKeyHint(snapshot.keyHint)
            } catch (error) {
              // The hint is a nicety; a failure here changes nothing else.
            }
          }
          read()
          return () => {
            live = false
          }
        }, [])

        // The page injects no form on a bundle page, so the selected tier is read
        // back from the same settings namespace the buttons write through —
        // otherwise no button can look selected.
        React.useEffect(() => {
          let live = true
          const read = async () => {
            const settings = settingsFacade()
            if (settings === undefined || typeof settings.describe !== 'function') return
            try {
              const result = unwrapRemote(await settings.describe())
              if (!live || result.error !== undefined) return
              const described = result.value
              const namespaces = described !== null && described !== undefined
                && Array.isArray(described.namespaces) ? described.namespaces : []
              const ours = namespaces.find(entry => entry !== null && entry !== undefined
                && entry.ns === SETTINGS_NS)
              setTierFromSettings(readTier(ours))
            } catch (error) {
              // The highlight is a nicety; a failure here changes nothing else.
            }
          }
          read()
          return () => {
            live = false
          }
        }, [])

        const run = async (action) => {
          setBusy(true)
          setNotice(null)
          try {
            await action()
          } catch (error) {
            setNotice({ kind: 'error', text: messageOf(error) })
          } finally {
            setBusy(false)
          }
        }

        const save = () => run(async () => {
          const api = credentials()
          if (api === undefined || typeof api.set !== 'function') {
            setNotice({ kind: 'error', text: '本页无法访问凭据服务' })
            return
          }
          const value = draft.trim()
          if (value.length === 0) {
            setNotice({ kind: 'error', text: '请先粘贴密钥' })
            return
          }
          const result = unwrap(await api.set(KEY_REF, value))
          if (result.error !== undefined) {
            setNotice({ kind: 'error', text: result.error })
            return
          }
          setDraft('')
          setNotice({ kind: 'ok', text: '密钥已保存' })
          await describeKey()
        })

        const clear = () => run(async () => {
          const api = credentials()
          if (api === undefined || typeof api.unset !== 'function') {
            setNotice({ kind: 'error', text: '本页无法访问凭据服务' })
            return
          }
          const result = unwrap(await api.unset(KEY_REF))
          if (result.error !== undefined) {
            setNotice({ kind: 'error', text: result.error })
            return
          }
          setNotice({ kind: 'ok', text: '密钥已清除' })
          await describeKey()
        })

        // The usage read is the connection test: it is the one call that proves
        // the stored key works against the gateway.
        const probe = () => run(async () => {
          const remote = namespaceOf(ctx)
          if (remote === undefined || typeof remote.snapshot !== 'function') {
            setTest({ ok: false, text: '用量命名空间未注册' })
            return
          }
          const result = unwrapRemote(await remote.snapshot(true))
          if (result.error !== undefined) {
            setTest({ ok: false, text: result.error })
            return
          }
          const snapshot = result.value
          if (snapshot !== null && snapshot !== undefined && snapshot.ok === true) {
            const five = snapshot.fiveHour
            setTest({
              ok: true,
              text: `网关可达 · 5 小时用量 ${five === undefined ? '不可用' : `${five.percent}%`}`,
            })
          } else {
            const reason = snapshot !== null && snapshot !== undefined && typeof snapshot.error === 'string'
              ? snapshot.error
              : '读取失败'
            setTest({ ok: false, text: reason })
          }
        })

        const state = form === undefined ? undefined : form.state
        const values = state === undefined || state.value === undefined ? {} : state.value
        const tier = tierFromSettings
          ?? (typeof values.planTier === 'string' ? values.planTier : undefined)
        const status = state === undefined ? 'unavailable' : state.status
        const canWriteConfig = state !== undefined && state.writable === true
        const settingsFacade = () => {
          const remote = remoteOf(ctx)
          return remote === undefined ? undefined : remote.settings
        }
        const canWriteTier = canWriteConfig || typeof settingsFacade()?.mutate === 'function'

        const pick = (next) => run(async () => {
          const ops = [{ op: 'set', path: ['planTier'], value: next }]
          // The page-injected form is the preferred writer. A bundle page hands
          // the entry no form at all, so the entry's own settings namespace is
          // the second writer rather than a dead end.
          if (form !== undefined && typeof form.mutate === 'function') {
            const accepted = await form.mutate(ops, state.revision)
            if (accepted) setTierFromSettings(next)
            setNotice(accepted
              ? { kind: 'ok', text: `档位已设为 ${next}` }
              : { kind: 'error', text: '宿主拒绝了档位修改' })
            return
          }
          const remote = remoteOf(ctx)
          const settings = remote === undefined ? undefined : remote.settings
          if (settings === undefined || typeof settings.mutate !== 'function') {
            setNotice({ kind: 'error', text: '本页既无配置表单，也无设置命名空间' })
            return
          }
          const result = unwrap(await settings.mutate(SETTINGS_NS, ops, undefined))
          if (result.error !== undefined) {
            setNotice({ kind: 'error', text: result.error })
            return
          }
          // The mutation answers with the namespace's new view, so the highlight
          // follows the write without a second round trip.
          setTierFromSettings(readTier(result.value) ?? next)
          setNotice({ kind: 'ok', text: `档位已设为 ${next}（经设置命名空间）` })
        })

        if (view !== 'page') {
          return h('span', { className: 'ccc_note' }, 'Command Code 订阅设置')
        }

        const configured = keyState !== null && keyState.configured === true
        const canWriteKey = keyState === null || keyState.writable !== false

        return h('div', { className: 'ccc_root' }, [
          h('style', { key: 'css' }, CARD_CSS),
          h('div', { className: 'ccc_field', key: 'key' }, [
            h('span', { className: 'ccc_label', key: 'l' }, 'API 密钥'),
            h('div', { className: 'ccc_row', key: 'r' }, [
              h('input', {
                key: 'i',
                className: 'ccc_input',
                type: 'password',
                // `new-password` is the one hint browsers honour for a field
                // that must never be autofilled from saved credentials.
                autoComplete: 'new-password',
                spellCheck: false,
                placeholder: configured ? '已保存 —— 粘贴新密钥即可覆盖' : KEY_REF,
                value: draft,
                disabled: busy || !canWriteKey,
                onChange: (event) => setDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === 'Enter') save()
                },
              }),
              h('button', {
                key: 's', type: 'button', className: 'ccc_btn', disabled: busy || !canWriteKey, onClick: save,
              }, '保存'),
              h('button', {
                key: 'c',
                type: 'button',
                className: 'ccc_btn',
                disabled: busy || !canWriteKey || !configured,
                onClick: clear,
              }, '清除'),
            ]),
            h('div', { className: 'ccc_status', key: 'st' }, [
              h('span', { key: 'd', className: 'ccc_dot', 'data-on': configured ? 'true' : 'false' }),
              h('span', { key: 't' }, configured
                ? `已保存${keyState.source === undefined ? '' : `（来源：${keyState.source}）`}`
                  + `${keyState.writable === false ? ' · 只读来源' : ''}`
                  + `${keyHint === undefined ? '' : ` · ${keyHint}`}`
                : `未配置 · 宿主将读取 ${KEY_REF}`),
            ]),
          ]),
          h('div', { className: 'ccc_field', key: 'tier' }, [
            h('span', { className: 'ccc_label', key: 'l' }, '套餐档位'),
            h('div', { className: 'ccc_seg', key: 'seg' }, TIERS.map(option => h('button', {
              key: option,
              type: 'button',
              className: 'ccc_segBtn',
              'aria-pressed': tier === option ? 'true' : 'false',
              disabled: busy || !canWriteTier,
              onClick: () => pick(option),
            }, option))),
            h('div', { className: 'ccc_note', key: 'n' },
              `显示该档位及更低档位 · 配置状态 ${status}`
              + `${canWriteConfig ? '' : ' · 通过设置命名空间写入'}`),
          ]),
          h('div', { className: 'ccc_row', key: 'test' }, [
            h('button', {
              key: 'b', type: 'button', className: 'ccc_btn', disabled: busy, onClick: probe,
            }, '测试连接'),
            test === null
              ? null
              : h('span', { key: 'o', className: test.ok ? 'ccc_ok' : 'ccc_err' }, test.text),
          ]),
          notice === null
            ? null
            : h('div', { key: 'notice', className: notice.kind === 'ok' ? 'ccc_ok' : 'ccc_err' }, notice.text),
          h('div', { key: 'diag', className: 'ccc_note' }, diagnostics()),
        ])
      }
    }

    return {
      // Every Remote namespace is its own cordis service named
      // `remote.<namespace>`, so a namespace is reachable only after it is
      // injected. `remote.credentials` and `remote.settings` are always in the
      // shipped assembly; this plugin's own namespace is deliberately NOT
      // injected, because an unresolved injection parks the whole entry and
      // would take the ring and the card down with it.
      inject: ['slots', 'remote', 'remote.credentials', 'remote.settings'],
      apply(ctx) {
        ctx.slots.inject(SLOT, () => ctx.slots.register(
          { name: SLOT, id: CELL_ID, order: 5 },
          pillFor(ctx),
        ))
        ctx.slots.inject(CONFIG_SLOT, () => ctx.slots.register(
          { name: CONFIG_SLOT, key: PKG },
          configFor(ctx),
        ))
        ctx.slots.inject(ROW_CONFIG_SLOT, () => ctx.slots.register(
          { name: ROW_CONFIG_SLOT, key: `${PKG}#commandcode-plans-provider` },
          configFor(ctx),
        ))
        // The browser's namespace set is assembled at build time from shipped
        // contributions, so a plugin's own namespace must be mounted at
        // runtime. `$mount` is the exact call `dsh-api-remotes` makes for every
        // generated contribution; the outcome lands in the card's diagnostics.
        const remote = remoteOf(ctx)
        if (remote === undefined || typeof remote.$mount !== 'function') {
          setMountState('unsupported: remote.$mount is missing')
        } else {
          Promise.resolve(remote.$mount({ package: PKG, descriptors: [USAGE_DESCRIPTOR] }))
            .then(() => {
              setMountState('mounted')
            })
            .catch((error) => {
              setMountState(`failed: ${error !== null && error !== undefined
                && typeof error.message === 'string' ? error.message : String(error)}`)
            })
        }
      },
    }
  },
})
