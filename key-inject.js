const koffi = require('koffi');

koffi.struct('MOUSEINPUT', {
  dx: 'int32_t',
  dy: 'int32_t',
  mouseData: 'uint32_t',
  dwFlags: 'uint32_t',
  time: 'uint32_t',
  dwExtraInfo: 'uintptr_t'
});

koffi.struct('HARDWAREINPUT', {
  uMsg: 'uint32_t',
  wParamL: 'uint16_t',
  wParamH: 'uint16_t'
});

koffi.struct('KEYBDINPUT', {
  wVk: 'uint16_t',
  wScan: 'uint16_t',
  dwFlags: 'uint32_t',
  time: 'uint32_t',
  dwExtraInfo: 'uintptr_t'
});

koffi.union('INPUTUNION', { mi: 'MOUSEINPUT', ki: 'KEYBDINPUT', hi: 'HARDWAREINPUT' });
koffi.struct('INPUT', { type: 'uint32_t', u: 'INPUTUNION' });

const user32 = koffi.load('user32.dll');
const SendInput = user32.func('uint32_t __stdcall SendInput(uint32_t nInputs, INPUT *pInputs, int32_t cbSize)');
const INPUT_SIZE = koffi.sizeof('INPUT');
const KEYUP = 0x0002;

function input(vk, flags) {
  const p = koffi.alloc('INPUT', 1);
  koffi.encode(p, 'INPUT', {
    type: 1,
    u: { ki: { wVk: vk, wScan: 0, dwFlags: flags, time: 0, dwExtraInfo: 0 } }
  });
  return p;
}

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function pressKey(vk, times = 1) {
  if (!Number.isInteger(vk) || vk < 1 || vk > 0xfe) throw new RangeError('invalid virtual key code');
  let sent = 0;
  for (let i = 0; i < times; i++) {
    const down = input(vk, 0);
    const up = input(vk, KEYUP);
    if (SendInput(1, down, INPUT_SIZE) !== 1) break;
    if (SendInput(1, up, INPUT_SIZE) !== 1) break;
    sent++;
    if (times > 1) sleep(25);
  }
  return sent;
}

const VK = {
  next: 0x27,
  prev: 0x25,
  end: 0x23,
  black: 0x42,
  white: 0x57,
  stop: 0x1b
};

function fire(action) {
  const vk = VK[action];
  if (!vk) return { ok: false, error: `unknown action: ${action}` };
  const sent = pressKey(vk);
  return { ok: sent === 1, action, vk, sent };
}

module.exports = { fire, pressKey, VK };
