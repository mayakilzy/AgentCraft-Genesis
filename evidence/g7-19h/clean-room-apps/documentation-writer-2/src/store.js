import { promises as fs } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
const requestsFile = join(dataDir, 'requests.json');

const VALID_STATUSES = ['open', 'in_progress', 'resolved'];
const ALLOWED_TRANSITIONS = {
  'open': ['in_progress'],
  'in_progress': ['resolved'],
  'resolved': []
};

// Helper function to ensure data directory exists
async function ensureDataDir() {
  try {
    await fs.access(dataDir);
  } catch {
    await fs.mkdir(dataDir, { recursive: true });
  }
}

// Helper function to initialize requests file if it doesn't exist
async function initRequestsFile() {
  try {
    await fs.access(requestsFile);
  } catch {
    await fs.writeFile(requestsFile, JSON.stringify([]));
  }
}

export async function loadRequests() {
  await ensureDataDir();
  await initRequestsFile();
  
  try {
    const data = await fs.readFile(requestsFile, 'utf-8');
    return JSON.parse(data);
  } catch (error) {
    console.error('Error loading requests:', error);
    return [];
  }
}

export async function saveRequests(requests) {
  await ensureDataDir();
  
  try {
    // Write to a temporary file first, then rename for atomicity
    const tempFile = requestsFile + '.tmp';
    await fs.writeFile(tempFile, JSON.stringify(requests, null, 2));
    await fs.rename(tempFile, requestsFile);
  } catch (error) {
    console.error('Error saving requests:', error);
    throw error;
  }
}

export async function createRequest(title, description) {
  if (!title || title.trim() === '') {
    throw new Error('Title cannot be empty');
  }
  
  const requests = await loadRequests();
  const newRequest = {
    id: Date.now().toString(),
    title: title.trim(),
    description: description.trim(),
    status: 'open',
    createdAt: new Date().toISOString()
  };
  
  requests.push(newRequest);
  await saveRequests(requests);
  
  return newRequest;
}

export async function listRequests() {
  return await loadRequests();
}

export async function updateStatus(id, newStatus) {
  if (!VALID_STATUSES.includes(newStatus)) {
    throw new Error(`Invalid status: ${newStatus}`);
  }
  
  const requests = await loadRequests();
  const requestIndex = requests.findIndex(req => req.id === id);
  
  if (requestIndex === -1) {
    throw new Error(`Request with ID ${id} not found`);
  }
  
  const currentStatus = requests[requestIndex].status;
  
  if (currentStatus === newStatus) {
    throw new Error(`Status is already ${newStatus}`);
  }
  
  if (!ALLOWED_TRANSITIONS[currentStatus].includes(newStatus)) {
    throw new Error(`Cannot transition from ${currentStatus} to ${newStatus}`);
  }
  
  requests[requestIndex].status = newStatus;
  await saveRequests(requests);
  
  return requests[requestIndex];
}