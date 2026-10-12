import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import http from 'node:http';
import { once } from 'node:events';

const BASE_URL = 'http://localhost:3000';

// Helper function to make HTTP requests
async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, options);
  const data = await response.text();
  return {
    status: response.status,
    headers: Object.fromEntries(response.headers.entries()),
    data: data ? JSON.parse(data) : null
  };
}

test('Create a task', async () => {
  const response = await request('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Test Task', description: 'Test Description' })
  });
  
  strictEqual(response.status, 201);
  ok(response.data.id);
  strictEqual(response.data.title, 'Test Task');
  strictEqual(response.data.description, 'Test Description');
  strictEqual(response.data.completed, false);
});

test('List tasks', async () => {
  // First, create a task
  await request('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'List Test Task', description: 'For listing test' })
  });
  
  // Then list all tasks
  const response = await request('/api/tasks');
  
  strictEqual(response.status, 200);
  ok(Array.isArray(response.data));
  ok(response.data.length > 0);
  
  const task = response.data.find(t => t.title === 'List Test Task');
  ok(task);
  strictEqual(task.description, 'For listing test');
  strictEqual(task.completed, false);
});

test('Mark task as complete', async () => {
  // First, create a task
  const createResponse = await request('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Complete Test Task', description: 'For complete test' })
  });
  
  const taskId = createResponse.data.id;
  
  // Then mark it as complete
  const response = await request(`/api/tasks/${taskId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Complete Test Task', description: 'For complete test', completed: true })
  });
  
  strictEqual(response.status, 200);
  strictEqual(response.data.completed, true);
  
  // Verify it's marked as complete when listing
  const listResponse = await request('/api/tasks?filter=completed');
  const completedTask = listResponse.data.find(t => t.id === taskId);
  ok(completedTask);
  strictEqual(completedTask.completed, true);
});

test('Filter tasks by status', async () => {
  // Create a completed task
  const completedFilterResponse = await request('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Completed Filter Task', description: 'Completed', completed: true })
  });
  
  // Create an active task
  const activeFilterResponse = await request('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Active Filter Task', description: 'Active', completed: false })
  });
  
  // Test all filter
  const allResponse = await request('/api/tasks?filter=all');
  strictEqual(allResponse.status, 200);
  ok(Array.isArray(allResponse.data));
  ok(allResponse.data.length >= 2);
  
  // Test active filter
  const activeTasksResponse = await request('/api/tasks?filter=active');
  strictEqual(activeTasksResponse.status, 200);
  ok(Array.isArray(activeTasksResponse.data));
  const activeTask = activeTasksResponse.data.find(t => t.id === activeFilterResponse.data.id);
  ok(activeTask);
  strictEqual(activeTask.completed, false);
  
  // Test completed filter
  const completedTasksResponse = await request('/api/tasks?filter=completed');
  strictEqual(completedTasksResponse.status, 200);
  ok(Array.isArray(completedTasksResponse.data));
  const completedTask = completedTasksResponse.data.find(t => t.id === completedFilterResponse.data.id);
  ok(completedTask);
  strictEqual(completedTask.completed, true);
});

test('Update a task', async () => {
  // First, create a task
  const createResponse = await request('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Update Test Task', description: 'Original description' })
  });
  
  const taskId = createResponse.data.id;
  
  // Then update it
  const response = await request(`/api/tasks/${taskId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Updated Task Title', description: 'Updated description', completed: true })
  });
  
  strictEqual(response.status, 200);
  strictEqual(response.data.title, 'Updated Task Title');
  strictEqual(response.data.description, 'Updated description');
  strictEqual(response.data.completed, true);
});

test('Delete a task', async () => {
  // First, create a task
  const createResponse = await request('/api/tasks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'Delete Test Task', description: 'To be deleted' })
  });
  
  const taskId = createResponse.data.id;
  
  // Then delete it
  const response = await request(`/api/tasks/${taskId}`, {
    method: 'DELETE'
  });
  
  strictEqual(response.status, 200);
  
  // Verify it's gone
  const listResponse = await request('/api/tasks');
  const deletedTask = listResponse.data.find(t => t.id === taskId);
  strictEqual(deletedTask, undefined);
});