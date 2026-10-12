import { open } from 'node:sqlite';
import { sqlite3 } from 'node:sqlite';

// Open the database file
const db = await open({
  filename: './tasks.db',
  driver: sqlite3.Database
});

// Initialize the database
await db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    completed BOOLEAN NOT NULL DEFAULT 0
  )
`);

// Database operations
export async function createTask(title, description) {
  return db.run(
    'INSERT INTO tasks (title, description) VALUES (?, ?)',
    [title, description]
  );
}

export async function getTasks(filter = 'all') {
  let query = 'SELECT * FROM tasks';
  if (filter === 'active') {
    query += ' WHERE completed = 0';
  } else if (filter === 'completed') {
    query += ' WHERE completed = 1';
  }
  query += ' ORDER BY id DESC';
  return db.all(query);
}

export async function getTaskById(id) {
  return db.get('SELECT * FROM tasks WHERE id = ?', [id]);
}

export async function updateTask(id, title, description, completed) {
  return db.run(
    'UPDATE tasks SET title = ?, description = ?, completed = ? WHERE id = ?',
    [title, description, completed ? 1 : 0, id]
  );
}

export async function deleteTask(id) {
  return db.run('DELETE FROM tasks WHERE id = ?', [id]);
}

// Close the database connection when the app exits
process.on('exit', () => {
  db.close();
});
