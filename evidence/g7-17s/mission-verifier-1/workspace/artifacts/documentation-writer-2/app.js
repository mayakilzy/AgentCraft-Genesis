const fs = require('fs');
const path = require('path');
const dataFilePath = path.join(__dirname, 'data.json');

// Valid statuses
const validStatuses = ['pending', 'in-progress', 'resolved', 'rejected'];

// Helper function to read data from JSON file
const readData = () => {
    try {
        const data = fs.readFileSync(dataFilePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        if (error.code === 'ENOENT') {
            return [];
        }
        throw error;
    }
};

// Helper function to write data to JSON file
const writeData = (data) => {
    fs.writeFileSync(dataFilePath, JSON.stringify(data, null, 2));
};

// Create a new service request
const createRequest = (title, description, status = 'pending') => {
    if (!title || !description) {
        throw new Error('Title and description cannot be empty');
    }
    
    if (!validStatuses.includes(status)) {
        throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }
    
    const requests = readData();
    const newRequest = {
        id: Date.now().toString(),
        title,
        description,
        status,
        createdAt: new Date().toISOString()
    };
    
    requests.push(newRequest);
    writeData(requests);
    return newRequest;
};

// List all service requests
const listRequests = () => {
    return readData();
};

// Filter requests by status
const filterByStatus = (status) => {
    if (!validStatuses.includes(status)) {
        throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }
    
    const requests = readData();
    return requests.filter(request => request.status === status);
};

// Update request status
const updateStatus = (id, newStatus) => {
    if (!validStatuses.includes(newStatus)) {
        throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
    }
    
    const requests = readData();
    const requestIndex = requests.findIndex(request => request.id === id);
    
    if (requestIndex === -1) {
        throw new Error(`Request with ID ${id} not found`);
    }
    
    requests[requestIndex].status = newStatus;
    requests[requestIndex].updatedAt = new Date().toISOString();
    writeData(requests);
    return requests[requestIndex];
};

// CLI interface
if (require.main === module) {
    const command = process.argv[2];
    const args = process.argv.slice(3);
    
    try {
        switch (command) {
            case 'create':
                if (args.length < 2) {
                    console.error('Usage: node app.js create "title" "description" [status]');
                    process.exit(1);
                }
                const title = args[0];
                const description = args[1];
                const status = args[2] || 'pending';
                const newRequest = createRequest(title, description, status);
                console.log('Created request:', JSON.stringify(newRequest, null, 2));
                break;
                
            case 'list':
                const requests = listRequests();
                console.log(JSON.stringify(requests, null, 2));
                break;
                
            case 'filter':
                if (args.length < 1) {
                    console.error('Usage: node app.js filter <status>');
                    process.exit(1);
                }
                const filteredRequests = filterByStatus(args[0]);
                console.log(JSON.stringify(filteredRequests, null, 2));
                break;
                
            case 'update':
                if (args.length < 2) {
                    console.error('Usage: node app.js update <id> <newStatus>');
                    process.exit(1);
                }
                const updatedRequest = updateStatus(args[0], args[1]);
                console.log('Updated request:', JSON.stringify(updatedRequest, null, 2));
                break;
                
            default:
                console.error('Invalid command. Use create, list, filter, or update.');
                process.exit(1);
        }
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

// Export functions for use as a module
module.exports = {
    createRequest,
    listRequests,
    filterByStatus,
    updateStatus
};