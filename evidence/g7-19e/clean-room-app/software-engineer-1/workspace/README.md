# Service Request Tracker — Smoke v0.1

## What it does
A minimal Node.js CLI app for tracking service requests with status management and persistence.

## Install
```bash
npm install
```
This is a no-op as there are no dependencies.

## Run tests
```bash
npm test
```

## CLI usage

### Create a service request
```bash
node src/index.js create "<title>" "<description>"
```
Example:
```bash
node src/index.js create "Server down" "The production server is not responding"
```

### List all requests
```bash
node src/index.js list
```

### Update a request status
```bash
node src/index.js update <id> <new-status>
```
Example:
```bash
node src/index.js update 123 in_progress
```

## Valid status transitions
| From | To |
|------|----|
| open | in_progress |
| in_progress | resolved |

All other transitions (including backward transitions and same-status updates) are forbidden.