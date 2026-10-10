const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { createRequest, listRequests, filterByStatus, updateStatus, validateRequest } = require('./app.js');

// Reset data before each test
test.beforeEach(() => {
    // Ensure we start with a clean state
    if (fs.existsSync('data.json')) {
        fs.unlinkSync('data.json');
    }
    // Reload app.js to ensure loadData is called with empty data
    delete require.cache[require.resolve('./app.js')];
    const app = require('./app.js');
    Object.assign(module.exports, app);
});

test.describe('createRequest', () => {
    test('should create a new request with valid data', () => {
        const request = createRequest('Fix pothole', 'Pothole on Main St', 'pending');
        assert.strictEqual(request.title, 'Fix pothole');
        assert.strictEqual(request.description, 'Pothole on Main St');
        assert.strictEqual(request.status, 'pending');
        assert.ok(request.id);
        assert.ok(request.createdAt);
    });
    
    test('should throw error for empty title', () => {
        assert.throws(() => {
            createRequest('', 'Some description', 'pending');
        }, 'Title cannot be empty');
    });
    
    test('should throw error for empty description', () => {
        assert.throws(() => {
            createRequest('Some title', '', 'pending');
        }, 'Description cannot be empty');
    });
    
    test('should throw error for invalid status', () => {
        assert.throws(() => {
            createRequest('Some title', 'Some description', 'invalid-status');
        }, 'Invalid status. Must be one of: pending, in-progress, resolved, rejected');
    });
});

test.describe('listRequests', () => {
    test('should return an empty array when no requests exist', () => {
        const requests = listRequests();
        assert.deepStrictEqual(requests, []);
    });
    
    test('should return all requests', () => {
        createRequest('Fix pothole', 'Pothole on Main St', 'pending');
        createRequest('Fix traffic light', 'Traffic light out at 5th and Main', 'in-progress');
        
        const requests = listRequests();
        assert.strictEqual(requests.length, 2);
    });
});

test.describe('filterByStatus', () => {
    test('should filter requests by status', () => {
        createRequest('Fix pothole', 'Pothole on Main St', 'pending');
        createRequest('Fix traffic light', 'Traffic light out at 5th and Main', 'in-progress');
        createRequest('Fix sidewalk', 'Broken sidewalk on Oak St', 'pending');
        
        const pendingRequests = filterByStatus('pending');
        assert.strictEqual(pendingRequests.length, 2);
        
        const inProgressRequests = filterByStatus('in-progress');
        assert.strictEqual(inProgressRequests.length, 1);
    });
    
    test('should throw error for invalid status', () => {
        assert.throws(() => {
            filterByStatus('invalid-status');
        }, 'Invalid status. Must be one of: pending, in-progress, resolved, rejected');
    });
});

test.describe('updateStatus', () => {
    test('should update a request status', () => {
        const request = createRequest('Fix pothole', 'Pothole on Main St', 'pending');
        const updatedRequest = updateStatus(request.id, 'resolved');
        
        assert.strictEqual(updatedRequest.status, 'resolved');
    });
    
    test('should throw error for non-existent ID', () => {
        assert.throws(() => {
            updateStatus(999, 'resolved');
        }, 'Request with ID 999 not found');
    });
    
    test('should throw error for invalid status', () => {
        const request = createRequest('Fix pothole', 'Pothole on Main St', 'pending');
        assert.throws(() => {
            updateStatus(request.id, 'invalid-status');
        }, 'Invalid status. Must be one of: pending, in-progress, resolved, rejected');
    });
});

test.describe('validateRequest', () => {
    test('should pass validation for valid data', () => {
        assert.doesNotThrow(() => {
            validateRequest('Fix pothole', 'Pothole on Main St', 'pending');
        });
    });
    
    test('should throw error for empty title', () => {
        assert.throws(() => {
            validateRequest('', 'Some description', 'pending');
        }, 'Title cannot be empty');
    });
    
    test('should throw error for empty description', () => {
        assert.throws(() => {
            validateRequest('Some title', '', 'pending');
        }, 'Description cannot be empty');
    });
    
    test('should throw error for invalid status', () => {
        assert.throws(() => {
            validateRequest('Some title', 'Some description', 'invalid-status');
        }, 'Invalid status. Must be one of: pending, in-progress, resolved, rejected');
    });
});