import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
const requestsFile = join(dataDir, 'requests.json');

// Known valid statuses
const VALID_STATUSES = ['open', 'in_progress', 'resolved'];

// Valid status transitions
const VALID_TRANSITIONS = {
  'open': ['in_progress'],
  'in_progress': ['resolved']
};

async function ensureDataDir() {
  try {
    await mkdir(dataDir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }
}

export async function loadRequests() {
  await ensureDataDir();
  try {
    const data = await readFile(requestsFile, 'utf-8');
    return JSON.parse(data);
  } catch (err) {
    if (err.code === 'ENOENT') {
      return [];
    }
    throw err;
  }
}

export async function saveRequests(requests) {
  await ensureDataDir();
  await writeFile(requestsFile, JSON.stringify(requests, null, 2));
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
    throw new Error(`Unknown status: ${newStatus}`);
  }
  
  const requests = await loadRequests();
  const requestIndex = requests.findIndex(req => req.id === id);
  
  if (requestIndex === -1) {
    throw new Error(`Request with id ${id} not found`);
  }
  
  const request = requests[requestIndex];
  const currentStatus = request.status;
  
  if (currentStatus === newStatus) {
    throw new Error(`Request is already in ${newStatus} status`);
  }
  
  if (!VALID_TRANSITIONS[currentStatus]?.includes(newStatus)) {
    throw new Error(`Invalid transition from ${currentStatus} to ${newStatus}`);
  }
  
  requests[requestIndex].status = newStatus;
  await saveRequests(requests);
  
  return requests[requestIndex];
}