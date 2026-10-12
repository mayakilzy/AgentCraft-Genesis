# Personal Task Manager

A full-stack personal task manager web application with a responsive UI and REST API.

## Installation and Usage

1. Install dependencies:
   ```bash
   npm install
   ```

2. Start the application:
   ```bash
   npm start
   ```

3. Open your browser and navigate to:
   http://localhost:3000

## Features

- Create tasks with title and description
- Edit existing tasks
- Mark tasks as complete
- Delete tasks
- Filter tasks by status (all, active, completed)
- Persistent data storage using SQLite
- Responsive web UI
- REST API for all CRUD operations

## API Endpoints

- `GET /api/tasks` - Get all tasks (with optional filter query parameter)
- `POST /api/tasks` - Create a new task
- `PUT /api/tasks/:id` - Update a task
- `DELETE /api/tasks/:id` - Delete a task

## Testing

Run the test suite:
```bash
npm test
```