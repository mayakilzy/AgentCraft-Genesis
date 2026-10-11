#!/usr/bin/env node

import { createRequest, listRequests, updateStatus } from './store.js';
import { argv } from 'process';

// CLI commands
const commands = {
  create: async (title, description) => {
    try {
      const newRequest = await createRequest(title, description);
      console.log(newRequest.id);
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  },
  
  list: async () => {
    try {
      const requests = await listRequests();
      console.log(JSON.stringify(requests, null, 2));
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(2);
    }
  },
  
  update: async (id, newStatus) => {
    try {
      const updatedRequest = await updateStatus(id, newStatus);
      console.log(JSON.stringify(updatedRequest, null, 2));
    } catch (error) {
      console.error(`Error: ${error.message}`);
      process.exit(1);
    }
  }
};

// Main function
async function main() {
  // Skip first two args (node and script path)
  const [command, ...args] = argv.slice(2);
  
  if (!command) {
    console.error('Error: No command provided');
    console.log('Usage:');
    console.log('  node src/index.js create "<title>" "<description>"');
    console.log('  node src/index.js list');
    console.log('  node src/index.js update <id> <new-status>');
    process.exit(1);
  }
  
  if (!commands[command]) {
    console.error(`Error: Unknown command "${command}"`);
    console.log('Available commands: create, list, update');
    process.exit(1);
  }
  
  // Validate arguments for each command
  switch (command) {
    case 'create':
      if (args.length < 2) {
        console.error('Error: create command requires title and description');
        process.exit(1);
      }
      // Trim whitespace from arguments
      await commands.create(args[0].trim(), args[1].trim());
      break;
      
    case 'list':
      if (args.length > 0) {
        console.error('Error: list command does not take arguments');
        process.exit(1);
      }
      await commands.list();
      break;
      
    case 'update':
      if (args.length < 2) {
        console.error('Error: update command requires id and new-status');
        process.exit(1);
      }
      await commands.update(args[0], args[1]);
      break;
  }
}

main();