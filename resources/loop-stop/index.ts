import { Type } from "typebox";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const LOOP_STOP_TOOL_NAME = "loop_stop";

export default function (pi: ExtensionAPI): void {
	pi.registerTool({
		name: LOOP_STOP_TOOL_NAME,
		label: "Loop: stop",
		description: `Stop the PiWright loop. The user runs you in a loop when they enabled the "Loop" checkbox near the prompt field: when your turn ends, PiWright automatically starts a brand-new session (fresh context) with the same prompt. Call this tool ONCE, after you have checked the loop's exit condition (given at the end of the prompt) and found it MET — the loop then stops after this turn. If the exit condition is not met yet, do NOT call this tool; just finish the turn normally and the loop continues.`,
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
