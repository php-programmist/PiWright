import { spawn } from 'node:child_process';
import { readFileSync, existsSync, rmSync } from 'node:fs';

const TARGET = 'D:/Projects/piwright/.tmp-loop-test.txt';
if (existsSync(TARGET)) rmSync(TARGET);

const proc = spawn('pi', ['--mode', 'rpc'], { shell: true, cwd: 'D:/Projects/piwright' });
let buf = '';
let state = 'boot';
let settledCount = 0;
let startsCount = 0;

proc.stdout.on('data', (d) => {
  buf += d.toString();
  let idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, idx).replace(/\r$/, '');
    buf = buf.slice(idx + 1);
    if (!line.trim()) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.type === 'response' && msg.command === 'get_state' && state === 'boot') {
      state = 'prompting';
      console.log('STATE OK, sending /loop prompt');
      send({ id: 2, type: 'prompt', message: '/loop Дописывай в файл D:/Projects/piwright/.tmp-loop-test.txt строку "iteration N" (N — номер итерации, начиная с 1), затем вызови schedule_loop_wakeup. Когда в файле будет 3 строки — больше не вызывай schedule_loop_wakeup и сообщи, что петля завершена.' });
    }
    if (msg.type === 'agent_start') {
      startsCount++;
      console.log(`--- agent_start #${startsCount}`);
    }
    if (msg.type === 'message_end' && msg.message?.role === 'assistant') {
      const text = (msg.message.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('');
      if (text.trim()) console.log('ASSISTANT:', text.slice(0, 300).replace(/\n/g, ' '));
    }
    if (msg.type === 'tool_execution_start') {
      console.log('TOOL:', msg.args?.toolName || msg.toolName || '?', JSON.stringify(msg.args?.args || {}).slice(0, 200));
    }
    if (msg.type === 'agent_settled') {
      settledCount++;
      console.log(`agent_settled #${settledCount}`);
      if (existsSync(TARGET)) console.log('FILE:', readFileSync(TARGET, 'utf8').trim().replace(/\n/g, ' | '));
      if (settledCount >= 3 || (existsSync(TARGET) && readFileSync(TARGET, 'utf8').split(/\r?\n/).filter(Boolean).length >= 3)) {
        // give the loop a moment in case it armed a next iteration, then check it stopped
        setTimeout(() => {
          console.log(`RESULT: starts=${startsCount} settled=${settledCount}`);
          console.log(existsSync(TARGET) ? 'E2E OK' : 'E2E FAIL: no file');
          proc.kill();
          process.exit(0);
        }, 30000);
      }
    }
  }
});

proc.stderr.on('data', (d) => console.error('STDERR:', d.toString().slice(0, 300)));

function send(obj) {
  proc.stdin.write(JSON.stringify(obj) + '\n');
}

send({ id: 1, type: 'get_state' });
setTimeout(() => {
  console.log(`TIMEOUT: starts=${startsCount} settled=${settledCount}`);
  if (existsSync(TARGET)) console.log('FILE:', readFileSync(TARGET, 'utf8'));
  proc.kill();
  process.exit(1);
}, 600000);
