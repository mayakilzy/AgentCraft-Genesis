#!/usr/bin/env node

import { createRequest, listRequests, updateStatus } from './store.js';
import { stderr } from 'node:process';

function printUsage() {
  stderr.write('Usage:\n');
  stderr.write('  node src/index.js create "<title>" "<description>"\n');
  stderr.write('  node src/index.js list\n');
  stderr.write('  node src/index.js update <id> <new-status>\n');
  stderr.write('\n');
  stderr.write('Valid status values: open, in_progress, resolved\n');
  stderr.write('Valid transitions: open → in_progress, in_progress → resolved\n');
}

function handleError(error) {
  stderr.write(`Error: ${error.message}\n`);
  process.exit(1);
}

function handleInternalError(error) {
  stderr.write(`Internal Error: ${error.message}\n`);
  process.exit(2);
}

async function main() {
  const command = process.argv[2];
  
  try {
    switch (command) {
      case 'create': {
        if (process.argv.length < 5) {
          stderr.write('Error: Missing title or description\n');
          printUsage();
          process.exit(1);
        }
        
        const title = process.argv[3];
        const description = process.argv[4];
        
        const newRequest = await createRequest(title, description);
        console.log(newRequest.id);
        break;
      }
      
      case 'list': {
        const requests = await listRequests();
        console.log(JSON.stringify(requests, null, 2));
        break;
      }
      
      case 'update': {
        if (process.argv.length < 5) {
          stderr.write('Error: Missing id or new status\n');
          printUsage();
          process.exit(1);
        }
        
        const id = process.argv[3];
        const newStatus = process.argv[4];
        
        await updateStatus(id, newStatus);
        break;
      }
      
      default: {
        stderr.write(`Error: Unknown command ${command}\n`);
        printUsage();
        process.exit(1);
      }
    }
  } catch (error) {
    if (error.message.includes('Title cannot be empty') || 
        error.message.includes('Request with id') || 
        error.message.includes('Unknown status:') || 
        error.message.includes('Invalid transition')) {
      handleError(error);
    } else {
      handleInternalError(error);
    }
  }
}

main();