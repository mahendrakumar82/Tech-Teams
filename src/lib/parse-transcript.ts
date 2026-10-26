export type DraftTurn = {
  speaker: string;
  text: string;
  startMs: number | null;
};

const NAME =
  String.raw`[\p{Lu}][\p{L}'’.-]{0,40}(?:\s+[\p{Lu}][\p{L}'’.-]{0,40}){0,3}`;
const SEPARATOR = String.raw`(?:\s*[:：]\s*|\s*[–—]\s*|\s+-\s*|\s*-\s+)`;
const BLOCKED = new Set([
  "note",
  "warning",
  "speaker",
  "untitled",
  "webvtt",
  "decision",
  "decisions",
  "highlights",
  "deadlines",
  "minutes",
  "summary",
  "agenda",
]);

function timeToMs(stamp: string): number {
  const parts = stamp.split(":").map((part) => Number(part));
  if (parts.some((part) => Number.isNaN(part))) return 0;
  if (parts.length === 3) return (parts[0] * 3600 + parts[1] * 60 + parts[2]) * 1000;
  if (parts.length === 2) return (parts[0] * 60 + parts[1]) * 1000;
  return 0;
}

function acceptable(speaker: string): boolean {
  const key = speaker.trim().toLowerCase();
  return key.length > 1 && !BLOCKED.has(key);
}

function merge(turns: DraftTurn[]): DraftTurn[] {
  const merged: DraftTurn[] = [];
  for (const turn of turns) {
    const text = turn.text.replace(/\s+/g, " ").trim();
    if (!text || !acceptable(turn.speaker)) continue;
    const previous = merged[merged.length - 1];
    if (previous && previous.speaker.toLowerCase() === turn.speaker.toLowerCase()) {
      previous.text = `${previous.text} ${text}`;
      continue;
    }
    merged.push({ speaker: turn.speaker.trim(), text, startMs: turn.startMs });
  }
  return merged;
}

function score(turns: DraftTurn[]): number {
  const speakers = new Set(turns.map((turn) => turn.speaker.toLowerCase()));
  if (speakers.size < 2) return speakers.size;
  return speakers.size * 1000 + turns.length;
}

const HEADING_STOP = new Set([
  "team",
  "the",
  "and",
  "from",
  "note",
  "purpose",
  "roles",
  "norms",
  "decision",
  "decisions",
  "minutes",
  "highlights",
  "summary",
  "agenda",
]);

function personHeading(name: string): boolean {
  const words = name.trim().split(/\s+/);
  if (words.length < 2 || words.length > 3) return false;
  return words.every((word) => acceptable(word) && !HEADING_STOP.has(word.toLowerCase()));
}

function parseColon(raw: string): DraftTurn[] {
  const linePattern = new RegExp(
    String.raw`^(?:\[?(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\]?\s+)?(${NAME})${SEPARATOR}(.*)$`,
    "u",
  );
  const nameOnly = new RegExp(
    String.raw`^(?:\[?(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\]?\s+)?(${NAME})$`,
    "u",
  );
  const turns: DraftTurn[] = [];
  let current: DraftTurn | null = null;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "WEBVTT" || trimmed.startsWith("NOTE")) continue;
    if (/^\d+$/.test(trimmed) || trimmed.includes("-->")) continue;
    const match = trimmed.match(linePattern);
    if (match) {
      const spoken = (match[3] ?? "").trim();
      if (!acceptable(match[2])) {
        if (current && spoken) current.text = `${current.text} ${spoken}`;
        continue;
      }
      if (current) turns.push(current);
      current = {
        speaker: match[2],
        text: spoken,
        startMs: match[1] ? timeToMs(match[1]) : null,
      };
      continue;
    }
    const heading = trimmed.match(nameOnly);
    if (heading && personHeading(heading[2])) {
      if (current) turns.push(current);
      current = {
        speaker: heading[2],
        text: "",
        startMs: heading[1] ? timeToMs(heading[1]) : null,
      };
      continue;
    }
    if (current) current.text = `${current.text} ${trimmed}`;
  }
  if (current) turns.push(current);
  return merge(turns);
}

function parseOtter(raw: string): DraftTurn[] {
  const header = new RegExp(
    String.raw`^(${NAME})\s+(\d{1,2}:\d{2}(?::\d{2})?)\s*$`,
    "u",
  );
  const turns: DraftTurn[] = [];
  let current: DraftTurn | null = null;
  let headers = 0;

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    const match = trimmed.match(header);
    if (match) {
      if (!acceptable(match[1])) continue;
      headers += 1;
      if (current) turns.push(current);
      current = {
        speaker: match[1],
        text: "",
        startMs: timeToMs(match[2]),
      };
      continue;
    }
    if (!trimmed) continue;
    if (current) current.text = `${current.text} ${trimmed}`.trim();
  }
  if (current) turns.push(current);
  if (headers < 2) return [];
  return merge(turns);
}

function parseTimed(raw: string): DraftTurn[] {
  if (!raw.includes("-->")) return [];
  const cues: { text: string; startMs: number | null }[] = [];
  let buffer: string[] = [];
  let startMs: number | null = null;

  const flush = () => {
    if (buffer.length === 0) return;
    cues.push({ text: buffer.join(" "), startMs });
    buffer = [];
    startMs = null;
  };

  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === "WEBVTT" || trimmed.startsWith("NOTE") || /^\d+$/.test(trimmed)) {
      if (!trimmed) flush();
      continue;
    }
    if (trimmed.includes("-->")) {
      flush();
      const stamp = trimmed.split("-->")[0]?.trim() ?? "";
      startMs = timeToMs(stamp.replace(",", "."));
      continue;
    }
    buffer.push(trimmed);
  }
  flush();

  const voice = /^<v(?:\.\w+)?\s+([^>]+)>(.*)$/i;
  const colon = new RegExp(String.raw`^(${NAME})${SEPARATOR}(.*)$`, "u");
  const turns: DraftTurn[] = [];
  for (const cue of cues) {
    const voiced = cue.text.match(voice);
    if (voiced) {
      const speaker = voiced[1].trim();
      const text = voiced[2].trim();
      if (!acceptable(speaker)) {
        const previous = turns[turns.length - 1];
        if (previous && text) previous.text = `${previous.text} ${text}`;
        continue;
      }
      turns.push({ speaker, text, startMs: cue.startMs });
      continue;
    }
    const spoken = cue.text.match(colon);
    if (spoken) {
      const speaker = spoken[1];
      const text = spoken[2].trim();
      if (!acceptable(speaker)) {
        const previous = turns[turns.length - 1];
        if (previous && text) previous.text = `${previous.text} ${text}`;
        continue;
      }
      turns.push({ speaker, text, startMs: cue.startMs });
    }
  }
  return merge(turns);
}

export function parseTranscript(raw: string): DraftTurn[] {
  const text = raw.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!text) return [];
  const candidates = [parseTimed(text), parseOtter(text), parseColon(text)];
  candidates.sort((a, b) => score(b) - score(a));
  return candidates[0] ?? [];
}
