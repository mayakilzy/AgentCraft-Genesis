import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

// Get __dirname equivalent for ES modules
const __dirname = import.meta.dirname || fileURLToPath(new URL('.', import.meta.url));
const dataDir = join(__dirname, '..', 'data');
const requestsFile = join(dataDir, 'requests.json');

// Initialize data directory if it doesn't exist
if (!existsSync(dataDir)) {
  mkdirSync(dataDir, { recursive: true });
}

// Initialize requests file if it doesn't exist
if (!existsSync(requestsFile)) {
  writeFileSync(requestsFile, '[]');
}

// Known statuses
const STATUSES = ['open', 'in_progress', 'resolved'];

// Valid transitions
const VALID_TRANSITIONS = {
  'open': ['in_progress'],
  'in_progress': ['resolved'],
  'resolved': []
};

// Generate a unique ID
function generateId() {
  return 'req_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
}

// Load requests from file
export function loadRequests() {
  try {
    const data = readFileSync(requestsFile, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading requests:', error.message);
    return [];
  }
}

// Save requests to file
export function saveRequests(requests) {
  try {
    writeFileSync(requestsFile, JSON.stringify(requests, null, 2));
    return true;
  } catch (error) {
    console.error('Error saving requests:', error.message);
    return false;
  }
}

// Create a new request
export function createRequest(title, description) {
  if (!title || title.trim() === '') {
    throw new Error('Title cannot be empty');
  }
  
  const requests = loadRequests();
  const newRequest = {
    id: generateId(),
    title: title.trim(),
    description: description.trim(),
    status: 'open',
    createdAt: new Date().toISOString()
  };
  
  requests.push(newRequest);
  saveRequests(requests);
  
  return newRequest;
}

// List all requests
export function listRequests() {
  return loadRequests();
}

// Update request status
export function updateStatus(id, newStatus) {
  if (!STATUSES.includes(newStatus)) {
    throw new Error(`Unknown status: ${newStatus}`);
  }
  
  const requests = loadRequests();
  const requestIndex = requests.findIndex(req => req.id === id);
  
  if (requestIndex === -1) {
    throw new Error(`Request with id ${id} not found`);
  }
  
  const currentStatus = requests[requestIndex].status;
  
  if (currentStatus === newStatus) {
    throw new Error(`Request is already ${newStatus}`);
  }
  
  if (!VALID_TRANSITIONS[currentStatus].includes(newStatus)) {
    throw new Error(`Cannot transition from ${currentStatus} to ${newStatus}`);
  }
  
  requests[requestIndex].status = newStatus;
  saveRequests(requests);
  
  return requests[requestIndex];
}