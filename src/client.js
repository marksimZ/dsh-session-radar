/**
 * Session radar, browser half.
 *
 * A small counter pill in the frame's top-right corner while other sessions
 * are running, waiting for an approval or failing. Clicking it opens the list;
 * clicking a row switches to that session through `ctx.uiWorkspace.openSession`.
 * With nothing active the widget renders nothing at all.
 */

window.__ModuleLoader__.load({
  id: 'dsh-session-radar',
  factory: (require) => {
    'use strict'

    const React = require('react')

    /** Cross-session state route served by the Host half. */
    const STATE_ROUTE = '/dsh-session-radar/state'

    /** One stylesheet. */
    const STYLE_ID = 'dsh-session-radar/styles'

    /** Fallback poll cadence; the Host injects the live value. */
    const DEFAULT_POLL_MS = 2_000

    const DEFAULT_CONFIG = {
      widgets: { radar: true },
      pollMs: DEFAULT_POLL_MS,
    }

    const STYLES = `
.dsr-root {
  position: fixed;
  top: var(--dsh-frame-overlay-top, 44px);
  right: 12px;
  z-index: 20;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 6px;
  font-family: var(--dsw-font-family);
}
.dsr-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  height: 24px;
  padding: 0 10px;
  border: 0;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-elevation-stroke), var(--dsw-elevation-panel);
  color: var(--dsw-alias-label-secondary);
  font: inherit;
  font-size: 11px;
  line-height: 14px;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
}
.dsr-pill:hover { color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-layer-2); }
.dsr-pill:focus-visible { outline: 2px solid var(--dsw-alias-link); outline-offset: 2px; }
.dsr-pill-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex: none;
  background: var(--dsw-static-green-500);
}
.dsr-pill[data-tone='awaiting'] .dsr-pill-dot { background: var(--dsw-alias-state-warn-primary); }
.dsr-pill[data-tone='failed'] .dsr-pill-dot { background: var(--dsw-alias-state-error-primary); }
.dsr-panel {
  box-sizing: border-box;
  width: 320px;
  max-width: calc(100vw - 24px);
  max-height: 60vh;
  overflow-y: auto;
  padding: 6px;
  border-radius: var(--dsw-radius-lg);
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-elevation-stroke), var(--dsw-elevation-panel);
}
.dsr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 8px 6px;
  font-size: 11px;
  line-height: 14px;
  color: var(--dsw-alias-label-tertiary);
  letter-spacing: .04em;
}
.dsr-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  width: 100%;
  box-sizing: border-box;
  padding: 7px 8px;
  border: 0;
  border-radius: var(--dsw-radius-md);
  background: none;
  color: var(--dsw-alias-label-primary);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.dsr-row:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dsr-row:focus-visible { outline: 2px solid var(--dsw-alias-link); outline-offset: -2px; }
.dsr-row[disabled] { cursor: default; opacity: .6; }
.dsr-dot {
  width: 6px;
  height: 6px;
  margin-top: 6px;
  border-radius: 50%;
  flex: none;
  background: var(--dsw-static-neutral-bluish-400);
}
.dsr-row[data-state='running'] .dsr-dot { background: var(--dsw-static-green-500); }
.dsr-row[data-state='awaiting'] .dsr-dot { background: var(--dsw-alias-state-warn-primary); }
.dsr-row[data-state='failed'] .dsr-dot { background: var(--dsw-alias-state-error-primary); }
.dsr-body {
  flex: 1 1 auto;
  min-width: 0;
}
.dsr-title {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  line-height: 18px;
  font-weight: 500;
  color: var(--dsw-alias-label-primary);
}
.dsr-meta {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  line-height: 14px;
  color: var(--dsw-alias-label-tertiary);
  font-variant-numeric: tabular-nums;
}
.dsr-row[data-state='awaiting'] .dsr-meta { color: var(--dsw-alias-state-warn-primary); }
.dsr-row[data-state='failed'] .dsr-meta { color: var(--dsw-alias-state-error-primary); }
.dsr-badge {
  flex: none;
  margin-top: 2px;
  padding: 1px 6px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2);
  color: var(--dsw-alias-label-tertiary);
  font-size: 11px;
  line-height: 14px;
  font-variant-numeric: tabular-nums;
}
.dsr-empty {
  padding: 10px 8px;
  font-size: 11px;
  line-height: 14px;
  color: var(--dsw-alias-label-tertiary);
}
@media (prefers-reduced-motion: reduce) {
  .dsr-pill,
  .dsr-row { transition: none; }
}
`

    /** Host-injected switches and cadence. */
    const runtimeConfig = (() => {
      const injected = globalThis.__DSH_SESSION_RADAR_CONFIG__
      if (injected === null || typeof injected !== 'object') return DEFAULT_CONFIG
      return {
        ...DEFAULT_CONFIG,
        ...injected,
        widgets: { ...DEFAULT_CONFIG.widgets, ...(injected.widgets ?? {}) },
      }
    })()

    /** Install the stylesheet once per page. */
    function installStyles() {
      if (document.querySelector('style[data-dsh-plugin-css="' + STYLE_ID + '"]') !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.dshPlugin = 'dsh-session-radar'
      tag.dataset.dshPluginCss = STYLE_ID
      tag.textContent = STYLES
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }

    /* ------------------------------------------------------------ helpers */

    function num(value) {
      const parsed = typeof value === 'number' ? value : Number(value)
      return Number.isFinite(parsed) ? parsed : 0
    }

    /** 30_000 → "30s"; 134_000 → "2m"; 7_200_000 → "2h". */
    function formatElapsed(milliseconds) {
      const seconds = Math.max(0, Math.round(num(milliseconds) / 1_000))
      if (seconds < 60) return seconds + 's'
      const minutes = Math.floor(seconds / 60)
      if (minutes < 60) return minutes + 'm'
      const hours = Math.floor(minutes / 60)
      if (hours < 24) return hours + 'h' + (minutes % 60 > 0 ? String(minutes % 60) + 'm' : '')
      return Math.floor(hours / 24) + 'd'
    }

    const STATE_LABEL = { awaiting: '等审批', running: '运行中', failed: '失败', done: '完成' }
    const STATE_PRIORITY = { awaiting: 0, running: 1, failed: 2, done: 3 }

    /**
     * Project one Host state response onto the pill and the panel rows.
     * Pure and exported to the spec test.
     */
    function radarView(state, now = Date.now()) {
      const sessions = Array.isArray(state?.sessions) ? state.sessions : []
      const counts = state?.counts ?? {}
      const awaiting = num(counts.awaiting)
      const running = num(counts.running)
      const failed = num(counts.failed)

      const parts = []
      if (awaiting > 0) parts.push(awaiting + ' 等审批')
      if (running > 0) parts.push(running + ' 运行中')
      if (failed > 0) parts.push(failed + ' 失败')

      const rows = sessions.map(session => {
        const sessionState = typeof session?.state === 'string' ? session.state : 'done'
        const title = typeof session?.title === 'string' && session.title.length > 0 ? session.title : '未命名会话'
        const metaParts = [STATE_LABEL[sessionState] ?? '完成']
        if (sessionState === 'awaiting') {
          metaParts.push(typeof session?.pendingTool === 'string' && session.pendingTool.length > 0 ? session.pendingTool : '等待批准')
          if (num(session?.pendingCount) > 1) metaParts.push('+' + String(num(session.pendingCount) - 1))
        } else {
          metaParts.push(formatElapsed(num(session?.elapsedMs)))
        }
        return {
          sessionId: typeof session?.sessionId === 'string' ? session.sessionId : '',
          title,
          state: sessionState,
          stateLabel: STATE_LABEL[sessionState] ?? '完成',
          meta: metaParts.join(' · '),
          elapsedMs: num(session?.elapsedMs),
          subagents: num(session?.subagentsRunning) > 0 ? num(session.subagentsRunning) : 0,
          pendingCount: num(session?.pendingCount),
        }
      })

      rows.sort((left, right) => {
        const priority = (STATE_PRIORITY[left.state] ?? 3) - (STATE_PRIORITY[right.state] ?? 3)
        return priority !== 0 ? priority : left.elapsedMs - right.elapsedMs
      })

      return {
        visible: rows.length > 0 || parts.length > 0,
        pillText: parts.join(' · '),
        tone: awaiting > 0 ? 'awaiting' : failed > 0 ? 'failed' : 'running',
        rows,
        counts: { awaiting, running, failed },
        now,
      }
    }

    /* ---------------------------------------------------------- widget */

    function SessionRadar(props) {
      const config = props.kit?.config ?? runtimeConfig
      const uiWorkspace = props.kit?.uiWorkspace
      const [state, setState] = React.useState(null)
      const [open, setOpen] = React.useState(false)
      const aliveRef = React.useRef(true)
      const pollMs = num(config.pollMs) >= 500 ? num(config.pollMs) : DEFAULT_POLL_MS

      React.useEffect(() => {
        aliveRef.current = true
        const load = async () => {
          try {
            if (typeof document !== 'undefined' && document.hidden === true) {
              // Hidden tab: poll slowly rather than not at all.
              return
            }
            const response = await fetch(STATE_ROUTE, { headers: { accept: 'application/json' } })
            if (!response.ok) return
            const body = await response.json()
            if (!aliveRef.current) return
            if (body !== null && typeof body === 'object' && Array.isArray(body.sessions)) setState(body)
          } catch {
            // Keep the last view; the next poll retries.
          }
        }
        void load()
        const timer = setInterval(() => { void load() }, pollMs)
        return () => {
          aliveRef.current = false
          clearInterval(timer)
        }
      }, [pollMs])

      const view = radarView(state)
      if (!view.visible) return null

      const openSession = sessionId => {
        try {
          uiWorkspace?.openSession(sessionId)
          setOpen(false)
        } catch {
          // A session that cannot be opened leaves the panel as it is.
        }
      }

      return React.createElement('div', { className: 'dsr-root' },
        React.createElement('button', {
          type: 'button',
          className: 'dsr-pill',
          'data-tone': view.tone,
          'aria-expanded': open ? 'true' : 'false',
          'aria-label': '会话雷达：' + view.pillText,
          onClick: () => setOpen(value => !value),
        },
        React.createElement('span', { className: 'dsr-pill-dot', 'aria-hidden': 'true' }),
        React.createElement('span', undefined, view.pillText)),
        open
          ? React.createElement('div', { className: 'dsr-panel', role: 'dialog', 'aria-label': '会话雷达' },
            React.createElement('div', { className: 'dsr-head' },
              React.createElement('span', undefined, '会话雷达'),
              React.createElement('span', undefined, String(view.rows.length) + ' 个活动')),
            view.rows.length === 0
              ? React.createElement('div', { className: 'dsr-empty' }, '没有正在进行的会话。')
              : view.rows.map(row => React.createElement('button', {
                type: 'button',
                className: 'dsr-row',
                'data-state': row.state,
                key: row.sessionId,
                disabled: row.sessionId.length === 0 || uiWorkspace === undefined,
                onClick: () => openSession(row.sessionId),
              },
              React.createElement('span', { className: 'dsr-dot', 'aria-hidden': 'true' }),
              React.createElement('span', { className: 'dsr-body' },
                React.createElement('span', { className: 'dsr-title' }, row.title),
                React.createElement('span', { className: 'dsr-meta' }, row.meta)),
              row.subagents > 0
                ? React.createElement('span', { className: 'dsr-badge' }, '+' + String(row.subagents) + ' 子代理')
                : null)))
          : null)
    }

    /* ------------------------------------------------------------ apply */

    function apply(ctx) {
      ctx.effect(() => installStyles(), 'session-radar: styles')
      if (runtimeConfig.widgets.radar === false) return
      ctx.effect(() => ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'session-radar',
        order: 40,
        label: '会话雷达',
      }, entryProps => React.createElement(SessionRadar, {
        ...entryProps,
        kit: { config: runtimeConfig, uiWorkspace: ctx.uiWorkspace },
      }))), 'session-radar: overlay')
    }

    return {
      name: 'dsh-session-radar',
      inject: ['slots', 'uiWorkspace'],
      apply,
      ...globalThis.__DSH_SESSION_RADAR_TEST__ === true
        ? {
          __internals: {
            radarView,
            formatElapsed,
            runtimeConfig,
            STYLE_ID,
          },
        }
        : {},
    }
  },
})
