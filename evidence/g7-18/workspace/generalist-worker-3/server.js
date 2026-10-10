const http = require('node:http');
const sqlite3 = require('node:sqlite3');
const { open } = require('node:sqlite');
const { sqlite3 } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

// Database setup
const DB_FILE = process.env.DB_FILE || 'hub.db';
const PORT = process.env.PORT || 3000;

// Initialize database
const db = new sqlite3.Database(DB_FILE, (err) => {
  if (err) {
    console.error('Error opening database:', err.message);
  } else {
    console.log('Connected to SQLite database');
    initializeDatabase();
  }
});

function initializeDatabase() {
  db.serialize(() => {
    // Create projects table
    db.run(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','archived')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    
    // Create tasks table
    db.run(`
      CREATE TABLE IF NOT EXISTS tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'todo' CHECK(status IN ('todo','in-progress','done')),
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
  });
}

// Helper function to send JSON responses
function sendJsonResponse(res, statusCode, ok, data = null, error = null) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok, data, error }));
}

// Helper function to parse request body
function getRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(body));
      } catch (err) {
        reject(new Error('Invalid JSON'));
      }
    });
  });
}

// API Routes
const server = http.createServer(async (req, res) => {
  // Handle CORS for local development
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // Serve static files
  if (!req.url.startsWith('/api/')) {
    const filePath = req.url === '/' ? './public/index.html' : `./public${req.url}`;
    
    fs.readFile(filePath, (err, data) => {
      if (err) {
        if (err.code === 'ENOENT') {
          sendJsonResponse(res, 404, false, null, 'File not found');
        } else {
          sendJsonResponse(res, 500, false, null, 'Server error');
        }
      } else {
        const ext = path.extname(filePath);
        let contentType = 'text/html';
        
        if (ext === '.css') contentType = 'text/css';
        if (ext === '.js') contentType = 'application/javascript';
        
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(data);
      }
    });
    return;
  }

  // API endpoint handling
  const urlParts = req.url.split('/');
  const endpoint = urlParts[2];
  const id = urlParts[3];
  
  if (req.method === 'GET' && endpoint === 'projects') {
    // Get all projects
    db.all('SELECT * FROM projects ORDER BY created_at DESC', [], (err, rows) => {
      if (err) {
        sendJsonResponse(res, 500, false, null, 'Database error');
      } else {
        sendJsonResponse(res, 200, true, rows);
      }
    });
  } 
  else if (req.method === 'POST' && endpoint === 'projects') {
    // Create a new project
    try {
      const body = await getRequestBody(req);
      
      if (!body.name || body.name.trim() === '') {
        sendJsonResponse(res, 400, false, null, 'Project name is required');
        return;
      }
      
      const stmt = db.prepare('INSERT INTO projects (name, description, status) VALUES (?, ?, ?)');
      stmt.run(body.name, body.description || null, body.status || 'active', function(err) {
        if (err) {
          sendJsonResponse(res, 500, false, null, 'Database error');
        } else {
          db.get('SELECT * FROM projects WHERE id = ?', [this.lastID], (err, row) => {
            if (err) {
              sendJsonResponse(res, 500, false, null, 'Database error');
            } else {
              sendJsonResponse(res, 201, true, row);
            }
          });
        }
      });
      stmt.finalize();
    } catch (err) {
      sendJsonResponse(res, 400, false, null, 'Invalid JSON');
    }
  }
  else if (req.method === 'GET' && endpoint === 'projects' && id) {
    // Get a specific project
    db.get('SELECT * FROM projects WHERE id = ?', [id], (err, row) => {
      if (err) {
        sendJsonResponse(res, 500, false, null, 'Database error');
      } else if (!row) {
        sendJsonResponse(res, 404, false, null, 'Project not found');
      } else {
        sendJsonResponse(res, 200, true, row);
      }
    });
  }
  else if (req.method === 'GET' && endpoint === 'projects' && id && urlParts[4] === 'tasks') {
    // Get tasks for a specific project
    db.all('SELECT * FROM tasks WHERE project_id = ?', [id], (err, rows) => {
      if (err) {
        sendJsonResponse(res, 500, false, null, 'Database error');
      } else {
        sendJsonResponse(res, 200, true, rows);
      }
    });
  }
  else if (req.method === 'POST' && endpoint === 'projects' && id && urlParts[4] === 'tasks') {
    // Create a new task for a project
    try {
      const body = await getRequestBody(req);
      
      // First check if project exists
      db.get('SELECT id FROM projects WHERE id = ?', [id], (err, project) => {
        if (err) {
          sendJsonResponse(res, 500, false, null, 'Database error');
          return;
        }
        
        if (!project) {
          sendJsonResponse(res, 404, false, null, 'Project not found');
          return;
        }
        
        if (!body.title || body.title.trim() === '') {
          sendJsonResponse(res, 400, false, null, 'Task title is required');
          return;
        }
        
        const stmt = db.prepare('INSERT INTO tasks (project_id, title, description, status) VALUES (?, ?, ?, ?)');
        stmt.run(id, body.title, body.description || null, body.status || 'todo', function(err) {
          if (err) {
            sendJsonResponse(res, 500, false, null, 'Database error');
          } else {
            db.get('SELECT * FROM tasks WHERE id = ?', [this.lastID], (err, row) => {
              if (err) {
                sendJsonResponse(res, 500, false, null, 'Database error');
              } else {
                sendJsonResponse(res, 201, true, row);
              }
            });
          }
        });
        stmt.finalize();
      });
    } catch (err) {
      sendJsonResponse(res, 400, false, null, 'Invalid JSON');
    }
  }
  else if (req.method === 'PATCH' && endpoint === 'tasks' && id) {
    // Update task status
    try {
      const body = await getRequestBody(req);
      
      if (!body.status || !['todo', 'in-progress', 'done'].includes(body.status)) {
        sendJsonResponse(res, 400, false, null, 'Invalid status');
        return;
      }
      
      // First check if task exists
      db.get('SELECT id FROM tasks WHERE id = ?', [id], (err, task) => {
        if (err) {
          sendJsonResponse(res, 500, false, null, 'Database error');
          return;
        }
        
        if (!task) {
          sendJsonResponse(res, 404, false, null, 'Task not found');
          return;
        }
        
        const stmt = db.prepare('UPDATE tasks SET status = ? WHERE id = ?');
        stmt.run(body.status, id, function(err) {
          if (err) {
            sendJsonResponse(res, 500, false, null, 'Database error');
          } else {
            db.get('SELECT * FROM tasks WHERE id = ?', [id], (err, row) => {
              if (err) {
                sendJsonResponse(res, 500, false, null, 'Database error');
              } else {
                sendJsonResponse(res, 200, true, row);
              }
            });
          }
        });
        stmt.finalize();
      });
    } catch (err) {
      sendJsonResponse(res, 400, false, null, 'Invalid JSON');
    }
  }
  else if (req.method === 'GET' && endpoint === 'tasks') {
    // Filter tasks by status
    const status = new URL(req.url, `http://${req.headers.host}`).searchParams.get('status');
    
    if (status && !['todo', 'in-progress', 'done'].includes(status)) {
      sendJsonResponse(res, 400, false, null, 'Invalid status');
      return;
    }
    
    const query = status ? 'SELECT * FROM tasks WHERE status = ?' : 'SELECT * FROM tasks';
    const params = status ? [status] : [];
    
    db.all(query, params, (err, rows) => {
      if (err) {
        sendJsonResponse(res, 500, false, null, 'Database error');
      } else {
        sendJsonResponse(res, 200, true, rows);
      }
    });
  }
  else {
    // 404 for unknown endpoints
    sendJsonResponse(res, 404, false, null, 'Endpoint not found');
  }
});

server.listen(PORT, () => {
  console.log(`Community Project Hub listening on port ${PORT}`);
});
