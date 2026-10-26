import { humanList, percent } from "./format";
import type { Analysis, SpeakerReport } from "./types";

export type Cohesion = {
  score: number;
  summary: string;
  improvements: { title: string; detail: string }[];
};

type Piece = { title: string; detail: string; rank: number };

export function scoreCohesion(input: {
  speakers: SpeakerReport[];
  equality: number;
  charterFit: number | null;
  charterGaps: Analysis["charter"]["gaps"];
  decision: Pick<Analysis["decision"], "found" | "missed" | "spokeLater" | "speaker" | "quote">;
}): Cohesion {
  const speaking = input.speakers.filter((speaker) => speaker.turns > 0);
  const count = Math.max(speaking.length, 1);
  const withCharter = input.charterFit !== null;
  const voiceMax = withCharter ? 25 : 30;
  const buildMax = withCharter ? 15 : 20;
  const inviteMax = 15;
  const debateMax = 20;
  const closeMax = withCharter ? 10 : 15;
  const builders = speaking.filter((speaker) => speaker.builds > 0).length;
  const inviters = speaking.filter((speaker) => speaker.invitations > 0).length;
  const challengers = speaking.filter((speaker) => speaker.challenges > 0).length;
  const criticisms = speaking.reduce((sum, speaker) => sum + speaker.personalCriticism, 0);
  const questions = speaking.reduce((sum, speaker) => sum + speaker.questions, 0);
  const unsure = speaking.filter((speaker) => speaker.uncertainty > 0).length;

  const voice = Math.round((input.equality / 100) * voiceMax);
  const build = Math.round(Math.min(buildMax, (builders / count) * buildMax * 2));
  const invite = Math.round(Math.min(inviteMax, (inviters / count) * inviteMax * 2));
  const debate =
    challengers > 0 && criticisms === 0
      ? debateMax
      : challengers > 0 && criticisms > 0
        ? Math.round(debateMax * 0.4)
        : criticisms > 0
          ? 0
          : Math.round(debateMax * 0.5);
  const neverHeard = input.decision.missed.filter(
    (name) => !input.decision.spokeLater.some((later) => later === name),
  );
  const close = !input.decision.found
    ? Math.round(closeMax * 0.55)
    : input.decision.missed.length === 0
      ? closeMax
      : neverHeard.length === 0
        ? Math.round(closeMax * 0.4)
        : 0;
  const norms = withCharter ? Math.round((input.charterFit ?? 0) * 0.15) : 0;
  const score = clamp(voice + build + invite + debate + close + norms);

  return {
    score,
    summary: reading(score, {
      equality: input.equality,
      criticisms,
      challengers,
      missed: input.decision.missed,
      found: input.decision.found,
    }),
    improvements: fiveImprovements({
      speakers: input.speakers,
      builders,
      inviters,
      challengers,
      criticisms,
      questions,
      unsure,
      count,
      charterFit: input.charterFit,
      charterGaps: input.charterGaps,
      decision: input.decision,
    }),
  };
}

function reading(
  score: number,
  facts: {
    equality: number;
    criticisms: number;
    challengers: number;
    missed: string[];
    found: boolean;
  },
): string {
  const pulls: string[] = [];
  if (facts.equality < 70) pulls.push("voice was uneven");
  if (facts.criticisms > 0) pulls.push("a remark aimed at a person");
  if (facts.found && facts.missed.length > 0) {
    pulls.push(`the first close came before ${humanList(facts.missed)} had spoken`);
  }
  if (facts.challengers === 0 && facts.criticisms === 0) pulls.push("the idea was not pushed on");
  const lead =
    score >= 80
      ? "This meeting held together."
      : score >= 60
        ? "The group worked as a team in places."
        : "The conversation did not yet hold together as one team.";
  return pulls.length > 0 ? `${lead} It is lower because ${humanList(pulls)}.` : `${lead} The notes below are the next stretches.`;
}

