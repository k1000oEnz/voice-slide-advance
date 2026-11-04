const fs = require('fs');
const path = require('path');
const koffi = require('koffi');

const ROOT = __dirname;
const BIN_DIR = path.join(ROOT, 'bin', 'vosk-win64-0.3.45');
const DLL_PATH = path.join(BIN_DIR, 'libvosk.dll');
const MODELS_DIR = path.join(ROOT, 'models');

function findModel() {
  if (!fs.existsSync(MODELS_DIR)) return null;
  const dir = fs
    .readdirSync(MODELS_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('vosk-model') && e.name.includes('es'))
    .map((e) => path.join(MODELS_DIR, e.name))
    .sort()
    .pop();
  return dir && fs.existsSync(path.join(dir, 'am')) ? dir : null;
}

function available() {
  return fs.existsSync(DLL_PATH) && Boolean(findModel());
}

if (!available()) throw new Error('Faltan binarios de Vosk (bin/libvosk.dll) o el modelo en models/');

process.env.PATH = `${BIN_DIR};${process.env.PATH}`;
const vosk = koffi.load(DLL_PATH);

const modelNew = vosk.func('void *vosk_model_new(const char *model_path)');
const modelFree = vosk.func('void vosk_model_free(void *model)');
const recognizerNew = vosk.func('void *vosk_recognizer_new(void *model, float sample_rate)');
const recognizerFree = vosk.func('void vosk_recognizer_free(void *recognizer)');
const acceptWaveformS = vosk.func('int vosk_recognizer_accept_waveform_s(void *recognizer, const short *data, int length)');
const result = vosk.func('const char *vosk_recognizer_result(void *recognizer)');
const partialResult = vosk.func('const char *vosk_recognizer_partial_result(void *recognizer)');
const finalResult = vosk.func('const char *vosk_recognizer_final_result(void *recognizer)');
const setLogLevel = vosk.func('void vosk_set_log_level(int level)');

const SAMPLE_RATE = 16000;
setLogLevel(-1);
const model = modelNew(findModel());
if (!model) throw new Error('Vosk no pudo cargar el modelo español');

const sessions = new Map();

function session(id) {
  let s = sessions.get(id);
  if (!s) {
    const recognizer = recognizerNew(model, SAMPLE_RATE);
    if (!recognizer) throw new Error('Vosk no pudo crear el recognizer');
    s = { recognizer, last: Date.now() };
    sessions.set(id, s);
  }
  s.last = Date.now();
  return s;
}

function closeSession(id) {
  const s = sessions.get(id);
  if (!s) return;
  sessions.delete(id);
  recognizerFree(s.recognizer);
}

function parse(json) {
  try {
    return JSON.parse(json || '{}');
  } catch {
    return {};
  }
}

/** Alimenta un bloque de PCM 16-bit mono a 16 kHz y devuelve lo reconocido. */
function feed(id, pcm) {
  const s = session(id);
  const samples = new Int16Array(pcm.buffer, pcm.byteOffset, Math.floor(pcm.byteLength / 2));
  const out = { partial: '', text: '' };
  const ended = acceptWaveformS(s.recognizer, samples, samples.length);
  if (ended < 0) throw new Error('Vosk devolvió un error procesando audio');
  if (ended === 1) out.text = parse(result(s.recognizer)).text || '';
  else out.partial = parse(partialResult(s.recognizer)).partial || '';
  return out;
}

/** Corta la escucha de una sesión: fuerza el resultado de lo que quede pendiente. */
function flush(id) {
  const s = sessions.get(id);
  if (!s) return { text: '' };
  const text = parse(finalResult(s.recognizer)).text || '';
  s.last = Date.now();
  return { text };
}

setInterval(() => {
  const now = Date.now();
  for (const [id, s] of sessions) if (now - s.last > 60000) closeSession(id);
}, 10000).unref();

process.once('exit', () => {
  for (const id of [...sessions.keys()]) closeSession(id);
  modelFree(model);
});

module.exports = { feed, flush, closeSession, available, SAMPLE_RATE };
