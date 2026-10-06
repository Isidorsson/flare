import { z } from "zod";

export const languageSchema = z.enum([
  "typescript",
  "javascript",
  "rust",
  "python",
  "lua",
  "luau",
  "go",
  "c",
  "cpp",
  "csharp",
  "java",
  "kotlin",
  "ruby",
  "php",
  "swift",
  "dart",
  "zig",
  "shell",
  "css",
  "vue",
  "svelte",
]);

export const graphSnapshotSchema = z.object({
  root: z.string(),
  nodes: z.array(z.object({ id: z.string().min(1), language: languageSchema })),
  edges: z.array(z.object({ source: z.string().min(1), target: z.string().min(1) })),
  warnings: z.array(z.string()),
});

export const blastRadiusSchema = z.object({
  origin: z.string().min(1),
  nodes: z.array(z.object({ id: z.string().min(1), depth: z.number().int().positive() })),
});

export const changeSchema = z.enum(["unchanged", "added", "updated", "removed", "rebuilt"]);

export type Language = z.infer<typeof languageSchema>;
export type GraphSnapshot = z.infer<typeof graphSnapshotSchema>;
export type GraphNodeData = GraphSnapshot["nodes"][number];
export type GraphEdgeData = GraphSnapshot["edges"][number];
export type BlastRadius = z.infer<typeof blastRadiusSchema>;
export type Change = z.infer<typeof changeSchema>;

export const LANGUAGES = languageSchema.options;
