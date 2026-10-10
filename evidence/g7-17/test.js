const fs = require('fs');
const path = require('path');
const {
  createRequest,
  listRequests,
  filterByStatus,
  updateStatus,
  validateInput,
  loadRequests,
  saveRequests
} = require('./app.js');

const TEST_DATA_FILE = path.join(__dirname, 'test-data.json');

// Helper function to reset test data
function resetTestData() {
  // Save empty array to test data file
  saveRequests(TEST_DATA_FILE, []);
  
  // Override the loadRequests function to use test data file
  const originalLoadRequests = loadRequests;
  const originalSaveRequests = saveRequests;
  
  global.loadRequests = () => {
    try {
      const data = fs.readFileSync(TEST_DATA_FILE, 'utf8');
      return JSON.parse(data);
    } catch (error) {
      console.error('Error loading test requests:', error);
      return [];
    }
  };
  
  global.saveRequests = (requests) => {
    try {
      fs.writeFileSync(TEST_DATA_FILE, JSON.stringify(requests, null, 2));
    } catch (error) {
      console.error('Error saving test requests:', error);
    }
  };
  
  // Restore original functions after tests
  return () => {
    global.loadRequests = originalLoadRequests;
    global.saveRequests = originalSaveRequests;
  };
}

// Test suite
function runTests() {
  console.log('Running tests...');
  let passedTests = 0;
  let totalTests = 0;
  
  // Test 1: Input validation
  totalTests++;
  const validation1 = validateInput('Test Title', 'pending');
  if (validation1.valid) {
    passedTests++;
    console.log('✓ Test 1 passed: Valid input accepted');
  } else {
    console.log('✗ Test 1 failed: Valid input rejected');
  }
  
  totalTests++;
  const validation2 = validateInput('', 'pending');
  if (!validation2.valid && validation2.message.includes('Title cannot be empty')) {
    passedTests++;
    console.log('✓ Test 2 passed: Empty title rejected');
  } else {
    console.log('✗ Test 2 failed: Empty title not rejected');
  }
  
  totalTests++;
  const validation3 = validateInput('Test Title', 'invalid-status');
  if (!validation3.valid && validation3.message.includes('Invalid status')) {
    passedTests++;
    console.log('✓ Test 3 passed: Invalid status rejected');
  } else {
    console.log('✗ Test 3 failed: Invalid status not rejected');
  }
  
  // Setup test environment
  const restoreFunctions = resetTestData();
  
  // Test 4: Create request
  totalTests++;
  const createResult1 = createRequest('Test Request 1', 'Description 1', 'pending');
  if (createResult1.success && createResult1.request.id && createResult1.request.title === 'Test Request 1') {
    passedTests++;
    console.log('✓ Test 4 passed: Request created successfully');
  } else {
    console.log('✗ Test 4 failed: Request creation failed');
  }
  
  // Test 5: List requests
  totalTests++;
  const listResult1 = listRequests();
  if (listResult1.length === 1 && listResult1[0].title === 'Test Request 1') {
    passedTests++;
    console.log('✓ Test 5 passed: Requests listed correctly');
  } else {
    console.log('✗ Test 5 failed: Requests not listed correctly');
  }
  
  // Test 6: Filter by status
  totalTests++;
  const filterResult1 = filterByStatus('pending');
  if (filterResult1.length === 1 && filterResult1[0].title === 'Test Request 1') {
    passedTests++;
    console.log('✓ Test 6 passed: Filter by status works');
  } else {
    console.log('✗ Test 6 failed: Filter by status failed');
  }
  
  totalTests++;
  const filterResult2 = filterByStatus('resolved');
  if (filterResult2.length === 0) {
    passedTests++;
    console.log('✓ Test 7 passed: Filter by status works (no results)');
  } else {
    console.log('✗ Test 7 failed: Filter by status failed (should have no results)');
  }
  
  // Test 8: Update status
  totalTests++;
  const updateResult1 = updateStatus(listResult1[0].id, 'in-progress');
  if (updateResult1.success && updateResult1.request.status === 'in-progress') {
    passedTests++;
    console.log('✓ Test 8 passed: Status updated successfully');
  } else {
    console.log('✗ Test 8 failed: Status update failed');
  }
  
  // Test 9: Update non-existent request
  totalTests++;
  const updateResult2 = updateStatus('non-existent-id', 'resolved');
  if (!updateResult2.success && updateResult2.message.includes('Request not found')) {
    passedTests++;
    console.log('✓ Test 9 passed: Update non-existent request fails');
  } else {
    console.log('✗ Test 9 failed: Update non-existent request should fail');
  }
  
  // Test 10: Create multiple requests
  totalTests++;
  const createResult2 = createRequest('Test Request 2', 'Description 2', 'pending');
  const createResult3 = createRequest('Test Request 3', 'Description 3', 'resolved');
  if (createResult2.success && createResult3.success) {
    const allRequests = listRequests();
    if (allRequests.length === 3) {
      passedTests++;
      console.log('✓ Test 10 passed: Multiple requests created');
    } else {
      console.log('✗ Test 10 failed: Multiple requests not created');
    }
  } else {
    console.log('✗ Test 10 failed: Multiple requests creation failed');
  }
  
  // Restore original functions
  restoreFunctions();
  
  // Clean up test data file
  if (fs.existsSync(TEST_DATA_FILE)) {
    fs.unlinkSync(TEST_DATA_FILE);
  }
  
  // Print test results
  console.log(`\nTest Results: ${passedTests}/${totalTests} tests passed`);
  
  if (passedTests === totalTests) {
    console.log('All tests passed!');
    process.exit(0);
  } else {
    console.log('Some tests failed!');
    process.exit(1);
  }
}

// Run tests if this file is executed directly
if (require.main === module) {
  runTests();
}