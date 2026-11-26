// One-shot generator for bundled notification sounds (build/sounds/*.wav).
// 16-bit PCM mono 44100 Hz, short sine tones with fade in/out.
const fs = require('node:fs')
const path = require('node:path')

const RATE = 44100

function writeWav(file, samples) {
  const data = Buffer.alloc(samples.length * 2)
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]))
    data.writeInt16LE(Math.round(v * 32767), i * 2)
  }
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVE', 8)
  header.write('fmt ', 12)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(RATE, 24)
  header.writeUInt32LE(RATE * 2, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, Buffer.concat([header, data]))
}

function tone(freq, dur, { gain = 0.5, fade = 0.02 } = {}) {
  const n = Math.round(RATE * dur)
  const out = new Array(n)
  for (let i = 0; i < n; i++) {
    const t = i / RATE
    const env = Math.min(1, i / (RATE * fade), (n - i) / (RATE * fade))
    out[i] = Math.sin(2 * Math.PI * freq * t) * gain * env
  }
  return out
}

function concat(...parts) {
  const out = []
  for (const p of parts) out.push(...p)
  return out
}

const outDir = path.join(__dirname, '..', 'build', 'sounds')
writeWav(path.join(outDir, 'notify-complete.wav'), concat(tone(880, 0.16), tone(1318.5, 0.22)))
writeWav(path.join(outDir, 'notify-await.wav'), tone(660, 0.22, { gain: 0.4 }))
writeWav(path.join(outDir, 'notify-error.wav'), concat(tone(233, 0.16, { gain: 0.55 }), tone(196, 0.2, { gain: 0.55 })))
console.log('written to', outDir)
