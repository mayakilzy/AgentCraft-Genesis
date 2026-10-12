import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { createServer } from 'http';
import { once } from 'events';
import http from 'http';

test('Create a new task', async () => {
  const server = createServer(async (req, res) => {
    if (req.url === '/api/tasks' && req.method === 'POST') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
      }
      
      const { title, description } = JSON.parse(body);
      
      // Mock database response
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 1,
        title,
        description,
        completed: 0
      }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });
  
  server.listen(0); // Use a random available port
  await once(server, 'listening');
  
  const port = server.address().port;
  const url = `http://localhost:${port}/api/tasks`;
  
  const postData = JSON.stringify({
    title: 'Test Task',
    description: 'This is a test task'
  });
  
  const options = {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };
  
  const request = http.request(url, options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      assert.strictEqual(res.statusCode, 201);
      const responseData = JSON.parse(data);
      assert.strictEqual(responseData.title, 'Test Task');
      assert.strictEqual(responseData.description, 'This is a test task');
      assert.strictEqual(responseData.completed, 0);
    });
  });
  
  request.write(postData);
  request.end();
  
  await once(request, 'response');
  server.close();
});

test('List all tasks', async () => {
  const server = createServer(async (req, res) => {
    if (req.url === '/api/tasks' && req.method === 'GET') {
      // Mock database response
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify([
        {
          id: 1,
          title: 'Task 1',
          description: 'First task',
          completed: 0
        },
        {
          id: 2,
          title: 'Task 2',
          description: 'Second task',
          completed: 1
        }
      ]));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });
  
  server.listen(0); // Use a random available port
  await once(server, 'listening');
  
  const port = server.address().port;
  const url = `http://localhost:${port}/api/tasks`;
  
  const options = {
    method: 'GET',
    headers: {
      'Content-Type': 'application/json'
    }
  };
  
  const request = http.request(url, options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      assert.strictEqual(res.statusCode, 200);
      const responseData = JSON.parse(data);
      assert.strictEqual(responseData.length, 2);
      assert.strictEqual(responseData[0].title, 'Task 1');
      assert.strictEqual(responseData[1].completed, 1);
    });
  });
  
  request.end();
  await once(request, 'response');
  server.close();
});

test('Mark task as complete', async () => {
  const server = createServer(async (req, res) => {
    if (req.url === '/api/tasks/1' && req.method === 'PUT') {
      let body = '';
      for await (const chunk of req) {
        body += chunk;
      }
      
      const { title, description, completed } = JSON.parse(body);
      
      // Mock database response
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        id: 1,
        title,
        description,
        completed: completed ? 1 : 0
      }));
    } else {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
    }
  });
  
  server.listen(0); // Use a random available port
  await once(server, 'listening');
  
  const port = server.address().port;
  const url = `http://localhost:${port}/api/tasks/1`;
  
  const postData = JSON.stringify({
    title: 'Updated Task',
    description: 'This task is now complete',
    completed: true
  });
  
  const options = {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData)
    }
  };
  
  const request = http.request(url, options, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      assert.strictEqual(res.statusCode, 200);
      const responseData = JSON.parse(data);
      assert.strictEqual(responseData.title, 'Updated Task');
      assert.strictEqual(responseData.completed, 1);
    });
  });
  
  request.write(postData);
  request.end();
  await once(request, 'response');
  server.close();
});