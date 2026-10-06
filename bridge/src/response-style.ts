import type { Options } from "@anthropic-ai/claude-agent-sdk";
import type { ResponseStyle } from "@flare/protocol";

export const CONCISE_INSTRUCTION =
  "Be concise. Lead with the answer or result, use short bullets over paragraphs, and skip preamble, recaps and restating the question. Expand only when the user asks.";

const EXPLANATORY_OUTPUT_STYLE = "Explanatory";

type StyleOptions = Pick<Options, "systemPrompt" | "settings">;

export function responseStyleOptions(style: ResponseStyle): StyleOptions {
  switch (style) {
    case "concise":
      return { systemPrompt: { type: "preset", preset: "claude_code", append: CONCISE_INSTRUCTION } };
    case "default":
      return { systemPrompt: { type: "preset", preset: "claude_code" } };
    case "explanatory":
      return {
        systemPrompt: { type: "preset", preset: "claude_code" },
        settings: { outputStyle: EXPLANATORY_OUTPUT_STYLE },
      };
  }
}
