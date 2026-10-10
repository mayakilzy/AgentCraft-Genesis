const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createRequest, listRequests, filterByStatus, updateStatus } = require('./app.js');

const dataFilePath = path.join(__dirname, 'data.json');

// Helper function to reset data.json
const resetData = () => {
    fs.writeFileSync(dataFilePath, JSON.stringify([]));
};

// Run before each test
test.beforeEach(() => {
    resetData();
});

test.describe('createRequest', () => {
    test('should create a new request with valid data', () => {
        const request = createRequest('Test Request', 'This is a test request', 'pending');
        assert.strictEqual(request.title, 'Test Request');
        assert.strictEqual(request.description, 'This is a test request');
        assert.strictEqual(request.status, 'pending');
        assert.ok(request.id);
        assert.ok(request.createdAt);
    });
    
    test('should throw error for empty title', () => {
        assert.throws(() => createRequest('', 'Description'), Error);
    });
    
    test('should throw error for empty description', () => {
        assert.throws(() => createRequest('Title', ''), Error);
    });
    
    test('should throw error for invalid status', () => {
        assert.throws(() => createRequest('Title', 'Description', 'invalid-status'), Error);
    });
});

test.describe('listRequests', () => {
    test('should return an empty array when no requests exist', () => {
        const requests = listRequests();
        assert.strictEqual(Array.isArray(requests), true);
        assert.strictEqual(requests.length, 0);
    });
    
    test('should return all requests', () => {
        createRequest('Request 1', 'Description 1');
        createRequest('Request 2', 'Description 2', 'in-progress');
        const requests = listRequests();
        assert.strictEqual(requests.length, 2);
        assert.strictEqual(requests[0].title, 'Request 1');
        assert.strictEqual(requests[1].title, 'Request 2');
    });
});

test.describe('filterByStatus', () => {
    test('should filter requests by status', () => {
        createRequest('Request 1', 'Description 1', 'pending');
        createRequest('Request 2', 'Description 2', 'in-progress');
        createRequest('Request 3', 'Description 3', 'pending');
        
        const pendingRequests = filterByStatus('pending');
        assert.strictEqual(pendingRequests.length, 2);
        assert.strictEqual(pendingRequests[0].title, 'Request 1');
        assert.strictEqual(pendingRequests[1].title, 'Request 3');
    });
    
    test('should throw error for invalid status', () => {
        assert.throws(() => filterByStatus('invalid-status'), Error);
    });
});

test.describe('updateStatus', () => {
    test('should update request status', () => {
        const request = createRequest('Test Request', 'This is a test request', 'pending');
        const updatedRequest = updateStatus(request.id, 'in-progress');
        
        assert.strictEqual(updatedRequest.status, 'in-progress');
        assert.ok(updatedRequest.updatedAt);
    });
    
    test('should throw error for non-existent ID', () => {
        assert.throws(() => updateStatus('non-existent-id', 'in-progress'), Error);
    });
    
    test('should throw error for invalid status', () => {
        const request = createRequest('Test Request', 'This is a test request');
        assert.throws(() => updateStatus(request.id, 'invalid-status'), Error);
    });
});