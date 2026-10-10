const fs = require('fs');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'data.json');

// Initialize data.json with empty array if it doesn't exist
if (!fs.existsSync(DATA_FILE)) {
  fs.writeFileSync(DATA_FILE, JSON.stringify([]));
}

// Load existing requests from data.json
function loadRequests() {
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading requests:', error);
    return [];
  }
}

// Save requests to data.json
function saveRequests(requests) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(requests, null, 2));
  } catch (error) {
    console.error('Error saving requests:', error);
  }
}

// Validate input
function validateInput(title, status) {
  if (!title || title.trim() === '') {
    return { valid: false, message: 'Title cannot be empty' };
  }
  
  const validStatuses = ['pending', 'in-progress', 'resolved', 'rejected'];
  if (!validStatuses.includes(status)) {
    return { valid: false, message: 'Invalid status. Must be one of: pending, in-progress, resolved, rejected' };
  }
  
  return { valid: true };
}

// Create a new service request
function createRequest(title, description, status) {
  const validation = validateInput(title, status);
  if (!validation.valid) {
    return { success: false, message: validation.message };
  }
  
  const requests = loadRequests();
  const newRequest = {
    id: Date.now().toString(),
    title,
    description,
    status,
    created_at: new Date().toISOString()
  };
  
  requests.push(newRequest);
  saveRequests(requests);
  
  return { success: true, request: newRequest };
}

// List all service requests
function listRequests() {
  return loadRequests();
}

// Filter requests by status
function filterByStatus(status) {
  const requests = loadRequests();
  return requests.filter(request => request.status === status);
}

// Update request status
function updateStatus(id, newStatus) {
  const validation = validateInput('dummy', newStatus);
  if (!validation.valid) {
    return { success: false, message: validation.message };
  }
  
  const requests = loadRequests();
  const requestIndex = requests.findIndex(request => request.id === id);
  
  if (requestIndex === -1) {
    return { success: false, message: 'Request not found' };
  }
  
  requests[requestIndex].status = newStatus;
  saveRequests(requests);
  
  return { success: true, request: requests[requestIndex] };
}

// Command line interface
function main() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log('Municipal Service Request Tracker');
    console.log('Usage:');
    console.log('  node app.js create <title> <description> <status>');
    console.log('  node app.js list');
    console.log('  node app.js filter <status>');
    console.log('  node app.js update <id> <newStatus>');
    return;
  }
  
  const command = args[0];
  
  switch (command) {
    case 'create':
      if (args.length < 4) {
        console.log('Error: Missing arguments for create command');
        console.log('Usage: node app.js create <title> <description> <status>');
        return;
      }
      const createResult = createRequest(args[1], args[2], args[3]);
      if (createResult.success) {
        console.log('Request created:', createResult.request);
      } else {
        console.log('Error:', createResult.message);
      }
      break;
      
    case 'list':
      const requests = listRequests();
      console.log('All requests:', requests);
      break;
      
    case 'filter':
      if (args.length < 2) {
        console.log('Error: Missing status for filter command');
        console.log('Usage: node app.js filter <status>');
        return;
      }
      const filtered = filterByStatus(args[1]);
      console.log(`Requests with status '${args[1]}':`, filtered);
      break;
      
    case 'update':
      if (args.length < 3) {
        console.log('Error: Missing arguments for update command');
        console.log('Usage: node app.js update <id> <newStatus>');
        return;
      }
      const updateResult = updateStatus(args[1], args[2]);
      if (updateResult.success) {
        console.log('Request updated:', updateResult.request);
      } else {
        console.log('Error:', updateResult.message);
      }
      break;
      
    default:
      console.log('Unknown command:', command);
      console.log('Available commands: create, list, filter, update');
  }
}

// Run main function if this file is executed directly
if (require.main === module) {
  main();
}

// Export functions for testing
module.exports = {
  createRequest,
  listRequests,
  filterByStatus,
  updateStatus,
  validateInput,
  loadRequests,
  saveRequests
};