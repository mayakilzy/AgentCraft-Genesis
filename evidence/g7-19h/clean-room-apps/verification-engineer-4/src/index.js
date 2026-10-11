#!/usr/bin/env node

import { createRequest, listRequests, updateStatus } from './store.js';

// Parse command line arguments
const command = process.argv[2];

// Helper function to print error and exit
function errorExit(message) {
  console.error(message);
  process.exit(1);
}

// Helper function to print success and exit
function successExit(message) {
  console.log(message);
  process.exit(0);
}

// Dispatch commands
switch (command) {
  case 'create':
    if (process.argv.length < 5) {
      errorExit('Usage: node src/index.js create "<title>" "<description>"');
    }
    
    const title = process.argv[3];
    const description = process.argv[4];
    
    try {
      const newRequest = createRequest(title, description);
      successExit(newRequest.id);
    } catch (error) {
      errorExit(`Error creating request: ${error.message}`);
    }
    break;
    
  case 'list':
    if (process.argv.length > 3) {
      errorExit('Usage: node src/index.js list');
    }
    
    try {
      const requests = listRequests();
      console.log(JSON.stringify(requests, null, 2));
      process.exit(0);
    } catch (error) {
      errorExit(`Error listing requests: ${error.message}`);
    }
    break;
    
  case 'update':
    if (process.argv.length !== 5) {
      errorExit('Usage: node src/index.js update <id> <new-status>');
    }
    
    const id = process.argv[3];
    const newStatus = process.argv[4];
    
    try {
      const updatedRequest = updateStatus(id, newStatus);
      successExit('Request updated successfully');
    } catch (error) {
      errorExit(`Error updating request: ${error.message}`);
    }
    break;
    
  default:
    errorExit(`Unknown command: ${command}. Available commands: create, list, update`);
}