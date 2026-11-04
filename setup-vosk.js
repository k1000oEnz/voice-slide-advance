const fs = require('fs');
const path = require('path');
const os = require('os');
const extract = require('extract-zip');

const RUNTIME_URL = 'https://github.com/alphacep/vosk-api/releases/download/v0.3.45/vosk-win64-0.3.45.zip';
const MODEL_URL = 'https://alphacephei.com/vosk/models/vosk-model-small-es-0.42.zip';
const ROOT = __dirname;

async function grab(url, dest) {
  process.stdout.write(`Descargando ${url}\n  → ${dest}\n`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} en ${url}`);
  const total = Number(res.headers.get('content-length')) || 0;
  const file = fs.createWriteStream(dest);
  let done = 0;
  for await (const chunk of res.body) {
    done += chunk.length;
    file.write(chunk);
    if (total) process.stdout.write(`\r  ${(done / 1048576).toFixed(1)} / ${(total / 1048576).toFixed(1)} MB`);
  }
  process.stdout.write('\n');
  await new Promise((r) => file.end(r));
  return dest;
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vosk-'));
  const runtimeZip = path.join(tmp, 'vosk-runtime.zip');
  const modelZip = path.join(tmp, 'vosk-model.zip');

  await grab(RUNTIME_URL, runtimeZip);
  console.log('Extrayendo libvosk.dll en bin/…');
  await extract(runtimeZip, { dir: path.join(ROOT, 'bin') });

  await grab(MODEL_URL, modelZip);
  console.log('Extrayendo el modelo español en models/ (puede tardar)…');
  await extract(modelZip, { dir: path.join(ROOT, 'models') });

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('\nListo. Arranca el servidor con npm start y elige el motor Vosk en la página.');
}

main().catch((err) => {
  console.error(`\nFalló la instalación de Vosk: ${err.message}`);
  process.exit(1);
});
