# Community Project Hub

A simple project management tool that allows users to create projects and tasks, and track their progress.

## Features

- Create and manage projects
- Create and manage tasks within projects
- Update task status (todo, in-progress, done)
- Filter tasks by status across all projects
- View project-specific tasks

## Installation

1. Clone this repository
2. Install dependencies: `npm install`
3. Start the server: `npm start`
4. Open your browser and navigate to `http://localhost:3000`

## Running Tests

To run the test suite, use:

```bash
npm test
```

The test suite includes:
- Unit tests for the database schema and constraints
- API tests for all endpoints
- Integration tests for the full application lifecycle

## API Endpoints

### Projects

- `GET /api/projects` - Get all projects
- `POST /api/projects` - Create a new project
- `GET /api/projects/:id` - Get a specific project by ID

### Tasks

- `POST /api/projects/:id/tasks` - Create a new task for a project
- `PATCH /api/tasks/:id` - Update a task's status
- `GET /api/tasks?status=<status>` - Get all tasks with a specific status across all projects
- `GET /api/projects/:id/tasks` - Get all tasks for a specific project

## Data Model

### Projects

- `id` - Primary key
- `name` - Project name (required)
- `description` - Project description
- `status` - Project status ('active' or 'archived')
- `created_at` - Creation timestamp

### Tasks

- `id` - Primary key
- `project_id` - Foreign key to projects table
- `title` - Task title (required)
- `description` - Task description
- `status` - Task status ('todo', 'in-progress', or 'done')
- `created_at` - Creation timestamp

## License

MIT
