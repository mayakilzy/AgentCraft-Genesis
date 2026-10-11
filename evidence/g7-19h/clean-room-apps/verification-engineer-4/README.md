# Service Request Tracker

## What it does
A command-line application for tracking service requests with status transitions. It allows creating, listing, and updating requests while persisting the data to a JSON file.

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
node src/index.js create "Request Title" "Request Description"
```
Example output:
```
req_12345
```

### List all requests
```bash
node src/index.js list
```
Example output:
```json
[
  {"id":"req_12345","title":"Request Title","description":"Request Description","status":"open","createdAt":"2023-05-20T12:34:56.789Z"}
]
```

### Update a request status
```bash
node src/index.js update req_12345 in_progress
```
Example output:
```
Request updated successfully
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
| Any status  | Same status | No      |
| Any status  | Unknown     | No      |