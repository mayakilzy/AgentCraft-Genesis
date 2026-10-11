# Service Request Tracker — Smoke v0.1

## What it does
A minimal Node.js CLI app for tracking service requests with status transitions. It allows creating, listing, and updating service requests while persisting data locally in a JSON file.

## Install
```bash
npm install
```
Note: This is a no-op as the app uses only Node.js standard library with no external dependencies.

## Run tests
```bash
npm test
```

## CLI usage

### Create a new request
```bash
node src/index.js create "<title>" "<description>"
```

Example:
```bash
node src/index.js create "Server down" "The main server is not responding"
```

### List all requests
```bash
node src/index.js list
```

Example:
```bash
node src/index.js list
```

### Update a request status
```bash
node src/index.js update <id> <new-status>
```

Example:
```bash
node src/index.js update 123456789 in_progress
```

## Valid status transitions

| From Status | To Status   | Allowed |
|-------------|-------------|---------|
| open        | in_progress | Yes     |
| in_progress | resolved    | Yes     |
| open        | resolved    | No      |
| resolved    | open        | No      |
| resolved    | in_progress | No      |
| in_progress | open        | No      |
| open        | open        | No      |
| in_progress | in_progress | No      |
| resolved    | resolved    | No      |

Only forward transitions are allowed. You must transition through each status in order (open → in_progress → resolved).