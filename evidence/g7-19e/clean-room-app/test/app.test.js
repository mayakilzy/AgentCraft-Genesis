import { test } from 'node:test';
import assert from 'node:assert';
import { loadRequests, saveRequests, createRequest, listRequests, updateStatus } from '../src/store.js';
import { readFile, writeFile, rm, mkdir } from 'fs/promises';
import { join } from 'path';
import { spawn } from 'child_process';

const DATA_DIR = 'data';
const REQUESTS_FILE = join(DATA_DIR, 'requests.json');

// Clean up before and after tests
async function setup() {
  try {
    await rm(DATA_DIR, { recursive: true });
  } catch (e) {
    // Directory might not exist
  }
}

async function teardown() {
  try {
    await rm(DATA_DIR, { recursive: true });
  } catch (e) {
    // Directory might not exist
  }
}

test.beforeEach(setup);
test.afterEach(teardown);

// Test (a): create adds a request to the store
test('create adds a request to the store', async () => {
  const request = await createRequest('Test Title', 'Test Description');
  assert.strictEqual(request.status, 'open');
  assert.ok(request.id);
  assert.ok(request.createdAt);
  
  const requests = await listRequests();
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].id, request.id);
});

// Test (b): list returns all stored requests
test('list returns all stored requests', async () => {
  await createRequest('First Title', 'First Description');
  await createRequest('Second Title', 'Second Description');
  
  const requests = await listRequests();
  assert.strictEqual(requests.length, 2);
  assert.strictEqual(requests[0].title, 'First Title');
  assert.strictEqual(requests[1].title, 'Second Title');
});

// Test (c): update transitions status
test('update transitions status', async () => {
  const request = await createRequest('Test Title', 'Test Description');
  const id = request.id;
  
  // Update to in_progress
  await updateStatus(id, 'in_progress');
  let requests = await listRequests();
  let updatedRequest = requests.find(r => r.id === id);
  assert.strictEqual(updatedRequest.status, 'in_progress');
  
  // Update to resolved
  await updateStatus(id, 'resolved');
  requests = await listRequests();
  updatedRequest = requests.find(r => r.id === id);
  assert.strictEqual(updatedRequest.status, 'resolved');
});

// Test (d): persistence survives restart
test('persistence survives restart', async () => {
  // Create a request
  const request = await createRequest('Test Title', 'Test Description');
  const id = request.id;
  
  // Verify it's in the file
  let data = await readFile(REQUESTS_FILE, 'utf-8');
  let requests = JSON.parse(data);
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].id, id);
  
  // Create a new store instance and load
  const newRequests = await loadRequests();
  assert.strictEqual(newRequests.length, 1);
  assert.strictEqual(newRequests[0].id, id);
});

// Test (e): empty title is rejected
test('empty title is rejected', async () => {
  await assert.rejects(
    async () => {
      await createRequest('', 'Test Description');
    },
    { message: 'Title cannot be empty' }
  );
  
  await assert.rejects(
    async () => {
      await createRequest('   ', 'Test Description');
    },
    { message: 'Title cannot be empty' }
  );
});

// Test (f): invalid transition is rejected
test('invalid transition is rejected', async () => {
  const request = await createRequest('Test Title', 'Test Description');
  const id = request.id;
  
  // Try to skip in_progress and go directly to resolved
  await assert.rejects(
    async () => {
      await updateStatus(id, 'resolved');
    },
    { message: 'Cannot transition directly from open to resolved' }
  );
  
  // Update to in_progress first
  await updateStatus(id, 'in_progress');
  
  // Try to go back to open
  await assert.rejects(
    async () => {
      await updateStatus(id, 'open');
    },
    { message: 'Cannot transition from in_progress to open' }
  );
  
  // Try to update to same status
  await assert.rejects(
    async () => {
      await updateStatus(id, 'in_progress');
    },
    { message: 'Status is already in_progress' }
  );
});

// Helper function to run CLI commands and capture output
async function runCliCommand(command) {
  return new Promise((resolve, reject) => {
    const child = spawn('node', ['src/index.js', ...command.split(' ')]);
    let stdout = '';
    let stderr = '';
    
    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });
    
    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });
    
    child.on('close', (code) => {
      resolve({
        status: code,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });
    
    child.on('error', (error) => {
      reject(error);
    });
  });
}

// Test CLI functionality
test('CLI create command', async () => {
  const result = await runCliCommand('create "CLI Test" "CLI Description"');
  assert.strictEqual(result.status, 0);
  assert.ok(result.stdout); // Should have an ID
  
  const id = result.stdout;
  const listResult = await runCliCommand('list');
  assert.strictEqual(listResult.status, 0);
  const requests = JSON.parse(listResult.stdout);
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].title, 'CLI Test');
  assert.strictEqual(requests[0].description, 'CLI Description');
});

test('CLI list command', async () => {
  await createRequest('List Test 1', 'Description 1');
  await createRequest('List Test 2', 'Description 2');
  
  const result = await runCliCommand('list');
  assert.strictEqual(result.status, 0);
  const requests = JSON.parse(result.stdout);
  assert.strictEqual(requests.length, 2);
});

test('CLI update command', async () => {
  const createResult = await runCliCommand('create "Update Test" "Description"');
  assert.strictEqual(createResult.status, 0);
  const id = createResult.stdout;
  
  // Update to in_progress
  let result = await runCliCommand(`update ${id} in_progress`);
  assert.strictEqual(result.status, 0);
  let updated = JSON.parse(result.stdout);
  assert.strictEqual(updated.status, 'in_progress');
  
  // Update to resolved
  result = await runCliCommand(`update ${id} resolved`);
  assert.strictEqual(result.status, 0);
  updated = JSON.parse(result.stdout);
  assert.strictEqual(updated.status, 'resolved');
});

test('CLI error handling - empty title', async () => {
  const result = await runCliCommand('create "" "Description"');
  assert.strictEqual(result.status, 1);
  assert.ok(result.stderr.includes('Title cannot be empty'));
});

test('CLI error handling - unknown id', async () => {
  const result = await runCliCommand('update unknown_id in_progress');
  assert.strictEqual(result.status, 1);
  assert.ok(result.stderr.includes('Request with id unknown_id not found'));
});

test('CLI error handling - invalid status', async () => {
  const createResult = await runCliCommand('create "Test" "Description"');
  const id = createResult.stdout;
  
  const result = await runCliCommand(`update ${id} invalid_status`);
  assert.strictEqual(result.status, 1);
  assert.ok(result.stderr.includes('Invalid status: invalid_status'));
});

test('CLI error handling - invalid transition', async () => {
  const createResult = await runCliCommand('create "Test" "Description"');
  const id = createResult.stdout;
  
  const result = await runCliCommand(`update ${id} resolved`);
  assert.strictEqual(result.status, 1);
  assert.ok(result.stderr.includes('Cannot transition directly from open to resolved'));
});