# Local SQLite stores: install, update, and repair

FinanceAgentGUI distributes SQLite design contracts and owner code, never a
runtime database. This applies to populated user databases and empty example or
seed databases alike. A release archive or Git commit containing either kind of
database is invalid because an update could replace, shadow, or confuse existing
local state.

The machine-readable inventory is `config/sqlite-stores.json`.

| Store | Runtime path | Tracked schema | Owner | Data role |
| --- | --- | --- | --- | --- |
| World Memory | `data/world-memory/world_issue_log.sqlite3` | `config/world-memory.schema.sql` | `scripts/world_memory_cli.py` | authoritative user state |
| Toss order-history ledger | `data/tossinvest/tossinvest-ledger.sqlite3` | `config/tossinvest-ledger.schema.sql` | `scripts/tossinvest_ledger_store.py` | credential-scoped synced state |
| Investment simulator | `data/invest-simulator/simulator.sqlite3` | `config/invest-simulator.schema.sql` | `scripts/invest_simulator_store.py` | authoritative user state |
| Magazine event-signature index | `data/magazine/event-signature-index.sqlite3` | `config/magazine-event-signature-index.schema.sql` | `scripts/magazine_event_signature_index.py` | rebuildable derived index |

Chromium-owned `.db` files under `data/arca-browser-profile/` are not app-owned
stores. They stay ignored with the whole browser profile and must not be opened,
migrated, or copied by the app database tools.

## Read-only diagnosis

Run from the project root:

```bash
python scripts/sqlite_store_doctor.py
```

The doctor never creates or migrates a database. It checks the tracked schema
blueprint, runtime file existence, `PRAGMA quick_check`, foreign-key integrity,
supported `user_version`, required tables/columns/indexes, row counts, Git ignore
coverage, and whether any runtime database is tracked.

A missing lazy store is an informational state, not corruption. Require all four
stores only when validating a complete local bootstrap:

```bash
python scripts/sqlite_store_doctor.py --require-initialized --strict
```

Use `--json` for agent or automation input. The doctor reports relative project
paths and does not read application row payloads, credentials, or secret files.
World Memory's strict content harness is a separate operating-data quality check;
an empty but structurally healthy World Memory store is not expected to pass
volume or dedupe-quality thresholds.

## Explicit local initialization

Each owner provides an idempotent init command:

```bash
python scripts/world_memory_cli.py init
python scripts/tossinvest_ledger_store.py init
python scripts/invest_simulator_store.py init
python scripts/magazine_event_signature_index.py init
```

These commands create a missing local file or apply additive compatibility work
to an existing file. They do not import a bundled database and do not clear
rows. Toss, simulator, and Magazine refuse a database whose `user_version` is
newer than the app supports instead of stamping it down to an older version.

The features also support lazy creation, so a new install does not have to create
disabled or unused stores. To initialize every missing store deliberately, first
review the plan and stop the local server:

```bash
python scripts/sqlite_store_setup.py plan --initialize-missing
python scripts/sqlite_store_setup.py apply --initialize-missing --confirm
python scripts/sqlite_store_doctor.py --require-initialized --strict
```

`apply` uses SQLite's backup API for every existing database before it invokes
the owner init command. Backups and a manifest are written under
`data/backups/sqlite/<UTC timestamp>/` and are gitignored private runtime data.
It then verifies that required schema objects are present and that no existing
table row count decreased. It does not automatically restore a backup after a
failure; inspect the error and backup manifest before deciding whether recovery
is appropriate.

## Updating from the GitHub repository

A normal Git update should change program files while preserving ignored runtime
state. An agent handling “update this app from GitHub” should use this sequence:

1. Confirm the current folder is the standalone app root and stop the app/server.
2. Inspect `git status --short --ignored`; do not use `git reset --hard`,
   `git clean -fdx`, or another command that can erase ignored local state.
3. Run `python scripts/release_safety_check.py --strict` when the current version
   provides it. Confirm no database, secret, user config, browser profile, or log
   is Git-tracked.
4. Preserve unrelated tracked user edits. Fetch and use a non-destructive update
   such as `git pull --ff-only` only when the worktree permits it.
5. With the new code present, run
   `python scripts/sqlite_store_setup.py plan --initialize-missing` and show the
   database targets, backups, and planned actions.
6. After confirmation, run the corresponding `apply --initialize-missing
   --confirm` command. Existing stores are backed up before migration; newly
   added feature stores are created locally through owner code.
7. Run the strict doctor and the narrow feature tests. Start the server only
   after those checks pass.

If a database is newer than the downloaded app, stop. Do not replace it with an
empty file, apply the SQL blueprint over it manually, or edit `user_version`.
Update the app to a compatible version or make a reviewed migration plan.

For ZIP-based updates, never delete the old folder and unzip over it blindly.
Stop the app, make consistent SQLite backups, stage the new release in another
folder, and transfer only documented runtime state. Prefer a Git checkout for
agent-managed updates because Git's ignored-file boundary makes preservation
auditable. Never create a release ZIP directly from a used working directory;
export the tracked standalone Git tree instead.

## Store-specific notes

- World Memory is opt-in and its CLI also seeds system taxonomy. The SQL file is
  a human-readable target, while the CLI is the migration owner.
- The Toss ledger can be resynced from the user's authorized API scope, but it
  still contains private transaction history and must be backed up and protected.
  Snapshot `rebuild` is a write operation, not a general health check.
- The investment simulator is append-only user-created history and is not
  reconstructible from a broker. Never delete it as a repair shortcut.
- The Magazine index is derived from article metadata. It can be rebuilt after a
  reviewed failure, but it remains private runtime data and is never a release
  asset.

## Release invariant

Only schema, registry, owner scripts, tests, and documentation are publishable.
Before a commit, push, tag, or release:

```bash
python scripts/sqlite_store_doctor.py
python scripts/release_safety_check.py --strict
python scripts/release_safety_check.py --history
```

The Git publish set must contain zero runtime SQLite/DB files. A local working
directory may contain ignored user databases; that is why releases must be built
from the tracked `GuiBuild/` tree rather than by zipping the live folder.
