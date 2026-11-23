import { Type } from 'typebox'
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent'
import {
  kanbanColumn,
  kanbanComment,
  kanbanCreateCard,
  kanbanGetCard,
  kanbanListCards,
  kanbanMove,
  kanbanPickTask,
  kanbanSearch,
  kanbanUpdateCard,
  kanbanWorkflow,
  type KanbanToolEnv,
  type KanbanToolResult
} from './lib/tools'

/** Расширение канбана PiWright: туы канбан-доски для агента. Хранение — lib/ (core/root/store/tools):
 *  доски в `<gitCommonRoot>/.pi/kanban/<boardId>.json`, формат и CAS-протокол — spec/kanban-plan.md §1–§2. */

const BOARD_PARAM = Type.Optional(
  Type.String({ description: 'Board id (b-xxxxxxxx) or board name; the default board when omitted.' })
)

function env(ctx: { cwd: string; sessionManager: { getSessionId(): string; getSessionName(): string | undefined } }): KanbanToolEnv {
  return {
    cwd: ctx.cwd,
    session: { id: ctx.sessionManager.getSessionId(), name: ctx.sessionManager.getSessionName() ?? '' }
  }
}

function run(result: Promise<KanbanToolResult>) {
  return result.then((resolved) => ({
    content: [
      { type: 'text' as const, text: resolved.text },
      ...(resolved.images ?? []).map((image) => ({
        type: 'image' as const,
        data: image.data,
        mimeType: image.mimeType
      }))
    ],
    details: resolved.details
  }))
}

