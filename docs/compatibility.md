# Compatibility And Agent Repair Notes

FinanceAgentGUI is a local app plus repairable source code. It should work out of the box for common environments, but OS, browser, auth, and local finance-tooling differences are expected. When compatibility fails, make the failure diagnosable and easy for a local coding agent to patch.

## Compatibility Philosophy

- Prefer clear diagnostics over broad generic advice.
- Keep every runtime requirement inside the app tree or configurable through settings/environment variables.
- Provide override knobs for platform-sensitive paths.
- Do not expose secrets while debugging.
- If a platform-specific fix is made, update this document in the same pass.

## Current Platform Expectations

| Area | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Vite/React web app | Intended, tested locally | Intended | Intended |
| Node local server | Intended, tested locally on Node 22 | Intended with Node 22+ recommended | Intended with Node 22+ recommended |
| Python helper scripts | Intended with venv | Intended with venv | Intended with venv or PowerShell activation |
| Arca.live browser handoff start | Tested with Google Chrome; Chrome is the default | Intended through `which`-detected browser commands | Intended through common Chrome/Edge/Brave install paths |
| Arca.live handoff recovery after server restart | Implemented through `ps` scan | Implemented through `ps` scan | Not fully implemented yet |

Windows support for starting a fresh browser handoff is present, but recovering an already-open handoff browser after GUI server restart is still a known improvement area.

## Windows Runtime Policy

Windows should be documented and supported in this order:

| Level | Environment | Support stance | Notes |
| --- | --- | --- | --- |
| 1 | Native PowerShell | Recommended default | Best match for Windows browser paths, local profiles, ports, Python venv activation, and future launcher scripts. |
| 2 | CMD | Secondary | Basic npm commands should work, but docs and repair guidance should prefer PowerShell. |
| 3 | WSL | Advanced only | Good for development or agent repair, not the default runtime for browser handoff. |

The default Windows user should run FinanceAgentGUI from native PowerShell, not WSL. This keeps Node, npm, Python, browser executables, browser profiles, and local server ports in the same operating-system context.

WSL is a separate Linux environment. Running the GUI server in WSL while expecting it to control a Windows Chrome installation can create path, quoting, profile-lock, localhost, DevTools, and credential-store confusion. If a user insists on WSL, make the environment choice explicit:

- WSL-native path: install Node/Python/npm packages inside WSL and use a Linux Chromium-family browser reachable from WSL.
- Windows-native path: install Node/Python/npm packages in PowerShell and use Windows Chrome/Edge/Brave.
- Do not mix WSL-installed dependencies with a PowerShell-run server, or PowerShell-installed dependencies with a WSL-run server.

If Windows users ask which one to choose, recommend PowerShell.

## Arca.live Browser Login Handoff

The Arca.live notification login flow uses a dedicated browser profile:

- profile directory: `data/arca-browser-profile`
- session file: `data/secrets/arca-session.json`
- login URL: `https://arca.live/u/login?goto=%2Fb%2Fstock`
- browser DevTools endpoint: local `127.0.0.1:<random-port>`

The user logs in manually in the opened browser. The app then captures only Arca.live cookies through the browser DevTools Protocol and stores them locally in `data/secrets/arca-session.json`.

Do not print the session file or raw cookie header. Status UI should show only safe metadata such as connected state, cookie names, domains, and timestamps.

## Browser Detection

The handoff code defaults to Google Chrome where available. It looks for browsers in this order:

- explicit `ARCA_BROWSER_PATH`
- macOS app paths for Chrome, Edge, Brave, Chromium
- Windows common install paths under `LOCALAPPDATA`, `Program Files`, and `Program Files (x86)`
- Linux commands resolved by `which`: `google-chrome`, `google-chrome-stable`, `chromium`, `chromium-browser`, `microsoft-edge`, `brave-browser`

ChatGPT Atlas is not auto-selected for this flow because it may not expose a stable DevTools endpoint when launched as a detached login handoff. If a user intentionally wants another Chromium-family browser, set `ARCA_BROWSER_PATH` to that executable. If detection fails, the recovery path should tell the user to set `ARCA_BROWSER_PATH` to the browser executable.

Starting the login handoff should return promptly after the dedicated browser process is open. If Chrome is still warming up its DevTools endpoint, the app can show the handoff as open and verify the endpoint again when the user presses "세션 저장".

## Known Compatibility Risks

### Durable local server service

The durable server command is cross-platform but intentionally uses each OS's
native user-level service manager:

- macOS: `launchd` LaunchAgent
- Linux: `systemd --user`
- Windows: Task Scheduler

Run from `web`:

```bash
npm run server:service:install
npm run server:service:status
```

The service keeps the local GUI server independent from a terminal window. It
does not make the app a public network service; the default bind remains
`127.0.0.1`.

Common repair checks:

- If install succeeds but the page is down, run `npm run server:service:status`
  and inspect `logs/service-5173.err.log`.
- If port `5173` is already occupied by a terminal-started server, stop the old
  process and run `npm run server:service:restart`.
- If Node was installed through a version manager and the service cannot find
  it, set `NODE_BIN` to the absolute Node executable path and reinstall the
  service.
- On Linux, `systemd --user` must be available in the current desktop/session
  environment. Without user systemd, use the foreground `npm run dev` path or
  add a platform-specific supervisor.
- On Windows, the scheduled task runs in the current user's context at logon. It
  should be installed from native PowerShell or another native Windows shell,
  not WSL.

