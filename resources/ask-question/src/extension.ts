import type { ExtensionAPI, ExtensionFactory } from "@earendil-works/pi-coding-agent";
import {
	ASK_UNAVAILABLE_TEXT,
	ASK_USER_QUESTION_TOOL_NAME,
	type AskUserQuestionArgs,
	type AskUserQuestionAsker,
	executableAskCallIds,
	isolateAskUserQuestionBatch,
	MAX_OPTIONS,
	MIN_OPTIONS,
	outcomeResult,
	textResult,
	validateQuestionnaire,
} from "./core.ts";
import { askWithDialogs } from "./dialogs.ts";
import { AskUserQuestionSchema } from "./schema.ts";
import { askInTerminal, renderAskCall, renderAskResult } from "./tui.ts";
import { askWithPlugin } from "./rpc.ts";

export interface AskUserQuestionGuidance {
	description?: string;
	promptSnippet?: string;
	promptGuidelines?: readonly string[];
}

export interface AskUserQuestionExtensionOptions {
	ask?: AskUserQuestionAsker;
	announce?: (toolCallId: string) => void;
	guidance?: AskUserQuestionGuidance;
}

export const DEFAULT_DESCRIPTION = `Ask the user one or more structured, multiple-choice questions during execution, instead of guessing. Use when:
1. The request is underspecified and you cannot proceed without a concrete decision.
2. You need a user preference, requirement, or a direction/implementation choice.

Calling this tool PAUSES EXECUTION until the user answers: the questions are shown as one interactive card (a preview panel per question when options carry previews), and the user's answers arrive as this tool's result. Do not continue working on the blocked task or assume an answer while the tool is pending. Notes:
- Every question also gets a "Свой вариант" free-text option and a "Нужно пояснение" mark. A marked question is not answered: the user asks for a more detailed explanation in chat, and the tool result tells you to explain it in your reply.
- Set multiSelect: true when several answers are valid; the user may combine checked options with their own typed answer.
- If you recommend one option, make it FIRST, append "(Recommended)" to its label, and set its recommendedReason to one short sentence on why you recommend it over the alternatives (shown under the option).
- Use options[].preview (markdown) for concrete artifacts to compare side-by-side (code, ASCII mockups, configs). Single-select only.
- One call = one round: ask every question you can ask now in a single call — never split independent questions across back-to-back calls. A question that depends on another question's answer waits for a later round; ask follow-up rounds until no decision is left assumed.
- Call ask_question as the only tool in the assistant response; other tool calls in that response are discarded and can be re-issued after the answer.
- The user may answer only some questions; unanswered ones are reported as declined.`;

export const DEFAULT_PROMPT_GUIDELINES: readonly string[] = [
	`Call ask_question whenever the request is ambiguous and a concrete decision is needed — one call is one round holding every question answerable now (dependent questions wait for the next round), with ${MIN_OPTIONS}-${MAX_OPTIONS} options each. The call blocks until its result contains the user's answers.`,
	"Every option needs a concise label (1-5 words) and a description of what it means / its trade-off.",
	'Recommend by putting the option first with "(Recommended)" appended to its label and setting its recommendedReason to one short sentence (shown under the option) on why you recommend it over the alternatives; the user can always type a custom answer or ask for more detail.',
	"Call ask_question as the only tool in the assistant response; continue with other tools after the answer.",
];

const askWithBuiltInUi: AskUserQuestionAsker = (request) =>
	request.ctx.mode === "tui" ? askInTerminal(request) : askWithDialogs(request);

export function createAskUserQuestionExtension(
	options: AskUserQuestionExtensionOptions = {},
): ExtensionFactory {
	const ask = options.ask ?? ((request) => (request.ctx.mode === "rpc" ? askWithPlugin(request) : askWithBuiltInUi(request)));
	const guidance = options.guidance ?? {};
	return (pi: ExtensionAPI): void => {
		pi.on("message_end", (event) => {
			const message = isolateAskUserQuestionBatch(event.message);
			if (options.announce) {
				for (const toolCallId of executableAskCallIds(message ?? event.message))
					options.announce(toolCallId);
			}
			return message ? { message } : undefined;
		});
		pi.registerTool({
			name: ASK_USER_QUESTION_TOOL_NAME,
			label: "Ask Question",
			description: guidance.description ?? DEFAULT_DESCRIPTION,
			...(guidance.promptSnippet ? { promptSnippet: guidance.promptSnippet } : {}),
			promptGuidelines: [...(guidance.promptGuidelines ?? DEFAULT_PROMPT_GUIDELINES)],
			parameters: AskUserQuestionSchema,
			executionMode: "sequential",
			exposure: "model-only",
			async execute(toolCallId, params, signal, _onUpdate, ctx) {
				const args: AskUserQuestionArgs = params;
				if (!options.ask && !ctx.hasUI)
					return textResult(ASK_UNAVAILABLE_TEXT, { answers: [], cancelled: true });
				const validation = validateQuestionnaire(args);
				if (!validation.ok) return textResult(validation.message, { answers: [], cancelled: true });
				const outcome = await ask({ toolCallId, args, signal, ctx });
				return outcomeResult(outcome, args);
			},
			renderCall: renderAskCall,
			renderResult: renderAskResult,
		});
	};
}
