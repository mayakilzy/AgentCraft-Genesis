#!/usr/bin/env node
import { createRequest, listRequests, updateStatus } from './store.js';
import { stdin as input, stdout as output } from 'node:process';
import { createInterface } from 'node:readline';

const rl = createInterface({ input, output });
const args = process.argv.slice(2);

const command = args[0];

async function runCommand() {
  try {
    switch (command) {
      case 'create': {
        if (args.length < 3) {
          console.error('Error: create command requires title and description');
          process.exit(1);
        }
        
        const title = args[1];
        const description = args.slice(2).join(' ');
        
        if (!title || title.trim() === '') {
          console.error('Error: Title cannot be empty');
          process.exit(1);
        }
        
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
        if (args.length < 3) {
          console.error('Error: update command requires id and new status');
          process.exit(1);
        }
        
        const id = args[1];
        const newStatus = args[2];
        
        await updateStatus(id, newStatus);
        break;
      }
      
      default: {
        console.error(`Error: Unknown command "${command}"`);
        console.error('Available commands: create, list, update');
        process.exit(1);
      }
    }
    
    process.exit(0);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }
}

runCommand();