const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');
const { spawn } = require('node:child_process');

// Test database file
const testDbFile = path.join(__dirname, 'hub.test.api.db');
const testPort = 3001;

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

    serverProcess.stdout.on('data', (data) => {
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
  // Store the server process in a module-level variable
  global.testServer = await startTestServer();
});

test.beforeEach(async () => {
  // Reset the database before each test
  cleanupDb();
  // Restart the server with a clean database
  if (global.testServer) {
    await stopTestServer(global.testServer);
  }
  global.testServer = await startTestServer();
});

test.after(async () => {
  cleanupDb();
  // Stop the server after all tests
  if (global.testServer) {
    await stopTestServer(global.testServer);
  }
});

test.describe('API Tests', () => {
  test.describe('GET /api/projects', () => {
    test('should return empty array when no projects exist', async () => {
      const response = await makeRequest('GET', '/api/projects');
      assert.strictEqual(response.statusCode, 200);
      assert.ok(response.data.ok);
      assert.deepEqual(response.data.data, []);
    });
  });

  test.describe('POST /api/projects', () => {
    test('should create a new project with valid data', async () => {
      const projectData = {
        name: 'Test Project',
        description: 'A test project',
      };

      const response = await makeRequest('POST', '/api/projects', projectData);
      assert.strictEqual(response.statusCode, 201);
      assert.ok(response.data.ok);
      assert.strictEqual(response.data.data.name, 'Test Project');
      assert.strictEqual(response.data.data.description, 'A test project');
      assert.strictEqual(response.data.data.status, 'active');
      assert.ok(response.data.data.id);
      assert.ok(response.data.data.created_at);
    });

    test('should reject project with empty name', async () => {
      const projectData = {
        name: '',
        description: 'A test project',
      };

      const response = await makeRequest('POST', '/api/projects', projectData);
      assert.strictEqual(response.statusCode, 400);
      assert.ok(!response.data.ok);
      assert.strictEqual(response.data.error, 'Project name is required');
    });

    test('should reject project with missing name', async () => {
      const projectData = {
        description: 'A test project',
      };

      const response = await makeRequest('POST', '/api/projects', projectData);
      assert.strictEqual(response.statusCode, 400);
      assert.ok(!response.data.ok);
      assert.strictEqual(response.data.error, 'Project name is required');
    });

    test('should reject project with invalid JSON', async () => {
      const options = {
        hostname: 'localhost',
        port: testPort,
        path: '/api/projects',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      };

      const req = http.request(options);
      req.write('invalid json');
      req.end();

      const response = await new Promise((resolve) => {
        req.on('response', (res) => {
          let body = '';
          res.on('data', (chunk) => {
            body += chunk;
          });
          res.on('end', () => {
            resolve({
              statusCode: res.statusCode,
              data: JSON.parse(body),
            });
          });
        });
      });

      assert.strictEqual(response.statusCode, 400);
      assert.ok(!response.data.ok);
      assert.strictEqual(response.data.error, 'Invalid JSON');
    });
  });

  test.describe('GET /api/projects/:id', () => {
    test('should return project by ID', async () => {
      // First create a project
      const projectData = {
        name: 'Test Project 2',
        description: 'Another test project',
      };

      const createResponse = await makeRequest('POST', '/api/projects', projectData);
      const projectId = createResponse.data.data.id;

      // Now get it by ID
      const response = await makeRequest('GET', `/api/projects/${projectId}`);
      assert.strictEqual(response.statusCode, 200);
      assert.ok(response.data.ok);
      assert.strictEqual(response.data.data.id, projectId);
      assert.strictEqual(response.data.data.name, 'Test Project 2');
    });

    test('should return 404 for non-existent project', async () => {
      const response = await makeRequest('GET', '/api/projects/99999');
      assert.strictEqual(response.statusCode, 404);
      assert.ok(!response.data.ok);
      assert.strictEqual(response.data.error, 'Project not found');
    });
  });

  test.describe('POST /api/projects/:id/tasks', () => {
    test('should create a new task for existing project', async () => {
      // First create a project
      const projectData = {
        name: 'Test Project 3',
        description: 'Project with tasks',
      };

      const createResponse = await makeRequest('POST', '/api/projects', projectData);
      const projectId = createResponse.data.data.id;

      // Now create a task for that project
      const taskData = {
        title: 'Test Task',
        description: 'A test task',
      };

      const response = await makeRequest('POST', `/api/projects/${projectId}/tasks`, taskData);
      assert.strictEqual(response.statusCode, 201);
      assert.ok(response.data.ok);
      assert.strictEqual(response.data.data.title, 'Test Task');
      assert.strictEqual(response.data.data.description, 'A test task');
      assert.strictEqual(response.data.data.status, 'todo');
      assert.strictEqual(response.data.data.project_id, projectId);
      assert.ok(response.data.data.id);
      assert.ok(response.data.data.created_at);
    });

    test('should return 404 for non-existent project', async () => {
      const taskData = {
        title: 'Test Task',
        description: 'A test task',
      };

      const response = await makeRequest('POST', '/api/projects/99999/tasks', taskData);
      assert.strictEqual(response.statusCode, 404);
      assert.ok(!response.data.ok);
      assert.strictEqual(response.data.error, 'Project not found');
    });

    test('should reject task with empty title', async () => {
      // First create a project
      const projectData = {
        name: 'Test Project 4',
        description: 'Project with invalid task',
      };

      const createResponse = await makeRequest('POST', '/api/projects', projectData);
      const projectId = createResponse.data.data.id;

      // Now create a task with empty title
      const taskData = {
        title: '',
        description: 'A test task',
      };

      const response = await makeRequest('POST', `/api/projects/${projectId}/tasks`, taskData);
      assert.strictEqual(response.statusCode, 400);
      assert.ok(!response.data.ok);
      assert.strictEqual(response.data.error, 'Task title is required');
    });
  });

  test.describe('PATCH /api/tasks/:id', () => {
    test('should update task status with valid value', async () => {
      // First create a project and a task
      const projectData = {
        name: 'Test Project 5',
        description: 'Project with task to update',
      };

      const createResponse = await makeRequest('POST', '/api/projects', projectData);
      const projectId = createResponse.data.data.id;

      const taskData = {
        title: 'Test Task to Update',
        description: 'A test task',
      };

      const createTaskResponse = await makeRequest('POST', `/api/projects/${projectId}/tasks`, taskData);
      const taskId = createTaskResponse.data.data.id;

      // Now update the task status
      const updateResponse = await makeRequest('PATCH', `/api/tasks/${taskId}`, {
        status: 'in-progress',
      });

      assert.strictEqual(updateResponse.statusCode, 200);
      assert.ok(updateResponse.data.ok);
      assert.strictEqual(updateResponse.data.data.status, 'in-progress');
    });

    test('should return 404 for non-existent task', async () => {
      const response = await makeRequest('PATCH', '/api/tasks/99999', {
        status: 'in-progress',
      });
      assert.strictEqual(response.statusCode, 404);
      assert.ok(!response.data.ok);
      assert.strictEqual(response.data.error, 'Task not found');
    });

    test('should reject invalid task status', async () => {
      // First create a project and a task
      const projectData = {
        name: 'Test Project 6',
        description: 'Project with task to update',
      };

      const createResponse = await makeRequest('POST', '/api/projects', projectData);
      const projectId = createResponse.data.data.id;

      const taskData = {
        title: 'Test Task to Update',
        description: 'A test task',
      };

      const createTaskResponse = await makeRequest('POST', `/api/projects/${projectId}/tasks`, taskData);
      const taskId = createTaskResponse.data.data.id;

      // Now try to update with invalid status
      const response = await makeRequest('PATCH', `/api/tasks/${taskId}`, {
        status: 'invalid-status',
      });

      assert.strictEqual(response.statusCode, 400);
      assert.ok(!response.data.ok);
      assert.strictEqual(response.data.error, 'Invalid task status');
    });

    test('should reject update without status', async () => {
      // First create a project and a task
      const projectData = {
        name: 'Test Project 7',
        description: 'Project with task to update',
      };

      const createResponse = await makeRequest('POST', '/api/projects', projectData);
      const projectId = createResponse.data.data.id;

      const taskData = {
        title: 'Test Task to Update',
        description: 'A test task',
      };

      const createTaskResponse = await makeRequest('POST', `/api/projects/${projectId}/tasks`, taskData);
      const taskId = createTaskResponse.data.data.id;

      // Now try to update without status
      const response = await makeRequest('PATCH', `/api/tasks/${taskId}`, {});

      assert.strictEqual(response.statusCode, 400);
      assert.ok(!response.data.ok);
      assert.strictEqual(response.data.error, 'Status is required');
    });
  });

  test.describe('GET /api/tasks?status=', () => {
    test('should filter tasks by status', async () => {
      // First create a project
      const projectData = {
        name: 'Test Project 8',
        description: 'Project with tasks for filtering',
      };

      const createResponse = await makeRequest('POST', '/api/projects', projectData);
      const projectId = createResponse.data.data.id;

      // Create tasks with different statuses
      const taskData1 = {
        title: 'Task 1',
        description: 'A todo task',
      };

      const taskData2 = {
        title: 'Task 2',
        description: 'An in-progress task',
      };

      const taskData3 = {
        title: 'Task 3',
        description: 'A done task',
      };

      await makeRequest('POST', `/api/projects/${projectId}/tasks`, taskData1);
      await makeRequest('POST', `/api/projects/${projectId}/tasks`, taskData2);
      await makeRequest('POST', `/api/projects/${projectId}/tasks`, taskData3);

      // Update one task to in-progress
      const tasksResponse = await makeRequest('GET', `/api/projects/${projectId}/tasks`);
      const taskId = tasksResponse.data.data.find(t => t.title === 'Task 2').id;
      await makeRequest('PATCH', `/api/tasks/${taskId}`, {
        status: 'in-progress',
      });

      // Update another task to done
      const tasksResponse2 = await makeRequest('GET', `/api/projects/${projectId}/tasks`);
      const taskId2 = tasksResponse2.data.data.find(t => t.title === 'Task 3').id;
      await makeRequest('PATCH', `/api/tasks/${taskId2}`, {
        status: 'done',
      });

      // Now test filtering
      const todoResponse = await makeRequest('GET', '/api/tasks?status=todo');
      assert.strictEqual(todoResponse.statusCode, 200);
      assert.ok(todoResponse.data.ok);
      
      // Verify cross-project filtering: response should contain our task
      const todoTask = todoResponse.data.data.find(t => t.title === 'Task 1' && t.project_id === projectId);
      assert.ok(todoTask, 'Should find Task 1 in todo response');
      
      // Verify project-specific filtering: project endpoint should return only our tasks
      const projectTasksResponse = await makeRequest('GET', `/api/projects/${projectId}/tasks`);
      assert.strictEqual(projectTasksResponse.statusCode, 200);
      assert.ok(projectTasksResponse.data.ok);
      assert.strictEqual(projectTasksResponse.data.data.length, 3);
      
      // Verify each task has the correct status
      const projectTodoTasks = projectTasksResponse.data.data.filter(t => t.status === 'todo');
      assert.strictEqual(projectTodoTasks.length, 1);
      assert.strictEqual(projectTodoTasks[0].title, 'Task 1');
      
      const projectInProgressTasks = projectTasksResponse.data.data.filter(t => t.status === 'in-progress');
      assert.strictEqual(projectInProgressTasks.length, 1);
      assert.strictEqual(projectInProgressTasks[0].title, 'Task 2');
      
      const projectDoneTasks = projectTasksResponse.data.data.filter(t => t.status === 'done');
      assert.strictEqual(projectDoneTasks.length, 1);
      assert.strictEqual(projectDoneTasks[0].title, 'Task 3');
    });
  });
});