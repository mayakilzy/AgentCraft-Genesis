# G7-18R Phase 1 — Diagnostic Report (Failure Reproduction)

## Isolated reproduction environment

- Directory: `/tmp/g7-18r-repro/` (fresh copy of `evidence/g7-18/clean-room-app/`).
- Node.js version: `v24.21.0` (matches G7-18's worker runtime).
- DB file: `/tmp/g7-18r-repro/hub.repro.db` (fresh).
- `npm install` exit: 0 (no-op since the app has no npm dependencies).

## Reproduced startup failure

Command: `PORT=3190 DB_FILE=hub.repro.db node server.js`

Output (first 20 lines, captured in `evidence/g7-18r/repro-stdout.txt`):

```
node:internal/modules/cjs/loader:1138
      throw new ERR_UNKNOWN_BUILTIN_MODULE(specifier);
      ^

Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite3
    at defaultResolveImplForCJSLoading (node:internal/modules/cjs/loader:1138:13)
    at resolveForCJSWithHooks (node:internal/modules/cjs/loader:1169:12)
    at Module._load (node:internal/modules/cjs/loader:1341:5)
    at wrapModuleLoad (node:internal/modules/cjs/loader:261:19)
    at Module._require (node:internal/modules/cjs/loader:1674:12)
    at Object.<anonymous> (/tmp/g7-18r-repro/server.js:2:17)
```

**Original defect reproduced: YES.** The `node:sqlite3` import on line 2 of `server.js` throws `ERR_UNKNOWN_BUILTIN_MODULE` before any HTTP route is registered.

## SQLite API usage inspection (server.js)

The backend uses the third-party `sqlite3` npm package API throughout, despite the Goal spec naming `node:sqlite` (the built-in). Confirmed `node:sqlite3` is not a Node.js built-in:

```
$ node -e "require('node:sqlite3')"
Error [ERR_UNKNOWN_BUILTIN_MODULE]: No such built-in module: node:sqlite3
```

```
$ node -e "console.log(Object.keys(require('node:sqlite')))"
[ 'DatabaseSync', 'StatementSync', 'Session', 'constants', 'backup' ]
```

The correct built-in exports `DatabaseSync` (a synchronous class). The worker instead wrote code against the third-party `sqlite3` package's API:

| `sqlite3` (npm package — used by worker) | `node:sqlite` (built-in — should have been used) |
|---|---|
| `const sqlite3 = require('node:sqlite3').verbose()` | `const { DatabaseSync } = require('node:sqlite')` |
| `new sqlite3.Database(dbFile)` | `new DatabaseSync(dbFile)` |
| `db.serialize(() => { db.run(sql); db.run(sql); })` | `db.exec(sql)` (synchronous) |
| `db.all(sql, params, (err, rows) => {...})` | `db.prepare(sql).all(...params)` (returns rows directly) |
| `db.get(sql, params, (err, row) => {...})` | `db.prepare(sql).get(...params)` (returns row or undefined) |
| `const stmt = db.prepare(sql); stmt.run(params, function(err) { this.lastID }); stmt.finalize();` | `const stmt = db.prepare(sql); const r = stmt.run(...params); const id = r.lastInsertRowid;` (no `finalize`, no `this` rebinding) |
| `db.prepare(sql).run(params, cb)` callback style | `db.prepare(sql).run(params)` synchronous, returns `{ changes, lastInsertRowid }` |

The handler structure (HTTP routing, body parsing, validation, JSON response shaping) is correct. The defect is confined to the DB layer: every `db.*` call uses the wrong API surface.

## Hidden defects behind the startup failure

Inspecting `test/db.test.js`:

```js
const { open } = require('node:sqlite');
const { sqlite3 } = require('node:sqlite');
```

`node:sqlite` does NOT export `open` or `sqlite3`. Both imports fail (silently destructured to `undefined`). The first usage of `open(...)` would throw `TypeError: open is not a function`.

So the defect is NOT confined to `server.js`. At minimum **two files** need correction:

| File | Defect | Required Correction |
|---|---|---|
| `server.js` | Imports non-existent `node:sqlite3`. Uses callback-style API throughout. | Replace import with `node:sqlite`'s `DatabaseSync`. Rewrite every DB call to the synchronous API (drop callbacks, drop `.serialize`, drop `.verbose`, drop `.finalize`, use `lastInsertRowid` not `this.lastID`). |
| `test/db.test.js` | Imports `{ open }` and `{ sqlite3 }` from `node:sqlite` — neither is exported. | Replace with `{ DatabaseSync }`. Rewrite the test's `await open({...})` pattern to `new DatabaseSync(...)` and adjust the methods used. |
| `test/api.test.js` | Spawns `node server.js` — fails because server.js fails. No direct DB imports. | No fix needed in this file. Will pass once `server.js` is corrected. |
| `test/integration.test.js` | Same as `test/api.test.js`. | Same — no fix needed. |
| `public/index.html` `public/styles.css` `public/app.js` | Frontend looks syntactically valid (HTML, CSS, vanilla JS fetch calls to the documented endpoints). Not directly affected by the SQLite API defect. | No fix needed — but cannot be verified until the backend works. |
| `package.json` `README.md` | Documentation and metadata; `npm install` works (no deps). | No fix needed. |

## Frontend API expectations (public/app.js)

Spot-checked the frontend's expected API shape against the backend's route table:

| Frontend call (from `public/app.js`) | Backend route (in `server.js`) | Match |
|---|---|---|
| `fetch('/api/projects')` (GET) | `GET /api/projects` | ✓ |
| `fetch('/api/projects', { method: 'POST', body: JSON.stringify({ name, description }) })` | `POST /api/projects` | ✓ |
| `fetch(\`/api/projects/${projectId}\`)` (GET) | `GET /api/projects/:id` | ✓ |
| `fetch(\`/api/projects/${projectId}/tasks\`)` (GET) | `GET /api/projects/:id/tasks` | ✓ |
| `fetch(\`/api/projects/${projectId}/tasks\`, { method: 'POST', body: JSON.stringify({ title, description }) })` | `POST /api/projects/:id/tasks` | ✓ |
| `fetch(\`/api/tasks/${taskId}\`, { method: 'PATCH', body: JSON.stringify({ status }) })` | `PATCH /api/tasks/:id` | ✓ |
| `fetch('/api/tasks?status=...')` | `GET /api/tasks?status=...` | ✓ |

The frontend and backend routes match. No additional defects found in the route contract.

## Diagnostic summary

- **Root cause**: the worker confused the third-party `sqlite3` npm package API (callback-style, with `.verbose()`, `.serialize`, `.run(cb)`, `this.lastID`, `.finalize()`) with the Node.js built-in `node:sqlite` API (synchronous, with `DatabaseSync`, `.exec`, `.prepare().run()` returning `{ lastInsertRowid }`, no `.finalize`).
- **Files requiring repair**: 2 of 9 (`server.js`, `test/db.test.js`).
- **Files unaffected**: 7 of 9 (`package.json`, `README.md`, `public/{index,styles,app}.{html,css,js}`, `test/api.test.js`, `test/integration.test.js`).
- **Estimated repair scope**: rewrite the DB interaction layer in `server.js` (≈40 lines of DB call code across 6 routes), and rewrite the DB-open + insert/verify patterns in `test/db.test.js` (≈15 lines). No frontend work, no documentation work, no new files.

This is a targeted repair, not a regeneration. The HTTP handler structure, frontend, validation logic, and tests' structure all stay.
