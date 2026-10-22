/**
 * Theme-token guard for the session radar.
 *
 * Checks `--dsw-*` (theme) and `--dsh-*` (frame/layout) references against the
 * names the installed app bundle actually declares.
 *
 * Usage: node scripts/theme-tokens.mjs [--asar <path to app.asar>]
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const BUNDLE = join(resolve(HERE, '..'), 'src', 'client.js')

function option(name) {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : undefined
}

const KNOWN_INVALID = [
  '--dsw-alias-bg-elevated',
  '--dsw-alias-text-primary',
  '--dsw-alias-text-secondary',
  '--dsw-alias-border-subtle',
]

const VERIFIED = new Set([
  '--dsw-alias-bg-layer-1',
  '--dsw-alias-bg-layer-2',
  '--dsw-alias-interactive-bg-hover',
  '--dsw-alias-label-primary',
  '--dsw-alias-label-secondary',
  '--dsw-alias-label-tertiary',
  '--dsw-alias-link',
  '--dsw-alias-state-error-primary',
  '--dsw-alias-state-warn-primary',
  '--dsw-elevation-panel',
  '--dsw-elevation-stroke',
  '--dsw-font-family',
  '--dsw-radius-lg',
  '--dsw-radius-md',
  '--dsw-static-green-500',
  '--dsw-static-neutral-bluish-400',
  '--dsh-frame-overlay-top',
])

const ASAR = option('asar') ?? process.env.DSH_ASAR ?? 'E:\\dsh\\resources\\app.asar'
const REFERENCE = /var\(\s*(--d(?:sw|sh)-[a-z0-9-]+)/gi
const DECLARATION = /(--d(?:sw|sh)-[a-z0-9-]+)\s*:/g

async function installedStylesheet() {
  const registrations = []
  globalThis.window = { __ModuleLoader__: { load: registration => registrations.push(registration) } }
  globalThis.document = {
    hidden: false,
    head: { appendChild: () => {} },
    createElement: () => ({ dataset: {}, textContent: '' }),
    querySelector: () => null,
  }
  await import(`${pathToFileURL(BUNDLE).href}?t=${Date.now()}`)
  const module = registrations[0].factory(() => ({
    createElement: () => ({}),
    useState: () => [null, () => {}],
    useEffect: () => {},
    useRef: value => ({ current: value }),
  }))
  const tags = []
  globalThis.document.head.appendChild = tag => { tags.push(tag) }
  module.apply({
    uiWorkspace: { openSession: () => {} },
    effect: body => { body(); return () => {} },
    slots: { inject: () => () => {}, register: () => () => {} },
    logger: { warn: () => {}, error: () => {} },
  })
  if (tags.length !== 1) throw new Error(`expected one stylesheet, captured ${tags.length}`)
  return tags[0].textContent
}

function declaredTokens() {
  if (!existsSync(ASAR)) return new Set()
  if (statSync(ASAR).size > 900 * 1024 * 1024) return new Set()
  const text = readFileSync(ASAR, 'utf8')
  const names = new Set()
  for (const match of text.matchAll(DECLARATION)) names.add(match[1])
  console.log(`[tokens] app bundle declares ${names.size} custom properties`)
  return names
}

const css = await installedStylesheet()
const referenced = [...new Set([...css.matchAll(REFERENCE)].map(match => match[1]))].sort()
const declared = declaredTokens()
console.log(`[tokens] stylesheet references ${referenced.length} custom properties`)
if (referenced.length === 0) throw new Error('stylesheet references no custom properties')

const problems = []
for (const token of referenced) {
  if (KNOWN_INVALID.includes(token)) {
    problems.push(`${token} (known-invalid theme token)`)
    continue
  }
  if (declared.size === 0) {
    if (!VERIFIED.has(token)) problems.push(`${token} (not in the verified allowlist)`)
    continue
  }
  if (!declared.has(token)) problems.push(`${token} (not declared by the installed bundle)`)
}

if (problems.length > 0) {
  console.error(`\n[tokens] ${problems.length} unresolved reference(s):`)
  for (const problem of problems) console.error('  -', problem)
  process.exit(1)
}

for (const selector of ['.dsr-pill', '.dsr-panel', '.dsr-row', '.dsr-title', '.dsr-badge']) {
  if (!css.includes(selector)) throw new Error(`stylesheet lost ${selector}`)
}
if (!css.includes('prefers-reduced-motion')) throw new Error('stylesheet lost the reduced-motion guard')
if (!css.includes('--dsh-frame-overlay-top')) throw new Error('stylesheet lost the frame clearance variable')

console.log('[tokens] every reference resolves')
console.log('[tokens] OK')
