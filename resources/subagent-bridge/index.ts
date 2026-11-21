import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

// PiWright bridge: pi-subagents announces agent lifecycle over pi.events, which never
// reaches the RPC stdout stream. Re-emit each event as a custom session entry
// (entry_appended in RPC) so the PiWright host can track running subagents.
const CHANNELS: Array<[channel: string, kind: string]> = [
	["subagents:created", "started"],
	["subagents:started", "started"],
	["subagents:completed", "completed"],
	["subagents:failed", "completed"],
	["subagents:workflow_started", "workflow_started"],
	["subagents:workflow_settled", "workflow_settled"],
	["subagents:disposed", "disposed"],
];

export default function (pi: ExtensionAPI): void {
	for (const [channel, kind] of CHANNELS) {
		pi.events.on(channel, (data: unknown) => {
			const id =
				typeof data === "object" && data !== null && typeof (data as { id?: unknown }).id === "string"
					? (data as { id: string }).id
					: null;
			void pi.appendEntry("piwright:subagents", { kind, id });
		});
	}
}
