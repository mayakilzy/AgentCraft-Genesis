const http = require('node:http');
const sqlite3 = require('node:sqlite3').verbose();
const path = require('node:path');
const fs = require('node:fs');
const { URL } = require('node:url');

const dbFile = process.env.DB_FILE || 'hub.db';
const port = process.env.PORT || 3000;

const db = new sqlite3.Database(dbFile);

const initializeDb = () => {
  const projectsTable = `
    CREATE TABLE IF NOT EXISTS projects (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `;

  const tasksTable = `
    CREATE TABLE IF NOT EXISTS tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      description TEXT,
      status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in-progress','done')),
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `;

  db.serialize(() => {
    db.run(projectsTable);
    db.run(tasksTable);
  });
};

const sendJson = (res, statusCode, body) => {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
};

const parseRequestBody = (req) => {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
  });
};

const validateProject = (project) => {
  if (!project.name || typeof project.name !== 'string' || project.name.trim() === '') {
    return { valid: false, error: 'Project name is required' };
  }
  return { valid: true };
};

const validateTask = (task) => {
  if (!task.title || typeof task.title !== 'string' || task.title.trim() === '') {
    return { valid: false, error: 'Task title is required' };
  }
  return { valid: true };
};

const validateTaskStatus = (status) => {
  const validStatuses = ['todo', 'in-progress', 'done'];
  if (!status || !validStatuses.includes(status)) {
    return { valid: false, error: 'Invalid task status' };
  }
  return { valid: true };
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const pathname = url.pathname;
  const method = req.method;

  if (pathname.startsWith('/api')) {
    try {
      if (pathname === '/api/projects' && method === 'GET') {
        db.all('SELECT * FROM projects', (err, rows) => {
          if (err) {
            sendJson(res, 500, { ok: false, error: err.message });
          } else {
            sendJson(res, 200, { ok: true, data: rows });
          }
        });
      } else if (pathname === '/api/projects' && method === 'POST') {
        try {
          const body = await parseRequestBody(req);
          const validation = validateProject(body);
          if (!validation.valid) {
            sendJson(res, 400, { ok: false, error: validation.error });
            return;
          }

          const stmt = db.prepare('INSERT INTO projects (name, description) VALUES (?, ?)');
          stmt.run([body.name, body.description], function(err) {
            if (err) {
              sendJson(res, 500, { ok: false, error: err.message });
            } else {
              db.get('SELECT * FROM projects WHERE id = ?', [this.lastID], (err, row) => {
                if (err) {
                  sendJson(res, 500, { ok: false, error: err.message });
                } else {
                  sendJson(res, 201, { ok: true, data: row });
                }
              });
            }
          });
          stmt.finalize();
        } catch (err) {
          sendJson(res, 400, { ok: false, error: 'Invalid JSON' });
        }
      } else if (pathname.startsWith('/api/projects/') && method === 'GET') {
        const id = pathname.split('/')[2];
        db.get('SELECT * FROM projects WHERE id = ?', [id], (err, row) => {
          if (err) {
            sendJson(res, 500, { ok: false, error: err.message });
          } else if (!row) {
            sendJson(res, 404, { ok: false, error: 'Project not found' });
          } else {
            sendJson(res, 200, { ok: true, data: row });
          }
        });
      } else if (pathname.startsWith('/api/projects/') && pathname.endsWith('/tasks') && method === 'GET') {
        const id = pathname.split('/')[2];
        db.all('SELECT * FROM tasks WHERE project_id = ?', [id], (err, rows) => {
          if (err) {
            sendJson(res, 500, { ok: false, error: err.message });
          } else {
            sendJson(res, 200, { ok: true, data: rows });
          }
        });
      } else if (pathname.startsWith('/api/projects/') && pathname.endsWith('/tasks') && method === 'POST') {
        try {
          const id = pathname.split('/')[2];
          const body = await parseRequestBody(req);
          const validation = validateTask(body);
          if (!validation.valid) {
            sendJson(res, 400, { ok: false, error: validation.error });
            return;
          }

          db.get('SELECT * FROM projects WHERE id = ?', [id], (err, project) => {
            if (err) {
              sendJson(res, 500, { ok: false, error: err.message });
            } else if (!project) {
              sendJson(res, 404, { ok: false, error: 'Project not found' });
            } else {
              const stmt = db.prepare('INSERT INTO tasks (project_id, title, description) VALUES (?, ?, ?)');
              stmt.run([id, body.title, body.description], function(err) {
                if (err) {
                  sendJson(res, 500, { ok: false, error: err.message });
                } else {
                  db.get('SELECT * FROM tasks WHERE id = ?', [this.lastID], (err, row) => {
                    if (err) {
                      sendJson(res, 500, { ok: false, error: err.message });
                    } else {
                      sendJson(res, 201, { ok: true, data: row });
                    }
                  });
                }
              });
              stmt.finalize();
            }
          });
        } catch (err) {
          sendJson(res, 400, { ok: false, error: 'Invalid JSON' });
        }
      } else if (pathname.startsWith('/api/tasks/') && method === 'PATCH') {
        try {
          const id = pathname.split('/')[2];
          const body = await parseRequestBody(req);
          if (!body.status) {
            sendJson(res, 400, { ok: false, error: 'Status is required' });
            return;
          }
          const validation = validateTaskStatus(body.status);
          if (!validation.valid) {
            sendJson(res, 400, { ok: false, error: validation.error });
            return;
          }

          db.get('SELECT * FROM tasks WHERE id = ?', [id], (err, task) => {
            if (err) {
              sendJson(res, 500, { ok: false, error: err.message });
            } else if (!task) {
              sendJson(res, 404, { ok: false, error: 'Task not found' });
            } else {
              const stmt = db.prepare('UPDATE tasks SET status = ? WHERE id = ?');
              stmt.run([body.status, id], function(err) {
                if (err) {
                  sendJson(res, 500, { ok: false, error: err.message });
                } else {
                  db.get('SELECT * FROM tasks WHERE id = ?', [id], (err, row) => {
                    if (err) {
                      sendJson(res, 500, { ok: false, error: err.message });
                    } else {
                      sendJson(res, 200, { ok: true, data: row });
                    }
                  });
                }
              });
              stmt.finalize();
            }
          });
        } catch (err) {
          sendJson(res, 400, { ok: false, error: 'Invalid JSON' });
        }
      } else if (pathname === '/api/tasks' && method === 'GET') {
        const status = url.searchParams.get('status');
        let query = 'SELECT * FROM tasks';
        let params = [];
        if (status && ['todo', 'in-progress', 'done'].includes(status)) {
          query += ' WHERE status = ?';
          params.push(status);
        }
        db.all(query, params, (err, rows) => {
          if (err) {
            sendJson(res, 500, { ok: false, error: err.message });
          } else {
            sendJson(res, 200, { ok: true, data: rows });
          }
        });
      } else {
        sendJson(res, 404, { ok: false, error: 'Not found' });
      }
    } catch (err) {
      sendJson(res, 500, { ok: false, error: 'Internal server error' });
    }
  } else {
    const filePath = path.join(__dirname, 'public', pathname === '/' ? 'index.html' : pathname);
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
      } else {
        const ext = path.extname(filePath);
        const contentType = {
          '.html': 'text/html',
          '.css': 'text/css',
          '.js': 'application/javascript'
        }[ext] || 'application/octet-stream';
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      }
    });
  }
});

initializeDb();

server.listen(port, () => {
  console.log(`Community Project Hub listening on port ${port}`);
});
