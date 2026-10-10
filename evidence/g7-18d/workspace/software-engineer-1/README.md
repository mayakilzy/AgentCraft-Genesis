# Community Project Hub v0.1

A local full-stack Node.js web application for managing community projects with tasks. Built with Node.js built-ins, SQLite, and vanilla HTML/CSS/JS.

## Prerequisites

- Node.js >= 22 (for node:sqlite)

## Installation

This project has no npm dependencies. Simply clone the repository and run:

```bash
npm install
```

This command will create a package-lock.json file but won't install any external dependencies.

## Startup

Start the application:

```bash
npm start
```

The server will listen on http://localhost:3000 by default. You can specify a different port:

```bash
PORT=3001 npm start
```

## Testing

Run the test suite:

```bash
npm test
```

This will run API tests, database tests, and integration tests.

## API Documentation

| Method | Path | Description | Body | Response |
|--------|------|-------------|------|----------|
| GET | `/api/projects` | List all projects | | `{ok:true, data:[{id,name,description,status,created_at}]}` |
| POST | `/api/projects` | Create a new project | `{name, description?}` | `{ok:true, data:{id,name,description,status,created_at}}` |
| GET | `/api/projects/:id` | Get a project by ID | | `{ok:true, data:{id,name,description,status,created_at}}` |
| GET | `/api/projects/:id/tasks` | List tasks for a project | | `{ok:true, data:[{id,project_id,title,description,status,created_at}]}` |
| POST | `/api/projects/:id/tasks` | Create a new task for a project | `{title, description?}` | `{ok:true, data:{id,project_id,title,description,status,created_at}}` |
| PATCH | `/api/tasks/:id` | Update task status | `{status: 'todo'|'in-progress'|'done'}` | `{ok:true, data:{id,project_id,title,description,status,created_at}}` |
| GET | `/api/tasks?status=` | Filter tasks by status | | `{ok:true, data:[{id,project_id,title,description,status,created_at}]}` |

## Browser Usage

1. Open http://localhost:3000 in your browser
2. Create a new project using the form
3. Click "View" on a project to see its tasks
4. Create tasks for a project
5. Update task status using the dropdown
6. Filter projects by status using the filter buttons

## Project Structure

```
.
├── server.js              # Node.js HTTP server with SQLite database
├── public/
│   ├── index.html         # Main HTML file
│   ├── styles.css         # CSS styles
│   └── app.js             # Frontend JavaScript
├── test/
│   ├── api.test.js        # API endpoint tests
│   ├── db.test.js         # Database schema and constraint tests
│   └── integration.test.js # Full lifecycle tests
├── package.json           # Project metadata and scripts
└── README.md              # This file
```

## Database

The application uses SQLite with the following tables:

- `projects`: id, name, description, status, created_at
- `tasks`: id, project_id (FK), title, description, status, created_at

The database file is created at startup (`hub.db` by default) and persists data across server restarts.

## Error Handling

All API responses follow this format:

- Success: `{ok:true, data:...}` with appropriate HTTP status code (200, 201)
- Error: `{ok:false, error:"..."}` with appropriate HTTP status code (400, 404, 500)

## License

ISC