function fiveImprovements(input: {
  speakers: SpeakerReport[];
  builders: number;
  inviters: number;
  challengers: number;
  criticisms: number;
  questions: number;
  unsure: number;
  count: number;
  charterFit: number | null;
  charterGaps: Analysis["charter"]["gaps"];
  decision: Pick<Analysis["decision"], "found" | "missed" | "spokeLater" | "speaker" | "quote">;
}): Cohesion["improvements"] {
  const pieces: Piece[] = [];
  const absent = input.speakers.filter((speaker) => speaker.guidance === "absent");
  const quiet = input.speakers.filter((speaker) => speaker.guidance === "invite");
  const loud = [...input.speakers].filter((speaker) => speaker.guidance === "yield").sort((a, b) => b.wordShare - a.wordShare)[0];
  const critics = input.speakers.filter((speaker) => speaker.personalCriticism > 0);

  if (absent.length > 0) {
    pieces.push({
      rank: 1,
      title: `Hear from ${humanList(absent.map((speaker) => speaker.name))}`,
      detail: `${humanList(absent.map((speaker) => speaker.name))} ${absent.length === 1 ? "is" : "are"} on the roster and did not speak. Ask for one risk before anyone recommends an option.`,
    });
  }
  if (critics.length > 0) {
    pieces.push({
      rank: 2,
      title: "Aim the point at the work",
      detail: `${humanList(critics.map((speaker) => speaker.name))} aimed a line at a person. Keep the objection, and restate it about the plan next time.`,
    });
  }
  if (input.decision.found && input.decision.missed.length > 0) {
    pieces.push({
      rank: 3,
      title: "Close after everyone has spoken",
      detail: `${input.decision.speaker ?? "Someone"} moved to a choice with “${input.decision.quote}” before ${humanList(input.decision.missed)} had spoken. Finish one round before that kind of line.`,
    });
  }
  if (loud) {
    pieces.push({
      rank: 4,
      title: `Ask ${loud.name} to pass the floor`,
      detail: `${loud.name} held ${percent(loud.wordShare)}% of the words. Have them speak after two other people and end the turn with a question.`,
    });
  }
  if (quiet.length > 0) {
    pieces.push({
      rank: 5,
      title: `Invite ${humanList(quiet.map((speaker) => speaker.name))} in by the work`,
      detail: `${humanList(quiet.map((speaker) => speaker.name))} held a small share of the words. Start from something they already said, and ask what would have to be true for them to support the choice.`,
    });
  }
  if (input.inviters === 0 && input.count > 1) {
    pieces.push({
      rank: 6,
      title: "Ask someone else in",
      detail: "Nobody invited another person into the turn. End one comment with “What are we missing?”",
    });
  }
  if (input.builders * 2 < input.count && input.count >= 3) {
    pieces.push({
      rank: 7,
      title: "Build on the last idea",
      detail: "Most turns added a separate piece. Ask the next person to say what they are adding to before they introduce a new point.",
    });
  }
  if (input.unsure === 0 && input.count > 1) {
    pieces.push({
      rank: 8,
      title: "Say what is unsure",
      detail: "Nobody said they were unsure. Ask each person for the part they are least sure about before the group chooses.",
    });
  }
  if (input.questions < input.count && input.count > 1) {
    pieces.push({
      rank: 9,
      title: "Ask before the recommendation",
      detail: "Questions were scarce for the size of the group. Require one question in the round before anyone recommends an option.",
    });
  }
  if (input.challengers === 0 && input.count > 1) {
    pieces.push({
      rank: 10,
      title: "Push on the idea",
      detail: "The idea was not challenged. Name one risk, and keep that push on the plan rather than on a teammate.",
    });
  }
  const gap = input.charterGaps.find((item) => item.title !== "Uneven voice" && item.title !== "Remark aimed at a person");
  if (gap) {
    pieces.push({ rank: 11, title: gap.title, detail: gap.detail });
  }
  if (input.charterFit === null) {
    pieces.push({
      rank: 12,
      title: "Check the meeting against the charter",
      detail: "No charter was pasted, so shared norms were not part of this score. Add the norms about voice and decisions, then analyze again.",
    });
  }
  if (!input.decision.found) {
    pieces.push({
      rank: 13,
      title: "Name the decision in one sentence",
      detail: "The transcript did not contain a clear close. Say the choice out loud, with the condition that would change it, before the meeting ends.",
    });
  }
  pieces.push({
    rank: 14,
    title: "Name what to repeat",
    detail: "Open the next meeting by asking each person for one practice from this meeting to keep, and one to change. The facilitator goes last.",
  });
  pieces.push({
    rank: 15,
    title: "Put an owner and a day on each commitment",
    detail: "Before ending, write who will do the work and which day it is due, so the next meeting starts from the same list.",
  });

  return pieces
    .sort((a, b) => a.rank - b.rank)
    .slice(0, 5)
    .map(({ title, detail }) => ({ title, detail }));
}

function clamp(value: number): number {
  return Math.max(0, Math.min(100, value));
}
