/**
 * Deployment probe for the session radar. Read-only.
 *
 * Usage: node scripts/verify-deployed.mjs [--url http://127.0.0.1:<port>] [--home <DSH_HOME>]
 */

import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

function option(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : undefined
}

const base = option('url') ?? process.env.DSH_WEB_URL ?? 'http://127.0.0.1:3080'
const home = option('home') ?? process.env.DSH_HOME ?? join(process.env.USERPROFILE ?? homedir(), '.dsh')
const authority = new URL(base).host
const b64 = value => Buffer.from(value).toString('base64').replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/u, '')

function sessionCookie() {
  const text = readFileSync(join(home, '.credentials.yaml'), 'utf8')
  const match = /client-connection\/browser-session:[\s\S]{0,400}?secret:\s*(\S+)/.exec(text)
  if (match === null) throw new Error(`no browser-session secret in ${home}/.credentials.yaml`)
  const secret = Buffer.from(match[1].replaceAll('-', '+').replaceAll('_', '/'), 'base64')
  const now = Date.now()
  const payload = { version: 1, authority, issuedAt: now, expiresAt: now + 3_600_000 }
  const body = b64(Buffer.from(JSON.stringify(payload), 'utf8'))
  const name = 'dsh-auth-' + b64(createHash('sha256').update(authority).digest())
  return `${name}=v1.${body}.${b64(createHmac('sha256', secret).update(body).digest())}`
}

const cookie = sessionCookie()
const indexResponse = await fetch(base + '/', { headers: { cookie, accept: 'text/html' } })
if (!indexResponse.ok) throw new Error(`index fetch failed: HTTP ${indexResponse.status}`)
const html = await indexResponse.text()
console.log(`[verify] index: HTTP ${indexResponse.status}, ${html.length} bytes`)

const graphMatch = /globalThis\["__DSH_BOOT__"\]\s*=\s*(\{[\s\S]*?\})<\/script>/.exec(html)
if (graphMatch === null) throw new Error('no __DSH_BOOT__ graph in the served index')
const graph = JSON.parse(graphMatch[1])
console.log(`[verify] boot graph rev ${graph.rev}, ${graph.entries.length} entries`)

const entry = graph.entries.find(candidate => candidate.id === 'dsh-session-radar')
if (entry === undefined) {
  console.error('[verify] dsh-session-radar is NOT in the boot graph. Entries:')
  for (const candidate of graph.entries) console.error('  -', candidate.id)
  process.exit(1)
}
console.log('[verify] boot entry:', JSON.stringify(entry))

const bundleResponse = await fetch(new URL(entry.url, base), { headers: { cookie } })
const bundle = await bundleResponse.text()
if (!bundleResponse.ok) throw new Error(`bundle fetch failed: HTTP ${bundleResponse.status}`)
console.log(`[verify] bundle: HTTP ${bundleResponse.status}, ${bundle.length} bytes`)
for (const marker of ['__ModuleLoader__.load', "id: 'dsh-session-radar'", 'dsr-pill', 'dsr-panel', '__DSH_SESSION_RADAR_CONFIG__', 'shell.overlay', 'uiWorkspace']) {
  if (!bundle.includes(marker)) throw new Error(`served bundle is missing ${marker}`)
}

const stateResponse = await fetch(base + '/dsh-session-radar/state', { headers: { cookie, accept: 'application/json' } })
if (!stateResponse.ok) throw new Error(`state route failed: HTTP ${stateResponse.status}`)
const state = await stateResponse.json()
if (!Array.isArray(state.sessions)) throw new Error('state route did not return a sessions array')
console.log('[verify] state route: OK,', state.sessions.length, 'sessions, counts', JSON.stringify(state.counts))

console.log('[verify] OK — the GUI is serving the session radar')
