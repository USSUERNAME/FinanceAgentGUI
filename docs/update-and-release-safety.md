# Update and release safety

This app keeps API credentials, cookies, browser profiles, databases, reports,
logs, and user configuration local. A GitHub update must preserve those files;
a GitHub release must exclude them.

## Protected local state

The following are never release assets:

- `.env` and `.env.*` other than the placeholder-only `.env.example`
- `config/*.user.json`
- `data/secrets/`, including Toss credential vaults and Arca session cookies
- `data/arca-browser-profile/`
- `data/backups/`
- app-owned SQLite stores and sidecars under `data/`
- generated Magazine articles, reports, shared memory, notifications, caches,
  attachments, and News Feed state
- `logs/`
- private keys, certificates with private material, raw tokens, personal email,
  resident-registration numbers, and personal absolute home paths

Git ignore rules are necessary but not sufficient: a file added before an ignore
rule can remain tracked, and a removed secret can remain in Git history.

## Release safety check

Run from the standalone project root:

```bash
python scripts/release_safety_check.py --strict
python scripts/release_safety_check.py --history
```

The first command checks the current tracked publish set and required ignore
guards. The second also scans reachable Git blobs. Output contains only finding
type, path, line, and abbreviated object id; the matched value is intentionally
suppressed so logs and agent context do not become a second leak.

Current-set errors block publication. History errors also block publication;
history-only warnings identify old non-secret runtime artifacts that need a
reviewed history-cleanup decision and must not trigger an automatic rewrite.

`data/news-feed.json` is a special history-only exception: its prior blob is
deterministic output from the configured public feeds and may remain in old Git
history. A current copy is still runtime state and must remain ignored. The
history scanner continues to inspect the old blob's contents for credential and
personal-data signatures even though it allows that historical path.

The scanner looks for forbidden runtime paths, database/private-key artifacts,
common provider token formats, literal credential assignments, private-key
blocks, personal home paths, Korean resident-registration numbers, and email
addresses. It is a defense-in-depth heuristic, not proof that arbitrary private
text is absent. Review the exact staged diff and release tree as well.

## If a secret is found

1. Stop publication. Do not paste the value into chat, an issue, or a log.
2. Revoke or rotate the credential first. Removing a file does not invalidate a
   key that another party may already have copied.
3. Remove the file from the current index and add the correct ignore rule.
4. If history contains it, treat the repository as exposed. Plan a reviewed
   history rewrite with the hosting service and collaborators; do not assume a
   force-push alone removes forks, caches, release archives, or local clones.
5. Re-run current and history scans and verify the public remote/release asset.

## Agent-managed GitHub update

When a user asks an agent to update the app from GitHub, the request authorizes a
code update, not deletion of local state or publication of private files.

- Stop the local server before database migration.
- Inspect the dirty and ignored worktree; preserve unrelated tracked edits.
- Never use destructive cleanup to make a pull succeed.
- Use the database plan/backup/migration workflow in `docs/sqlite-stores.md`.
- Do not print secret file contents while diagnosing update conflicts.
- After the update, run database doctor, release safety check, tests, and build.

For the public `devninjadev/FinanceAgentGUI` repository, publish the tracked
contents of this standalone folder as the GitHub root. Verify the remote/release
root contains `web/`, `docs/`, `scripts/`, `README.md`, `LICENSE`, and
`AGENTS.md`, and contains no top-level `GuiBuild/`, runtime DB, secret, user
config, browser profile, or log.
