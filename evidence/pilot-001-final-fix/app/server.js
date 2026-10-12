import { readFile } from 'fs/promises';
import { createServer } from 'http';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = join(fileURLToPath(import.meta.url), '..');

const server = createServer(async (req, res) => {
  // Remove leading slash from URL
  const filePath = req.url === '/' ? 'index.html' : req.url.slice(1);
  const fullPath = join(__dirname, filePath);
  
  try {
    const content = await readFile(fullPath);
    
    // Set Content-Type based on file extension
    const ext = filePath.split('.').pop();
    let contentType = 'application/octet-stream';
    
    if (ext === 'html') contentType = 'text/html';
    else if (ext === 'js') contentType = 'application/javascript';
    else if (ext === 'css') contentType = 'text/css';
    else if (ext === 'json') contentType = 'application/json';
    else if (ext === 'png') contentType = 'image/png';
    else if (ext === 'jpg' || ext === 'jpeg') contentType = 'image/jpeg';
    else if (ext === 'gif') contentType = 'image/gif';
    else if (ext === 'svg') contentType = 'image/svg+xml';
    
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch (error) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

server.listen(3000, () => {
  console.log('Server running at http://localhost:3000/');
});