export type Guidance = "yield" | "invite" | "steady" | "absent";

export type UtteranceFlags = {
  decision: boolean;
  criticism: boolean;
  uncertainty: boolean;
  challenge: boolean;
  invitation: boolean;
  question: boolean;
  build: boolean;
};

export type Utterance = {
  speaker: string;
  text: string;
  index: number;
  words: number;
  startMs: number | null;
  flags: UtteranceFlags;
};

export type SpeakerReport = {
  name: string;
  turns: number;
  words: number;
  wordShare: number;
  questions: number;
  builds: number;
  challenges: number;
  uncertainty: number;
  invitations: number;
  personalCriticism: number;
  firstIndex: number | null;
  guidance: Guidance;
  guidanceTitle: string;
  guidanceBody: string;
  script: string;
  quote: string | null;
  note: string | null;
  noteFit: string | null;
  role: string | null;
};

export type CharterGap = {
  title: string;
  detail: string;
};

export type Analysis = {
  utterances: Utterance[];
  speakers: SpeakerReport[];
  rosterUsed: boolean;
  totalWords: number;
  totalTurns: number;
  equality: number;
  gini: number;
  evenShare: number;
  safety: {
    score: number;
    uncertainty: number;
    challenge: number;
    questions: number;
    respect: number;
    summary: string;
  };
  charter: {
    provided: boolean;
    norms: string[];
    gaps: CharterGap[];
    fit: number | null;
    unchecked: string | null;
  };
  breakout: {
    provided: boolean;
    themes: string[];
    alignment: string;
  };
  decision: {
    found: boolean;
    index: number | null;
    quote: string | null;
    speaker: string | null;
    heardBefore: string[];
    missed: string[];
    spokeLater: string[];
  };
  leaderMove: {
    title: string;
    why: string;
    script: string;
    lens: string;
  };
  cohesion: {
    score: number;
    summary: string;
    improvements: { title: string; detail: string }[];
  };
};

export type AnalyzeResult =
  | { ok: true; analysis: Analysis }
  | { ok: false; error: string };

export type CoachReply = {
  text: string;
  cites: string[];
};
