/* Фейковый pi для съёмки README-скриншотов: у каждой копии свой sessionId,
 * промпт с "[ask]" открывает ask-диалог (extension_ui_request), обычный — висит
 * в агентном ходе (busy). Ходов не завершает — статусы держатся для скрина. */
const readline = require('node:readline')
const crypto = require('node:crypto')

const SESSION_ID = 's-shot-' + crypto.randomBytes(2).toString('hex')

const STATE = {
  sessionId: SESSION_ID,
  sessionFile: 'C:\\proj\\.pi\\sessions\\fake.jsonl',
  model: { provider: 'p', id: 'm', name: 'm', contextWindow: 1000, reasoning: true, input: ['text', 'image'] },
  thinkingLevel: 'off',
  autoCompactionEnabled: false,
  sessionName: 'Shot Session'
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n')
}

function respond(id, command, data) {
  send({ type: 'response', id, command, success: true, data: data ?? {} })
}

function userEcho(text) {
  send({ type: 'message_end', message: { role: 'user', content: [{ type: 'text', text }] } })
}

const ASK_PAYLOAD = {
  questions: [
    {
      header: 'Rollout',
      question: 'Where should the WIP limit warning appear?',
      options: [
        {
          label: 'Column header badge (Recommended)',
          description: 'Amber counter next to the column name once the limit is exceeded',
          preview: null,
          recommendedReason: 'Visible without opening the column'
        },
        {
          label: 'Card border highlight',
          description: 'Cards beyond the limit get an amber border in the column',
          preview: null,
          recommendedReason: null
        },
        {
          label: 'Banner above the board',
          description: 'A single banner lists all columns over their limit',
          preview: null,
          recommendedReason: null
        }
      ],
      multiSelect: false
    },
    {
      header: 'Limits',
      question: 'Which default limits should new columns get?',
      options: [
        {
          label: 'No limit (Recommended)',
          description: 'Existing behavior stays; limits are opt-in per column',
          preview: null,
          recommendedReason: 'Least surprise for current boards'
        },
        {
          label: 'Backlog unlimited, others 5',
          description: 'Work columns default to 5 cards in progress',
          preview: null,
          recommendedReason: null
        }
      ],
      multiSelect: false
    }
  ]
}

function emitAskTurn(text) {
  userEcho(text)
  send({ type: 'agent_start' })
  const title = 'pi-wrapper:ask:' + Buffer.from(JSON.stringify(ASK_PAYLOAD)).toString('base64')
  send({ type: 'extension_ui_request', id: 'ui-ask-1', method: 'input', title })
}

function emitBusyTurn(text) {
  userEcho(text)
  send({ type: 'agent_start' })
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
    case 'prompt': {
      const text = typeof frame.message === 'string' ? frame.message : typeof frame.text === 'string' ? frame.text : 'message'
      respond(id, type, { disposition: 'started' })
      setTimeout(() => (text.includes('[ask]') ? emitAskTurn(text) : emitBusyTurn(text)), 400)
      break
    }
    default:
      respond(id, type, {})
  }
})
