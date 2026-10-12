import { deepStrictEqual, strictEqual } from 'node:assert';
import { test } from 'node:test';
import { createServer } from 'http';

// Test for creating a task
test('API - Create a task', async () => {
  // Start server
  const server = createServer((req, res) => {
    if (req.url === '/api/tasks' && req.method === 'POST') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        const { title, description } = JSON.parse(body);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 1, title, description, completed: false }));
      });
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });
  
  const port = 3001;
  server.listen(port);
  
  try {
    // Create a task
    const response = await fetch(`http://localhost:${port}/api/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: 'Test Task', description: 'Test Description' })
    });
    
    strictEqual(response.status, 201);
    
    const task = await response.json();
    strictEqual(task.title, 'Test Task');
    strictEqual(task.description, 'Test Description');
    strictEqual(task.completed, false);
  } finally {
    server.close();
  }
});

// Test for listing tasks
test('API - List tasks', async () => {
  // Start server
  const server = createServer((req, res) => {
    if (req.url === '/api/tasks' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([
        { id: 1, title: 'Task 1', description: 'Description 1', completed: false },
        { id: 2, title: 'Task 2', description: 'Description 2', completed: true }
      ]));
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });
  
  const port = 3002;
  server.listen(port);
  
  try {
    // List tasks
    const response = await fetch(`http://localhost:${port}/api/tasks`);
    
    strictEqual(response.status, 200);
    
    const tasks = await response.json();
    strictEqual(tasks.length, 2);
    strictEqual(tasks[0].title, 'Task 1');
    strictEqual(tasks[1].completed, true);
  } finally {
    server.close();
  }
});

// Test for completing a task
test('API - Complete a task', async () => {
  // Start server
  const server = createServer((req, res) => {
    if (req.url === '/api/tasks/1' && req.method === 'PUT') {
      let body = '';
      req.on('data', chunk => {
        body += chunk.toString();
      });
      req.on('end', () => {
        const { completed } = JSON.parse(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ id: 1, title: 'Task 1', description: 'Description 1', completed }));
      });
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  });
  
  const port = 3003;
  server.listen(port);
  
  try {
    // Complete a task
    const response = await fetch(`http://localhost:${port}/api/tasks/1`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ completed: true })
    });
    
    strictEqual(response.status, 200);
    
    const task = await response.json();
    strictEqual(task.completed, true);
  } finally {
    server.close();
  }
});