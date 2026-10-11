#!/usr/bin/env node
import { createRequest, listRequests, updateStatus } from './store.js';
import { argv } from 'process';

const command = argv[2];

try {
  switch (command) {
    case 'create': {
      if (argv.length < 5) {
        console.error('Error: Usage - node src/index.js create "<title>" "<description>"');
        process.exit(1);
      }
      
      const title = argv[3];
      const description = argv[4];
      
      const newRequest = createRequest(title, description);
      console.log(newRequest.id);
      break;
    }
    
    case 'list': {
      if (argv.length !== 3) {
        console.error('Error: Usage - node src/index.js list');
        process.exit(1);
      }
      
      const requests = listRequests();
      console.log(JSON.stringify(requests, null, 2));
      break;
    }
    
    case 'update': {
      if (argv.length !== 5) {
        console.error('Error: Usage - node src/index.js update <id> <new-status>');
        process.exit(1);
      }
      
      const id = argv[3];
      const newStatus = argv[4];
      
      const updatedRequest = updateStatus(id, newStatus);
      console.log(JSON.stringify(updatedRequest, null, 2));
      break;
    }
    
    default: {
      console.error('Error: Unknown command. Use create, list, or update.');
      process.exit(1);
    }
  }
} catch (error) {
  console.error(`Error: ${error.message}`);
  process.exit(1);
}
