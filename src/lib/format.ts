export const SPEAKER_COLORS = [
  "var(--speaker-1)",
  "var(--speaker-2)",
  "var(--speaker-3)",
  "var(--speaker-4)",
  "var(--speaker-5)",
  "var(--speaker-6)",
  "var(--speaker-7)",
  "var(--speaker-8)",
];

export function speakerColor(index: number): string {
  return SPEAKER_COLORS[index % SPEAKER_COLORS.length];
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

export function sentenceWith(text: string, pattern: RegExp, max = 170): string {
  const match = pattern.exec(text);
  if (!match || match.index === undefined) return clip(text, max);
  const start = text.lastIndexOf(".", match.index);
  const from = start === -1 ? 0 : start + 1;
  const after = text.indexOf(".", match.index + match[0].length);
  const to = after === -1 ? text.length : after + 1;
  return clip(text.slice(from, to).trim(), max);
}

export function clip(text: string, max = 160): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max - 1).trimEnd()}…`;
}

export function humanList(names: string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

export function percent(share: number): number {
  return Math.round(share * 100);
}

export function samePerson(a: string, b: string): boolean {
  const left = a.trim().toLowerCase().replace(/\s+/g, " ");
  const right = b.trim().toLowerCase().replace(/\s+/g, " ");
  if (!left || !right) return false;
  return (
    left === right ||
    left.startsWith(`${right} `) ||
    right.startsWith(`${left} `)
  );
}

export function parseRoster(raw: string): string[] {
  const seen: string[] = [];
  for (const part of raw.split(/[\n,]/)) {
    const name = part.replace(/^\s*and\s+/i, "").trim();
    if (!name) continue;
    if (seen.some((existing) => samePerson(existing, name))) continue;
    seen.push(name);
  }
  return seen;
}

export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}
