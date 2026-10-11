# Service Request Tracker

## What it does
A command-line tool for tracking service requests with status transitions. Allows creating, listing, and updating requests with persistence.

## Install
```bash
npm install
```

## Run tests
```bash
npm test
```

## CLI usage

### Create a new request
```bash
node src/index.js create "Request Title" "Request Description"
```

### List all requests
```bash
node src/index.js list
```

### Update a request status
```bash
node src/index.js update <id> <new-status>
```

## Valid status transitions
| From Status | To Status |
|-------------|-----------|
| open | in_progress |
| in_progress | resolved |

- Forward transitions only
- Cannot skip statuses (open → resolved is invalid)
- Cannot transition backwards
- Cannot stay in the same status
- Unknown status values are rejected