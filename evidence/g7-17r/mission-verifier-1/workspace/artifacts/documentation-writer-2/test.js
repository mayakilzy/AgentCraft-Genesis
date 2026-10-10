const {
    createRequest,
    listRequests,
    filterByStatus,
    updateStatus
} = require('./app.js');

// Reset data before each test
function resetData() {
    const fs = require('fs');
    fs.writeFileSync('data.json', JSON.stringify([]));
    // Reload data
    const { loadData } = require('./app.js');
    loadData();
}

// Test createRequest
test('createRequest creates a new request with valid data', () => {
    resetData();
    const request = createRequest('Test Request', 'This is a test request', 'pending');
    expect(request).toMatchObject({
        id: expect.any(Number),
        title: 'Test Request',
        description: 'This is a test request',
        status: 'pending',
        createdAt: expect.any(String)
    });
    expect(request.id).toBeGreaterThan(0);
});

test('createRequest throws error for empty title', () => {
    resetData();
    expect(() => createRequest('', 'This is a test request')).toThrow('Title cannot be empty');
});

test('createRequest throws error for invalid status', () => {
    resetData();
    expect(() => createRequest('Test Request', 'This is a test request', 'invalid-status'))
        .toThrow('Invalid status. Valid statuses are: pending, in-progress, resolved, rejected');
});

// Test listRequests
test('listRequests returns all requests', () => {
    resetData();
    createRequest('Request 1', 'Description 1', 'pending');
    createRequest('Request 2', 'Description 2', 'in-progress');
    
    const requests = listRequests();
    expect(requests).toHaveLength(2);
    expect(requests[0].title).toBe('Request 1');
    expect(requests[1].title).toBe('Request 2');
});

// Test filterByStatus
test('filterByStatus filters requests by status', () => {
    resetData();
    createRequest('Request 1', 'Description 1', 'pending');
    createRequest('Request 2', 'Description 2', 'in-progress');
    createRequest('Request 3', 'Description 3', 'pending');
    
    const pendingRequests = filterByStatus('pending');
    expect(pendingRequests).toHaveLength(2);
    expect(pendingRequests[0].title).toBe('Request 1');
    expect(pendingRequests[1].title).toBe('Request 3');
    
    const inProgressRequests = filterByStatus('in-progress');
    expect(inProgressRequests).toHaveLength(1);
    expect(inProgressRequests[0].title).toBe('Request 2');
});

test('filterByStatus throws error for invalid status', () => {
    resetData();
    expect(() => filterByStatus('invalid-status'))
        .toThrow('Invalid status. Valid statuses are: pending, in-progress, resolved, rejected');
});

// Test updateStatus
test('updateStatus updates a request status', () => {
    resetData();
    const request = createRequest('Test Request', 'This is a test request', 'pending');
    const updatedRequest = updateStatus(request.id, 'resolved');
    
    expect(updatedRequest.status).toBe('resolved');
    expect(updatedRequest.updatedAt).toBeDefined();
    
    // Verify the update persisted
    const requests = listRequests();
    expect(requests[0].status).toBe('resolved');
});

test('updateStatus throws error for invalid status', () => {
    resetData();
    const request = createRequest('Test Request', 'This is a test request', 'pending');
    expect(() => updateStatus(request.id, 'invalid-status'))
        .toThrow('Invalid status. Valid statuses are: pending, in-progress, resolved, rejected');
});

test('updateStatus throws error for non-existent ID', () => {
    resetData();
    expect(() => updateStatus(999, 'resolved'))
        .toThrow('Request with ID 999 not found');
});