import type { Utterance } from "./types";

export type Deadline = {
  owner: string;
  task: string;
  phrase: string;
  due: string;
  remindOn: string;
};

export type RaciPerson = {
  name: string;
  role: string | null;
};

export type RaciRow = {
  description: string;
  due: string;
  remindOn: string;
  responsible: string;
  accountable: string;
  consulted: string;
  informed: string;
};

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

const WHEN =
  /\b(tonight|today|tomorrow|in\s+\d+\s+days|(?:by|before|on|this|due|next)\s+(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|monday|tuesday|wednesday|thursday|friday|saturday|sunday|(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,\s*\d{4})?|\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/i;

export function parseIsoDate(iso: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date;
}

export function formatIso(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDays(iso: string, days: number): string | null {
  const date = parseIsoDate(iso);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return formatIso(date);
}

export function formatLong(iso: string): string {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function formatShort(iso: string): string {
  const date = parseIsoDate(iso);
  if (!date) return iso;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

export function taskDescription(task: string, phrase: string): string {
  const phrasePattern = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
  const cleaned = task
    .replace(phrasePattern, " ")
    .replace(/\b(i will|i'll|i can|i am going to|we will|we'll|we should|we can|let's|lets|at the same time)\b/gi, " ")
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  const description = cleaned || task.replace(/\s+/g, " ").trim();
  const sentence = description.charAt(0).toUpperCase() + description.slice(1);
  return sentence.length > 72 ? `${sentence.slice(0, 71).trimEnd()}…` : sentence;
}

export function raciRows(deadlines: Deadline[], people: RaciPerson[]): RaciRow[] {
  const facilitator = people.find((person) => /facilitat/i.test(person.role ?? ""));
  return deadlines.map((deadline) => {
    const responsible = responsibleFor(deadline);
    const accountable = facilitator?.name ?? (responsible === "Team" ? deadline.owner : responsible);
    const consulted = people
      .filter((person) => person.name.toLowerCase() !== responsible.toLowerCase())
      .filter((person) => person.name.toLowerCase() !== accountable.toLowerCase())
      .filter((person) => new RegExp(`\\b${escapeName(person.name)}\\b`, "i").test(deadline.task))
      .map((person) => person.name);
    const skip = new Set([responsible, accountable, ...consulted].map((name) => name.toLowerCase()));
    const informed =
      responsible === "Team"
        ? []
        : people.filter((person) => !skip.has(person.name.toLowerCase())).map((person) => person.name);
    return {
      description: taskDescription(deadline.task, deadline.phrase),
      due: deadline.due,
      remindOn: deadline.remindOn,
      responsible,
      accountable,
      consulted: consulted.join(", ") || "—",
      informed: informed.join(", ") || "—",
    };
  });
}

function responsibleFor(deadline: Deadline): string {
  if (/\b(i will|i'll|i can|i am going to)\b/i.test(deadline.task)) return deadline.owner;
  const assigned = /\b([A-Z][a-z]+)\s+will\b/.exec(deadline.task);
  if (assigned) return assigned[1];
  if (/\b(we|let's|lets|the team)\b/i.test(deadline.task)) return "Team";
  return deadline.owner;
}

function escapeName(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function resolveWhen(phrase: string, meetingIso: string): string | null {
  if (!parseIsoDate(meetingIso)) return null;
  const text = phrase.toLowerCase().replace(/\s+/g, " ").trim();
  if (text === "today" || text === "tonight") return meetingIso;
  if (text === "tomorrow") return addDays(meetingIso, 1);

  const inDays = /^in\s+(\d+)\s+days$/.exec(text);
  if (inDays) return addDays(meetingIso, Number(inDays[1]));

  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return parseIsoDate(text) ? text : null;

  const numeric = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/.exec(text);
  if (numeric) {
    const year = numeric[3] ? normalizeYear(Number(numeric[3])) : undefined;
    return onOrAfter(meetingIso, Number(numeric[1]) - 1, Number(numeric[2]), year);
  }

  const named =
    /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+(\d{1,2})(?:,\s*(\d{4}))?$/.exec(text);
  if (named) {
    return onOrAfter(meetingIso, MONTHS[named[1]], Number(named[2]), named[3] ? Number(named[3]) : undefined);
  }

  const weekday = /\b(next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/.exec(text);
  if (!weekday) return null;
  const target = WEEKDAYS.indexOf(weekday[2]);
  const meeting = parseIsoDate(meetingIso);
  if (!meeting) return null;
  let delta = (target - meeting.getUTCDay() + 7) % 7;
  if (weekday[1] && delta === 0) delta = 7;
  return addDays(meetingIso, delta);
}

export function extractDeadlines(utterances: Utterance[], meetingIso: string): Deadline[] {
  if (!parseIsoDate(meetingIso)) return [];
  const found: Deadline[] = [];
  for (const turn of utterances) {
    for (const sentence of turn.text.split(/(?<=[.!?])\s+/)) {
      const task = sentence.replace(/\s+/g, " ").trim();
      const match = WHEN.exec(task);
      if (!match) continue;
      const due = resolveWhen(match[1], meetingIso);
      const remindOn = due ? addDays(due, -2) : null;
      if (!due || !remindOn) continue;
      const key = `${due}|${task.toLowerCase()}`;
      if (found.some((item) => `${item.due}|${item.task.toLowerCase()}` === key)) continue;
      found.push({
        owner: turn.speaker,
        task: task.length > 180 ? `${task.slice(0, 179).trimEnd()}…` : task,
        phrase: match[1],
        due,
        remindOn,
      });
    }
  }
  return found;
}

function normalizeYear(year: number): number {
  if (year < 100) return 2000 + year;
  return year;
}

function onOrAfter(meetingIso: string, month: number, day: number, year?: number): string | null {
  const meeting = parseIsoDate(meetingIso);
  if (!meeting || month < 0 || month > 11 || day < 1 || day > 31) return null;
  const baseYear = year ?? meeting.getUTCFullYear();
  const built = buildDate(baseYear, month, day);
  if (!built) return null;
  if (year === undefined && built < meetingIso) return buildDate(baseYear + 1, month, day);
  return built;
}

function buildDate(year: number, month: number, day: number): string | null {
  const date = new Date(Date.UTC(year, month, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month || date.getUTCDate() !== day) return null;
  return formatIso(date);
}
