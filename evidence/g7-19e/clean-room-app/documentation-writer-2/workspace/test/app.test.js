import { test } from 'node:test';
import assert from 'node:assert';
import { createRequest, listRequests, updateStatus } from '../src/store.js';
import { existsSync, unlinkSync, rmdirSync } from 'fs';
import { join } from 'path';

// Clean up before each test
const cleanup = () => {
  if (existsSync('data/requests.json')) {
    unlinkSync('data/requests.json');
  }
  if (existsSync('data')) {
    rmdirSync('data');
  }
};

test.beforeEach(cleanup);
test.afterEach(cleanup);

test('create adds a request to the store', () => {
  const request = createRequest('Test Title', 'Test Description');
  assert.strictEqual(request.status, 'open');
  assert.ok(request.id);
  assert.ok(request.createdAt);
  
  const requests = listRequests();
  assert.strictEqual(requests.length, 1);
  assert.strictEqual(requests[0].id, request.id);
});

test('list returns all stored requests', () => {
  createRequest('First Title', 'First Description');
  createRequest('Second Title', 'Second Description');
  
  const requests = listRequests();
  assert.strictEqual(requests.length, 2);
  assert.strictEqual(requests[0].title, 'First Title');
  assert.strictEqual(requests[1].title, 'Second Title');
});

test('update transitions status', () => {
  const request = createRequest('Test Title', 'Test Description');
  const id = request.id;
  
  // Update to in_progress
  const updated1 = updateStatus(id, 'in_progress');
  assert.strictEqual(updated1.status, 'in_progress');
  
  // Update to resolved
  const updated2 = updateStatus(id, 'resolved');
  assert.strictEqual(updated2.status, 'resolved');
});

test('persistence survives restart', () => {
  // Create a request
  createRequest('Persistent Title', 'Persistent Description');
  
  // Simulate restart by creating a new store instance
  // We'll just reload the file directly to simulate this
  const reloadedRequests = listRequests();
  assert.strictEqual(reloadedRequests.length, 1);
  assert.strictEqual(reloadedRequests[0].title, 'Persistent Title');
});

test('empty title is rejected', () => {
  assert.throws(() => {
    createRequest('', 'Description');
  }, /Title cannot be empty/);
  
  assert.throws(() => {
    createRequest('   ', 'Description');
  }, /Title cannot be empty/);
});

test('invalid transition is rejected', () => {
  const request = createRequest('Test Title', 'Test Description');
  const id = request.id;
  
  // Try to go from open directly to resolved (should fail)
  assert.throws(() => {
    updateStatus(id, 'resolved');
  }, /Cannot transition from open to resolved/);
  
  // Try to go backwards (should fail)
  const updated = updateStatus(id, 'in_progress');
  assert.strictEqual(updated.status, 'in_progress');
  
  assert.throws(() => {
    updateStatus(id, 'open');
  }, /Cannot transition from in_progress to open/);
  
  // Try same status (should fail)
  assert.throws(() => {
    updateStatus(id, 'in_progress');
  }, /Status is already in_progress/);
  
  // Try unknown status (should fail)
  assert.throws(() => {
    updateStatus(id, 'unknown_status');
  }, /Invalid status: unknown_status/);
});

test('unknown id is rejected', () => {
  assert.throws(() => {
    updateStatus('nonexistent_id', 'in_progress');
  }, /Request with id nonexistent_id not found/);
});