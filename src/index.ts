/**
 * Session radar, Host half.
 *
 * Folds the session event stream into a small cross-session view: who is
 * running, who is waiting for an approval, what failed recently, and how many
 * sub-agents each root session has. Titles come from the durable
 * `session/title` events, parentage from the session header.
 *
 * Nothing is guessed from projections: every fact below is an event this half
 * observed after it mounted. Sessions that were already idle before mount
 * simply do not appear, which is the intended meaning of a radar.
 */

import type { Context } from '@deepseek-ai/cordis'

/** Cordis plugin name (the Loader row name). */
export const name = 'session-radar'

/** `webServer` carries the state route; everything else rides session events. */
export const inject = ['webServer']

/** Index-injection property carrying the display switches to the browser half. */
export const CONFIG_GLOBAL = '__DSH_SESSION_RADAR_CONFIG__'

/** Cross-session state route. */
const ROUTE_STATE = '/dsh-session-radar/state'

/** Host-half configuration. */
export interface Config {
  /** Per-widget switches. @default { radar: true } */
  readonly widgets?: { readonly radar?: boolean }
  /** How long a finished session stays visible. @default 1800000 (30 min) */
  readonly recentMs?: number
  /** Maximum rows published. @default 8 */
  readonly maxRows?: number
  /** Browser poll interval hint. @default 2000 */
  readonly pollMs?: number
}

interface Settings {
  widgets: { radar: boolean }
  recentMs: number
  maxRows: number
  pollMs: number
}

const DEFAULTS: Settings = {
  widgets: { radar: true },
  recentMs: 1_800_000,
  maxRows: 8,
  pollMs: 2_000,
}

/* ------------------------------------------------------------------ types */

interface PendingApproval {
  requestId: string
  toolName: string
  since: number
}

interface SessionTrack {
  id: string
  title: string
  parentSession: string
  running: boolean
  turn: number
  turnStartedAt: number
  lastEndKind: string
  lastEndAt: number
  pending: Map<string, PendingApproval>
  updatedAt: number
}

type RadarState = 'awaiting' | 'running' | 'failed' | 'done'

interface RadarSession {
  sessionId: string
  title: string
  state: RadarState
  turn: number
  elapsedMs: number
  updatedAt: number
  pendingCount: number
  pendingTool: string
  subagentsRunning: number
  subagentsTotal: number
}

interface RequestLike {
  method?: string
  url?: string
}

interface ResponseLike {
  writeHead(status: number, headers: Record<string, string>): void
  end(body?: string): void
}

/* --------------------------------------------------------------- helpers */

