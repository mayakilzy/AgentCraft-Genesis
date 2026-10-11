import { test } from 'node:test';
import assert from 'node:assert';
import { exec } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const testDataDir = join(__dirname, '..', 'data');
const testRequestsFile = join(testDataDir, 'requests.json');

// Clean up before each test
async function setup() {
  try {
    await rm(testDataDir, { recursive: true });
  } catch (e) {
    // Directory doesn't exist, which is fine
  }
}

// Helper function to run CLI commands
function runCliCommand(command) {
  return new Promise((resolve, reject) => {
    exec(`node ${join(__dirname, '..', 'src', 'index.js')} ${command}`, (error, stdout, stderr) => {
      if (error) {
        reject({ error, stderr });
      } else {
        resolve({ stdout, stderr });
      }
    });
  });
}

test('Create a new request', async () => {
  await setup();
  
  // Create a new request
  const result = await runCliCommand('create "Test Request" "This is a test request"');
  
  // Should return an ID
  assert.ok(result.stdout.trim(), 'Should return an ID');
  
  // List requests to verify
  const listResult = await runCliCommand('list');
  const requests = JSON.parse(listResult.stdout);
  
  assert.strictEqual(requests.length, 1, 'Should have one request');
  assert.strictEqual(requests[0].title, 'Test Request', 'Title should match');
  assert.strictEqual(requests[0].description, 'This is a test request', 'Description should match');
  assert.strictEqual(requests[0].status, 'open', 'Status should be open');
  assert.strictEqual(requests[0].id, result.stdout.trim(), 'ID should match');
});

test('List all requests', async () => {
  await setup();
  
  // Create multiple requests
  const result1 = await runCliCommand('create "Request 1" "Description 1"');
  const result2 = await runCliCommand('create "Request 2" "Description 2"');
  
  // List all requests
  const listResult = await runCliCommand('list');
  const requests = JSON.parse(listResult.stdout);
  
  assert.strictEqual(requests.length, 2, 'Should have two requests');
  assert.strictEqual(requests[0].title, 'Request 1', 'First request title should match');
  assert.strictEqual(requests[1].title, 'Request 2', 'Second request title should match');
});

test('Update request status', async () => {
  await setup();
  
  // Create a request
  const createResult = await runCliCommand('create "Test Request" "This is a test request"');
  const id = createResult.stdout.trim();
  
  // Update status to in_progress
  await runCliCommand(`update ${id} in_progress`);
  
  // List requests to verify
  const listResult = await runCliCommand('list');
  const requests = JSON.parse(listResult.stdout);
  
  assert.strictEqual(requests[0].status, 'in_progress', 'Status should be in_progress');
  
  // Update status to resolved
  await runCliCommand(`update ${id} resolved`);
  
  // List requests to verify
  const listResult2 = await runCliCommand('list');
  const requests2 = JSON.parse(listResult2.stdout);
  
  assert.strictEqual(requests2[0].status, 'resolved', 'Status should be resolved');
});

test('Persistence across restarts', async () => {
  await setup();
  
  // Create a request
  const createResult = await runCliCommand('create "Test Request" "This is a test request"');
  const id = createResult.stdout.trim();
  
  // Update status
  await runCliCommand(`update ${id} in_progress`);
  
  // List requests to verify
  const listResult1 = await runCliCommand('list');
  const requests1 = JSON.parse(listResult1.stdout);
  assert.strictEqual(requests1[0].status, 'in_progress', 'Status should be in_progress');
  
  // Simulate restart by running a new process
  const listResult2 = await runCliCommand('list');
  const requests2 = JSON.parse(listResult2.stdout);
  
  assert.strictEqual(requests2.length, 1, 'Should have one request');
  assert.strictEqual(requests2[0].id, id, 'ID should match');
  assert.strictEqual(requests2[0].status, 'in_progress', 'Status should persist');
});

test('Reject invalid inputs', async () => {
  await setup();
  
  // Test empty title
  try {
    await runCliCommand('create "" "Description"');
    assert.fail('Should have thrown error for empty title');
  } catch (error) {
    assert.ok(error.stderr.includes('Title cannot be empty'), 'Should show error for empty title');
  }
  
  // Test unknown ID
  try {
    await runCliCommand('update unknown_id in_progress');
    assert.fail('Should have thrown error for unknown ID');
  } catch (error) {
    assert.ok(error.stderr.includes('not found'), 'Should show error for unknown ID');
  }
  
  // Test unknown status
  try {
    const createResult = await runCliCommand('create "Test Request" "This is a test request"');
    const id = createResult.stdout.trim();
    await runCliCommand(`update ${id} unknown_status`);
    assert.fail('Should have thrown error for unknown status');
  } catch (error) {
    assert.ok(error.stderr.includes('Invalid status'), 'Should show error for unknown status');
  }
  
  // Test invalid transition
  try {
    const createResult = await runCliCommand('create "Test Request" "This is a test request"');
    const id = createResult.stdout.trim();
    await runCliCommand(`update ${id} resolved`);
    assert.fail('Should have thrown error for invalid transition');
  } catch (error) {
    assert.ok(error.stderr.includes('Cannot transition'), 'Should show error for invalid transition');
  }
});

test('Negative test - same status update', async () => {
  await setup();
  
  // Create a request
  const createResult = await runCliCommand('create "Test Request" "This is a test request"');
  const id = createResult.stdout.trim();
  
  // Try to update to same status
  try {
    await runCliCommand(`update ${id} open`);
    assert.fail('Should have thrown error for same status update');
  } catch (error) {
    assert.ok(error.stderr.includes('Status is already open'), 'Should show error for same status update');
  }
});