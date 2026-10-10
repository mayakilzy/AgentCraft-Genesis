const fs = require('fs');
const dataFile = 'data.json';

let requests = [];

// Load data from file on startup
function loadData() {
    try {
        const data = fs.readFileSync(dataFile, 'utf8');
        requests = JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            // File doesn't exist, create a new one
            saveData();
        } else {
            console.error('Error loading data:', error);
        }
    }
}

// Save data to file
function saveData() {
    try {
        fs.writeFileSync(dataFile, JSON.stringify(requests, null, 2));
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
function createRequest(title, description, status = 'pending') {
    if (!title || title.trim() === '') {
        throw new Error('Title cannot be empty');
    }
    
    if (!isValidStatus(status)) {
        throw new Error('Invalid status. Valid statuses are: pending, in-progress, resolved, rejected');
    }
    
    const newRequest = {
        id: Date.now(),
        title: title.trim(),
        description: description.trim(),
        status: status,
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
    if (!isValidStatus(status)) {
        throw new Error('Invalid status. Valid statuses are: pending, in-progress, resolved, rejected');
    }
    
    return requests.filter(request => request.status === status);
}

// Update request status
function updateStatus(id, newStatus) {
    if (!isValidStatus(newStatus)) {
        throw new Error('Invalid status. Valid statuses are: pending, in-progress, resolved, rejected');
    }
    
    const requestIndex = requests.findIndex(request => request.id === id);
    if (requestIndex === -1) {
        throw new Error(`Request with ID ${id} not found`);
    }
    
    requests[requestIndex].status = newStatus;
    requests[requestIndex].updatedAt = new Date().toISOString();
    saveData();
    return requests[requestIndex];
}

// CLI interface
if (require.main === module) {
    const command = process.argv[2];
    
    switch (command) {
        case 'create':
            if (process.argv.length < 5) {
                console.error('Usage: node app.js create <title> <description> [status]');
                process.exit(1);
            }
            const title = process.argv[3];
            const description = process.argv[4];
            const status = process.argv[5] || 'pending';
            
            try {
                const request = createRequest(title, description, status);
                console.log('Request created:', request);
            } catch (error) {
                console.error('Error:', error.message);
            }
            break;
            
        case 'list':
            const allRequests = listRequests();
            console.log('All requests:');
            allRequests.forEach(request => {
                console.log(`ID: ${request.id}, Title: ${request.title}, Status: ${request.status}`);
            });
            break;
            
        case 'filter':
            if (process.argv.length < 4) {
                console.error('Usage: node app.js filter <status>');
                process.exit(1);
            }
            const filterStatus = process.argv[3];
            
            try {
                const filteredRequests = filterByStatus(filterStatus);
                console.log(`Requests with status '${filterStatus}':`);
                filteredRequests.forEach(request => {
                    console.log(`ID: ${request.id}, Title: ${request.title}, Status: ${request.status}`);
                });
            } catch (error) {
                console.error('Error:', error.message);
            }
            break;
            
        case 'update':
            if (process.argv.length < 5) {
                console.error('Usage: node app.js update <id> <newStatus>');
                process.exit(1);
            }
            const id = parseInt(process.argv[3]);
            const newStatus = process.argv[4];
            
            try {
                const updatedRequest = updateStatus(id, newStatus);
                console.log('Request updated:', updatedRequest);
            } catch (error) {
                console.error('Error:', error.message);
            }
            break;
            
        default:
            console.error('Invalid command. Usage: node app.js create|list|filter|update');
            process.exit(1);
    }
}

// Export functions for testing
module.exports = {
    createRequest,
    listRequests,
    filterByStatus,
    updateStatus,
    loadData,
    saveData
};