import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const LOOP_STOP_TOOL_NAME = "loop_stop";

export default function (pi: ExtensionAPI): void {
	pi.registerTool({
		name: LOOP_STOP_TOOL_NAME,
		label: "Loop: stop",
		description: `Stop the PiWright loop. The user runs you in a loop when they enabled the "Loop" checkbox near the prompt field: after each of your work turns, PiWright sends a short condition-check prompt asking you to verify the loop's exit condition. Call this tool ONLY in response to that check prompt, when the condition is MET — the loop then stops after this turn. If the condition is not met, do NOT call this tool; reply with a short text without any tool calls, and the next iteration starts in a fresh session.`,
		parameters: Type.Object({}),
		async execute() {
			return {
				content: [
					{
						type: "text",
						text: "Loop stop requested. PiWright will not start the next iteration after this turn ends.",
					},
				],
				details: { requested: true },
			};
		},
	});
}
