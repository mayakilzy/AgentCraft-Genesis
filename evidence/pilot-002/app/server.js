import { createServer } from 'http';
import { open, sqlite3 } from 'node:sqlite';
import { sqlite3 as sqlite3Driver } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = 3000;
const DB_FILE = join(__dirname, 'tasks.db');

let db;

async function initDB() {
  db = await open({
    filename: DB_FILE,
    driver: sqlite3Driver
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

async function getTasks(req, res) {
  try {
    const { filter = 'all' } = req.query;
    let query = 'SELECT * FROM tasks';
    
    if (filter === 'active') {
      query += ' WHERE completed = 0';
    } else if (filter === 'completed') {
      query += ' WHERE completed = 1';
    }
    
    const tasks = await db.all(query);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(tasks));
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

async function createTask(req, res) {
  try {
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }
    
    const { title, description } = JSON.parse(body);
    const result = await db.run(
      'INSERT INTO tasks (title, description) VALUES (?, ?)',
      [title, description]
    );
    
    const newTask = await db.get('SELECT * FROM tasks WHERE id = ?', [result.lastID]);
    res.writeHead(201, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(newTask));
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

async function updateTask(req, res) {
  try {
    const id = req.url.split('/')[3];
    let body = '';
    for await (const chunk of req) {
      body += chunk;
    }
    
    const { title, description, completed } = JSON.parse(body);
    
    const result = await db.run(
      'UPDATE tasks SET title = ?, description = ?, completed = ? WHERE id = ?',
      [title, description, completed ? 1 : 0, id]
    );
    
    if (result.changes === 0) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found' }));
      return;
    }
    
    const updatedTask = await db.get('SELECT * FROM tasks WHERE id = ?', [id]);
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(updatedTask));
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

async function deleteTask(req, res) {
  try {
    const id = req.url.split('/')[3];
    const result = await db.run('DELETE FROM tasks WHERE id = ?', [id]);
    
    if (result.changes === 0) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Task not found' }));
      return;
    }
    
    res.writeHead(204, { 'Content-Type': 'application/json' });
    res.end();
  } catch (error) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: error.message }));
  }
}

async function serveStaticFile(req, res) {
  const filePath = req.url === '/' ? join(__dirname, 'index.html') : join(__dirname, req.url);
  
  try {
    const fs = await import('fs');
    const data = await fs.promises.readFile(filePath);
    
    const ext = filePath.split('.').pop();
    let contentType = 'text/html';
    
    if (ext === 'css') contentType = 'text/css';
    if (ext === 'js') contentType = 'application/javascript';
    
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'File not found' }));
    } else {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: error.message }));
    }
  }
}

async function handleRequest(req, res) {
  if (req.url.startsWith('/api/tasks')) {
    if (req.method === 'GET') {
      await getTasks(req, res);
    } else if (req.method === 'POST') {
      await createTask(req, res);
    } else if (req.method === 'PUT') {
      await updateTask(req, res);
    } else if (req.method === 'DELETE') {
      await deleteTask(req, res);
    } else {
      res.writeHead(405, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
  } else {
    await serveStaticFile(req, res);
  }
}

const server = createServer(handleRequest);

server.listen(PORT, async () => {
  await initDB();
  console.log(`Server running on http://localhost:${PORT}`);
});
