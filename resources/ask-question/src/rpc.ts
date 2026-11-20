import type { ExtensionUIContext } from "@earendil-works/pi-coding-agent";
import {
	type AskOutcome,
	type AskRequest,
	type AskUserQuestionAnswer,
	type AskUserQuestionArgs,
	type AskUserQuestionItem,
	ASK_USER_QUESTION_TOOL_NAME,
} from "./core.ts";

/** Префикс заголовка `input`-запроса: по нему плагин отличает опрос от обычного ввода. */
export const ASK_PAYLOAD_PREFIX = "pi-wrapper:ask:";

type DialogUi = Pick<ExtensionUIContext, "input">;

function encodePayload(args: AskUserQuestionArgs): string {
	return ASK_PAYLOAD_PREFIX + Buffer.from(JSON.stringify({ questions: args.questions }), "utf8").toString("base64");
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === "object";
}

function parseAnswers(value: string, args: AskUserQuestionArgs): AskUserQuestionAnswer[] | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		return null;
	}
	if (!isRecord(parsed) || !Array.isArray(parsed.answers)) return null;
	const answers: AskUserQuestionAnswer[] = [];
	for (const raw of parsed.answers) {
		if (!isRecord(raw)) continue;
		const questionIndex = typeof raw.questionIndex === "number" ? raw.questionIndex : -1;
		const question = args.questions[questionIndex];
		if (!question) continue;
		const kind = raw.kind;
		if (kind === "chat") {
			answers.push({ questionIndex, question: question.question, kind: "chat", answer: null });
			continue;
		}
		const notes = typeof raw.notes === "string" && raw.notes.trim() !== "" ? raw.notes.trim() : undefined;
		if (kind === "option") {
			const label = typeof raw.answer === "string" ? raw.answer : "";
			const option = question.options.find((o) => o.label === label);
			if (!option) continue;
			answers.push({
				questionIndex,
				question: question.question,
				kind: "option",
				answer: option.label,
				...(option.preview ? { preview: option.preview } : {}),
				...(notes ? { notes } : {}),
			});
			continue;
		}
		if (kind === "custom") {
			const text = typeof raw.answer === "string" ? raw.answer.trim() : "";
			if (!text) continue;
			answers.push({
				questionIndex,
				question: question.question,
				kind: "custom",
				answer: text,
				...(notes ? { notes } : {}),
			});
			continue;
		}
		if (kind === "multi") {
			const selected = Array.isArray(raw.selected)
				? raw.selected.filter((x): x is string => typeof x === "string")
				: [];
			const own = typeof raw.answer === "string" && raw.answer.trim() !== "" ? raw.answer.trim() : null;
			if (selected.length === 0 && !own) continue;
			answers.push({
				questionIndex,
				question: question.question,
				kind: "multi",
				answer: own,
				selected,
				...(notes ? { notes } : {}),
			});
		}
	}
	return answers;
}

/**
 * RPC-путь: весь опрос уезжает одним `input`-запросом (JSON в base64), плагин рисует карточку
 * и возвращает JSON с ответами. Один запрос на пачку — плагин сам решает, как показать вопросы.
 */
export async function askWithPlugin(request: AskRequest): Promise<AskOutcome> {
	const { args, signal, ctx } = request;
	const value = await ctx.ui.input(encodePayload(args), "", signal ? { signal } : undefined);
	if (value === undefined) return { kind: "answered", result: { answers: [], cancelled: true } };
	const answers = parseAnswers(value, args);
	if (!answers) return { kind: "answered", result: { answers: [], cancelled: true } };
	return { kind: "answered", result: { answers, cancelled: false } };
}

export function isAskPayloadTitle(title: string): boolean {
	return title.startsWith(ASK_PAYLOAD_PREFIX);
}

export { ASK_USER_QUESTION_TOOL_NAME };
export type { AskUserQuestionItem };
