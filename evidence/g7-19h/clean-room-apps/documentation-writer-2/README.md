# Service Request Tracker

## What it does
A command-line tool for tracking service requests with status transitions. Create new requests, list all requests, and update request statuses with proper validation.

## Install
```bash
npm install
```
No dependencies required.

## Run tests
```bash
npm test
```

## CLI usage

### Create a new request
```bash
node src/index.js create "Request title" "Request description"
```

### List all requests
```bash
node src/index.js list
```

### Update request status
```bash
node src/index.js update <id> <new-status>
```

## Valid status transitions
| From | To |
|------|-----|
| open | in_progress |
| in_progress | resolved |

Note: Backward transitions, same-status updates, and unknown statuses are not allowed.