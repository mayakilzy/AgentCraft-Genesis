import { open } from 'node:sqlite';
import { sqlite3 } from 'node:sqlite';

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

export { initializeDatabase, getTasks, createTask, updateTask, deleteTask, getTaskById };