export default function (pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'kanban_pick_task',
    label: 'Kanban: pick task',
    description:
      'Atomically claim the next task from the kanban board: moves the first card of the Todo column (fallback: Backlog) to In Progress and returns it with the board workflow. Call this when the user asks to take or work on a task from the kanban board.',
    promptSnippet: 'kanban_pick_task: atomically claim the next kanban task (Todo → In Progress)',
    promptGuidelines: [
      'When taking a kanban task: call kanban_pick_task first, then rename_session to the task title; when done, kanban_move the card to Review and add two comments (session link + commit hashes, then a completion report).'
    ],
    parameters: Type.Object({ board: BOARD_PARAM }),
    executionMode: 'sequential',
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return run(kanbanPickTask(env(ctx), params))
    }
  })

  pi.registerTool({
    name: 'kanban_list_cards',
    label: 'Kanban: list cards',
    description:
      'List kanban cards: a specific column (by name or id) or all columns, positions first. Compact render: id, column, title.',
    promptSnippet: 'kanban_list_cards: list kanban cards of a column or the whole board',
    parameters: Type.Object({
      board: BOARD_PARAM,
      column: Type.Optional(Type.String({ description: 'Column name or id; all columns when omitted.' })),
      limit: Type.Optional(Type.Number({ description: 'Max cards per column, 1–100 (default 20).' }))
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return run(kanbanListCards(env(ctx), params))
    }
  })

  pi.registerTool({
    name: 'kanban_search',
    label: 'Kanban: search cards',
    description: 'Fuzzy-search kanban cards by title and description; returns the top matches with ids and columns.',
    promptSnippet: 'kanban_search: fuzzy-search kanban cards',
    parameters: Type.Object({
      board: BOARD_PARAM,
      query: Type.String({ description: 'Search query: words or a phrase matched against titles and descriptions.' })
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return run(kanbanSearch(env(ctx), params))
    }
  })

  pi.registerTool({
    name: 'kanban_get_card',
    label: 'Kanban: get card',
    description: 'Return one kanban card in full: description, images, comments with session and commit references.',
    promptSnippet: 'kanban_get_card: full kanban card by id',
    parameters: Type.Object({
      board: BOARD_PARAM,
      id: Type.String({ description: 'Card id (c-xxxxxxxx).' })
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return run(kanbanGetCard(env(ctx), params))
    }
  })

  pi.registerTool({
    name: 'kanban_create_card',
    label: 'Kanban: create card',
    description: 'Create a kanban card (default column: Backlog).',
    promptSnippet: 'kanban_create_card: create a kanban card',
    parameters: Type.Object({
      board: BOARD_PARAM,
      title: Type.String({ description: 'Card title, 1–300 characters.' }),
      description: Type.Optional(Type.String({ description: 'Card description (optional).' })),
      column: Type.Optional(Type.String({ description: 'Column name or id; Backlog when omitted.' }))
    }),
    executionMode: 'sequential',
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return run(kanbanCreateCard(env(ctx), params))
    }
  })

  pi.registerTool({
    name: 'kanban_update_card',
    label: 'Kanban: update card',
    description: 'Update a kanban card title and/or description.',
    promptSnippet: 'kanban_update_card: edit kanban card title/description',
    parameters: Type.Object({
      board: BOARD_PARAM,
      id: Type.String({ description: 'Card id (c-xxxxxxxx).' }),
      title: Type.Optional(Type.String({ description: 'New title; unchanged when omitted.' })),
      description: Type.Optional(Type.String({ description: 'New description; unchanged when omitted.' }))
    }),
    executionMode: 'sequential',
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return run(kanbanUpdateCard(env(ctx), params))
    }
  })

  pi.registerTool({
    name: 'kanban_comment',
    label: 'Kanban: comment card',
    description:
      'Add an agent comment to a kanban card. Optionally link the current session (sessionName), commit refs, and attach image files (copied into the board attachments).',
    promptSnippet: 'kanban_comment: comment on a kanban card',
    promptGuidelines: [
      'When finishing a kanban task, add two comments to the card: one with the session link (sessionName), another with a short completion report. Always pass commit hashes via the commits parameter (hash + optional message), never as plain text in the body — only structured commits render as clickable badges.'
    ],
    parameters: Type.Object({
      board: BOARD_PARAM,
      id: Type.String({ description: 'Card id (c-xxxxxxxx).' }),
      text: Type.String({ description: 'Comment text, 1–10000 characters.' }),
      sessionName: Type.Optional(Type.String({ description: 'Session name to reference; defaults to the current session name.' })),
      commits: Type.Optional(
        Type.Array(
          Type.Object({
            hash: Type.String({ description: 'Commit hash.' }),
            message: Type.Optional(Type.String({ description: 'Commit message (optional).' }))
          }),
          { description: 'Commits related to this comment.' }
        )
      ),
      images: Type.Optional(Type.Array(Type.String(), { description: 'Paths of image files to attach (absolute or relative to the project).' }))
    }),
    executionMode: 'sequential',
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return run(kanbanComment(env(ctx), params))
    }
  })

  pi.registerTool({
    name: 'kanban_move',
    label: 'Kanban: move card',
    description:
      'Move a kanban card to another column (by name or id), optionally adding a comment in the same atomic update. Use this to move a finished task to Review.',
    promptSnippet: 'kanban_move: move a kanban card to another column',
    parameters: Type.Object({
      board: BOARD_PARAM,
      id: Type.String({ description: 'Card id (c-xxxxxxxx).' }),
      column: Type.String({ description: 'Target column name or id.' }),
      comment: Type.Optional(Type.String({ description: 'Optional comment added with the move.' })),
      sessionName: Type.Optional(Type.String({ description: 'Session name to reference in the comment.' })),
      commits: Type.Optional(
        Type.Array(
          Type.Object({
            hash: Type.String({ description: 'Commit hash.' }),
            message: Type.Optional(Type.String({ description: 'Commit message (optional).' }))
          }),
          { description: 'Commits related to the move.' }
        )
      )
    }),
    executionMode: 'sequential',
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return run(kanbanMove(env(ctx), params))
    }
  })

  pi.registerTool({
    name: 'kanban_column',
    label: 'Kanban: column admin',
    description:
      'Manage kanban columns: create, rename, delete (its cards move to Backlog), or move a column to another position. The last column cannot be deleted.',
    promptSnippet: 'kanban_column: create/rename/delete/move a kanban column',
    parameters: Type.Object({
      board: BOARD_PARAM,
      action: Type.Union([
        Type.Literal('create'),
        Type.Literal('rename'),
        Type.Literal('delete'),
        Type.Literal('move')
      ], { description: 'Column operation.' }),
      name: Type.String({ description: 'Column name or id; for create — the name of the new column.' }),
      newName: Type.Optional(Type.String({ description: 'New name (rename action only).' })),
      afterColumn: Type.Optional(Type.String({ description: 'Move action: place the column right after this one (name or id); omitted — move to the end.' }))
    }),
    executionMode: 'sequential',
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return run(kanbanColumn(env(ctx), params))
    }
  })

  pi.registerTool({
    name: 'kanban_workflow',
    label: 'Kanban: workflow',
    description:
      'Read or replace the board workflow (the process text the agent follows when working on kanban tasks). Without text — returns the current workflow; with text — replaces it.',
    promptSnippet: 'kanban_workflow: read or replace the kanban board workflow',
    parameters: Type.Object({
      board: BOARD_PARAM,
      text: Type.Optional(Type.String({ description: 'New workflow text, 1–20000 characters; read-only when omitted.' }))
    }),
    executionMode: 'sequential',
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      return run(kanbanWorkflow(env(ctx), params))
    }
  })
}