### Antigravity CLI OAuth

Antigravity provider calls use the standalone `agy` CLI and its Google OAuth
session. Install the CLI, then run `agy` in a terminal to complete the browser
login flow before selecting Antigravity in the app.

If `agy` is missing, unauthenticated, or unable to list models, Antigravity
provider actions should fail with a clear readiness or generation error. Do not
use an alternate authentication mechanism or another selected provider.

### World Memory local database

World Memory stores user-specific SQLite data under `data/world-memory/`.
The app should create or migrate that database locally through
`scripts/world_memory_cli.py`; GitHub should only contain the schema blueprint
and operating instructions.

Tracked references:

- `docs/world-memory.md`
- `config/world-memory.schema.sql`
- `config/world-memory-collection.prompt.md`

Do not fix a missing World Memory store by copying in a bundled SQLite file.
Run `python scripts/world_memory_cli.py init` from the repository root if the file is
absent. If a populated store exists, repair commands must show the target path,
expected impact, and backup or confirmation boundary before destructive changes.

### Node WebSocket support

`web/server/arcaAuthApi.mjs` uses the global `WebSocket` client to talk to Chrome DevTools Protocol. Node 22 is the recommended runtime.

If the error says WebSocket is unavailable:

- upgrade Node,
- or patch the project to use an explicit WebSocket dependency,
- then document the new dependency in `docs/installation.md`.

### Windows Python stdout encoding

Windows native shells can expose `cp949` or another locale code page to Python
child processes. The yfinance calendar endpoints emit Korean labels, country
emoji, and fallback markers such as `•` as JSON, so `web/server/earningsApi.mjs`
and `web/server/economicCalendarApi.mjs` force their Python subprocesses to
UTF-8 with `PYTHONIOENCODING=utf-8` and `PYTHONUTF8=1`.

If a calendar view shows `UnicodeEncodeError: 'cp949' codec can't encode`, check
that those server modules are the active build and that the process was restarted
after updating. Do not remove the UTF-8 environment override when refactoring
Python subprocess helpers.

### Browser profile locks

Chromium-family browsers lock a profile while running. If `data/arca-browser-profile` is already open and the GUI server lost in-memory handoff state, the app should recover the running DevTools port where possible.

Current behavior:

- macOS/Linux: recovery scans running processes for the profile path and `--remote-debugging-port`.
- Windows: recovery is not yet fully implemented.

Possible Windows repair strategies:

- use PowerShell `Get-CimInstance Win32_Process` to find a command line containing `data\\arca-browser-profile` and `--remote-debugging-port=`,
- persist the handoff port and pid to a local runtime state file when launching,
- read Chromium's `DevToolsActivePort` file if available for the profile.

For WSL-specific repairs, avoid assuming a Windows browser executable can safely consume a Linux profile path. Prefer native PowerShell execution, or implement a deliberate WSL bridge with path conversion and explicit documentation.

### Browser enterprise policies

Some managed environments block remote debugging or custom user-data-dir profiles. If handoff start fails even with a correct browser path:

- capture the safe error message,
- verify whether the browser launches manually with `--remote-debugging-port`,
- offer `ARCA_BROWSER_PATH` or a different Chromium-family browser.

### Cloudflare and captcha

Arca.live may show Cloudflare challenge or captcha screens. The app should not bypass these. The user should complete them manually in the handoff browser. Agents should not solve captcha unless the user explicitly asks at action time.

### Login URL drift

The current login URL uses `goto`, not `redirect`. A wrong parameter can lead to `/u/null` and a 404 page after login.

If login opens a 404 page:

1. Inspect the public board page for the current login link.
2. Update the default login URL in `web/server/arcaAuthApi.mjs`.
3. Keep `ARCA_LOGIN_URL` as an override.
4. Re-run status/start/stop probes.

## Safe Diagnostic Commands

From `web`:

```bash
npm run build
node --check server/arcaAuthApi.mjs
npm run dev -- --host 127.0.0.1
```

Probe auth status:

```bash
curl -sS http://127.0.0.1:5173/api/arca/auth/status
```

Probe start/stop without printing secrets:

```bash
curl -sS -X POST -H 'Content-Type: application/json' -d '{}' \
  http://127.0.0.1:5173/api/arca/auth/start

curl -sS -X POST -H 'Content-Type: application/json' -d '{}' \
  http://127.0.0.1:5173/api/arca/auth/stop
```

If Vite uses another port, use the printed local URL.

## What Not To Do

- Do not commit `data/secrets/arca-session.json`.
- Do not commit `data/world-memory/world_issue_log.sqlite3` or any generated World Memory runtime file.
- Do not paste raw cookies into issues, chat, logs, or memory.
- Do not make a personal absolute path the default browser path.
- Do not remove the manual-login boundary by asking the app to collect the user's password.
- Do not treat a successful cookie capture as proof that notification polling is complete; polling still needs its own endpoint, status, error handling, and verification.

## Agent Repair Checklist

When the user says "fix this on my machine":

1. Identify the OS, shell, Node version, browser used, and exact failing endpoint.
2. Read `docs/installation.md` and this file.
3. Check whether `ARCA_BROWSER_PATH` or `ARCA_LOGIN_URL` would solve the issue without code changes.
4. If code changes are needed, keep them under the app tree.
5. Run `node --check` on edited server modules.
6. Run `npm run build`.
7. Start the local server and test the narrow endpoint.
8. Do not display raw secrets.
9. Update this document with any durable compatibility lesson.
