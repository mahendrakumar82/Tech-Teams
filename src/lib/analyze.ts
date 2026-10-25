import { scoreCohesion } from "./cohesion";
import { clip, countWords, humanList, parseRoster, percent, samePerson, sentenceWith } from "./format";
import { parseTranscript } from "./parse-transcript";
import type {
  Analysis,
  AnalyzeResult,
  CharterGap,
  SpeakerReport,
  Utterance,
  UtteranceFlags,
} from "./types";

const DECISION =
  /\b(let(?:['’]s| us) go with|we(?:['’]ll| will) go with|i think we should go with|that is the decision|that(?:['’]s| is) the decision|final decision|we decided|lock (?:it|this) in)\b/i;
const CRITICISM =
  /\b(you always|you never|thats stupid|that is stupid|you do not listen|you dont listen|shut up|typical of you|your fault)\b/;
const UNCERTAINTY =
  /\b(im not sure|i am not sure|not sure|not really sure|i dont know|i do not know|i might be wrong|i could be wrong|i wonder|not certain|im unsure|i am unsure|less sure|unsure|uncertain|not confident|hard to say|perhaps|maybe we|maybe it|maybe the|i guess|im guessing|i doubt)\b/;
const CHALLENGE =
  /\b(i disagree|i dont agree|i do not agree|another way|on the other hand|what if|the risk is|hold on|push back|not convinced|i see it differently|too risky|the problem is|the issue is|the concern is|i object|instead of|that will not work|that wont work|i would not)\b/;
const INVITATION =
  /\b(what do you think|what do you|anyone else|have we heard|what are we missing|your take|who have we not heard|your thoughts|who else|your view|have not heard|havent heard|jump in|does anyone|what about you|any thoughts|lets hear|over to you|who has not|who hasnt|do you want to add|thoughts on)\b/;
const BUILD =
  /\b(building on|to add to|i agree with|i agree|adding to|following up|to build on|yes and|good point|and also|on top of that|adding that)\b/;
const QUESTION_PHRASES =
  /\b(what do you think|what do|what does|what did|what if|what about|what should|what would|what could|what can|why do|why does|why is|why are|why would|why should|how do|how does|how can|how could|how should|how would|how about|how come|who else|who can|who should|when do|when should|when can|where do|where should|where can|which one|which option|which way|do you|do we|does anyone|does that|does this|does it|did you|did we|did anyone|can you|can we|can anyone|could you|could we|could anyone|could that|should we|should you|would you|would we|would anyone|would that|would this|will you|will we|is there|is that|is this|is it|are we|are you|are there|have we|has anyone|anyone else|anybody|any questions|a question)\b/;
const QUESTION_START =
  /^(what|why|how|who|when|where|which|does|did|can|could|should|would|will|is|are|was|were|has|anyone|anybody|do|have)\b/;

const LOW_RATIO = 0.65;
const HIGH_RATIO = 1.45;
const HIGH_FLOOR = 0.34;

export function gini(values: number[]): number {
  const count = values.length;
  if (count === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  if (total === 0) return 0;
  let weighted = 0;
  sorted.forEach((value, index) => {
    weighted += (2 * (index + 1) - count - 1) * value;
  });
  return weighted / (count * total);
}

type BehaviorTally = {
  questions: number;
  uncertainty: number;
  challenges: number;
  invitations: number;
  builds: number;
  personalCriticism: number;
};

function spokenWords(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/'/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function countPattern(words: string, pattern: RegExp): number {
  if (!words) return 0;
  return [...words.matchAll(new RegExp(pattern.source, "g"))].length;
}

function countQuestions(words: string): number {
  if (!words) return 0;
  const phrases = [...words.matchAll(new RegExp(QUESTION_PHRASES.source, "g"))];
  const opens =
    QUESTION_START.test(words) &&
    !/^(do|does) not\b/.test(words) &&
    !/^(have|has) (been|a|the|to)\b/.test(words) &&
    !phrases.some((match) => match.index === 0);
  return phrases.length + (opens ? 1 : 0);
}

function behaviorSentences(text: string): string[] {
  const parts = text
    .split(/(?<=[.!?])\s+|\n+/)
    .map(spokenWords)
    .filter(Boolean);
  return parts.length > 0 ? parts : [spokenWords(text)].filter(Boolean);
}

function tallyBehaviors(text: string): BehaviorTally {
  return behaviorSentences(text).reduce<BehaviorTally>(
    (sum, words) => ({
      questions: sum.questions + countQuestions(words),
      uncertainty: sum.uncertainty + countPattern(words, UNCERTAINTY),
      challenges: sum.challenges + countPattern(words, CHALLENGE),
      invitations: sum.invitations + countPattern(words, INVITATION),
      builds: sum.builds + countPattern(words, BUILD),
      personalCriticism: sum.personalCriticism + countPattern(words, CRITICISM),
    }),
    { questions: 0, uncertainty: 0, challenges: 0, invitations: 0, builds: 0, personalCriticism: 0 },
  );
}

function flagsFor(text: string, tally: BehaviorTally): UtteranceFlags {
  return {
    decision: DECISION.test(text),
    criticism: tally.personalCriticism > 0,
    uncertainty: tally.uncertainty > 0,
    challenge: tally.challenges > 0,
    invitation: tally.invitations > 0,
    question: tally.questions > 0,
    build: tally.builds > 0,
  };
}

function canonical(name: string, roster: string[]): string {
  return roster.find((person) => samePerson(person, name)) ?? name.trim();
}

function extractNorms(charter: string): string[] {
  return charter
    .split("\n")
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter((line) => line.length > 12 && line.length < 180)
    .filter((line) => !/^team |^purpose:/i.test(line))
    .slice(0, 6);
}

function extractRoles(charter: string): { name: string; role: string }[] {
  const pattern =
    /\b([A-Z][a-z]+)\s+(facilitates|holds|tracks|watches|owns|leads)\b([^.]*)/g;
  const roles: { name: string; role: string }[] = [];
  for (const match of charter.matchAll(pattern)) {
    const detail = match[3].replace(/^the\s+/i, "").trim();
    const role = detail ? `${match[2]} ${detail}` : match[2];
    roles.push({ name: match[1], role: role.replace(/\s+/g, " ") });
  }
  return roles;
}

function parseNotes(raw: string): { name: string; note: string }[] {
  const turns = parseTranscript(raw);
  if (turns.length > 0) {
    return turns.map((turn) => ({ name: turn.speaker, note: turn.text }));
  }
  return [];
}

function noteFit(
  speaker: SpeakerReport,
  decisionIndex: number | null,
): string | null {
  if (!speaker.note) return null;
  const note = speaker.note.toLowerCase();
  const late =
    decisionIndex !== null &&
    speaker.firstIndex !== null &&
    speaker.firstIndex > decisionIndex;
  if (
    /quiet|wait|until i am sure|hold back|thinking out loud/.test(note) &&
    (speaker.guidance === "invite" || late)
  ) {
    return "This note matches the meeting: they entered late or held a small share of the words.";
  }
  if (
    /fill silence|talk|jump in|stall/.test(note) &&
    speaker.guidance === "yield"
  ) {
    return "This note matches the meeting: they held the largest share of the floor.";
  }
  if (
    /frustrat|decide before|operations/.test(note) &&
    (speaker.challenges > 0 || speaker.personalCriticism > 0)
  ) {
    return "This note matches the meeting: they pushed on the decision, and one line aimed at a person.";
  }
  if (/dissent|disagree|if someone asks/.test(note) && (speaker.challenges > 0 || speaker.uncertainty > 0)) {
    return "They did raise a risk. The note about waiting to be asked fits a later entry.";
  }
  if (/numbers|assume others/.test(note)) {
    return "They spent time on the numbers. It is worth asking whether waiting for others to jump in still feels fair.";
  }
  return "Ask in the next meeting whether this note still feels true.";
}

function guidanceFor(
  name: string,
  share: number,
  turns: number,
  evenShare: number,
  quote: string | null,
  role: string | null,
): Pick<SpeakerReport, "guidance" | "guidanceTitle" | "guidanceBody" | "script"> {
  if (turns === 0) {
    const roleBit = role
      ? ` Their charter role is to ${role}.`
      : "";
    return {
      guidance: "absent",
      guidanceTitle: "Not heard",
      guidanceBody: `${name} is on the roster and did not speak.${roleBit}`,
      script: role
        ? `${name}, your role is to ${role}. What is one risk the rest of us have not named?`
        : `${name}, we have not heard your read yet. What is the part you are least sure about?`,
    };
  }
  if (share >= Math.max(HIGH_FLOOR, evenShare * HIGH_RATIO)) {
    return {
      guidance: "yield",
      guidanceTitle: "Pass the floor",
      guidanceBody: `${name} held ${percent(share)}% of the words in this meeting. Ask them to speak after two other people, and to end a turn with a question.`,
      script: `${name}, when you have made the point, pass it: "What are we missing?" I will go last on the recommendation.`,
    };
  }
  if (share <= evenShare * LOW_RATIO) {
    const hook = quote
      ? `Last time they said “${clip(quote, 90)}.” Start there.`
      : role
        ? `Use the charter role (${role}) instead of commenting on how quiet they were.`
        : "Invite the work, not the silence.";
    return {
      guidance: "invite",
      guidanceTitle: "Invite in",
      guidanceBody: `${name} held ${percent(share)}% of the words. ${hook}`,
      script: quote
        ? `${name}, you said “${clip(quote, 80)}.” What would have to be true for you to support this?`
        : `${name}, before we choose, what is the risk you would want on the slide?`,
    };
  }
  return {
    guidance: "steady",
    guidanceTitle: "Steady share",
    guidanceBody: `${name} held ${percent(share)}% of the words, near an even share of ${percent(evenShare)}%. Keep asking them to build on other people, not only to report their own piece.`,
    script: `${name}, what did you hear from someone else that should change our recommendation?`,
  };
}

export function analyzeMeeting(input: {
  transcript: string;
  charter?: string;
  breakout?: string;
  notes?: string;
  roster?: string;
}): AnalyzeResult {
  const roster = parseRoster(input.roster ?? "");
  const drafts = parseTranscript(input.transcript);
  if (drafts.length === 0) {
    return {
      ok: false,
      error:
        "No speaker turns found. Start each turn with a name and a colon or hyphen, like “Priya: The rent is the risk.” or “Priya - The rent is the risk.” Zoom, Teams, Otter (.vtt or .txt), and .srt files work too.",
    };
  }

  const known = [...roster];
  for (const draft of drafts) {
    if (!known.some((name) => samePerson(name, draft.speaker))) known.push(draft.speaker);
  }
  if (known.length < 2) {
    return {
      ok: false,
      error:
        "This transcript has only one speaker. Add the rest of the team to the roster, or use a transcript where each person has a name, then a colon or hyphen.",
    };
  }

  const tallies = drafts.map((draft) => tallyBehaviors(draft.text));
  const utterances: Utterance[] = drafts.map((draft, index) => ({
    speaker: canonical(draft.speaker, known),
    text: draft.text,
    index,
    words: countWords(draft.text),
    startMs: draft.startMs,
    flags: flagsFor(draft.text, tallies[index]),
  }));

  const notes = parseNotes(input.notes ?? "");
  const roles = extractRoles(input.charter ?? "");
  const totalWords = utterances.reduce((sum, turn) => sum + turn.words, 0);
  const evenShare = 1 / known.length;

  const decisionTurn = utterances.find((turn) => turn.flags.decision) ?? null;
  const heardBefore = decisionTurn
    ? unique(
        utterances
          .filter((turn) => turn.index < decisionTurn.index)
          .map((turn) => turn.speaker),
      )
    : [];
  const missed = decisionTurn
    ? known.filter((name) => !heardBefore.some((heard) => samePerson(heard, name)))
    : [];
  const spokeLater = missed.filter((name) =>
    utterances.some((turn) => samePerson(turn.speaker, name)),
  );

  const speakers: SpeakerReport[] = known.map((name) => {
    const turns = utterances.filter((turn) => samePerson(turn.speaker, name));
    const words = turns.reduce((sum, turn) => sum + turn.words, 0);
    const share = totalWords === 0 ? 0 : words / totalWords;
    const quote =
      turns.find((turn) => turn.flags.uncertainty)?.text ??
      turns.find((turn) => turn.flags.challenge)?.text ??
      turns.find((turn) => turn.flags.criticism)?.text ??
      turns[0]?.text ??
      null;
    const role = roles.find((item) => samePerson(item.name, name))?.role ?? null;
    const base = guidanceFor(name, share, turns.length, evenShare, quote, role);
    const report: SpeakerReport = {
      name,
      turns: turns.length,
      words,
      wordShare: share,
      questions: turns.reduce((sum, turn) => sum + tallies[turn.index].questions, 0),
      builds: turns.reduce((sum, turn) => sum + tallies[turn.index].builds, 0),
      challenges: turns.reduce((sum, turn) => sum + tallies[turn.index].challenges, 0),
      uncertainty: turns.reduce((sum, turn) => sum + tallies[turn.index].uncertainty, 0),
      invitations: turns.reduce((sum, turn) => sum + tallies[turn.index].invitations, 0),
      personalCriticism: turns.reduce((sum, turn) => sum + tallies[turn.index].personalCriticism, 0),
      firstIndex: turns[0]?.index ?? null,
      quote: quote ? clip(quote, 180) : null,
      note: notes.find((item) => samePerson(item.name, name))?.note ?? null,
      noteFit: null,
      role,
      ...base,
    };
    report.noteFit = noteFit(report, decisionTurn?.index ?? null);
    return report;
  });

  const equality = Math.round((1 - gini(speakers.map((speaker) => speaker.words))) * 100);
  const safety = scoreSafety(speakers);
  const charter = scoreCharter({
    charter: input.charter ?? "",
    speakers,
    hasTimestamps: utterances.some((turn) => turn.startMs !== null),
  });
  const breakout = scoreBreakout(input.breakout ?? "", {
    equality,
    missed,
    decisionQuote: decisionTurn ? sentenceWith(decisionTurn.text, DECISION, 140) : null,
  });

  const analysis: Analysis = {
    utterances,
    speakers,
    rosterUsed: roster.length > 0,
    totalWords,
    totalTurns: utterances.length,
    equality,
    gini: gini(speakers.map((speaker) => speaker.words)),
    evenShare,
    safety,
    charter,
    breakout,
    decision: {
      found: Boolean(decisionTurn),
      index: decisionTurn?.index ?? null,
      quote: decisionTurn ? sentenceWith(decisionTurn.text, DECISION, 180) : null,
      speaker: decisionTurn?.speaker ?? null,
      heardBefore,
      missed,
      spokeLater,
    },
    leaderMove: chooseMove(speakers, {
      found: Boolean(decisionTurn),
      quote: decisionTurn ? sentenceWith(decisionTurn.text, DECISION, 140) : null,
      speaker: decisionTurn?.speaker ?? null,
      missed,
      spokeLater,
      everyoneBefore: /everyone speaks|before we decide|round-?robin|all voices|hear from everyone/i.test(
        input.charter ?? "",
      ),
      charterProvided: Boolean(input.charter?.trim()),
    }),
    cohesion: scoreCohesion({
      speakers,
      equality,
      charterFit: charter.fit,
      charterGaps: charter.gaps,
      decision: {
        found: Boolean(decisionTurn),
        missed,
        spokeLater,
        speaker: decisionTurn?.speaker ?? null,
        quote: decisionTurn ? sentenceWith(decisionTurn.text, DECISION, 140) : null,
      },
    }),
  };

  return { ok: true, analysis };
}

function unique(names: string[]): string[] {
  const list: string[] = [];
  for (const name of names) {
    if (!list.some((item) => samePerson(item, name))) list.push(name);
  }
  return list;
}

function scoreSafety(speakers: SpeakerReport[]): Analysis["safety"] {
  const speaking = speakers.filter((speaker) => speaker.turns > 0);
  const count = speaking.length || 1;
  const uncertainPeople = speaking.filter((speaker) => speaker.uncertainty > 0).length;
  const challengePeople = speaking.filter((speaker) => speaker.challenges > 0).length;
  const questions = speaking.reduce((sum, speaker) => sum + speaker.questions, 0);
  const criticisms = speaking.reduce((sum, speaker) => sum + speaker.personalCriticism, 0);
  const uncertainty = Math.round(Math.min(25, (uncertainPeople / count) * 50));
  const challenge = Math.round(Math.min(25, (challengePeople / count) * 50));
  const questionPoints = Math.round(Math.min(25, (questions / count) * 12.5));
  const respect = criticisms === 0 ? 25 : criticisms === 1 ? 10 : 0;
  const score = uncertainty + challenge + questionPoints + respect;
  const uncertainNames = speaking
    .filter((speaker) => speaker.uncertainty > 0)
    .map((speaker) => speaker.name);
  const summary =
    uncertainNames.length === 0
      ? "Almost nobody admitted uncertainty or asked a question. That pattern makes it harder to tell whether people felt able to think out loud."
      : `Uncertainty showed up from ${humanList(uncertainNames)}. ${
          criticisms > 0
            ? "One remark aimed at a person rather than the idea, so task debate and personal criticism are both in this meeting."
            : "Disagreement stayed on the idea."
        }`;
  return {
    score,
    uncertainty,
    challenge,
    questions: questionPoints,
    respect,
    summary,
  };
}

function scoreCharter(input: {
  charter: string;
  speakers: SpeakerReport[];
  hasTimestamps: boolean;
}): Analysis["charter"] {
  const text = input.charter.trim();
  if (!text) {
    return {
      provided: false,
      norms: [],
      gaps: [],
      fit: null,
      unchecked: null,
    };
  }
  const everyone = /everyone speaks|before we decide|round-?robin|all voices|hear from everyone/i.test(
    text,
  );
  const noPersonal = /not the person|disagree with the idea|no personal/i.test(text);
  const timeLimit = /more than \w+ minutes|two minutes|holds the floor/i.test(text);
  const gaps: CharterGap[] = [];
  let fit = 100;

  const quiet = input.speakers.filter(
    (speaker) => speaker.turns > 0 && speaker.wordShare <= input.speakers.length ** -1 * LOW_RATIO,
  );
  if (everyone && quiet.length > 0) {
    fit -= 25;
    gaps.push({
      title: "Uneven voice",
      detail: `${humanList(quiet.map((speaker) => speaker.name))} held well under an even share of the words.`,
    });
  }
  const critics = input.speakers.filter((speaker) => speaker.personalCriticism > 0);
  if (noPersonal && critics.length > 0) {
    fit -= 20;
    gaps.push({
      title: "Remark aimed at a person",
      detail: `${humanList(critics.map((speaker) => speaker.name))} used language aimed at a teammate (“you always”), not only at the idea.`,
    });
  }
  const invitations = input.speakers.reduce((sum, speaker) => sum + speaker.invitations, 0);
  if (everyone && invitations === 0) {
    fit -= 10;
    gaps.push({
      title: "No one passed the floor",
      detail: "The charter asks for broad voice, and nobody invited another person in.",
    });
  }

  return {
    provided: true,
    norms: extractNorms(text),
    gaps,
    fit: Math.max(0, fit),
    unchecked:
      timeLimit && !input.hasTimestamps
        ? "The charter mentions a time limit. This transcript has no timestamps, so minutes on the floor were not checked. Word share is the stand-in."
        : null,
  };
}

function scoreBreakout(
  raw: string,
  context: { equality: number; missed: string[]; decisionQuote: string | null },
): Analysis["breakout"] {
  const text = raw.trim();
  if (!text) {
    return {
      provided: false,
      themes: [],
      alignment:
        "Add Breakout Learning feedback if you have it. The coach will say whether the simulation and this meeting tell the same story.",
    };
  }
  const themes = text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) =>
      /strength|growth|peer|participat|challenge|quiet|score|collaboration/i.test(line),
    )
    .slice(0, 4);
  const uneven = /uneven|quiet|dominat|carried the discussion/i.test(text);
  const wantsChallenge = /challenge the first|before the group locked|speak up/i.test(text);
  let alignment = "Breakout feedback is loaded. Compare the themes below with the floor and the first decision line.";
  if (uneven && (context.equality < 85 || context.missed.length > 0)) {
    alignment = `Breakout feedback said voice was uneven. This meeting agrees${
      context.decisionQuote
        ? `: the first decision line was “${context.decisionQuote}”`
        : ""
    }${
      context.missed.length > 0
        ? `, before ${humanList(context.missed)} had spoken.`
        : "."
    }`;
  } else if (uneven) {
    alignment =
      "Breakout feedback flagged uneven voice, but this transcript is more balanced. Ask which setting felt harder, the simulation or the live meeting.";
  }
  if (wantsChallenge && context.missed.length > 0) {
    alignment += " The peer note about challenging the first idea also matches: the choice started before the round was finished.";
  }
  return { provided: true, themes, alignment };
}

function chooseMove(
  speakers: SpeakerReport[],
  decision: {
    found: boolean;
    quote: string | null;
    speaker: string | null;
    missed: string[];
    spokeLater: string[];
    everyoneBefore: boolean;
    charterProvided: boolean;
  },
): Analysis["leaderMove"] {
  if (decision.found && decision.missed.length > 0) {
    return {
      lens: decision.everyoneBefore || decision.charterProvided ? "Charter" : "Floor",
      title: "Open the next meeting before anyone pitches",
      why: `${decision.speaker} moved to a choice with “${decision.quote}” before ${humanList(decision.missed)} had spoken. ${
        decision.spokeLater.length > 0
          ? `${humanList(decision.spokeLater)} did enter later, after the first close.`
          : "Some people never got a turn."
      }`,
      script:
        "Before anyone argues for a recommendation, we will go around once. Each person names the biggest risk they see. I will go last. We will not say “let’s go with” until that round is done.",
    };
  }

  const critic = speakers.find((speaker) => speaker.personalCriticism > 0);
  if (critic?.quote) {
    return {
      lens: "Learning signals",
      title: "Keep the challenge, drop the label",
      why: `${critic.name} challenged the work and also said “${clip(critic.quote, 120)}.” Task disagreement can help. A remark about the person makes the next risk harder to say.`,
      script: `${critic.name}, the operations point mattered. Next time, aim it at the plan: “The machine cannot cover both shops.” I will back that kind of pushback.`,
    };
  }

  const quiet = [...speakers]
    .filter((speaker) => speaker.guidance === "invite" || speaker.guidance === "absent")
    .sort((a, b) => a.wordShare - b.wordShare)[0];
  if (quiet) {
    return {
      lens: "Floor",
      title: `Invite ${quiet.name} in by the work`,
      why: quiet.guidanceBody,
      script: quiet.script,
    };
  }

  const loud = speakers.find((speaker) => speaker.guidance === "yield");
  if (loud) {
    return {
      lens: "Floor",
      title: `Ask ${loud.name} to pass the floor`,
      why: loud.guidanceBody,
      script: loud.script,
    };
  }

  return {
    lens: "Next launch",
    title: "Protect what already worked",
    why: "This meeting was relatively even, and the tool did not find an early close that shut people out. Use the next opening to ask what the team wants to repeat.",
    script:
      "Before we start the work, each person names one thing from last meeting we should repeat, and one thing we should change. I will go last.",
  };
}
