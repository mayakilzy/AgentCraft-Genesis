import { createServer } from 'http';
import { open, sqlite3 } from 'node:sqlite';
import { sqlite3 as verbose } from 'node:sqlite';
import { Database } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let db;

async function initializeDatabase() {
  db = await open({
    filename: './tasks.db',
    driver: sqlite3.Database
  });

  await db.exec(`
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      description TEXT,
      completed INTEGER DEFAULT 0
    )
  `);
}

async function getTasks(filter = 'all') {
  let query = 'SELECT * FROM tasks';
  if (filter === 'active') {
    query += ' WHERE completed = 0';
  } else if (filter === 'completed') {
    query += ' WHERE completed = 1';
  }
  return db.all(query);
}

async function createTask(title, description) {
  return db.run(
    'INSERT INTO tasks (title, description) VALUES (?, ?)',
    [title, description]
  );
}

async function updateTask(id, title, description, completed) {
  return db.run(
    'UPDATE tasks SET title = ?, description = ?, completed = ? WHERE id = ?',
    [title, description, completed ? 1 : 0, id]
  );
}

async function deleteTask(id) {
  return db.run('DELETE FROM tasks WHERE id = ?', [id]);
}

async function getTaskById(id) {
  return db.get('SELECT * FROM tasks WHERE id = ?', [id]);
}

const server = createServer(async (req, res) => {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // API routes
  if (req.url.startsWith('/api/')) {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', async () => {
      try {
        if (req.url === '/api/tasks' && req.method === 'GET') {
          const filter = new URL(req.url, `http://${req.headers.host}`).searchParams.get('filter') || 'all';
          const tasks = await getTasks(filter);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(tasks));
        } else if (req.url === '/api/tasks' && req.method === 'POST') {
          const { title, description } = JSON.parse(body);
          await createTask(title, description);
          res.writeHead(201, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } else if (req.url.startsWith('/api/tasks/') && req.method === 'PUT') {
          const id = req.url.split('/')[3];
          const { title, description, completed } = JSON.parse(body);
          await updateTask(id, title, description, completed);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } else if (req.url.startsWith('/api/tasks/') && req.method === 'DELETE') {
          const id = req.url.split('/')[3];
          await deleteTask(id);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Endpoint not found' }));
        }
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: error.message }));
      }
    });
    return;
  }

  // Serve static files
  const filePath = req.url === '/' ? 'index.html' : req.url;
  const fullPath = path.join(__dirname, filePath);

  // Check if file exists
  if (fs.existsSync(fullPath)) {
    const ext = path.extname(fullPath);
    let contentType = 'text/html';

    if (ext === '.js') contentType = 'application/javascript';
    else if (ext === '.css') contentType = 'text/css';
    else if (ext === '.json') contentType = 'application/json';
    else if (ext === '.png') contentType = 'image/png';
    else if (ext === '.jpg') contentType = 'image/jpeg';
    else if (ext === '.gif') contentType = 'image/gif';

    fs.readFile(fullPath, (err, content) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain' });
        res.end('Server error');
      } else {
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
      }
    });
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('File not found');
  }
});

const PORT = 3000;

// Initialize database and start server
initializeDatabase().then(() => {
  server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
});