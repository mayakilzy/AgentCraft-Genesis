# Municipal Service Request Tracker - Prototype v0.1

A simple Node.js application for tracking municipal service requests.

## Installation

1. Clone this repository
2. Install dependencies (if any)
3. Run the application using Node.js

## Usage

The application provides a command-line interface (CLI) with the following commands:

### Create a new request

```bash
node app.js create "Title" "Description" [status]
```

- `Title`: The title of the service request (required)
- `Description`: The description of the service request (required)
- `status`: Optional status (default: 'pending')
  - Valid statuses: pending, in-progress, resolved, rejected

### List all requests

```bash
node app.js list
```

### Filter requests by status

```bash
node app.js filter <status>
```

- `<status>`: The status to filter by
  - Valid statuses: pending, in-progress, resolved, rejected

### Update a request's status

```bash
node app.js update <id> <newStatus>
```

- `<id>`: The ID of the request to update
- `<newStatus>`: The new status for the request
  - Valid statuses: pending, in-progress, resolved, rejected

## Testing

Run the automated tests:

```bash
npm test
```

Or directly:

```bash
node --test test.js
```

## Data Persistence

Requests are stored in `data.json` in the same directory as the application. The file is automatically created if it doesn't exist.

## Contributing

This is a prototype application. Feel free to extend it as needed.

## License

ISC