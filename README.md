# dsh-session-radar

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin that shows **what is
happening across your sessions** in one small pill at the top-right corner of the frame:

```
 ●  1 等审批 · 1 运行中 · 1 失败
```

Click it to open the list; click a row to switch to that session. When nothing is running, waiting
or failing, the widget renders nothing at all.

```
┌────────────────────────────────────────────┐
│ 会话雷达                          4 个活动 │
│ ⏸ 修复登录        等审批 · bash · +1        │
│ ● 重构余额插件    运行中 · 12m   +1 子代理  │
│ ● （未命名）      失败 · 1m                 │
│ ✓ 调研压缩        完成 · 2m                 │
└────────────────────────────────────────────┘
```

## What it shows

| State | Meaning | Source |
|---|---|---|
| **等审批** | the session has a pending approval (badge names the tool and extra count) | `approval/asked`, `approval/decided` |
| **运行中** | a turn is open, or a sub-agent is still running for this root session | `turn/start`, `turn/end` |
| **失败** | the last turn ended with an `error` reason | `turn/end.reason.kind` |
| **完成** | finished within `recentMs` (30 min by default) | `turn/end` |
| **子代理** | `+N 子代理` badge counts running child sessions | `session.header.parentSession` |

- Titles come from the durable `session/title` events, so no projection read is involved.
- Sub-agent sessions are aggregated into their root row instead of cluttering the list.
- Ordering is deliberate: approvals first, then running, failures, finished — newest first within
  each group.

## Requirements

- A DSH client that composes the client `uiWorkspace` service (used to switch sessions) and
  `webServer` (the Host route). The Desktop client and `dsh web` both do.
- Node 20+ only for the test/install scripts; the plugin has **no build step**.

## Install

```sh
git clone https://github.com/marksimZ/dsh-session-radar.git dsh-session-radar
dsh web --patch /absolute/path/to/dsh-session-radar/cordis.patch.yml
# or permanently:
node scripts/install.mjs --dry-run
node scripts/install.mjs
node scripts/verify-deployed.mjs --url http://127.0.0.1:<GUI 端口>
```

## Configuration

| Key | Default | Meaning |
|---|---|---|
| `widgets.radar` | `true` | Register the pill and panel |
| `recentMs` | `1800000` | How long a finished session stays listed |
| `maxRows` | `8` | Maximum rows published |
| `pollMs` | `2000` | Browser poll interval (Host hint) |

## Architecture

```text
Host half (src/index.ts)
  ctx.on('session/event')
    session/title        → the row title
    turn/start, turn/end → running state and the ending reason
    approval/asked|decided → the pending badge
  session.header.parentSession → sub-agent aggregation
  ├─ GET /dsh-session-radar/state → rows + counts, ordered and capped
  └─ globalThis.__DSH_SESSION_RADAR_CONFIG__ → widget switch and poll hint

Browser half (src/client.js)
  shell.overlay (list seat, replaceRisk: none) → pill + panel
  ctx.uiWorkspace.openSession(id)              → row click switches session
```

**Why `shell.overlay`?** It is a frame-wide list seat with `replaceRisk: none`, so a fresh `id`
sits beside the shipped overlay entries instead of replacing one. The pill is positioned with
`var(--dsh-frame-overlay-top, 44px)`, which keeps it below the Windows caption strip and the macOS
traffic lights.

**Why a Host half?** A client plugin only sees the session it is bound to. The cross-session view
needs the global `session/event` stream, which only the Host receives.

## Tests

```sh
npm test          # view model + bundle smoke + theme/frame tokens + visual tokens
npm run test:host # four root sessions + one sub-agent over the real state route
npm run verify    # read-only probe of a running GUI
```

| Script | What it pins |
|---|---|
| `scripts/client-spec.mjs` | pill copy and tone, row ordering, per-state meta text, title fallback, sub-agent badge, elapsed formatting, injected switches |
| `scripts/client-smoke.mjs` | bundle contract, overlay registration, the radar switch |
| `scripts/host-smoke.mjs` | state ordering and counts, approval lifecycle, sub-agent aggregation, `maxRows`, the recent window, route edges |
| `scripts/theme-tokens.mjs` | every `--dsw-*`/`--dsh-*` reference is declared by the installed bundle |
| `scripts/visual-tokens.mjs` | no raw colours, radii/type from the theme scale, no infinite animation |
| `scripts/verify-deployed.mjs` | the running GUI serves the bundle and the state route |

## Limitations

- **Nothing before mount.** The Host folds the live event stream, so sessions that were already
  idle before it mounted do not appear — that is the intended meaning of a radar.
- **One Host process.** Sessions in another client window or process are outside its view.
- **Read-only.** Rows switch sessions; the radar never stops, retries or approves anything.
- **Sub-agents are counted, not listed.** Their rows belong to the parent session.

## License

MIT — see [LICENSE](LICENSE).
