import test from 'node:test';
import assert from 'node:assert';
import { execSync } from 'child_process';
import { existsSync, readFileSync, unlinkSync, rmdirSync } from 'fs';
import { join } from 'path';

// Clean up before tests
const dataDir = join(process.cwd(), 'data');
if (existsSync(dataDir)) {
  rmdirSync(dataDir, { recursive: true });
}

// Helper function to run CLI commands
function runCommand(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    return error.stdout.toString() + error.stderr.toString();
  }
}

test('Create a new request', () => {
  const output = runCommand('node src/index.js create "Test Request" "Test Description"');
  assert.match(output, /req_/);
  
  const requests = JSON.parse(runCommand('node src/index.js list'));
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].title, 'Test Request');
  assert.strictEqual(requests[0].description, 'Test Description');
  assert.strictEqual(requests[0].status, 'open');
});

test('List all requests', () => {
  runCommand('node src/index.js create "Second Request" "Second Description"');
  
  const requests = JSON.parse(runCommand('node src/index.js list'));
  assert.strictEqual(requests.length, 2);
  assert.strictEqual(requests[0].title, 'Test Request');
  assert.strictEqual(requests[1].title, 'Second Request');
});

test('Update request status', () => {
  const requests = JSON.parse(runCommand('node src/index.js list'));
  const id = requests[0].id;
  
  const output = runCommand(`node src/index.js update ${id} in_progress`);
  assert.strictEqual(output.trim(), 'Request updated successfully');
  
  const updatedRequests = JSON.parse(runCommand('node src/index.js list'));
  const updatedRequest = updatedRequests.find(req => req.id === id);
  assert.strictEqual(updatedRequest.status, 'in_progress');
});

test('Persistence across restart', () => {
  const requestsBefore = JSON.parse(runCommand('node src/index.js list'));
  assert.strictEqual(requestsBefore.length, 2);
  
  // Simulate restart by re-reading the file
  const data = readFileSync(join(dataDir, 'requests.json'), 'utf8');
  const requestsFromFile = JSON.parse(data);
  assert.strictEqual(requestsFromFile.length, 2);
  assert.strictEqual(requestsFromFile[0].status, 'in_progress');
});

test('Reject invalid inputs - empty title', () => {
  const output = runCommand('node src/index.js create "" "Description"');
  assert.match(output, /Title cannot be empty/);
});

test('Reject invalid inputs - unknown id', () => {
  const output = runCommand('node src/index.js update unknown_id in_progress');
  assert.match(output, /Request with id unknown_id not found/);
});

test('Reject invalid inputs - unknown status', () => {
  const requests = JSON.parse(runCommand('node src/index.js list'));
  const id = requests[1].id; // Use the second request which is still "open"
  
  const output = runCommand(`node src/index.js update ${id} unknown_status`);
  assert.match(output, /Unknown status: unknown_status/);
});

test('Reject invalid inputs - invalid transition (open to resolved)', () => {
  const requests = JSON.parse(runCommand('node src/index.js list'));
  const id = requests[1].id; // Use the second request which is still "open"
  
  const output = runCommand(`node src/index.js update ${id} resolved`);
  assert.match(output, /Cannot transition from open to resolved/);
});

test('Reject invalid inputs - same status', () => {
  const requests = JSON.parse(runCommand('node src/index.js list'));
  const id = requests[0].id; // Use the first request which is "in_progress"
  
  const output = runCommand(`node src/index.js update ${id} in_progress`);
  assert.match(output, /Request is already in_progress/);
});

test('Negative test - unknown command', () => {
  const output = runCommand('node src/index.js unknown_command');
  assert.match(output, /Unknown command: unknown_command/);
});

// Clean up after tests
if (existsSync(dataDir)) {
  rmdirSync(dataDir, { recursive: true });
}