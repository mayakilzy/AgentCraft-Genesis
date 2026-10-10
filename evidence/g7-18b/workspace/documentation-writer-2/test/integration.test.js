const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');

// Test database file
const testDbFile = path.join(__dirname, 'hub.test.integration.db');
const testPort = 3002;

// Clean up test database before and after tests
const cleanupDb = () => {
  if (fs.existsSync(testDbFile)) {
    fs.unlinkSync(testDbFile);
  }
};

// Helper function to make HTTP requests
const makeRequest = (method, path, data = null) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: testPort,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          resolve({
            statusCode: res.statusCode,
            data: JSON.parse(body),
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            data: body,
          });
        }
      });
    });

    req.on('error', reject);

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
};

// Start test server
const startTestServer = () => {
  return new Promise((resolve, reject) => {
    const serverProcess = spawn('node', ['server.js'], {
      env: { ...process.env, DB_FILE: testDbFile, PORT: testPort },
      stdio: 'pipe',
    });

    let started = false;
    let timeout;

    const timeoutId = setTimeout(() => {
      if (!started) {
        serverProcess.kill();
        reject(new Error('Server did not start in time'));
      }
    }, 5000);

    serverProcess.stderr.on('data', (data) => {
      const message = data.toString();
      if (message.includes('listening on port')) {
        started = true;
        clearTimeout(timeoutId);
        resolve(serverProcess);
      }
    });

    serverProcess.on('error', (err) => {
      clearTimeout(timeoutId);
      reject(err);
    });

    serverProcess.on('close', (code) => {
      if (!started) {
        clearTimeout(timeoutId);
        reject(new Error(`Server closed with code ${code}`));
      }
    });
  });
};

// Stop test server
const stopTestServer = (serverProcess) => {
  return new Promise((resolve) => {
    serverProcess.on('close', () => {
      resolve();
    });
    serverProcess.kill();
  });
};

test.before(async () => {
  cleanupDb();
  await startTestServer();
});

test.after(async () => {
  cleanupDb();
});

test.describe('Integration Tests', () => {
  test.describe('Full Lifecycle Test', () => {
    test('should persist data across server restarts', async () => {
      // Step 1: Create a project
      const projectData = {
        name: 'Integration Test Project',
        description: 'A project for integration testing',
      };

      const createProjectResponse = await makeRequest('POST', '/api/projects', projectData);
      assert.strictEqual(createProjectResponse.statusCode, 201);
      assert.ok(createProjectResponse.data.ok);
      const projectId = createProjectResponse.data.data.id;

      // Step 2: Create a task for that project
      const taskData = {
        title: 'Integration Test Task',
        description: 'A task for integration testing',
      };

      const createTaskResponse = await makeRequest('POST', `/api/projects/${projectId}/tasks`, taskData);
      assert.strictEqual(createTaskResponse.statusCode, 201);
      assert.ok(createTaskResponse.data.ok);
      const taskId = createTaskResponse.data.data.id;

      // Step 3: Update the task status
      const updateTaskResponse = await makeRequest('PATCH', `/api/tasks/${taskId}`, {
        status: 'in-progress',
      });
      assert.strictEqual(updateTaskResponse.statusCode, 200);
      assert.ok(updateTaskResponse.data.ok);
      assert.strictEqual(updateTaskResponse.data.data.status, 'in-progress');

      // Step 4: Filter tasks by status
      const filteredTasksResponse = await makeRequest('GET', '/api/tasks?status=in-progress');
      assert.strictEqual(filteredTasksResponse.statusCode, 200);
      assert.ok(filteredTasksResponse.data.ok);
      assert.strictEqual(filteredTasksResponse.data.data.length, 1);
      assert.strictEqual(filteredTasksResponse.data.data[0].id, taskId);

      // Step 5: Stop the server
      const serverProcess = await startTestServer(); // Get the server process
      await stopTestServer(serverProcess);

      // Step 6: Restart the server with the same database file
      const restartedServer = await startTestServer();

      // Step 7: Verify the project still exists
      const getProjectResponse = await makeRequest('GET', `/api/projects/${projectId}`);
      assert.strictEqual(getProjectResponse.statusCode, 200);
      assert.ok(getProjectResponse.data.ok);
      assert.strictEqual(getProjectResponse.data.data.id, projectId);
      assert.strictEqual(getProjectResponse.data.data.name, 'Integration Test Project');

      // Step 8: Verify the task still exists
      const getTasksResponse = await makeRequest(`GET`, `/api/projects/${projectId}/tasks`);
      assert.strictEqual(getTasksResponse.statusCode, 200);
      assert.ok(getTasksResponse.data.ok);
      assert.strictEqual(getTasksResponse.data.data.length, 1);
      assert.strictEqual(getTasksResponse.data.data[0].id, taskId);
      assert.strictEqual(getTasksResponse.data.data[0].title, 'Integration Test Task');
      assert.strictEqual(getTasksResponse.data.data[0].status, 'in-progress');

      // Step 9: Verify the filtered task list still works
      const restartedFilteredTasksResponse = await makeRequest('GET', '/api/tasks?status=in-progress');
      assert.strictEqual(restartedFilteredTasksResponse.statusCode, 200);
      assert.ok(restartedFilteredTasksResponse.data.ok);
      assert.strictEqual(restartedFilteredTasksResponse.data.data.length, 1);
      assert.strictEqual(restartedFilteredTasksResponse.data.data[0].id, taskId);

      // Step 10: Clean up by stopping the server
      await stopTestServer(restartedServer);
    });
  });
});