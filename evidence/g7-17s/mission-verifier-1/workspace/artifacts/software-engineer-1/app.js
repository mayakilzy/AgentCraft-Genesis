#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const dataFile = path.join(__dirname, 'data.json');

// Initialize data.json if it doesn't exist
if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, JSON.stringify([]));
}

// Load existing data
function loadData() {
    try {
        const data = fs.readFileSync(dataFile, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error('Error loading data:', error);
        return [];
    }
}

// Save data to file
function saveData(data) {
    try {
        fs.writeFileSync(dataFile, JSON.stringify(data, null, 2));
    } catch (error) {
        console.error('Error saving data:', error);
    }
}

// Validate status
function isValidStatus(status) {
    const validStatuses = ['pending', 'in-progress', 'resolved', 'rejected'];
    return validStatuses.includes(status);
}

// Create a new request
function createRequest(title, desc, status = 'pending') {
    if (!title || title.trim() === '') {
        throw new Error('Title cannot be empty');
    }
    if (!desc || desc.trim() === '') {
        throw new Error('Description cannot be empty');
    }
    if (!isValidStatus(status)) {
        throw new Error('Invalid status');
    }
    
    const requests = loadData();
    const newRequest = {
        id: Date.now().toString(),
        title,
        desc,
        status,
        createdAt: new Date().toISOString()
    };
    
    requests.push(newRequest);
    saveData(requests);
    return newRequest;
}

// List all requests
function listRequests() {
    return loadData();
}

// Filter requests by status
function filterByStatus(status) {
    if (!isValidStatus(status)) {
        throw new Error('Invalid status');
    }
    
    const requests = loadData();
    return requests.filter(request => request.status === status);
}

// Update request status
function updateStatus(id, newStatus) {
    if (!isValidStatus(newStatus)) {
        throw new Error('Invalid status');
    }
    
    const requests = loadData();
    const requestIndex = requests.findIndex(request => request.id === id);
    
    if (requestIndex === -1) {
        throw new Error('Request not found');
    }
    
    requests[requestIndex].status = newStatus;
    requests[requestIndex].updatedAt = new Date().toISOString();
    saveData(requests);
    return requests[requestIndex];
}

// CLI functionality
function main() {
    const args = process.argv.slice(2);
    
    if (args.length < 1) {
        console.log('Usage:');
        console.log('  node app.js create <title> <description> [status]');
        console.log('  node app.js list');
        console.log('  node app.js filter <status>');
        console.log('  node app.js update <id> <newStatus>');
        return;
    }
    
    const command = args[0];
    
    try {
        switch (command) {
            case 'create':
                if (args.length < 3) {
                    console.log('Error: Not enough arguments for create command');
                    console.log('Usage: node app.js create <title> <description> [status]');
                    return;
                }
                const title = args[1];
                const desc = args[2];
                const status = args[3] || 'pending';
                const newRequest = createRequest(title, desc, status);
                console.log('Request created:', JSON.stringify(newRequest, null, 2));
                break;
                
            case 'list':
                const requests = listRequests();
                console.log(JSON.stringify(requests, null, 2));
                break;
                
            case 'filter':
                if (args.length < 2) {
                    console.log('Error: Not enough arguments for filter command');
                    console.log('Usage: node app.js filter <status>');
                    return;
                }
                const filterStatus = args[1];
                const filteredRequests = filterByStatus(filterStatus);
                console.log(JSON.stringify(filteredRequests, null, 2));
                break;
                
            case 'update':
                if (args.length < 3) {
                    console.log('Error: Not enough arguments for update command');
                    console.log('Usage: node app.js update <id> <newStatus>');
                    return;
                }
                const id = args[1];
                const newStatus = args[2];
                const updatedRequest = updateStatus(id, newStatus);
                console.log('Request updated:', JSON.stringify(updatedRequest, null, 2));
                break;
                
            default:
                console.log('Unknown command:', command);
                console.log('Available commands: create, list, filter, update');
        }
    } catch (error) {
        console.error('Error:', error.message);
    }
}

// Export functions for testing
module.exports = {
    createRequest,
    listRequests,
    filterByStatus,
    updateStatus,
    loadData,
    saveData,
    isValidStatus
};

// Run CLI if called directly
if (require.main === module) {
    main();
}