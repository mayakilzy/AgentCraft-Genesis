import { open } from 'node:sqlite';
import { sqlite3 } from 'node:sqlite';

// Create or open the database
const openDb = async () => {
  return await open({
    filename: './tasks.db',
    driver: sqlite3.Database
  });
};

// Create a new task
export const createTask = async (title, description) => {
  const db = await openDb();
  const result = await db.run(
    'INSERT INTO tasks (title, description) VALUES (?, ?)',
    [title, description]
  );
  return await db.get('SELECT * FROM tasks WHERE id = ?', [result.lastID]);
};

// Get all tasks
export const getTasks = async () => {
  const db = await openDb();
  return await db.all('SELECT * FROM tasks');
};

// Get a task by ID
export const getTaskById = async (id) => {
  const db = await openDb();
  return await db.get('SELECT * FROM tasks WHERE id = ?', [id]);
};

// Update a task
export const updateTask = async (id, title, description, completed) => {
  const db = await openDb();
  const result = await db.run(
    'UPDATE tasks SET title = ?, description = ?, completed = ? WHERE id = ?',
    [title, description, completed ? 1 : 0, id]
  );
  
  if (result.changes === 0) {
    return null;
  }
  
  return await db.get('SELECT * FROM tasks WHERE id = ?', [id]);
};

// Delete a task
export const deleteTask = async (id) => {
  const db = await openDb();
  const result = await db.run('DELETE FROM tasks WHERE id = ?', [id]);
  return result.changes > 0;
};