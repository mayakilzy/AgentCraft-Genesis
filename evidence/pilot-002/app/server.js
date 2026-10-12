import { createServer } from 'http';
import { open } from 'node:sqlite';
import { sqlite3 } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const dbFile = join(__dirname, 'tasks.db');
let db;

const server = createServer(async (req, res) => {
  // Handle API routes
  if (req.url.startsWith('/api/')) {
    handleAPI(req, res);
    return;
  }

  // Serve static files
  if (req.url === '/' || req.url === '/index.html') {
    serveFile(res, join(__dirname, 'index.html'), 'text/html');
    return;
  }

  if (req.url === '/app.js') {
    serveFile(res, join(__dirname, 'app.js'), 'application/javascript');
    return;
  }

  if (req.url === '/style.css') {
    serveFile(res, join(__dirname, 'style.css'), 'text/css');
    return;
  }

  // 404 for other routes
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

async function handleAPI(req, res) {
  if (!db) {
    db = await open({
      filename: dbFile,
      driver: sqlite3.Database
    });
    
    // Create tasks table if not exists
    await db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        completed INTEGER DEFAULT 0
      )
    `);
  }

  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'GET' && req.url === '/api/tasks') {
    try {
      const tasks = await db.all('SELECT * FROM tasks');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(tasks));
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error');
    }
    return;
  }

  if (req.method === 'POST' && req.url === '/api/tasks') {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const { title, description } = JSON.parse(body);
        if (!title) {
          res.writeHead(400, { 'Content-Type': 'text/plain' });
          res.end('Title is required');
          return;
        }
        
        const result = await db.run(
          'INSERT INTO tasks (title, description) VALUES (?, ?)',
          [title, description]
        );
        
        const newTask = await db.get('SELECT * FROM tasks WHERE id = ?', [result.lastID]);
        res.writeHead(201, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(newTask));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server error');
      }
    });
    return;
  }

  if (req.method === 'PUT' && req.url.match(/\/api\/tasks\/(\d+)/)) {
    const id = req.url.match(/\/api\/tasks\/(\d+)/)[1];
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });
    req.on('end', async () => {
      try {
        const { title, description, completed } = JSON.parse(body);
        
        const result = await db.run(
          'UPDATE tasks SET title = ?, description = ?, completed = ? WHERE id = ?',
          [title, description, completed ? 1 : 0, id]
        );
        
        if (result.changes === 0) {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Task not found');
          return;
        }
        
        const updatedTask = await db.get('SELECT * FROM tasks WHERE id = ?', [id]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(updatedTask));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server error');
      }
    });
    return;
  }

  if (req.method === 'DELETE' && req.url.match(/\/api\/tasks\/(\d+)/)) {
    const id = req.url.match(/\/api\/tasks\/(\d+)/)[1];
    try {
      const result = await db.run('DELETE FROM tasks WHERE id = ?', [id]);
      
      if (result.changes === 0) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Task not found');
        return;
      }
      
      res.writeHead(204, { 'Content-Type': 'text/plain' });
      res.end();
    } catch (error) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error');
    }
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
}

function serveFile(res, filePath, contentType) {
  const fs = require('fs');
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('Server error');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const PORT = 3000;
server.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});