import { open } from 'node:sqlite';
import { sqlite3 as sqlite3Driver } from 'node:sqlite';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

export async function createTask(title, description) {
  const result = await db.run(
    'INSERT INTO tasks (title, description) VALUES (?, ?)',
    [title, description]
  );
  return db.get('SELECT * FROM tasks WHERE id = ?', [result.lastID]);
}

export async function getTasks(filter = 'all') {
  let query = 'SELECT * FROM tasks';
  
  if (filter === 'active') {
    query += ' WHERE completed = 0';
  } else if (filter === 'completed') {
    query += ' WHERE completed = 1';
  }
  
  return db.all(query);
}

export async function getTaskById(id) {
  return db.get('SELECT * FROM tasks WHERE id = ?', [id]);
}

export async function updateTask(id, title, description, completed) {
  const result = await db.run(
    'UPDATE tasks SET title = ?, description = ?, completed = ? WHERE id = ?',
    [title, description, completed ? 1 : 0, id]
  );
  
  if (result.changes === 0) {
    throw new Error('Task not found');
  }
  
  return db.get('SELECT * FROM tasks WHERE id = ?', [id]);
}

export async function deleteTask(id) {
  const result = await db.run('DELETE FROM tasks WHERE id = ?', [id]);
  
  if (result.changes === 0) {
    throw new Error('Task not found');
  }
}

// Initialize the database when this module is imported
initDB();
