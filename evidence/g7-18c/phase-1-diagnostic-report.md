# G7-18C Phase 1 — Diagnostic Report (All Remaining Defects)

## Reproduced G7-18B failures (6 of 17 acceptance checks)

From `evidence/g7-18b/acceptance-results.json`:

| Check | Status | Detail |
|---|---|---|
| A-09 (POST /api/projects/:id/tasks) | FAIL | 404 |
| A-10 (PATCH /api/tasks/:id) | FAIL | (skipped — no task) |
| A-11 (status filter) | FAIL | (skipped — no task) |
| A-13b (task persistence) | FAIL | (no task to persist) |
| A-14 (automated tests) | FAIL | npm test exit 1, pass=0, fail=6 |
| A-15 (browser acceptance) | FAIL | task creation 404 |

## Defect 1: Route-parsing index error (4 occurrences in `server.js`)

`server.js` extracts the `:id` parameter from the pathname using `pathname.split('/')[2]`. This returns the wrong segment.

**Bug locations:**
- Line 108: `GET /api/projects/:id` → `const id = pathname.split('/')[2];`
- Line 116: `GET /api/projects/:id/tasks` → `const id = pathname.split('/')[2];`
- Line 121: `POST /api/projects/:id/tasks` → `const id = pathname.split('/')[2];`
- Line 143: `PATCH /api/tasks/:id` → `const id = pathname.split('/')[2];`

**Analysis:**
- `/api/projects/1` → split = `['', 'api', 'projects', '1']` → `[2]` = `'projects'`, `[3]` = `'1'`
- `/api/projects/1/tasks` → split = `['', 'api', 'projects', '1', 'tasks']` → `[2]` = `'projects'`, `[3]` = `'1'`
- `/api/tasks/1` → split = `['', 'api', 'tasks', '1']` → `[2]` = `'tasks'`, `[3]` = `'1'`

**Fix:** All 4 occurrences should use `pathname.split('/')[3]` (not `[2]`). The `[2]` index returns the literal string `'projects'` or `'tasks'`, not the numeric id. When this string is used in `db.prepare('SELECT * FROM projects WHERE id = ?').get('projects')`, SQLite returns no row (no project with id='projects'), so the route returns 404.

**Note:** This bug was present in the ORIGINAL G7-18 generation. The G7-18B repair goal said "Preserve HTTP routing unchanged" so the worker correctly did not touch it. G7-18C explicitly allows fixing the HTTP API implementation, so this is now in scope.

## Defect 2: Test startup readiness detection uses stderr instead of stdout (2 occurrences)

`test/api.test.js` line 80 and `test/integration.test.js` line 80:

```js
serverProcess.stderr.on('data', (data) => {
  const message = data.toString();
  if (message.includes('listening on port')) {
    started = true;
    // ...
  }
});
```

But `server.js` (line ~165) logs the startup message via `console.log("Community Project Hub listening on port ${port}")` which writes to **stdout**, not stderr. The test never sees the startup message and times out after 5 seconds.

**Fix:** Change `serverProcess.stderr.on(...)` to `serverProcess.stdout.on(...)` in both `test/api.test.js` and `test/integration.test.js`. (Alternatively, listen on both `stdout` and `stderr` — but stdout is the correct channel for `console.log`.)

## Defect 3: `test/db.test.js` does not create the schema before querying it

The repaired `test/db.test.js` opens a fresh DB with `new DatabaseSync(testDbFile)` and immediately queries `sqlite_master` for the `projects` table:

```js
const db = new DatabaseSync(testDbFile);
const result = db.prepare(`SELECT sql FROM sqlite_master WHERE type='table' AND name='projects'`).get();
assert.ok(result, 'Projects table should exist');  // FAILS — table doesn't exist
```

The test never calls `db.exec()` with the `CREATE TABLE` statements. All 6 db tests fail because the schema is never created.

**Fix:** Add a schema-creation step at the start of each test (or in a `beforeEach` hook). The schema should match `server.js`'s `initializeDb()`:

```sql
CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in-progress','done')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

Additionally, to test FK enforcement and cascade delete, the test must enable `PRAGMA foreign_keys = ON;` before inserting data (SQLite disables FK enforcement by default).

## Defect 4 (potential): FK enforcement may not be enabled in `server.js`

The `server.js` `initializeDb()` creates the tables with `ON DELETE CASCADE` but does NOT execute `PRAGMA foreign_keys = ON;`. This means:
- The FK constraint `REFERENCES projects(id)` is syntactically valid but not enforced at runtime.
- `ON DELETE CASCADE` does not fire.
- A task can be inserted with a non-existent `project_id` (the FK check is skipped).

If `test/db.test.js` tests FK enforcement (it does: "should reject inserting task with non-existent project_id"), then `server.js` must also enable `PRAGMA foreign_keys = ON;` in `initializeDb()`.

**Fix:** Add `db.exec('PRAGMA foreign_keys = ON;');` in `initializeDb()` before the CREATE TABLE statements. This is a minimal, correct change that makes the existing schema constraints actually work.

## Defect 5 (potential): `test/api.test.js` and `test/integration.test.js` may have route expectations that the route-parsing bug would still break even after fixing stderr → stdout

Even after fixing the stderr/stdout bug, the API tests will hit the route-parsing bug (Defect 1). So fixing Defect 1 is a prerequisite for the API tests to pass.

Once Defect 1 is fixed:
- `POST /api/projects/1/tasks` → returns 201 with the created task
- `PATCH /api/tasks/1` → returns 200 with the updated task
- `GET /api/tasks?status=in-progress` → returns the filtered list

## Summary of required repairs

| File | Defect | Fix |
|---|---|---|
| `server.js` line 108, 116, 121, 143 | Route-parsing `[2]` → `[3]` | Change 4 occurrences of `pathname.split('/')[2]` to `pathname.split('/')[3]` |
| `server.js` `initializeDb()` | FK enforcement not enabled | Add `db.exec('PRAGMA foreign_keys = ON;');` before CREATE TABLE |
| `test/api.test.js` line 80 | Listens on stderr | Change to `serverProcess.stdout.on(...)` (or listen on both) |
| `test/integration.test.js` line 80 | Same | Same fix |
| `test/db.test.js` | No schema creation | Add `db.exec()` with CREATE TABLE statements + `PRAGMA foreign_keys = ON;` at the start of each test (or in a `beforeEach` hook) |

**Files requiring repair: 4** (`server.js`, `test/api.test.js`, `test/db.test.js`, `test/integration.test.js`).
**Files NOT requiring repair: 5** (`public/index.html`, `public/styles.css`, `public/app.js`, `package.json`, `README.md`).

## Reproduction evidence

Captured in:
- `evidence/g7-18b/acceptance-results.json` — the 6 FAIL results
- `evidence/g7-18b/app-test-stdout.txt` — the 6 test failures (db tests fail immediately, api tests time out at 5s)
- `evidence/g7-18b/clean-room-app/server.js` — the 4 `pathname.split('/')[2]` occurrences (lines 108, 116, 121, 143)
- `evidence/g7-18b/clean-room-app/test/api.test.js` line 80 — `serverProcess.stderr.on('data', ...)`
- `evidence/g7-18b/clean-room-app/test/integration.test.js` line 80 — same
- `evidence/g7-18b/clean-room-app/test/db.test.js` — no `db.exec()` calls