function num(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Normalize a partial row config against the defaults. */
function normalize(config: Config | undefined): Settings {
  const widgets = config?.widgets ?? {}
  const recentMs = Number(config?.recentMs)
  const maxRows = Number(config?.maxRows)
  const pollMs = Number(config?.pollMs)
  return {
    widgets: { radar: widgets.radar ?? DEFAULTS.widgets.radar },
    recentMs: Number.isFinite(recentMs) && recentMs > 0 ? Math.round(recentMs) : DEFAULTS.recentMs,
    maxRows: Number.isFinite(maxRows) && maxRows > 0 ? Math.min(50, Math.round(maxRows)) : DEFAULTS.maxRows,
    pollMs: Number.isFinite(pollMs) && pollMs >= 500 ? Math.round(pollMs) : DEFAULTS.pollMs,
  }
}

/** The session id, wherever this DSH build put it. */
function sessionKey(session: unknown): string | undefined {
  const value = session as { id?: unknown; header?: { id?: unknown } } | null | undefined
  const id = value?.id ?? value?.header?.id
  return typeof id === 'string' && id.length > 0 ? id : undefined
}

/** The parent session id of a delegated session. */
function parentOf(session: unknown): string {
  const value = session as { header?: { parentSession?: unknown } } | null | undefined
  return text(value?.header?.parentSession)
}

/** State priority for sorting: approvals first, then running, then failures. */
const PRIORITY: Record<RadarState, number> = { awaiting: 0, running: 1, failed: 2, done: 3 }

/* ------------------------------------------------------------------ apply */

/**
 * Mount the cross-session radar and its route.
 * @param ctx - Host plugin context.
 * @param config - optional row configuration.
 */
export function apply(ctx: Context, config?: Config): void {
  const settings = normalize(config)
  let disposed = false

  const sessions = new Map<string, SessionTrack>()

  const trackFor = (session: unknown): SessionTrack | undefined => {
    const id = sessionKey(session)
    if (id === undefined) return undefined
    let track = sessions.get(id)
    if (track === undefined) {
      track = {
        id,
        title: '',
        parentSession: parentOf(session),
        running: false,
        turn: 0,
        turnStartedAt: 0,
        lastEndKind: '',
        lastEndAt: 0,
        pending: new Map(),
        updatedAt: Date.now(),
      }
      sessions.set(id, track)
    } else if (track.parentSession.length === 0) {
      track.parentSession = parentOf(session)
    }
    return track
  }

  const onSessionEvent = (session: unknown, event: { type?: string; data?: Record<string, unknown> }): void => {
    if (disposed) return
    const track = trackFor(session)
    if (track === undefined) return
    const now = Date.now()
    track.updatedAt = now
    const type = text(event?.type)
    const data = (event?.data ?? {}) as Record<string, unknown>

    if (type === 'session/title') {
      const title = text(data.title)
      if (title.length > 0) track.title = title
      return
    }

    if (type === 'turn/start') {
      track.running = true
      track.turn = num(data.turn)
      track.turnStartedAt = now
      return
    }

    if (type === 'turn/end') {
      track.running = false
      const reason = data.reason
      const kind = reason !== null && typeof reason === 'object' ? text((reason as Record<string, unknown>).kind) : ''
      track.lastEndKind = kind
      track.lastEndAt = now
      return
    }

    if (type === 'approval/asked') {
      const requestId = text(data.id)
      if (requestId.length === 0) return
      track.pending.set(requestId, { requestId, toolName: text(data.toolName), since: now })
      return
    }

    if (type === 'approval/decided') {
      const requestId = text(data.id)
      if (requestId.length > 0) track.pending.delete(requestId)
    }
  }

  /* ------------------------------------------------------------- surfaces */

  const stateOf = (track: SessionTrack): RadarState => {
    if (track.pending.size > 0) return 'awaiting'
    if (track.running) return 'running'
    if (track.lastEndKind === 'error') return 'failed'
    return 'done'
  }

  const view = (now: number): { sessions: RadarSession[]; counts: { running: number; awaiting: number; failed: number } } => {
    const children = new Map<string, { running: number; total: number }>()
    for (const track of sessions.values()) {
      if (track.parentSession.length === 0) continue
      const entry = children.get(track.parentSession) ?? { running: 0, total: 0 }
      entry.total += 1
      if (track.running) entry.running += 1
      children.set(track.parentSession, entry)
    }

    const counts = { running: 0, awaiting: 0, failed: 0 }
    const rows: RadarSession[] = []
    for (const track of sessions.values()) {
      if (track.parentSession.length > 0) continue
      const child = children.get(track.id) ?? { running: 0, total: 0 }
      let state = stateOf(track)
      // A root session whose own turn is idle but whose sub-agents run is
      // still doing work, so it belongs in the running group.
      if (state === 'done' && child.running > 0) state = 'running'
      const active = state === 'awaiting' || state === 'running'
      if (!active && now - track.updatedAt > settings.recentMs) continue
      if (state === 'awaiting') counts.awaiting += 1
      else if (state === 'running') counts.running += 1
      else if (state === 'failed') counts.failed += 1
      rows.push({
        sessionId: track.id,
        title: track.title,
        state,
        turn: track.turn,
        elapsedMs: active
          ? Math.max(0, now - (track.turnStartedAt > 0 ? track.turnStartedAt : track.updatedAt))
          : Math.max(0, now - (track.lastEndAt > 0 ? track.lastEndAt : track.updatedAt)),
        updatedAt: track.updatedAt,
        pendingCount: track.pending.size,
        pendingTool: track.pending.size > 0 ? [...track.pending.values()][0].toolName : '',
        subagentsRunning: child.running,
        subagentsTotal: child.total,
      })
    }

    rows.sort((left, right) => {
      const priority = PRIORITY[left.state] - PRIORITY[right.state]
      return priority !== 0 ? priority : right.updatedAt - left.updatedAt
    })

    return { sessions: rows.slice(0, settings.maxRows), counts }
  }

  const respond = (res: ResponseLike, status: number, payload: string, head: boolean): void => {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    })
    res.end(head ? undefined : payload)
  }

  const handleState = (req: RequestLike, res: ResponseLike): void => {
    try {
      const method = text(req.method).toUpperCase() || 'GET'
      if (method !== 'GET' && method !== 'HEAD') {
        respond(res, 405, JSON.stringify({ error: 'method not allowed' }), false)
        return
      }
      const now = Date.now()
      const next = view(now)
      respond(res, 200, JSON.stringify({
        sessions: next.sessions,
        counts: next.counts,
        updatedAt: now,
      }), method === 'HEAD')
    } catch (error) {
      respond(res, 500, JSON.stringify({ error: messageOf(error) }), false)
    }
  }

  ctx.effect(() => (ctx as unknown as { webServer: { register(route: { kind: 'exact'; path: string; handler: (req: RequestLike, res: ResponseLike) => void }): () => void } }).webServer.register({
    kind: 'exact',
    path: ROUTE_STATE,
    handler: handleState,
  }), `${name}: state route`)

  ctx.effect(() => ctx.on('session/event', onSessionEvent), `${name}: session folding`)

  ctx.effect(() => ctx.on('webserver/index-inject', (table: unknown[]) => {
    if (disposed) return
    table.push({
      kind: 'global',
      name: CONFIG_GLOBAL,
      value: {
        widgets: settings.widgets,
        pollMs: settings.pollMs,
      },
    })
  }), `${name}: display switches`)

  ctx.effect(() => () => {
    disposed = true
    sessions.clear()
  }, `${name}: disposal`)
}
