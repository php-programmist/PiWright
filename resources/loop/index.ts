import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const LOOP_TOOL_NAME = "loop_next";

export default function (pi: ExtensionAPI): void {
	pi.registerTool({
		name: LOOP_TOOL_NAME,
		label: "Loop: next iteration",
		description: `Request the next iteration of a PiWright loop. The user runs you in a loop when they enabled the "Loop" checkbox near the prompt field: after your turn ends, PiWright starts a brand-new session (fresh context) with the same original prompt. Call this tool ONCE, at the very end of your turn, after you have finished this iteration's work and written your final report — it schedules the next iteration. If the goal of the loop prompt is fully reached, or there is nothing meaningful left to do, do NOT call this tool — the loop then stops. Never call it mid-turn, and never call it when the user did not start a loop.`,
		promptSnippet:
			"loop_next: at the end of a turn, request the next loop iteration (only when the user runs you in a PiWright loop)",
		promptGuidelines: [
			"When the user started a PiWright loop (the Loop checkbox), finish the iteration's work, write the final report, then call loop_next once at the very end of the turn; omit it to stop the loop.",
		],
		parameters: Type.Object({}),
		async execute() {
			return {
				content: [
					{
						type: "text",
						text: "Next loop iteration requested. PiWright will start a fresh session with the original prompt after this turn ends.",
					},
				],
				details: { requested: true },
			};
		},
	});
}
