/**
 * Client spec — the radar view model, pinned.
 *
 * Usage: node scripts/client-spec.mjs
 */

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUNDLE = join(resolve(HERE, '..'), 'src', 'client.js')

let checks = 0
const failures = []

function check(label, actual, expected) {
  checks += 1
  if (!Object.is(actual, expected) && JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assert(label, condition) {
  checks += 1
  if (!condition) failures.push(`${label}: condition failed`)
}

async function load(config) {
  const registrations = []
  globalThis.window = { __ModuleLoader__: { load: registration => registrations.push(registration) } }
  globalThis.__DSH_SESSION_RADAR_TEST__ = true
  globalThis.document = { hidden: false }
  if (config === undefined) delete globalThis.__DSH_SESSION_RADAR_CONFIG__
  else globalThis.__DSH_SESSION_RADAR_CONFIG__ = config
  await import(`${pathToFileURL(BUNDLE).href}?t=${Date.now()}${Math.random()}`)
  return registrations[0].factory(() => ({
    createElement: () => ({}),
    useState: () => [null, () => {}],
    useEffect: () => {},
    useRef: value => ({ current: value }),
  }))
}

const module = await load(undefined)
check('module name', module.name, 'dsh-session-radar')
check('injects the slot and workspace services', module.inject.join(','), 'slots,uiWorkspace')
const { radarView, formatElapsed, runtimeConfig } = module.__internals

// --- defaults -----------------------------------------------------------
check('default radar switch', runtimeConfig.widgets.radar, true)
check('default poll', runtimeConfig.pollMs, 2_000)

// --- empty --------------------------------------------------------------
const empty = radarView({ sessions: [], counts: {} })
check('empty view is hidden', empty.visible, false)
check('empty pill text', empty.pillText, '')
check('empty rows', empty.rows, [])

// --- counts and tone ----------------------------------------------------
const state = {
  sessions: [
    { sessionId: 's-done', title: '调研', state: 'done', elapsedMs: 120_000, pendingCount: 0, pendingTool: '', subagentsRunning: 0 },
    { sessionId: 's-run', title: '重构余额插件', state: 'running', elapsedMs: 720_000, pendingCount: 0, pendingTool: '', subagentsRunning: 1 },
    { sessionId: 's-wait', title: '修复登录', state: 'awaiting', elapsedMs: 30_000, pendingCount: 2, pendingTool: 'bash', subagentsRunning: 0 },
    { sessionId: 's-fail', title: '', state: 'failed', elapsedMs: 60_000, pendingCount: 0, pendingTool: '', subagentsRunning: 0 },
  ],
  counts: { awaiting: 1, running: 1, failed: 1 },
}
const view = radarView(state)
assert('view is visible', view.visible === true)
check('pill text', view.pillText, '1 等审批 · 1 运行中 · 1 失败')
check('pill tone favours approval', view.tone, 'awaiting')
check('rows are sorted by state', view.rows.map(row => row.state), ['awaiting', 'running', 'failed', 'done'])
check('awaiting row meta', view.rows[0].meta, '等审批 · bash · +1')
check('running row meta', view.rows[1].meta, '运行中 · 12m')
check('failed row meta', view.rows[2].meta, '失败 · 1m')
check('done row meta', view.rows[3].meta, '完成 · 2m')
check('missing title falls back', view.rows[2].title, '未命名会话')
check('subagent badge count', view.rows[1].subagents, 1)

// --- tone without approvals --------------------------------------------
const failedOnly = radarView({ sessions: [{ sessionId: 'x', state: 'failed' }], counts: { failed: 1 } })
check('failed tone', failedOnly.tone, 'failed')
const runningOnly = radarView({ sessions: [{ sessionId: 'x', state: 'running' }], counts: { running: 1 } })
check('running tone', runningOnly.tone, 'running')

// A panel can be open while only finished sessions remain.
const doneOnly = radarView({ sessions: [{ sessionId: 'x', state: 'done', elapsedMs: 5_000 }], counts: {} })
assert('done rows keep the widget visible', doneOnly.visible === true)
check('done-only pill text is empty', doneOnly.pillText, '')

// --- elapsed formatting -------------------------------------------------
check('elapsed seconds', formatElapsed(30_000), '30s')
check('elapsed minutes', formatElapsed(134_000), '2m')
check('elapsed hours', formatElapsed(7_500_000), '2h5m')
check('elapsed days', formatElapsed(90_000_000), '1d')

// --- injected switches --------------------------------------------------
const configured = await load({ widgets: { radar: false }, pollMs: 5_000 })
check('injected switch', configured.__internals.runtimeConfig.widgets.radar, false)
check('injected poll', configured.__internals.runtimeConfig.pollMs, 5_000)

if (failures.length > 0) {
  console.error(`\n[client-spec] ${failures.length} of ${checks} checks failed:`)
  for (const failure of failures) console.error('  -', failure)
  process.exit(1)
}
console.log(`[client-spec] ${checks} checks passed`)
