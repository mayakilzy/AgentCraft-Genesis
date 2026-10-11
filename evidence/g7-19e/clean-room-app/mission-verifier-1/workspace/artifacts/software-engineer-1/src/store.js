import { promises as fs } from 'fs';
import { join } from 'path';

const DATA_DIR = 'data';
const REQUESTS_FILE = join(DATA_DIR, 'requests.json');

// Initialize data directory and file if they don't exist
async function initializeDataStore() {
  try {
    await fs.access(DATA_DIR);
  } catch {
    await fs.mkdir(DATA_DIR, { recursive: true });
  }
  
  try {
    await fs.access(REQUESTS_FILE);
  } catch {
    await fs.writeFile(REQUESTS_FILE, '[]');
  }
}

// Load requests from file
export async function loadRequests() {
  await initializeDataStore();
  try {
    const data = await fs.readFile(REQUESTS_FILE, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error(`Error reading requests file: ${error.message}`);
    return [];
  }
}

// Save requests to file
export async function saveRequests(requests) {
  await initializeDataStore();
  try {
    await fs.writeFile(REQUESTS_FILE, JSON.stringify(requests, null, 2));
  } catch (error) {
    console.error(`Error saving requests file: ${error.message}`);
    throw error;
  }
}

// Generate a unique ID
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

// Create a new request
export async function createRequest(title, description) {
  if (!title || title.trim() === '') {
    throw new Error('Title cannot be empty');
  }
  
  const requests = await loadRequests();
  const newRequest = {
    id: generateId(),
    title: title.trim(),
    description: description.trim(),
    status: 'open',
    createdAt: new Date().toISOString(),
  };
  
  requests.push(newRequest);
  await saveRequests(requests);
  return newRequest;
}

// List all requests
export async function listRequests() {
  return await loadRequests();
}

// Update request status
export async function updateStatus(id, newStatus) {
  const requests = await loadRequests();
  const requestIndex = requests.findIndex(req => req.id === id);
  
  if (requestIndex === -1) {
    throw new Error(`Request with id ${id} not found`);
  }
  
  const request = requests[requestIndex];
  const currentStatus = request.status;
  
  // Validate new status
  const validStatuses = ['open', 'in_progress', 'resolved'];
  if (!validStatuses.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}`);
  }
  
  // Validate transition
  if (currentStatus === newStatus) {
    throw new Error(`Status is already ${newStatus}`);
  }
  
  if (currentStatus === 'open' && newStatus === 'resolved') {
    throw new Error('Cannot transition directly from open to resolved');
  }
  
  if (currentStatus === 'resolved' && newStatus !== 'resolved') {
    throw new Error('Cannot transition from resolved to any other status');
  }
  
  if (currentStatus === 'in_progress' && newStatus === 'open') {
    throw new Error('Cannot transition from in_progress to open');
  }
  
  // Update the status
  requests[requestIndex].status = newStatus;
  await saveRequests(requests);
  return requests[requestIndex];
}