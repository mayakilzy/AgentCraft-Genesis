import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

const DATA_DIR = 'data';
const REQUESTS_FILE = join(DATA_DIR, 'requests.json');

// Ensure data directory exists
if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR);
}

// Initialize requests file if it doesn't exist
if (!existsSync(REQUESTS_FILE)) {
  writeFileSync(REQUESTS_FILE, '[]');
}

// Helper function to read requests from file
const readRequests = () => {
  try {
    const data = readFileSync(REQUESTS_FILE, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error reading requests:', error);
    return [];
  }
};

// Helper function to write requests to file
const writeRequests = (requests) => {
  try {
    writeFileSync(REQUESTS_FILE, JSON.stringify(requests, null, 2));
  } catch (error) {
    console.error('Error writing requests:', error);
    throw error;
  }
};

// Valid status transitions
const VALID_TRANSITIONS = {
  'open': ['in_progress'],
  'in_progress': ['resolved'],
  'resolved': []
};

// Create a new request
export const createRequest = (title, description) => {
  if (!title || title.trim() === '') {
    throw new Error('Title cannot be empty');
  }
  
  const requests = readRequests();
  const newRequest = {
    id: Date.now().toString(),
    title: title.trim(),
    description: description.trim(),
    status: 'open',
    createdAt: new Date().toISOString()
  };
  
  requests.push(newRequest);
  writeRequests(requests);
  
  return newRequest;
};

// List all requests
export const listRequests = () => {
  return readRequests();
};

// Update request status
export const updateStatus = (id, newStatus) => {
  const requests = readRequests();
  const requestIndex = requests.findIndex(req => req.id === id);
  
  if (requestIndex === -1) {
    throw new Error(`Request with id ${id} not found`);
  }
  
  const request = requests[requestIndex];
  const currentStatus = request.status;
  
  if (!VALID_TRANSITIONS.hasOwnProperty(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}`);
  }
  
  if (currentStatus === newStatus) {
    throw new Error(`Status is already ${newStatus}`);
  }
  
  if (!VALID_TRANSITIONS[currentStatus].includes(newStatus)) {
    throw new Error(`Cannot transition from ${currentStatus} to ${newStatus}`);
  }
  
  request.status = newStatus;
  writeRequests(requests);
  
  return request;
};