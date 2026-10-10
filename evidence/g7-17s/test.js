const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const app = require('./app.js');

// Helper function to reset data.json
function resetData() {
    fs.writeFileSync(path.join(__dirname, 'data.json'), JSON.stringify([]));
}

test.describe('Municipal Service Request Tracker', () => {
    test.beforeEach(() => {
        resetData();
    });
    
    test.describe('createRequest', () => {
        test('should create a new request with valid data', () => {
            const request = app.createRequest('Test Title', 'Test Description', 'pending');
            assert.strictEqual(request.title, 'Test Title');
            assert.strictEqual(request.desc, 'Test Description');
            assert.strictEqual(request.status, 'pending');
            assert.ok(request.id);
            assert.ok(request.createdAt);
        });
        
        test('should throw error for empty title', () => {
            assert.throws(() => {
                app.createRequest('', 'Test Description');
            }, Error);
        });
        
        test('should throw error for empty description', () => {
            assert.throws(() => {
                app.createRequest('Test Title', '');
            }, Error);
        });
        
        test('should throw error for invalid status', () => {
            assert.throws(() => {
                app.createRequest('Test Title', 'Test Description', 'invalid-status');
            }, Error);
        });
        
        test('should default status to pending when not provided', () => {
            const request = app.createRequest('Test Title', 'Test Description');
            assert.strictEqual(request.status, 'pending');
        });
    });
    
    test.describe('listRequests', () => {
        test('should return an empty array when no requests exist', () => {
            const requests = app.listRequests();
            assert.strictEqual(Array.isArray(requests), true);
            assert.strictEqual(requests.length, 0);
        });
        
        test('should return all requests', () => {
            app.createRequest('Title 1', 'Description 1', 'pending');
            app.createRequest('Title 2', 'Description 2', 'in-progress');
            const requests = app.listRequests();
            assert.strictEqual(requests.length, 2);
            assert.strictEqual(requests[0].title, 'Title 1');
            assert.strictEqual(requests[1].title, 'Title 2');
        });
    });
    
    test.describe('filterByStatus', () => {
        test('should throw error for invalid status', () => {
            assert.throws(() => {
                app.filterByStatus('invalid-status');
            }, Error);
        });
        
        test('should return empty array when no requests match the status', () => {
            app.createRequest('Title 1', 'Description 1', 'pending');
            const requests = app.filterByStatus('resolved');
            assert.strictEqual(requests.length, 0);
        });
        
        test('should return only requests with matching status', () => {
            app.createRequest('Title 1', 'Description 1', 'pending');
            app.createRequest('Title 2', 'Description 2', 'in-progress');
            app.createRequest('Title 3', 'Description 3', 'pending');
            const requests = app.filterByStatus('pending');
            assert.strictEqual(requests.length, 2);
            assert.strictEqual(requests[0].title, 'Title 1');
            assert.strictEqual(requests[1].title, 'Title 3');
        });
    });
    
    test.describe('updateStatus', () => {
        test('should throw error for invalid status', () => {
            const request = app.createRequest('Test Title', 'Test Description', 'pending');
            assert.throws(() => {
                app.updateStatus(request.id, 'invalid-status');
            }, Error);
        });
        
        test('should throw error for non-existent request', () => {
            assert.throws(() => {
                app.updateStatus('non-existent-id', 'in-progress');
            }, Error);
        });
        
        test('should update request status successfully', () => {
            const request = app.createRequest('Test Title', 'Test Description', 'pending');
            const updatedRequest = app.updateStatus(request.id, 'in-progress');
            assert.strictEqual(updatedRequest.status, 'in-progress');
            assert.ok(updatedRequest.updatedAt);
            
            // Verify the change persisted
            const requests = app.listRequests();
            assert.strictEqual(requests[0].status, 'in-progress');
        });
    });
});