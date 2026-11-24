/* Фейковый pi (--mode rpc) для смоуков без реальной модели: отвечает на хендшейк,
 * на prompt выдаёт обычный завершённый ход с текстом "ok". */
const readline = require('node:readline')

const STATE = {
  sessionId: 's-fake-1',
  sessionFile: 'C:\\proj\\.pi\\sessions\\fake.jsonl',
  model: { provider: 'p', id: 'm', name: 'm', contextWindow: 1000, reasoning: true, input: ['text', 'image'] },
  thinkingLevel: 'off',
  autoCompactionEnabled: false,
  sessionName: 'Fake OK Session'
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

function respond(id, command, data) {
  send({ type: 'response', id, command, success: true, data: data ?? {} })
}

function emitOkTurn() {
  send({ type: 'agent_start' })
  send({
    type: 'message_end',
    message: {
      role: 'assistant',
      content: [{ type: 'text', text: 'ok' }],
      stopReason: 'stop'
    }
  })
  send({ type: 'agent_end', messages: [], willRetry: false })
  send({ type: 'agent_settled', aborted: false })
}

const rl = readline.createInterface({ input: process.stdin, terminal: false })
rl.on('line', (line) => {
  let frame
  try {
    frame = JSON.parse(line)
  } catch {
    return
  }
  if (frame === null || typeof frame !== 'object' || typeof frame.type !== 'string') return
  const { id, type } = frame
  if (typeof id !== 'string') return
  switch (type) {
    case 'get_state':
      respond(id, type, STATE)
      break
    case 'get_available_models':
      respond(id, type, { models: [] })
      break
    case 'get_commands':
      respond(id, type, { commands: [] })
      break
    case 'get_available_thinking_levels':
      respond(id, type, { levels: ['off'] })
      break
    case 'get_session_stats':
      respond(id, type, { tokens: { input: 100, output: 20, cacheRead: 900, cacheWrite: 30 } })
      break
    case 'prompt':
      respond(id, type, { disposition: 'started' })
      setTimeout(emitOkTurn, 300)
      break
    default:
      respond(id, type, {})
  }
})
