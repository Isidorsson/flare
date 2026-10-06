import { z } from "zod";

const outputMessageSchema = z.instanceof(ArrayBuffer).transform((buffer) => ({
  kind: "output" as const,
  bytes: new Uint8Array(buffer),
}));

const exitMessageSchema = z
  .object({
    type: z.literal("exit"),
    code: z.number().int().nonnegative().nullable(),
  })
  .transform(({ code }) => ({ kind: "exit" as const, code }));

const ptyMessageSchema = z.union([outputMessageSchema, exitMessageSchema]);

export type PtyMessage = z.output<typeof ptyMessageSchema>;

export function parsePtyMessage(raw: unknown): PtyMessage {
  return ptyMessageSchema.parse(raw);
}

export function describeExit(code: number | null): string {
  return code === null ? "process exited" : `process exited with code ${code}`;
}
