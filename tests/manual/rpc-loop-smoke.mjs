import { spawn } from 'node:child_process';

const proc = spawn('pi', ['--mode', 'rpc'], { shell: true, cwd: 'D:/Projects/piwright' });
let buf = '';
const seen = [];
let promptId = 2;

proc.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).replace(/\r$/, '');
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.type === 'response' && msg.command === 'prompt') {
      console.log('PROMPT RESPONSE:', JSON.stringify(msg).slice(0, 300));
      if (msg.data?.disposition === 'handled') {
        console.log('SMOKE OK (command handled)');
        proc.kill();
        process.exit(0);
      }
    }
    if (msg.type === 'response' && msg.command === 'get_state') {
      console.log('STATE OK, sending /loop list');
      send({ id: promptId, type: 'prompt', message: '/loop list' });
    }
    if (msg.type && msg.type !== 'response' && msg.type !== 'message_update' && msg.type !== 'message_start') {
      console.log('EVENT:', msg.type, JSON.stringify(msg).slice(0, 400));
    }
    if (msg.type === 'agent_start') seen.push('agent_start');
    if (msg.type === 'message_end' && msg.message?.role === 'assistant') {
      const text = (msg.message.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
      if (text.trim()) console.log('ASSISTANT:', text.slice(0, 500));
    }
    if (msg.type === 'agent_settled') {
      console.log('AGENT_SETTLED, events:', seen.join(','));
      console.log('SMOKE OK');
      proc.kill();
      process.exit(0);
    }
  }
});

proc.stderr.on('data', (d) => console.error('STDERR:', d.toString().slice(0, 500)));

function send(obj) {
  proc.stdin.write(JSON.stringify(obj) + '\n');
}

send({ id: 1, type: 'get_state' });
setTimeout(() => {
  console.log('TIMEOUT, events seen:', seen.join(','));
  proc.kill();
  process.exit(1);
}, 180000);
