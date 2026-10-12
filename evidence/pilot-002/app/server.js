import { createServer } from 'node:http';
import { open } from 'node:sqlite';
import { sqlite3 } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import 
  { createTask, 
    getTasks, 
    getTaskById, 
    updateTask, 
    deleteTask 
  } from './database.js';

const server = createServer(async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // Parse URL
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  // API Routes
  if (path.startsWith('/api/')) {
    try {
      if (path === '/api/tasks' && req.method === 'GET') {
        const filter = url.searchParams.get('filter') || 'all';
        const tasks = await getTasks(filter);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify(tasks));
      }

      if (path === '/api/tasks' && req.method === 'POST') {
        let body = '';
        for await (const chunk of req) {
          body += chunk.toString();
        }
        const { title, description } = JSON.parse(body);
        const result = await createTask(title, description);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ id: result.lastID, title, description, completed: false }));
      }

      if (path.startsWith('/api/tasks/') && req.method === 'GET') {
        const id = path.split('/').pop();
        const task = await getTaskById(id);
        if (task) {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify(task));
        } else {
          res.writeHead(404);
          return res.end('Task not found');
        }
      }

      if (path.startsWith('/api/tasks/') && req.method === 'PUT') {
        const id = path.split('/').pop();
        let body = '';
        for await (const chunk of req) {
          body += chunk.toString();
        }
        const { title, description, completed } = JSON.parse(body);
        await updateTask(id, title, description, completed);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ id, title, description, completed }));
      }

      if (path.startsWith('/api/tasks/') && req.method === 'DELETE') {
        const id = path.split('/').pop();
        await deleteTask(id);
        res.writeHead(200);
        return res.end();
      }

      res.writeHead(404);
      return res.end('Not found');
    } catch (error) {
      console.error('API Error:', error);
      res.writeHead(500);
      return res.end('Internal Server Error');
    }
  }

  // Static file serving
  try {
    let filePath = path === '/' ? 'index.html' : path.substring(1);
    
    // Security check to prevent directory traversal
    if (filePath.includes('..') || filePath.startsWith('/')) {
      res.writeHead(403);
      return res.end('Forbidden');
    }
    
    const fileContent = await readFile(join(new URL('.', import.meta.url).pathname, filePath));
    
    // Set appropriate content type
    if (filePath.endsWith('.html')) {
      res.setHeader('Content-Type', 'text/html');
    } else if (filePath.endsWith('.js')) {
      res.setHeader('Content-Type', 'application/javascript');
    } else if (filePath.endsWith('.css')) {
      res.setHeader('Content-Type', 'text/css');
    }
    
    res.writeHead(200);
    return res.end(fileContent);
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.writeHead(404);
      return res.end('Not found');
    }
    console.error('Static file error:', error);
    res.writeHead(500);
    return res.end('Internal Server Error');
  }
});

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});