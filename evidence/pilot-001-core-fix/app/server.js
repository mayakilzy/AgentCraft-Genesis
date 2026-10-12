import { readFile } from 'fs/promises';
import { createServer } from 'http';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = join(fileURLToPath(import.meta.url), '..');

const server = createServer(async (req, res) => {
  const filePath = req.url === '/' || req.url === '/index.html' 
    ? join(__dirname, 'index.html') 
    : join(__dirname, req.url);

  try {
    const content = await readFile(filePath);
    
    // Set Content-Type based on file extension
    const ext = filePath.split('.').pop();
    let contentType = 'text/plain';
    
    switch (ext) {
      case 'html':
        contentType = 'text/html';
        break;
      case 'js':
        contentType = 'application/javascript';
        break;
      case 'css':
        contentType = 'text/css';
        break;
      case 'json':
        contentType = 'application/json';
        break;
    }
    
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