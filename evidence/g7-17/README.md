# Municipal Service Request Tracker

A simple Node.js application for tracking municipal service requests.

## Installation

1. Clone or download this repository.
2. Install dependencies:
   ```bash
   npm install
   ```

## Usage

The application provides a command-line interface with the following commands:

### Create a new service request

```bash
node app.js create <title> <description> <status>
```

Example:
```bash
node app.js create "Street Light Out" "The street light on Main St is out" pending
```

### List all service requests

```bash
node app.js list
```

### Filter requests by status

```bash
node app.js filter <status>
```

Valid statuses: pending, in-progress, resolved, rejected

Example:
```bash
node app.js filter pending
```

### Update request status

```bash
node app.js update <id> <newStatus>
```

Example:
```bash
node app.js update 123456789 in-progress
```

## Data Persistence

All service requests are stored in a JSON file named `data.json` in the same directory as the application.

## Testing

Run the test suite:

```bash
npm test
```

## Development

This application uses Node.js built-in modules for file system operations and JSON parsing. No external dependencies are required.

## License

ISC