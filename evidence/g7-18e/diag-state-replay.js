// Replays the api.test.js setup sequence to verify the actual returned counts
// at the moment the "should filter tasks by status" test asserts.
// Run with: node diag-state-replay.js (after starting the server on port 3099).
//
// This is the deterministic Phase-1 reproduction script. It exercises the SAME
// sequence of earlier tests in api.test.js against a fresh server+DB and then
// queries the filter endpoints. The application's behavior is correct — the
// test wrongly assumed isolation.
//
// At the moment the failing test asserts length===1, the actual returned
// counts are:
//   - GET /api/tasks?status=todo        → 4 tasks (Test Task, 2× Test Task to Update, Task 1)
//   - GET /api/tasks?status=in-progress → 2 tasks (Test Task to Update, Task 2)
//   - GET /api/tasks?status=done        → 1 task  (Task 3)
//   - GET /api/projects/8/tasks          → 3 tasks (Task 1, Task 2, Task 3) ← project-scoped correct
//
// Verdict: server.js is correct. The test assumes data isolation that doesn't
// exist because earlier tests in the SAME file share the SAME test DB.
const http = require('node:http');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const testDbFile = path.join(__dirname, 'hub.diag.db');
if (fs.existsSync(testDbFile)) fs.unlinkSync(testDbFile);

const startServer = () => new Promise((resolve, reject) => {
  const p = spawn('node', ['server.js'], {
    cwd: __dirname,
    env: { ...process.env, DB_FILE: testDbFile, PORT: 3099 },
    stdio: 'pipe',
  });
  p.stdout.on('data', (d) => {
    if (d.toString().includes('listening on port')) resolve(p);
  });
  p.on('error', reject);
});

const req = (method, p, data=null) => new Promise((resolve, reject) => {
  const r = http.request({ hostname:'localhost', port:3099, path:p, method, headers:{'Content-Type':'application/json'}}, (res) => {
    let body = '';
    res.on('data', c => body += c);
    res.on('end', () => { try { resolve({ statusCode: res.statusCode, data: JSON.parse(body) }); } catch { resolve({ statusCode: res.statusCode, data: body }); } });
  });
  r.on('error', reject);
  if (data) r.write(JSON.stringify(data));
  r.end();
});

(async () => {
  const server = await startServer();
  // 1) "should create a new project with valid data" - 'Test Project'
  await req('POST','/api/projects', { name:'Test Project', description:'A test project' });
  // 2) "should return project by ID" - 'Test Project 2'
  await req('POST','/api/projects', { name:'Test Project 2', description:'Another test project' });
  // 3) "should create a new task for existing project" - 'Test Project 3' + 'Test Task' (todo)
  const r3 = await req('POST','/api/projects', { name:'Test Project 3', description:'Project with tasks' });
  await req('POST', `/api/projects/${r3.data.data.id}/tasks`, { title:'Test Task', description:'A test task' });
  // 4) "should reject task with empty title" - 'Test Project 4' (no task)
  await req('POST','/api/projects', { name:'Test Project 4', description:'Project with invalid task' });
  // 5) "should update task status with valid value" - 'Test Project 5' + 'Test Task to Update' -> in-progress
  const r5 = await req('POST','/api/projects', { name:'Test Project 5', description:'Project with task to update' });
  const t5 = await req('POST', `/api/projects/${r5.data.data.id}/tasks`, { title:'Test Task to Update', description:'A test task' });
  await req('PATCH', `/api/tasks/${t5.data.data.id}`, { status:'in-progress' });
  // 6) "should reject invalid task status" - 'Test Project 6' + 'Test Task to Update' (todo, patch rejected)
  const r6 = await req('POST','/api/projects', { name:'Test Project 6', description:'Project with task to update' });
  const t6 = await req('POST', `/api/projects/${r6.data.data.id}/tasks`, { title:'Test Task to Update', description:'A test task' });
  await req('PATCH', `/api/tasks/${t6.data.data.id}`, { status:'invalid-status' });
  // 7) "should reject update without status" - 'Test Project 7' + 'Test Task to Update' (todo, patch rejected)
  const r7 = await req('POST','/api/projects', { name:'Test Project 7', description:'Project with task to update' });
  const t7 = await req('POST', `/api/projects/${r7.data.data.id}/tasks`, { title:'Test Task to Update', description:'A test task' });
  await req('PATCH', `/api/tasks/${t7.data.data.id}`, {});
  // 8) "should filter tasks by status" - 'Test Project 8' + Task 1 (todo), Task 2 (in-progress), Task 3 (done)
  const r8 = await req('POST','/api/projects', { name:'Test Project 8', description:'Project with tasks for filtering' });
  const pid8 = r8.data.data.id;
  await req('POST', `/api/projects/${pid8}/tasks`, { title:'Task 1', description:'A todo task' });
  const t2 = await req('POST', `/api/projects/${pid8}/tasks`, { title:'Task 2', description:'An in-progress task' });
  const t3 = await req('POST', `/api/projects/${pid8}/tasks`, { title:'Task 3', description:'A done task' });
  await req('PATCH', `/api/tasks/${t2.data.data.id}`, { status:'in-progress' });
  await req('PATCH', `/api/tasks/${t3.data.data.id}`, { status:'done' });

  // Now query the same filters
  const todo = await req('GET', '/api/tasks?status=todo');
  const inprog = await req('GET', '/api/tasks?status=in-progress');
  const done = await req('GET', '/api/tasks?status=done');

  console.log('=== State at moment "should filter tasks by status" asserts ===');
  console.log('GET /api/tasks?status=todo      → count =', todo.data.data.length, '| titles =', todo.data.data.map(t=>t.title).join(', '));
  console.log('GET /api/tasks?status=in-progress→ count =', inprog.data.data.length, '| titles =', inprog.data.data.map(t=>t.title).join(', '));
  console.log('GET /api/tasks?status=done      → count =', done.data.data.length, '| titles =', done.data.data.map(t=>t.title).join(', '));
  console.log();
  console.log('Expected by test (length===1 each):');
  console.log('  todo: 1, in-progress: 1, done: 1');
  console.log();
  console.log('=== Per-project scope for Test Project 8 (the documented project-specific retrieval) ===');
  const proj8Tasks = await req('GET', `/api/projects/${pid8}/tasks`);
  console.log('GET /api/projects/8/tasks → count =', proj8Tasks.data.data.length, '| titles =', proj8Tasks.data.data.map(t=>t.title).join(', '));

  server.kill();
  process.exit(0);
})();
