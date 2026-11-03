const http = require('http');
const fs = require('fs');
const path = require('path');
const { fire, VK } = require('./key-inject');

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 8734);
const PUBLIC = path.join(__dirname, 'public');

function readBody(req, limit = 4096) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function json(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*'
  });
  res.end(body);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'POST, GET, OPTIONS',
      'access-control-allow-headers': 'content-type'
    });
    res.end();
    return;
  }

  if (url.pathname === '/health') {
    json(res, 200, { ok: true, actions: Object.keys(VK) });
    return;
  }

  if (url.pathname === '/command') {
    if (req.method !== 'POST') {
      json(res, 405, { ok: false, error: 'POST required' });
      return;
    }
    let action;
    let spoken = '';
    try {
      const parsed = JSON.parse((await readBody(req)) || '{}');
      action = parsed.action;
      spoken = String(parsed.spoken || '').slice(0, 200);
    } catch {
      json(res, 400, { ok: false, error: 'invalid json' });
      return;
    }
    const result = fire(action);
    console.log(
      result.ok
        ? `[${new Date().toLocaleTimeString()}] ${action} <- "${spoken}" (vk 0x${result.vk.toString(16)})`
        : `[${new Date().toLocaleTimeString()}] RECHAZADO ${action}: ${result.error}`
    );
    json(res, result.ok ? 200 : 400, result);
    return;
  }

  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const target = path.join(PUBLIC, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
  if (!target.startsWith(PUBLIC) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  fs.createReadStream(target).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`Escuchando en http://localhost:${PORT}  (abre esa URL en Chrome o Edge)`);
  console.log(`Acciones: ${Object.keys(VK).join(', ')}`);
});
