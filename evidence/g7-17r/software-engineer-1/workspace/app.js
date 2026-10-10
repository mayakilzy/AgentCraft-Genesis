const fs = require('fs');
const dataFilePath = 'data.json';

let requests = [];

// Load data from file on startup
function loadData() {
    try {
        const data = fs.readFileSync(dataFilePath, 'utf8');
        requests = JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            // File doesn't exist, start with empty array
            requests = [];
        } else {
            console.error('Error loading data:', error);
            process.exit(1);
        }
    }
}

// Save data to file
function saveData() {
    try {
        fs.writeFileSync(dataFilePath, JSON.stringify(requests, null, 2));
    } catch (error) {
        console.error('Error saving data:', error);
        process.exit(1);
    }
}

// Input validation
function validateRequest(title, description, status) {
    if (!title || title.trim() === '') {
        throw new Error('Title cannot be empty');
    }
    if (!description || description.trim() === '') {
        throw new Error('Description cannot be empty');
    }
    const validStatuses = ['pending', 'in-progress', 'resolved', 'rejected'];
    if (!validStatuses.includes(status)) {
        throw new Error('Invalid status. Must be one of: pending, in-progress, resolved, rejected');
    }
}

// Create a new request
function createRequest(title, description, status) {
    validateRequest(title, description, status);
    
    const newRequest = {
        id: Date.now(),
        title,
        description,
        status,
        createdAt: new Date().toISOString()
    };
    
    requests.push(newRequest);
    saveData();
    return newRequest;
}

// List all requests
function listRequests() {
    return requests;
}

// Filter requests by status
function filterByStatus(status) {
    const validStatuses = ['pending', 'in-progress', 'resolved', 'rejected'];
    if (!validStatuses.includes(status)) {
        throw new Error('Invalid status. Must be one of: pending, in-progress, resolved, rejected');
    }
    return requests.filter(request => request.status === status);
}

// Update request status
function updateStatus(id, newStatus) {
    const validStatuses = ['pending', 'in-progress', 'resolved', 'rejected'];
    if (!validStatuses.includes(newStatus)) {
        throw new Error('Invalid status. Must be one of: pending, in-progress, resolved, rejected');
    }
    
    const requestIndex = requests.findIndex(request => request.id === id);
    if (requestIndex === -1) {
        throw new Error(`Request with ID ${id} not found`);
    }
    
    requests[requestIndex].status = newStatus;
    saveData();
    return requests[requestIndex];
}

// CLI interface
function cli() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('Usage:');
        console.log('  node app.js create <title> <description> <status>');
        console.log('  node app.js list');
        console.log('  node app.js filter <status>');
        console.log('  node app.js update <id> <newStatus>');
        return;
    }
    
    const command = args[0];
    
    try {
        switch (command) {
            case 'create':
                if (args.length !== 4) {
                    console.error('Invalid arguments for create. Usage: node app.js create <title> <description> <status>');
                    return;
                }
                const newRequest = createRequest(args[1], args[2], args[3]);
                console.log('Request created:', newRequest);
                break;
                
            case 'list':
                const allRequests = listRequests();
                console.log('All requests:');
                allRequests.forEach(request => {
                    console.log(`ID: ${request.id}, Title: ${request.title}, Status: ${request.status}`);
                });
                break;
                
            case 'filter':
                if (args.length !== 2) {
                    console.error('Invalid arguments for filter. Usage: node app.js filter <status>');
                    return;
                }
                const filteredRequests = filterByStatus(args[1]);
                console.log(`Requests with status '${args[1]}':`);
                filteredRequests.forEach(request => {
                    console.log(`ID: ${request.id}, Title: ${request.title}, Status: ${request.status}`);
                });
                break;
                
            case 'update':
                if (args.length !== 3) {
                    console.error('Invalid arguments for update. Usage: node app.js update <id> <newStatus>');
                    return;
                }
                const updatedRequest = updateStatus(parseInt(args[1]), args[2]);
                console.log('Request updated:', updatedRequest);
                break;
                
            default:
                console.log('Unknown command:', command);
                console.log('Available commands: create, list, filter, update');
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
}

// Load data on startup
loadData();

// If this file is run directly (not imported), execute CLI
if (require.main === module) {
    cli();
}

// Export functions for testing
module.exports = {
    createRequest,
    listRequests,
    filterByStatus,
    updateStatus,
    validateRequest
};