import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export const REFRESH_MODELS_COMMAND = "piwright-refresh-models";

export default function (pi: ExtensionAPI): void {
	pi.registerCommand(REFRESH_MODELS_COMMAND, {
		description: "Reload models.json into the model registry (PiWright service command)",
		handler: async (_args, ctx) => {
			await ctx.modelRegistry.refresh({ allowNetwork: false });
		},
	});
}
