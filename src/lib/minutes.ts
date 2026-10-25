import { percent } from "./format";
import { formatLong, raciRows, type Deadline } from "./deadlines";
import type { Analysis } from "./types";

export type ParticipantEmail = {
  name: string;
  email: string;
  valid: boolean;
};

export type SavedReminder = Deadline & {
  id: string;
  emails: string[];
  sent: boolean;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const STORAGE_KEY = "before-we-decide-reminders";
const EMPTY: SavedReminder[] = [];

let storedRaw = "";
let storedSnapshot: SavedReminder[] = EMPTY;
const listeners = new Set<() => void>();

export function parseParticipantEmails(raw: string): ParticipantEmail[] {
  const rows: ParticipantEmail[] = [];
  for (const line of raw.split(/\n+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const named =
      /^([^:<]+?)\s*[:<]\s*([^\s>]+)\s*>?$/.exec(trimmed) ??
      /^(.+?)\s+[-–—]\s+(\S+)$/.exec(trimmed);
    const email = (named ? named[2] : trimmed).trim();
    const name = named ? named[1].trim() : "";
    rows.push({ name, email, valid: EMAIL.test(email) });
  }
  return rows;
}

export function validEmails(raw: string): string[] {
  const seen: string[] = [];
  for (const row of parseParticipantEmails(raw)) {
    const email = row.email.toLowerCase();
    if (!row.valid || seen.includes(email)) continue;
    seen.push(email);
  }
  return seen;
}

export function meetingMinutes(analysis: Analysis, deadlines: Deadline[], meetingIso: string): string {
  const ranked = [...analysis.speakers].sort((a, b) => b.wordShare - a.wordShare);
  const loudest = ranked[0];
  const quietest = ranked[ranked.length - 1];
  const decisions = analysis.utterances.filter((turn) => turn.flags.decision);
  const lines = [
    "Meeting minutes",
    ...(meetingIso ? [`Meeting date: ${formatLong(meetingIso)}`] : []),
    "",
    "Highlights",
    `${analysis.totalTurns} turns and ${analysis.totalWords.toLocaleString()} words. Floor equality ${analysis.equality} out of 100.`,
    ...(loudest && quietest
      ? [`${loudest.name} held ${percent(loudest.wordShare)}% of the words. ${quietest.name} held ${percent(quietest.wordShare)}%.`]
      : []),
    analysis.safety.summary,
    "",
    "Decisions",
  ];
  if (decisions.length === 0) {
    lines.push("No decision line was found.");
  } else {
    for (const turn of decisions) {
      const quoted = turn.index === analysis.decision.index ? analysis.decision.quote : null;
      lines.push(`${turn.speaker}: ${quoted || decisionSentence(turn.text)}`);
    }
  }
  lines.push("", "Deadlines");
  if (deadlines.length === 0) {
    lines.push("No dated deadline was found. A line needs a day, such as Thursday, tonight, or October 30.");
  } else {
    lines.push("R does the work. A answers for it. C is asked. I is told.");
    for (const row of raciRows(
      deadlines,
      analysis.speakers.map((speaker) => ({ name: speaker.name, role: speaker.role })),
    )) {
      lines.push(
        `${row.description} — Due ${formatLong(row.due)}. Reminder ${formatLong(row.remindOn)}. R ${row.responsible}. A ${row.accountable}. C ${row.consulted}. I ${row.informed}.`,
      );
    }
  }
  return lines.join("\n");
}

export function reminderMessage(deadline: Deadline): string {
  return [
    `Reminder: this is due in two days, on ${formatLong(deadline.due)}.`,
    "",
    `${deadline.owner}: ${deadline.task}`,
    "",
    "Sent from the meeting minutes so the date does not slip.",
  ].join("\n");
}

export function mailtoHref(emails: string[], subject: string, body: string): string {
  return `mailto:${emails.join(",")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

export function calendarIcs(deadlines: Deadline[], emails: ParticipantEmail[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const events = deadlines.map((deadline, index) => {
    const end = shiftDate(deadline.due, 1);
    const guests = emails
      .filter((row) => row.valid)
      .map((row) => `ATTENDEE;CN=${icsText(row.name || row.email)}:mailto:${row.email}`);
    return [
      "BEGIN:VEVENT",
      `UID:before-we-decide-${deadline.due}-${index}@local`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${deadline.due.replaceAll("-", "")}`,
      `DTEND;VALUE=DATE:${end.replaceAll("-", "")}`,
      `SUMMARY:${icsText(`Deadline: ${deadline.owner}`)}`,
      `DESCRIPTION:${icsText(`${deadline.task} Reminder is set two days before, on ${formatLong(deadline.remindOn)}.`)}`,
      ...guests,
      "BEGIN:VALARM",
      "TRIGGER:-P2D",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsText(`In two days: ${deadline.owner} — ${deadline.task}`)}`,
      "END:VALARM",
      "END:VEVENT",
    ].join("\r\n");
  });
  return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//SpeakSense AI//EN", ...events, "END:VCALENDAR"].join(
    "\r\n",
  );
}

export function subscribeReminders(listener: () => void): () => void {
  listeners.add(listener);
  const onStorage = () => listener();
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function readReminders(): SavedReminder[] {
  if (typeof window === "undefined") return EMPTY;
  const raw = window.localStorage.getItem(STORAGE_KEY) ?? "";
  if (raw === storedRaw) return storedSnapshot;
  storedRaw = raw;
  storedSnapshot = parseStored(raw);
  return storedSnapshot;
}

export function saveReminders(deadlines: Deadline[], emails: string[]) {
  const current = readReminders();
  const next = deadlines.map((deadline) => {
    const id = `${deadline.due}|${deadline.task}`;
    const previous = current.find((item) => item.id === id);
    return { ...deadline, id, emails, sent: previous?.sent ?? false };
  });
  writeReminders(next);
}

export function markReminderSent(id: string) {
  writeReminders(readReminders().map((item) => (item.id === id ? { ...item, sent: true } : item)));
}

function writeReminders(items: SavedReminder[]) {
  storedSnapshot = items;
  storedRaw = JSON.stringify(items);
  window.localStorage.setItem(STORAGE_KEY, storedRaw);
  for (const listener of listeners) listener();
}

function parseStored(raw: string): SavedReminder[] {
  if (!raw) return EMPTY;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return EMPTY;
    return parsed.filter(isReminder);
  } catch {
    return EMPTY;
  }
}

function isReminder(value: unknown): value is SavedReminder {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SavedReminder>;
  return typeof item.id === "string" && typeof item.due === "string" && typeof item.remindOn === "string" && typeof item.task === "string";
}

function decisionSentence(text: string): string {
  const parts = text.split(/(?<=[.!?])\s+/);
  const hit = parts.find((part) =>
    /let(?:['’]s| us) go with|that is the decision|we decided|we(?:['’]ll| will) go with|i think we should go with/i.test(part),
  );
  const sentence = (hit ?? parts[0] ?? text).replace(/\s+/g, " ").trim();
  return sentence.length > 180 ? `${sentence.slice(0, 179).trimEnd()}…` : sentence;
}

function shiftDate(iso: string, days: number): string {
  const [year, month, day] = iso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
}
