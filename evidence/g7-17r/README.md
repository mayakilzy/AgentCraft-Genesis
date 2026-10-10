# Municipal Service Request Tracker — Prototype v0.1

A small, functional Node.js application for tracking municipal service requests.

## Installation

1. Clone or download this repository.
2. Install dependencies (if any): `npm install`

## Usage

### Command Line Interface

The application provides a command-line interface (CLI) for interacting with service requests:

- Create a new request:
  ```
  node app.js create <title> <description> <status>
  ```
- List all requests:
  ```
  node app.js list
  ```
- Filter requests by status:
  ```
  node app.js filter <status>
  ```
- Update a request's status:
  ```
  node app.js update <id> <newStatus>
  ```

### Valid Status Values

- pending
- in-progress
- resolved
- rejected

## Testing

Run the automated tests:

```
npm test
```

or

```
node --test test.js
```

## Data Persistence

Requests are stored in `data.json` and loaded automatically when the application starts.

## API Functions

The following functions are exported for use in other modules or testing:

- `createRequest(title, description, status)` - Creates a new request
- `listRequests()` - Lists all requests
- `filterByStatus(status)` - Filters requests by status
- `updateStatus(id, newStatus)` - Updates a request's status
- `validateRequest(title, description, status)` - Validates request data

## License

ISC