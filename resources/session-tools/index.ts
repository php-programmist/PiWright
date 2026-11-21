import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** Инструмент `rename_session`: агент сам называет сессию (pi пишет имя в `session_info` своего JSONL,
 *  PiWright подхватывает его событием `session_info_changed`). Нужен для работы петлёй: много задач
 *  канбана в одной панели различимы, иначе все подписаны первым промптом. */
export const RENAME_SESSION_TOOL_NAME = "rename_session";
export const MAX_SESSION_NAME_LENGTH = 120;

export function normalizeSessionName(raw: string): string {
	return raw.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_SESSION_NAME_LENGTH);
}

export default function (pi: ExtensionAPI): void {
	pi.registerTool({
		name: RENAME_SESSION_TOOL_NAME,
		label: "Rename session",
		description: `Rename the current session so the user can find it later in the session list and history.
Call it once as soon as the work item is known — normally right after taking a task from the kanban board, with that task's title as the name. The name replaces the first-message heuristic everywhere the session is listed, so a loop that works through many tasks stays navigable. Call it again if the scope of the work turns out to be different.`,
		promptSnippet: "rename_session: name the current session (right after taking a task, use the task title)",
		promptGuidelines: [
			"Rename the session as the first action after taking a kanban task, using the task title as the session name.",
		],
		parameters: Type.Object({
			name: Type.String({
				description: `Session display name, typically the kanban task title. Whitespace is collapsed; max ${MAX_SESSION_NAME_LENGTH} characters.`,
			}),
		}),
		async execute(_toolCallId, params) {
			const name = normalizeSessionName(params.name);
			if (name.length === 0) {
				return {
					content: [{ type: "text", text: "Session name is empty — the session keeps its current name." }],
					details: { renamed: false },
				};
			}
			pi.setSessionName(name);
			return {
				content: [{ type: "text", text: `Session renamed to "${name}".` }],
				details: { renamed: true, name },
			};
		},
	});
}
