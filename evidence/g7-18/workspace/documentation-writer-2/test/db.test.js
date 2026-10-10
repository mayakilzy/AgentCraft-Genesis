const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert');
const { open } = require('node:sqlite');
const { sqlite3 } = require('node:sqlite');

// Test database file
const testDbFile = path.join(__dirname, 'hub.test.db.db');

// Clean up test database before and after tests
const cleanupDb = () => {
  if (fs.existsSync(testDbFile)) {
    fs.unlinkSync(testDbFile);
  }
};

test.before(() => {
  cleanupDb();
});

test.after(() => {
  cleanupDb();
});

test.describe('Database Tests', () => {
  test.describe('Table Structure', () => {
    test('should create projects table with correct schema', async () => {
      const db = await open({
        filename: testDbFile,
        driver: sqlite3.Database
      });

      const result = await db.prepare(`
        SELECT sql FROM sqlite_master 
        WHERE type='table' AND name='projects'
      `).get();

      assert.ok(result, 'Projects table should exist');
      assert.ok(result.sql.includes('CREATE TABLE'), 'Should be a CREATE TABLE statement');
      assert.ok(result.sql.includes('id INTEGER PRIMARY KEY'), 'Should have id column as primary key');
      assert.ok(result.sql.includes('name TEXT NOT NULL'), 'Should have name column as NOT NULL');
      assert.ok(result.sql.includes('status TEXT NOT NULL DEFAULT'), 'Should have status column with default');
      assert.ok(result.sql.includes('CHECK(status IN'), 'Should have CHECK constraint for status');
      assert.ok(result.sql.includes('created_at TEXT NOT NULL DEFAULT'), 'Should have created_at column with default');

      await db.close();
    });

    test('should create tasks table with correct schema', async () => {
      const db = await open({
        filename: testDbFile,
        driver: sqlite3.Database
      });

      const result = await db.prepare(`
        SELECT sql FROM sqlite_master 
        WHERE type='table' AND name='tasks'
      `).get();

      assert.ok(result, 'Tasks table should exist');
      assert.ok(result.sql.includes('CREATE TABLE'), 'Should be a CREATE TABLE statement');
      assert.ok(result.sql.includes('id INTEGER PRIMARY KEY'), 'Should have id column as primary key');
      assert.ok(result.sql.includes('project_id INTEGER NOT NULL'), 'Should have project_id column as NOT NULL');
      assert.ok(result.sql.includes('REFERENCES projects(id)'), 'Should have foreign key reference to projects');
      assert.ok(result.sql.includes('ON DELETE CASCADE'), 'Should have CASCADE delete rule');
      assert.ok(result.sql.includes('title TEXT NOT NULL'), 'Should have title column as NOT NULL');
      assert.ok(result.sql.includes('status TEXT NOT NULL DEFAULT'), 'Should have status column with default');
      assert.ok(result.sql.includes('CHECK(status IN'), 'Should have CHECK constraint for status');
      assert.ok(result.sql.includes('created_at TEXT NOT NULL DEFAULT'), 'Should have created_at column with default');

      await db.close();
    });
  });

  test.describe('Foreign Key Constraints', () => {
    test('should allow inserting task with valid project_id', async () => {
      const db = await open({
        filename: testDbFile,
        driver: sqlite3.Database
      });

      // Insert a project first
      const projectResult = await db.prepare('INSERT INTO projects (name, description) VALUES (?, ?) RETURNING id')
        .get('Test Project', 'A test project');
      
      const projectId = projectResult.id;
      
      // Insert a task with valid project_id
      const taskResult = await db.prepare('INSERT INTO tasks (project_id, title, description) VALUES (?, ?, ?) RETURNING id')
        .get(projectId, 'Test Task', 'A test task');
      
      assert.ok(taskResult.id, 'Task should be created with valid project_id');
      
      await db.close();
    });

    test('should reject inserting task with non-existent project_id', async () => {
      const db = await open({
        filename: testDbFile,
        driver: sqlite3.Database
      });

      // Try to insert a task with non-existent project_id
      let errorCaught = false;
      
      try {
        await db.prepare('INSERT INTO tasks (project_id, title, description) VALUES (?, ?, ?)')
          .run(99999, 'Test Task', 'A test task');
      } catch (err) {
        errorCaught = true;
        assert.ok(err.message.includes('FOREIGN KEY constraint failed'), 'Should throw foreign key constraint error');
      }
      
      assert.ok(errorCaught, 'Should have thrown an error for invalid project_id');
      
      await db.close();
    });
  });

  test.describe('Cascade Delete', () => {
    test('should delete tasks when project is deleted', async () => {
      const db = await open({
        filename: testDbFile,
        driver: sqlite3.Database
      });

      // Insert a project
      const projectResult = await db.prepare('INSERT INTO projects (name, description) VALUES (?, ?) RETURNING id')
        .get('Test Project for Cascade', 'A test project');
      
      const projectId = projectResult.id;
      
      // Insert a task for that project
      await db.prepare('INSERT INTO tasks (project_id, title, description) VALUES (?, ?, ?)')
        .run(projectId, 'Test Task for Cascade', 'A test task');
      
      // Verify task exists
      const taskBefore = await db.prepare('SELECT COUNT(*) as count FROM tasks WHERE project_id = ?').get(projectId);
      assert.strictEqual(taskBefore.count, 1, 'Task should exist before project deletion');
      
      // Delete the project
      await db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
      
      // Verify task is also deleted
      const taskAfter = await db.prepare('SELECT COUNT(*) as count FROM tasks WHERE project_id = ?').get(projectId);
      assert.strictEqual(taskAfter.count, 0, 'Task should be cascade deleted when project is deleted');
      
      await db.close();
    });
  });

  test.describe('Data Persistence', () => {
    test('should persist data after database is closed and reopened', async () => {
      const db1 = await open({
        filename: testDbFile,
        driver: sqlite3.Database
      });

      // Insert a project
      const projectResult = await db1.prepare('INSERT INTO projects (name, description) VALUES (?, ?) RETURNING id')
        .get('Persistent Project', 'A project that persists');
      
      const projectId = projectResult.id;
      
      // Insert a task
      await db1.prepare('INSERT INTO tasks (project_id, title, description) VALUES (?, ?, ?)')
        .run(projectId, 'Persistent Task', 'A task that persists');
      
      await db1.close();
      
      // Reopen database
      const db2 = await open({
        filename: testDbFile,
        driver: sqlite3.Database
      });
      
      // Verify project still exists
      const project = await db2.prepare('SELECT * FROM projects WHERE id = ?').get(projectId);
      assert.ok(project, 'Project should persist after database is reopened');
      assert.strictEqual(project.name, 'Persistent Project', 'Project name should be preserved');
      
      // Verify task still exists
      const task = await db2.prepare('SELECT * FROM tasks WHERE project_id = ?').get(projectId);
      assert.ok(task, 'Task should persist after database is reopened');
      assert.strictEqual(task.title, 'Persistent Task', 'Task title should be preserved');
      
      await db2.close();
    });
  });
});