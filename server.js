const http = require('http');
const fs = require('fs');
const path = require('path');
const { fire, VK } = require('./key-inject');

let vosk = null;
try {
  vosk = require('./vosk-engine');
} catch (err) {
  console.warn(`Vosk no disponible: ${err.message}`);
  console.warn('Usa el motor Google (Chrome/Edge) o descarga bin/ y models/ para el modo offline.');
}

const HOST = '127.0.0.1';
const PORT = Number(process.env.PORT || 8734);
const PUBLIC = path.join(__dirname, 'public');
const MAX_AUDIO = 1024 * 1024;
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function readBody(req, limit) {
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
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function json(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*'
  });
  res.end(JSON.stringify(data));
}

/** Float32 mono a la tasa del navegador -> Int16 mono a 16 kHz para Vosk. */
function toVoskPcm(floatBuffer, fromRate) {
  const src = new Float32Array(floatBuffer.buffer, floatBuffer.byteOffset, Math.floor(floatBuffer.byteLength / 4));
  const toRate = 16000;
  const outN = Math.floor((src.length * toRate) / fromRate);
  const out = new Int16Array(outN + 1);
  const step = fromRate / toRate;
  for (let i = 0; i < outN; i++) {
    const pos = i * step;
    const a = Math.floor(pos);
    const b = Math.min(a + 1, src.length - 1);
    const t = pos - a;
    const v = (src[a] * (1 - t) + src[b] * t) * 32767;
    out[i] = v < -32768 ? -32768 : v > 32767 ? 32767 : v;
  }
  return Buffer.from(out.buffer, 0, outN * 2);
}

async function handleAsr(req, res, url) {
  if (!vosk) {
    json(res, 503, { ok: false, error: 'Vosk no está instalado en este servidor' });
    return;
  }
  const sid = String(url.searchParams.get('sid') || '').slice(0, 64);
  const rate = Number(url.searchParams.get('rate')) || 48000;
  if (!sid) {
    json(res, 400, { ok: false, error: 'falta sid' });
    return;
  }
  let body;
  try {
    body = await readBody(req, MAX_AUDIO);
  } catch {
    json(res, 413, { ok: false, error: 'audio demasiado grande' });
    return;
  }
  try {
    if (url.searchParams.get('flush') === '1') {
      const out = vosk.flush(sid);
      vosk.closeSession(sid);
      json(res, 200, { ok: true, ...out });
      return;
    }
    const pcm = rate === 16000 ? body : toVoskPcm(body, rate);
    json(res, 200, { ok: true, ...vosk.feed(sid, pcm) });
  } catch (err) {
    json(res, 500, { ok: false, error: err.message });
  }
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
    json(res, 200, { ok: true, actions: Object.keys(VK), vosk: Boolean(vosk) });
    return;
  }

  if (req.method !== 'POST') {
    const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
    const target = path.join(PUBLIC, path.normalize(file).replace(/^(\.\.[/\\])+/, ''));
    if (!target.startsWith(PUBLIC) || !fs.existsSync(target) || !fs.statSync(target).isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('not found');
      return;
    }
    const type = MIME[path.extname(target).toLowerCase()] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': `${type}; charset=utf-8`, 'cache-control': 'no-store' });
    fs.createReadStream(target).pipe(res);
    return;
  }

  if (url.pathname === '/asr') {
    handleAsr(req, res, url).catch((err) => json(res, 500, { ok: false, error: err.message }));
    return;
  }

  if (url.pathname === '/command') {
    let action;
    let spoken = '';
    try {
      const parsed = JSON.parse((await readBody(req, 4096)).toString('utf8') || '{}');
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

  json(res, 404, { ok: false, error: 'not found' });
});

server.listen(PORT, HOST, () => {
  console.log(`Abre http://localhost:${PORT} en Chrome, Edge o Firefox`);
  console.log(`Motor offline (Vosk): ${vosk ? 'activo' : 'no disponible'} | acciones: ${Object.keys(VK).join(', ')}`);
});
