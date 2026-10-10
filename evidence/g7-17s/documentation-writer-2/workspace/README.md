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
  node app.js create "title" "description" [status]
  ```
  - `title`: Title of the request (required)
  - `description`: Description of the request (required)
  - `status`: Status of the request (optional, defaults to 'pending')
  
- List all requests:
  ```bash
  node app.js list
  ```
  
- Filter requests by status:
  ```bash
  node app.js filter <status>
  ```
  - `status`: Status to filter by (pending, in-progress, resolved, rejected)
  
- Update request status:
  ```bash
  node app.js update <id> <newStatus>
  ```
  - `id`: ID of the request to update
  - `newStatus`: New status for the request

### Module Usage

```javascript
const { createRequest, listRequests, filterByStatus, updateStatus } = require('./app.js');

// Create a new request
const newRequest = createRequest('Street Light Out', 'The street light on 5th and Main is out', 'pending');

// List all requests
const allRequests = listRequests();

// Filter requests by status
const pendingRequests = filterByStatus('pending');

// Update request status
const updatedRequest = updateStatus(newRequest.id, 'in-progress');
```

## Testing

Run the test suite:

```bash
npm test
```