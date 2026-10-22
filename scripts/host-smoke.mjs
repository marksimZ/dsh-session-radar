/**
 * Host smoke — fold several sessions through the real radar route and check
 * states, ordering, counts, sub-agent aggregation, the recent window and the
 * approval lifecycle.
 *
 * Usage: node --experimental-strip-types scripts/host-smoke.mjs
 */

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENTRY = join(resolve(HERE, '..'), 'src', 'index.ts')

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

const sleep = milliseconds => new Promise(settle => setTimeout(settle, milliseconds))

function mockContext() {
  const routes = []
  const listeners = new Map()
  return {
    routes,
    effect(body) {
      const dispose = body()
      return () => { if (typeof dispose === 'function') dispose() }
    },
    on(event, listener) {
      const set = listeners.get(event) ?? new Set()
      set.add(listener)
      listeners.set(event, set)
      return () => set.delete(listener)
    },
    emit(event, ...args) {
      for (const listener of listeners.get(event) ?? []) listener(...args)
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    logger: { warn: () => {} },
  }
}

function respond(handler, method = 'GET') {
  return new Promise((settle, fail) => {
    const res = {
      status: 0,
      writeHead(status) { this.status = status },
      end(body) { settle({ status: this.status, body: body ?? '' }) },
    }
    try { handler({ method, url: '/dsh-session-radar/state' }, res) } catch (error) { fail(error) }
  })
}

const root = id => ({ id, header: {} })
const child = (id, parentSession) => ({ id, header: { parentSession, origin: 'subagent' } })

const module = await import(pathToFileURL(ENTRY).href)
check('module name', module.name, 'session-radar')
check('injection global', module.CONFIG_GLOBAL, '__DSH_SESSION_RADAR_CONFIG__')
check('needs only the web server', module.inject.join(','), 'webServer')

const ctx = mockContext()
module.apply(ctx, { maxRows: 8, recentMs: 1_800_000, pollMs: 5_000 })
check('one route', ctx.routes.length, 1)
check('route path', ctx.routes[0].path, '/dsh-session-radar/state')

const table = []
ctx.emit('webserver/index-inject', table)
check('one injection row', table.length, 1)
check('injection name', table[0].name, '__DSH_SESSION_RADAR_CONFIG__')
check('injection switch', table[0].value.widgets, { radar: true })
check('injection poll', table[0].value.pollMs, 5_000)

// --- four root sessions and one sub-agent -------------------------------
const sessionA = root('session-a')
const sessionB = root('session-b')
const sessionC = root('session-c')
const sessionE = root('session-e')
const subagent = child('session-d', 'session-a')

ctx.emit('session/event', sessionA, { type: 'session/title', data: { title: '重构余额插件' } })
ctx.emit('session/event', sessionA, { type: 'turn/start', data: { turn: 4 } })
ctx.emit('session/event', subagent, { type: 'turn/start', data: { turn: 1 } })

ctx.emit('session/event', sessionB, { type: 'session/title', data: { title: '修复登录' } })
ctx.emit('session/event', sessionB, { type: 'turn/start', data: { turn: 2 } })
ctx.emit('session/event', sessionB, { type: 'approval/asked', data: { id: 'r1', toolName: 'bash', callId: 'c1', reason: 'run tests' } })

ctx.emit('session/event', sessionC, { type: 'session/title', data: { title: '调研压缩' } })
ctx.emit('session/event', sessionC, { type: 'turn/start', data: { turn: 1 } })
ctx.emit('session/event', sessionC, { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })

ctx.emit('session/event', sessionE, { type: 'turn/start', data: { turn: 1 } })
ctx.emit('session/event', sessionE, { type: 'turn/end', data: { turn: 1, reason: { kind: 'error' } } })

const first = JSON.parse((await respond(ctx.routes[0].handler)).body)
check('four root rows', first.sessions.length, 4)
check('sub-agent is not a row', first.sessions.some(row => row.sessionId === 'session-d'), false)
check('states in priority order', first.sessions.map(row => row.state), ['awaiting', 'running', 'failed', 'done'])
check('awaiting first', first.sessions[0].sessionId, 'session-b')
check('awaiting carries the tool', first.sessions[0].pendingTool, 'bash')
check('awaited count', first.sessions[0].pendingCount, 1)
check('title from the event', first.sessions[0].title, '修复登录')
check('running second', first.sessions[1].sessionId, 'session-a')
check('sub-agent aggregation', first.sessions[1].subagentsRunning, 1)
check('sub-agent total', first.sessions[1].subagentsTotal, 1)
check('failed third', first.sessions[2].sessionId, 'session-e')
check('awaited count', first.counts.awaiting, 1)
check('running count', first.counts.running, 1)
check('failed count', first.counts.failed, 1)
assert('running has elapsed time', first.sessions[1].elapsedMs >= 0)

// --- deciding the approval moves that session out of awaiting -----------
ctx.emit('session/event', sessionB, { type: 'approval/decided', data: { id: 'r1', outcome: { kind: 'allow' } } })
const second = JSON.parse((await respond(ctx.routes[0].handler)).body)
check('approval cleared', second.counts.awaiting, 0)
check('decided session is still running', second.sessions.find(row => row.sessionId === 'session-b')?.state, 'running')
assert('decided row still listed as recent', second.sessions.some(row => row.sessionId === 'session-b'))

// --- maxRows ------------------------------------------------------------
const capped = mockContext()
module.apply(capped, { maxRows: 2 })
capped.emit('session/event', root('c1'), { type: 'turn/start', data: { turn: 1 } })
capped.emit('session/event', root('c2'), { type: 'turn/start', data: { turn: 1 } })
capped.emit('session/event', root('c3'), { type: 'turn/start', data: { turn: 1 } })
const cappedBody = JSON.parse((await respond(capped.routes[0].handler)).body)
check('maxRows caps the list', cappedBody.sessions.length, 2)

// --- recent window ------------------------------------------------------
const narrow = mockContext()
module.apply(narrow, { recentMs: 1 })
narrow.emit('session/event', root('n1'), { type: 'turn/start', data: { turn: 1 } })
narrow.emit('session/event', root('n1'), { type: 'turn/end', data: { turn: 1, reason: { kind: 'completed' } } })
await sleep(5)
const narrowBody = JSON.parse((await respond(narrow.routes[0].handler)).body)
check('finished sessions age out', narrowBody.sessions.length, 0)

// --- edges --------------------------------------------------------------
const post = await respond(ctx.routes[0].handler, 'POST')
check('POST is refused', post.status, 405)
const head = await respond(ctx.routes[0].handler, 'HEAD')
check('HEAD is accepted', head.status, 200)
check('HEAD has no body', head.body, '')
assert('route carries no message text', !JSON.stringify(first).includes('messages'))

if (failures.length > 0) {
  console.error(`\n[host-smoke] ${failures.length} of ${checks} checks failed:`)
  for (const failure of failures) console.error('  -', failure)
  process.exit(1)
}
console.log(`[host-smoke] ${checks} checks passed`)
process.exit(0)
