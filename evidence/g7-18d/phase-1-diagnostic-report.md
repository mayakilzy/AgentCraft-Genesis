# G7-18D Phase 1 — Deterministic Diagnosis

## Reproduced defect: route-ordering

**Confirmed:** `GET /api/projects/1/tasks` incorrectly matches the more general `GET /api/projects/:id` route before the `GET /api/projects/:id/tasks` route.

### Reproduction evidence

```
POST /api/projects → 201, id=1
POST /api/projects/1/tasks → 201, task created (id=1)
GET /api/projects/1/tasks → 200, but returns PROJECT object, not tasks array:
  {"ok":true,"data":{"id":1,"name":"Phase1 Test","description":"diagnostic","status":"active","created_at":"..."}}
```

The `data` field is a dict (project object), not an array (tasks list). This is the route-ordering defect.

### Root cause in server.js

```
Line 110: } else if (pathname.startsWith('/api/projects/') && method === 'GET') {
Line 118: } else if (pathname.startsWith('/api/projects/') && pathname.endsWith('/tasks') && method === 'GET') {
```

Line 110 matches ANY pathname starting with `/api/projects/` with method GET — including `/api/projects/1/tasks`. The more specific route at line 118 is never reached because line 110 matches first.

### Fix

Reorder: move the `/tasks` route (line 118) BEFORE the general `:id` route (line 110). OR add `&& !pathname.endsWith('/tasks')` to the line 110 condition.

## Independent failures beyond the routing defect

### Test 1: db.test.js — 6/6 PASS (no failures)

All 6 database tests pass. No independent failures.

### Test 2: api.test.js — 1 failure

**"should filter tasks by status"** at line 424:
```
TypeError: tasksResponse.data.data.find is not a function
```

This is **directly caused by the route-ordering defect**. The test calls `GET /api/projects/${projectId}/tasks` (line 423) and expects `tasksResponse.data.data` to be an array. Due to the route-ordering bug, the response is a project object, so `.find()` fails.

**Not an independent failure** — this is a direct consequence of the route-ordering defect.

### Test 3: integration.test.js — 1 failure

**"should persist data across server restarts"** at line 97:
```
Error: Server closed with code 1
```

This is an **independent failure** — NOT caused by the route-ordering defect.

**Root cause:** The integration test calls `startTestServer()` at line 163 to "get the server process", but `startTestServer()` always starts a NEW server process on port 3002. The first server (started in `test.before` at line 115) is still running on port 3002. The second server gets `EADDRINUSE` and crashes with code 1.

```js
// Line 115 (test.before):
await startTestServer();  // starts server #1 on port 3002

// Line 163 (inside the test):
const serverProcess = await startTestServer();  // starts server #2 on port 3002 → EADDRINUSE → crash
await stopTestServer(serverProcess);
```

The test author intended to "get the server process" from the `test.before` hook, but `startTestServer()` always creates a new process. The fix is to store the server process from `test.before` and use it directly, instead of calling `startTestServer()` again.

**This is a test design bug, not a routing bug.** It would fail even if the route-ordering were correct.

## Summary

| # | Failure | Caused by route-ordering? | Fix needed |
|---|---|---|---|
| 1 | `GET /api/projects/:id/tasks` returns project not tasks array | YES | Reorder routes in server.js |
| 2 | api.test.js "should filter tasks by status" | YES (direct consequence) | Fixed automatically once #1 is fixed |
| 3 | integration.test.js "should persist data across server restarts" | NO (independent) | Fix test: don't call startTestServer() twice on same port |

**Files requiring repair: 2** (`server.js` for the route-ordering, `test/integration.test.js` for the double-start bug).
**Files NOT requiring repair: 7** (public/*, test/api.test.js, test/db.test.js, package.json, README.md).

Note: test/api.test.js will pass automatically once the route-ordering is fixed — no changes needed to that file.
