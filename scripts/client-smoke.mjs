/**
 * Client smoke — the radar bundle mounts into `shell.overlay` with the
 * workspace service in its kit, and the switch removes the registration.
 *
 * Usage: node scripts/client-smoke.mjs
 */

import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUNDLE = join(resolve(HERE, '..'), 'src', 'client.js')

async function load(config) {
  const registrations = []
  globalThis.window = { __ModuleLoader__: { load: registration => registrations.push(registration) } }
  if (config === undefined) delete globalThis.__DSH_SESSION_RADAR_CONFIG__
  else globalThis.__DSH_SESSION_RADAR_CONFIG__ = config
  const tags = []
  globalThis.document = {
    hidden: false,
    head: { appendChild: tag => { tags.push(tag); return tag } },
    createElement: () => ({ dataset: {}, textContent: '', remove() {} }),
    querySelector: () => null,
  }
  await import(`${pathToFileURL(BUNDLE).href}?t=${Date.now()}${Math.random()}`)
  if (registrations.length !== 1) throw new Error(`expected one registration, got ${registrations.length}`)
  const module = registrations[0].factory(name => {
    if (name !== 'react') throw new Error(`unexpected shared module: ${name}`)
    return {
      createElement: () => ({}),
      useState: () => [null, () => {}],
      useEffect: () => {},
      useRef: value => ({ current: value }),
    }
  })
  return { module, tags }
}

function mount(module) {
  const injected = []
  const registered = []
  const effects = []
  const ctx = {
    uiWorkspace: { openSession: () => {} },
    effect(body) { effects.push(body()); return () => {} },
    slots: {
      inject(name, factory) { injected.push(name); factory(); return () => {} },
      register(registration, component) { registered.push({ registration, component }); return () => {} },
    },
    logger: { warn: () => {}, error: () => {} },
  }
  module.apply(ctx)
  for (const dispose of effects) if (typeof dispose === 'function') dispose()
  return { injected, registered }
}

// --- radar on -----------------------------------------------------------
const enabled = await load({ widgets: { radar: true } })
if (enabled.module.name !== 'dsh-session-radar') throw new Error(`unexpected name: ${enabled.module.name}`)
const mounted = mount(enabled.module)
if (mounted.injected.length !== 1 || mounted.injected[0] !== 'shell.overlay') throw new Error(`unexpected seats: ${mounted.injected.join(',')}`)
if (mounted.registered.length !== 1) throw new Error(`expected one registration, got ${mounted.registered.length}`)
const registration = mounted.registered[0].registration
if (registration.id !== 'session-radar') throw new Error(`unexpected id: ${registration.id}`)
if (registration.name !== 'shell.overlay') throw new Error(`unexpected seat: ${registration.name}`)
if (enabled.tags.length !== 1) throw new Error(`expected one stylesheet, got ${enabled.tags.length}`)
const css = String(enabled.tags[0].textContent)
for (const selector of ['.dsr-root', '.dsr-pill', '.dsr-panel', '.dsr-row']) {
  if (!css.includes(selector)) throw new Error(`stylesheet is missing ${selector}`)
}
console.log('[client-smoke] radar registered into', registration.name, 'as', registration.id)

// --- radar off ----------------------------------------------------------
const disabled = await load({ widgets: { radar: false } })
const off = mount(disabled.module)
if (off.registered.length !== 0) throw new Error('radar switch did not remove its registration')
if (disabled.tags.length !== 1) throw new Error('styles should still install when the widget is off')
console.log('[client-smoke] radar switch: no registration')

console.log('[client-smoke] stylesheet bytes:', css.length)
console.log('[client-smoke] OK')
