# G7-19E — Independent Clean-Room Acceptance Transcript

Date: 2026-10-11T05:35:13Z
Clean-room path: /tmp/g7-19e-clean-room
Source: /home/z/my-project/work/evidence/g7-19e/clean-room-app/ (files only — no Genesis context)

## Manual CLI verification

### TEST 1 — Create a service request
```
mv3e2y4x6a8wu
exit: 0
second create id: mv3e2y5s2uydz
```

### TEST 2 — List all requests
```
[
  {
    "id": "mv3e2y4x6a8wu",
    "title": "Server down",
    "description": "Production unresponsive",
    "status": "open",
    "createdAt": "2026-10-11T05:35:13.233Z"
  },
  {
    "id": "mv3e2y5s2uydz",
    "title": "DB slow",
    "description": "Queries timing out",
    "status": "open",
    "createdAt": "2026-10-11T05:35:13.264Z"
  }
]
exit: 0
```

### TEST 3 — Update status (open→in_progress)
```
{
  "id": "mv3e2y5s2uydz",
  "title": "DB slow",
  "description": "Queries timing out",
  "status": "in_progress",
  "createdAt": "2026-10-11T05:35:13.264Z"
}
exit: 0
```

### TEST 4 — Update status (in_progress→resolved)
```
{
  "id": "mv3e2y5s2uydz",
  "title": "DB slow",
  "description": "Queries timing out",
  "status": "resolved",
  "createdAt": "2026-10-11T05:35:13.264Z"
}
exit: 0
```

### TEST 5 — Persistence survives restart (new process reads same file)
```
-rw-rw-r-- 1 z z 349 Oct 11 05:35 data/requests.json
[
  {
    "id": "mv3e2y4x6a8wu",
    "title": "Server down",
    "description": "Production unresponsive",
    "status": "open",
    "createdAt": "2026-10-11T05:35:13.233Z"
  },
  {
    "id": "mv3e2y5s2uydz",
```

### TEST 6 — Empty title rejected
```
Error: Title cannot be empty
exit: 1
```

### TEST 7 — Invalid status rejected
```
Error: Invalid status: bogus_status
exit: 1
```

### TEST 8 — Invalid transition (resolved→open) rejected
```
Error: Cannot transition from resolved to any other status
exit: 1
```

### TEST 9 — Unknown id rejected
```
Error: Request with id nonexistent-id not found
exit: 1
```

## npm install (must be a no-op)
```

up to date in 208ms
exit: 0
ls: cannot access 'node_modules/': No such file or directory
```

## npm test (must exit 0 within 60s)
```
  code: 'MODULE_NOT_FOUND',
  requireStack: []
}

Node.js v24.21.0
✖ test (32.701396ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 39.18592

✖ failing tests:

test at test:1:1
✖ test (32.701396ms)
  'test failed'
exit: 0
```

## Direct node test runner (no npm wrapper)
```
  
      at TestContext.<anonymous> (file:///tmp/g7-19e-clean-room/test/app.test.js:180:10)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: '"CLI',
    expected: 'CLI Test',
    operator: 'strictEqual',
    diff: 'simple'
  }

test at test/app.test.js:212:1
✖ CLI error handling - empty title (30.437007ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  
  0 !== 1
  
      at TestContext.<anonymous> (file:///tmp/g7-19e-clean-room/test/app.test.js:214:10)
      at process.processTicksAndRejections (node:internal/process/task_queues:104:5)
      at async Test.run (node:internal/test_runner/test:1409:7)
      at async Test.processPendingSubtests (node:internal/test_runner/test:974:7) {
    generatedMessage: true,
    code: 'ERR_ASSERTION',
    actual: 0,
    expected: 1,
    operator: 'strictEqual',
    diff: 'simple'
  }
exit: 0
```
