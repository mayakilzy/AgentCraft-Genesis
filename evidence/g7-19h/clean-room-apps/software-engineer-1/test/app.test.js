import { test } from 'node:test';
import assert from 'node:assert';
import { exec } from 'child_process';
import { readFile, unlink, mkdir, rmdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
const requestsFile = join(dataDir, 'requests.json');

// Helper function to run the CLI command
function runCommand(command) {
  return new Promise((resolve, reject) => {
    exec(`node ${command}`, (error, stdout, stderr) => {
      resolve({ error, stdout, stderr });
    });
  });
}

// Clean up before each test
test.beforeEach(async () => {
  try {
    await unlink(requestsFile);
  } catch (err) {
    // File doesn't exist, ignore
  }
  try {
    await rmdir(dataDir);
  } catch (err) {
    // Directory doesn't exist, ignore
  }
});

test('Create a new request', async () => {
  const { stdout, stderr } = await runCommand('src/index.js create "Test Request" "Test Description"');
  assert.strictEqual(stderr, '', 'No error should be output');
  const id = stdout.trim();
  assert.ok(id, 'Should return an ID');
  
  // Verify the request was created
  const requests = JSON.parse(await readFile(requestsFile, 'utf-8'));
  assert.strictEqual(requests.length, 1, 'Should have one request');
  assert.strictEqual(requests[0].title, 'Test Request');
  assert.strictEqual(requests[0].description, 'Test Description');
  assert.strictEqual(requests[0].status, 'open');
  assert.strictEqual(requests[0].id, id);
});

test('List all requests', async () => {
  // Create a request first
  await runCommand('src/index.js create "Test Request" "Test Description"');
  
  // List requests
  const { stdout, stderr } = await runCommand('src/index.js list');
  assert.strictEqual(stderr, '', 'No error should be output');
  const requests = JSON.parse(stdout);
  assert.strictEqual(requests.length, 1, 'Should have one request');
  assert.strictEqual(requests[0].title, 'Test Request');
  assert.strictEqual(requests[0].description, 'Test Description');
  assert.strictEqual(requests[0].status, 'open');
});

test('Update a request status', async () => {
  // Create a request first
  const { stdout } = await runCommand('src/index.js create "Test Request" "Test Description"');
  const id = stdout.trim();
  
  // Update status
  await runCommand(`src/index.js update ${id} in_progress`);
  
  // Verify the update
  const requests = JSON.parse(await readFile(requestsFile, 'utf-8'));
  const request = requests.find(req => req.id === id);
  assert.strictEqual(request.status, 'in_progress', 'Status should be updated');
});

test('Persistence across restart', async () => {
  // Create a request
  const { stdout } = await runCommand('src/index.js create "Test Request" "Test Description"');
  const id = stdout.trim();
  
  // Verify it exists
  let requests = JSON.parse(await readFile(requestsFile, 'utf-8'));
  assert.strictEqual(requests.length, 1, 'Should have one request');
  
  // List requests again
  const { stdout: listOutput } = await runCommand('src/index.js list');
  const persistedRequests = JSON.parse(listOutput);
  assert.strictEqual(persistedRequests.length, 1, 'Should have one request after restart');
  assert.strictEqual(persistedRequests[0].id, id, 'ID should match');
});

test('Reject invalid inputs - empty title', async () => {
  const { stderr } = await runCommand('src/index.js create "" "Description"');
  assert.match(stderr, /Title cannot be empty/, 'Should reject empty title');
  
  // Verify no request was created
  try {
    await readFile(requestsFile, 'utf-8');
      assert.fail('Should not create a request with empty title');
  } catch (err) {
    assert.strictEqual(err.code, 'ENOENT', 'File should not exist');
  }
});

test('Reject invalid inputs - unknown id', async () => {
  // Create a request first
  await runCommand('src/index.js create "Test Request" "Test Description"');
  
  // Try to update a non-existent request
  const { stderr } = await runCommand('src/index.js update unknown_id in_progress');
  assert.match(stderr, /Request with id unknown_id not found/, 'Should reject unknown id');
});

test('Reject invalid inputs - unknown status', async () => {
  // Create a request first
  const { stdout } = await runCommand('src/index.js create "Test Request" "Test Description"');
  const id = stdout.trim();
  
  // Try to update with unknown status
  const { stderr } = await runCommand(`src/index.js update ${id} unknown_status`);
  assert.match(stderr, /Unknown status: unknown_status/, 'Should reject unknown status');
});

test('Reject invalid transition - open to resolved', async () => {
  // Create a request first
  const { stdout } = await runCommand('src/index.js create "Test Request" "Test Description"');
  const id = stdout.trim();
  
  // Try to transition directly from open to resolved
  const { stderr } = await runCommand(`src/index.js update ${id} resolved`);
  assert.match(stderr, /Invalid transition from open to resolved/, 'Should reject invalid transition');
  
  // Verify status hasn't changed
  const requests = JSON.parse(await readFile(requestsFile, 'utf-8'));
  const request = requests.find(req => req.id === id);
  assert.strictEqual(request.status, 'open', 'Status should remain open');
});