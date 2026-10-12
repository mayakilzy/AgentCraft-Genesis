import { test } from 'node:test';
import { strictEqual, ok } from 'node:assert';
import http from 'http';
import { once } from 'node:events';

// Helper function to make HTTP requests
async function makeRequest(url, options = {}) {
  const response = await new Promise((resolve, reject) => {
    const req = http.request(url, options, resolve);
    req.on('error', reject);
    
    if (options.body) {
      req.write(options.body);
    }
    
    req.end();
  });
  
  const data = await once(response, 'data');
  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: JSON.parse(data.toString())
  };
}

// Start the server before running tests
let server;

test.before(async () => {
  // Import the server module
  const { initializeDatabase } = await import('../database.js');
  await initializeDatabase();
  
  // Start the server
  const { default: serverModule } = await import('../server.js');
  server = serverModule;
  
  // Wait for server to start
  await once(server, 'listening');
});

test.after(async () => {
  // Close the server after tests
  if (server) {
    server.close();
    await once(server, 'close');
  }
});

test('GET /api/tasks returns empty array initially', async () => {
  const response = await makeRequest('http://localhost:3000/api/tasks');
  strictEqual(response.statusCode, 200);
  ok(Array.isArray(response.body));
  strictEqual(response.body.length, 0);
});

test('POST /api/tasks creates a new task', async () => {
  const taskData = {
    title: 'Test Task',
    description: 'This is a test task'
  };
  
  const response = await makeRequest(
    'http://localhost:3000/api/tasks',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(taskData)
    }
  );
  
  strictEqual(response.statusCode, 201);
  ok(response.body.success);
  
  // Verify the task was created
  const getResponse = await makeRequest('http://localhost:3000/api/tasks');
  strictEqual(getResponse.statusCode, 200);
  ok(Array.isArray(getResponse.body));
  strictEqual(getResponse.body.length, 1);
  strictEqual(getResponse.body[0].title, taskData.title);
  strictEqual(getResponse.body[0].description, taskData.description);
  strictEqual(getResponse.body[0].completed, 0);
});

test('PUT /api/tasks/:id updates a task', async () => {
  // First create a task
  const createResponse = await makeRequest(
    'http://localhost:3000/api/tasks',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'Original Task',
        description: 'Original description'
      })
    }
  );
  
  strictEqual(createResponse.statusCode, 201);
  const taskId = createResponse.body.id;
  
  // Update the task
  const updateData = {
    title: 'Updated Task',
    description: 'Updated description',
    completed: 1
  };
  
  const updateResponse = await makeRequest(
    `http://localhost:3000/api/tasks/${taskId}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(updateData)
    }
  );
  
  strictEqual(updateResponse.statusCode, 200);
  ok(updateResponse.body.success);
  
  // Verify the task was updated
  const getResponse = await makeRequest(`http://localhost:3000/api/tasks/${taskId}`);
  strictEqual(getResponse.statusCode, 200);
  strictEqual(getResponse.body.title, updateData.title);
  strictEqual(getResponse.body.description, updateData.description);
  strictEqual(getResponse.body.completed, 1);
});

test('DELETE /api/tasks/:id deletes a task', async () => {
  // First create a task
  const createResponse = await makeRequest(
    'http://localhost:3000/api/tasks',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'Task to Delete',
        description: 'This task will be deleted'
      })
    }
  );
  
  strictEqual(createResponse.statusCode, 201);
  const taskId = createResponse.body.id;
  
  // Delete the task
  const deleteResponse = await makeRequest(
    `http://localhost:3000/api/tasks/${taskId}`,
    {
      method: 'DELETE'
    }
  );
  
  strictEqual(deleteResponse.statusCode, 200);
  ok(deleteResponse.body.success);
  
  // Verify the task was deleted
  const getResponse = await makeRequest(`http://localhost:3000/api/tasks/${taskId}`);
  strictEqual(getResponse.statusCode, 404); // Should be 404 since the task is deleted
});

test('GET /api/tasks?filter=active returns only active tasks', async () => {
  // Create multiple tasks with different statuses
  await makeRequest(
    'http://localhost:3000/api/tasks',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'Active Task 1',
        description: 'This task is active'
      })
    }
  );
  
  const createResponse2 = await makeRequest(
    'http://localhost:3000/api/tasks',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: 'Active Task 2',
        description: 'This task is also active'
      })
    }
  );
  
  // Mark one task as completed
  await makeRequest(
    `http://localhost:3000/api/tasks/${createResponse2.body.id}`,
    {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ completed: true })
    }
  );
  
  // Get active tasks
  const activeResponse = await makeRequest('http://localhost:3000/api/tasks?filter=active');
  strictEqual(activeResponse.statusCode, 200);
  ok(Array.isArray(activeResponse.body));
  strictEqual(activeResponse.body.length, 1);
  strictEqual(activeResponse.body[0].title, 'Active Task 1');
  strictEqual(activeResponse.body[0].completed, 0);
});

test('GET /api/tasks?filter=completed returns only completed tasks', async () => {
  // Get completed tasks
  const completedResponse = await makeRequest('http://localhost:3000/api/tasks?filter=completed');
  strictEqual(completedResponse.statusCode, 200);
  ok(Array.isArray(completedResponse.body));
  strictEqual(completedResponse.body.length, 1);
  strictEqual(completedResponse.body[0].title, 'Active Task 2');
  strictEqual(completedResponse.body[0].completed, 1);
});