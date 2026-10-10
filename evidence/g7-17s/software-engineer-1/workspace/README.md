# Municipal Service Request Tracker v0.1

A Node.js application for tracking municipal service requests.

## Installation

```bash
npm install
```

## Usage

### CLI Commands

- Create a new request:
  ```bash
  node app.js create <title> <description> [status]
  ```
  Example:
  ```bash
  node app.js create "Street Light Out" "The street light on Main St is out" pending
  ```

- List all requests:
  ```bash
  node app.js list
  ```

- Filter requests by status:
  ```bash
  node app.js filter <status>
  ```
  Example:
  ```bash
  node app.js filter pending
  ```

- Update request status:
  ```bash
  node app.js update <id> <newStatus>
  ```
  Example:
  ```bash
  node app.js update 1234567890 in-progress
  ```

### Valid Status Values

- pending
- in-progress
- resolved
- rejected

## Testing

Run the test suite:

```bash
npm test
```