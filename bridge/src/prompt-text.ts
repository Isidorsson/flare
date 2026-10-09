export function clipText(text: string, max: number): { text: string; cut: boolean } {
  if (text.length <= max) return { text, cut: false };
  const lastCode = text.charCodeAt(max - 1);
  const endsInHighSurrogate = lastCode >= 0xd800 && lastCode <= 0xdbff;
  return { text: text.slice(0, max - (endsInHighSurrogate ? 1 : 0)), cut: true };
}

export function singleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
