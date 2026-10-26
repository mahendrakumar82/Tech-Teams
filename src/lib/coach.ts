import { clip, humanList, percent, samePerson, sentenceWith } from "./format";
import type { Analysis, CoachReply, SpeakerReport } from "./types";

const GENERIC_NAME = new Set([
  "meeting",
  "recording",
  "team",
  "speaker",
  "the",
  "and",
  "from",
  "note",
  "transcript",
]);

function mentions(question: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(question);
}

function nameParts(name: string): string[] {
  return name
    .split(/\s+/)
    .filter((part) => part.length > 2 && !GENERIC_NAME.has(part.toLowerCase()));
}

export function firstName(name: string): string {
  return nameParts(name)[0] ?? name;
}

function personReply(speaker: SpeakerReport, analysis: Analysis): CoachReply {
  const even = percent(analysis.evenShare);
  const share = percent(speaker.wordShare);
  const late =
    analysis.decision.found && analysis.decision.missed.some((name) => samePerson(name, speaker.name))
      ? ` They had not spoken yet when the first close landed.`
      : "";
  return {
    text: `${speaker.name} held ${share}% of the words across ${speaker.turns} turns. An even share was about ${even}%.${late} ${speaker.script}`,
    cites: speaker.quote ? [clip(speaker.quote, 140)] : [],
  };
}

function dominateReply(speaker: SpeakerReport, analysis: Analysis): CoachReply {
  const share = percent(speaker.wordShare);
  const even = percent(analysis.evenShare);
  const dominating = speaker.guidance === "yield" || speaker.wordShare >= analysis.evenShare * 1.45;
  const quiet = speaker.guidance === "invite" || speaker.guidance === "absent" || speaker.turns === 0;
  const answer = speaker.turns === 0
    ? `No. ${speaker.name} did not speak.`
    : dominating
      ? `Yes. ${speaker.name} held ${share}% of the words, above an even share of about ${even}%.`
      : quiet
        ? `No. ${speaker.name} held ${share}% of the words, under an even share of about ${even}%.`
        : `No. ${speaker.name} held ${share}% of the words, close to an even share of about ${even}%.`;
  return { text: answer, cites: speaker.quote ? [clip(speaker.quote, 120)] : [] };
}

function coverReply(speaker: SpeakerReport, analysis: Analysis): CoachReply {
  if (speaker.turns === 0) {
    return { text: `No. ${speaker.name} did not speak, so none of their points are in the transcript.`, cites: [] };
  }
  const moves = [
    speaker.questions > 0 ? "asked a question" : "",
    speaker.challenges > 0 ? "pushed on an idea" : "",
    speaker.builds > 0 ? "built on someone else" : "",
    speaker.uncertainty > 0 ? "named something unsure" : "",
    speaker.invitations > 0 ? "invited someone in" : "",
  ].filter(Boolean);
  const late = analysis.decision.found && analysis.decision.missed.some((name) => samePerson(name, speaker.name));
  const did = moves.length > 0 ? `They ${humanList(moves)}.` : "Their turns did not include a question, a challenge, or a build.";
  const timing = late ? " They spoke after the first close, so those points arrived late." : "";
  return {
    text: `${speaker.name} spoke ${speaker.turns} time${speaker.turns === 1 ? "" : "s"}. There is no private agenda in the file, so this is what they put on the table. ${did}${timing}`,
    cites: speaker.quote ? [clip(speaker.quote, 140)] : [],
  };
}

function clarityReply(speaker: SpeakerReport, analysis: Analysis): CoachReply {
  const lines = analysis.utterances.filter((turn) => samePerson(turn.speaker, speaker.name));
  const text = lines.map((turn) => turn.text).join(" ");
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  if (words < 12) {
    return {
      text: `${speaker.name} did not say enough to judge. Clarity here is read from the words, not from the audio.`,
      cites: [],
    };
  }
  const fillers = text.match(/\b(uh+|um+|er+|ah+|hmm+|you know|kind of|sort of|kinda|basically)\b/gi)?.length ?? 0;
  const perHundred = (fillers / words) * 100;
  const clear = perHundred < 4;
  return {
    text: clear
      ? `Yes, from the words. ${speaker.name}'s lines are in full phrases, with few fillers. This does not judge pronunciation, because the audio was not scored.`
      : `The wording looks hesitant. ${speaker.name} used filler words often enough that the lines are harder to follow. This is from the transcript, not a judgment of their voice.`,
    cites: speaker.quote ? [clip(speaker.quote, 120)] : [],
  };
}

function participationReply(analysis: Analysis): CoachReply {
  const loud = [...analysis.speakers].sort((a, b) => b.wordShare - a.wordShare)[0];
  const quiet = [...analysis.speakers].sort((a, b) => a.wordShare - b.wordShare)[0];
  const cites = [analysis.decision.quote, quiet.quote, loud.quote].filter(
    (item): item is string => Boolean(item),
  );
  if (analysis.equality >= 85 && analysis.decision.missed.length === 0) {
    return {
      text: `This meeting was relatively even (floor equality ${analysis.equality}). An even share would be about ${percent(analysis.evenShare)}% of the words. Ask the team what they want to protect next time, and keep the practice of you speaking last on the recommendation.`,
      cites: [],
    };
  }
  const missed = analysis.decision.missed.length
    ? ` The first decision line arrived before ${humanList(analysis.decision.missed)} had spoken.`
    : "";
  return {
    text: [
      `An even share would have been about ${percent(analysis.evenShare)}% of the words. ${loud.name} held ${percent(loud.wordShare)}% across ${loud.turns} turns. ${quiet.name} held ${percent(quiet.wordShare)}%. Floor equality for the meeting is ${analysis.equality}.${missed}`,
      `Invite ${quiet.name} through the work, using something they already said or their charter role. ${quiet.script}`,
      `Ask ${loud.name} to pass the floor: they speak after two other people and end the turn with a question. You go last, and nobody says “let’s go with” until each person has named one risk.`,
    ].join("\n\n"),
    cites: [...new Set(cites.map((item) => clip(item, 150)))].slice(0, 3),
  };
}

const STOP = new Set([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "her", "was", "one", "our",
  "out", "has", "have", "had", "been", "were", "did", "does", "doing", "what", "when", "where",
  "which", "who", "why", "how", "this", "that", "with", "from", "they", "them", "their", "his",
  "hers", "she", "him", "into", "about", "your", "just", "like", "than", "then", "also", "any",
  "anyone", "anything", "something", "please", "tell", "give", "short", "meeting", "transcript",
  "said", "say", "says", "talk", "talked", "speak", "spoke", "mention", "mentioned", "there",
  "here", "would", "could", "should", "will", "shall", "its", "it's", "very", "really", "more",
  "most", "some", "such", "only", "over", "after", "before", "during", "while", "because",
  "ask", "asked", "question", "questions", "team", "people", "person", "someone", "anybody",
  "actually", "exactly", "specifically", "bring", "brought", "being", "came", "come", "going", "make", "made",
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function contentWords(question: string, speakers: SpeakerReport[]): string[] {
  const names = new Set(speakers.flatMap((speaker) => speaker.name.toLowerCase().split(/\s+/)));
  const seen = new Set<string>();
  const words: string[] = [];
  for (const word of question.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/)) {
    if (word.length < 3 || STOP.has(word) || names.has(word) || seen.has(word)) continue;
    seen.add(word);
    words.push(word);
  }
  return words;
}

function wordHit(text: string, word: string): boolean {
  return new RegExp(`\\b${escapeRegExp(word)}`, "i").test(text);
}

function speakersNamed(question: string, speakers: SpeakerReport[]): SpeakerReport[] {
  return speakers
    .map((speaker) => {
      const full = mentions(question, speaker.name);
      const part = nameParts(speaker.name).some((part) => mentions(question, part));
      return { speaker, score: full ? 2 : part ? 1 : 0 };
    })
    .filter((hit) => hit.score > 0)
    .sort((a, b) => b.score - a.score || b.speaker.name.length - a.speaker.name.length)
    .map((hit) => hit.speaker);
}

function bestSentence(text: string, words: string[]): string {
  const sentences = text.split(/(?<=[.!?])\s+/).map((sentence) => sentence.trim()).filter(Boolean);
  if (sentences.length === 0) return clip(text, 160);
  let best = sentences[0];
  let bestScore = -1;
  for (const sentence of sentences) {
    const score = words.reduce((total, word) => total + (wordHit(sentence, word) ? word.length : 0), 0);
    if (score > bestScore) {
      best = sentence;
      bestScore = score;
    }
  }
  return clip(best, 160);
}

function whatTheySaid(speakers: SpeakerReport[]): CoachReply {
  const lines = speakers.slice(0, 3).map((speaker) => {
    if (speaker.turns === 0) return `${speaker.name} was listed and did not speak.`;
    const quote = speaker.quote ? ` “${clip(speaker.quote, 140)}”` : "";
    return `${speaker.name} held ${percent(speaker.wordShare)}% of the words across ${speaker.turns} turns.${quote}`;
  });
  return {
    text: lines.join(" "),
    cites: speakers.map((speaker) => speaker.quote).filter((quote): quote is string => Boolean(quote)).slice(0, 3).map((quote) => clip(quote, 140)),
  };
}

const DECISION_LINE = /\b(let(?:['’]s| us) go with|we(?:['’]ll| will) go with|i think we should go with|that is the decision|that(?:['’]s| is) the decision|final decision|we decided|lock (?:it|this) in)\b/i;

function decisionReply(analysis: Analysis): CoachReply {
  const turns = analysis.utterances.filter((turn) => turn.flags.decision);
  if (turns.length === 0) {
    return {
      text: "No decision line is in this transcript. Nobody said “let’s go with” or “that is the decision.”",
      cites: [],
    };
  }
  const line = (turn: (typeof turns)[number]) => sentenceWith(turn.text, DECISION_LINE, 150);
  const last = turns[turns.length - 1];
  const early =
    turns.length > 1 ? `${turns[0].speaker} moved toward a choice earlier: “${line(turns[0])}”. ` : "";
  const missed = analysis.decision.missed.length
    ? ` The first close came before ${humanList(analysis.decision.missed)} had spoken.`
    : "";
  return {
    text: `${early}The decision on the record is from ${last.speaker}: “${line(last)}”.${missed}`,
    cites: turns.slice(-2).map((turn) => line(turn)),
  };
}

function disagreementReply(analysis: Analysis): CoachReply {
  const turns = analysis.utterances.filter((turn) => turn.flags.challenge || turn.flags.criticism);
  if (turns.length === 0) {
    return {
      text: "Nobody pushed back. The transcript has no disagreement with an idea and no remark aimed at a person.",
      cites: [],
    };
  }
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const turn of turns) {
    if (seen.has(turn.speaker)) continue;
    seen.add(turn.speaker);
    const kind = turn.flags.criticism ? "aimed part of a line at a person" : "pushed on the idea";
    lines.push(`${turn.speaker} ${kind}: “${clip(turn.text, 140)}”`);
    if (lines.length === 3) break;
  }
  return { text: lines.join(" "), cites: turns.slice(0, 3).map((turn) => clip(turn.text, 140)) };
}

function riskReply(analysis: Analysis): CoachReply {
  const pattern = /\brisks?|downsides?|worries|worried|concerns?|not sure|unsure|might be wrong|stuck\b/i;
  const turns = analysis.utterances.filter((turn) => pattern.test(turn.text) || turn.flags.uncertainty);
  if (turns.length === 0) {
    return { text: "Nobody named a risk, a downside, or something they were unsure about.", cites: [] };
  }
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const turn of turns) {
    if (seen.has(turn.speaker)) continue;
    seen.add(turn.speaker);
    lines.push(`${turn.speaker}: “${bestSentence(turn.text, ["risk", "downside", "unsure", "sure", "stuck", "wrong"])}”`);
    if (lines.length === 3) break;
  }
  return {
    text: `Risks named in the meeting: ${lines.join(" ")}`,
    cites: turns.slice(0, 3).map((turn) => clip(turn.text, 140)),
  };
}

function commitmentReply(analysis: Analysis): CoachReply {
  const pattern = /\b(i will|i'll|i’ll|i can)\b/i;
  const turns = analysis.utterances.filter((turn) => pattern.test(turn.text));
  if (turns.length === 0) {
    return { text: "Nobody took a next step in so many words. No “I will” or “I can” line is in the transcript.", cites: [] };
  }
  const lines = turns.slice(-4).map((turn) => `${turn.speaker}: “${bestSentence(turn.text, ["will", "can"])}”`);
  return { text: `Next steps from the transcript: ${lines.join(" ")}`, cites: turns.slice(-3).map((turn) => clip(turn.text, 140)) };
}

function floorReply(analysis: Analysis): CoachReply {
  const ranked = [...analysis.speakers].sort((a, b) => b.wordShare - a.wordShare);
  const loud = ranked[0];
  const quiet = ranked[ranked.length - 1];
  const silent = analysis.speakers.filter((speaker) => speaker.turns === 0).map((speaker) => speaker.name);
  if (!loud) return { text: "No speakers were found in this transcript.", cites: [] };
  const silence = silent.length ? ` ${humanList(silent)} did not speak.` : "";
  return {
    text: `${loud.name} held the most words, ${percent(loud.wordShare)}% across ${loud.turns} turns. ${quiet && quiet.name !== loud.name ? `${quiet.name} held the least, ${percent(quiet.wordShare)}%.` : ""}${silence} An even share was about ${percent(analysis.evenShare)}%.`,
    cites: [loud.quote, quiet?.quote].filter((quote): quote is string => Boolean(quote)).map((quote) => clip(quote, 120)),
  };
}

function questionsReply(analysis: Analysis): CoachReply {
  const turns = analysis.utterances.filter((turn) => turn.flags.question);
  if (turns.length === 0) return { text: "No question showed up in the words people said.", cites: [] };
  const lines = turns.slice(0, 3).map((turn) => `${turn.speaker}: “${bestSentence(turn.text, ["what", "how", "who", "why", "do"])}”`);
  return { text: `Questions in the meeting: ${lines.join(" ")}`, cites: turns.slice(0, 3).map((turn) => clip(turn.text, 140)) };
}

function summaryReply(analysis: Analysis): CoachReply {
  const loud = [...analysis.speakers].sort((a, b) => b.wordShare - a.wordShare)[0];
  const opener = analysis.utterances[0];
  const decision = analysis.decision.found
    ? `${analysis.decision.speaker} put a decision on the record: “${clip(analysis.decision.quote ?? "", 120)}”.`
    : "No decision line was recorded.";
  const missed = analysis.decision.missed.length
    ? ` That first close came before ${humanList(analysis.decision.missed)} had spoken.`
    : "";
  const voice = loud ? `${loud.name} held ${percent(loud.wordShare)}% of the words.` : "";
  const start = opener ? `It opened with ${opener.speaker}: “${clip(opener.text, 110)}”.` : "";
  return {
    text: `${start} ${voice} ${decision}${missed} Team cohesiveness is ${analysis.cohesion.score} out of 100. ${analysis.cohesion.summary}`,
    cites: [opener?.text, analysis.decision.quote].filter((item): item is string => Boolean(item)).map((item) => clip(item, 140)),
  };
}

function retrievalReply(question: string, analysis: Analysis, named: SpeakerReport[]): CoachReply | null {
  const words = contentWords(question, analysis.speakers);
  if (words.length === 0) return named.length > 0 ? whatTheySaid(named) : null;
  const pool = named.length
    ? analysis.utterances.filter((turn) => named.some((speaker) => samePerson(turn.speaker, speaker.name)))
    : analysis.utterances;
  const rarity = new Map(words.map((word) => [word, pool.filter((turn) => wordHit(turn.text, word)).length]));
  const ranked = pool
    .map((turn) => {
      const score = words.reduce((total, word) => {
        const docs = rarity.get(word) ?? 0;
        if (docs === 0 || !wordHit(turn.text, word)) return total;
        return total + (1 / docs) * Math.min(word.length, 10);
      }, 0);
      return { turn, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score);
  if (ranked.length === 0) return null;
  const picked: typeof ranked = [];
  const seen = new Set<string>();
  for (const item of ranked) {
    if (seen.has(item.turn.speaker) && picked.length > 0) continue;
    seen.add(item.turn.speaker);
    picked.push(item);
    if (picked.length === 3) break;
  }
  const topic = words.slice(0, 4).join(", ");
  const lines = picked.map((item) => `${item.turn.speaker}: “${bestSentence(item.turn.text, words)}”`);
  const lead = named.length === 1 ? `Here is what ${named[0].name} said about ${topic}.` : `Here is what the transcript says about ${topic}.`;
  return { text: `${lead} ${lines.join(" ")}`, cites: picked.map((item) => clip(item.turn.text, 140)) };
}

function closestReading(analysis: Analysis, named: SpeakerReport[]): CoachReply {
  if (named.length > 0) {
    const lines = named.slice(0, 2).map((speaker) => {
      if (speaker.turns === 0 || !speaker.quote) return `${speaker.name} did not say those words.`;
      return `${speaker.name} did not use those words. They did say “${clip(speaker.quote, 140)}”`;
    });
    return { text: lines.join(" "), cites: named.map((speaker) => speaker.quote).filter((quote): quote is string => Boolean(quote)).slice(0, 2).map((quote) => clip(quote, 140)) };
  }
  const opener = analysis.utterances[0];
  const decision = analysis.decision.found
    ? ` The closest decision line is ${analysis.decision.speaker}: “${clip(analysis.decision.quote ?? "", 120)}”.`
    : " There is no decision line to attach it to.";
  const start = opener ? `Those words are not in the transcript. The meeting opened with ${opener.speaker}: “${clip(opener.text, 120)}”.` : "Those words are not in the transcript.";
  return { text: `${start}${decision}`, cites: opener ? [clip(opener.text, 140)] : [] };
}

export function openingBrief(analysis: Analysis): CoachReply {
  const turns = analysis.totalTurns;
  const people = analysis.speakers.filter((speaker) => speaker.turns > 0).length;
  return {
    text: `Ask anything about this meeting. I will answer from the ${turns} turns and ${people} people in the transcript.`,
    cites: [],
  };
}

export function askCoach(question: string, analysis: Analysis): CoachReply {
  const asked = question.trim();
  if (!asked) {
    return { text: "Ask anything about this meeting.", cites: [] };
  }

  const namedPeople = speakersNamed(asked, analysis.speakers);
  const named = namedPeople[0];
  if (named && /dominat|too much|hold the floor|talked the most|hog/i.test(asked)) {
    return dominateReply(named, analysis);
  }
  if (named && /cover|points|agenda|everything they|all (his|her|their) points/i.test(asked)) {
    return coverReply(named, analysis);
  }
  if (named && /clear|articulat|filler|hesitat|um\b|uh\b/i.test(asked)) {
    return clarityReply(named, analysis);
  }
  if (named && /\b(differently|next time|advice|improve)\b|should .+ do/i.test(asked)) {
    return personReply(named, analysis);
  }

  if (/\b(what (?:did|was|were).{0,48}(?:decid|agree|recommend)|(?:the|our|their) decision|outcome|conclusion|what was decided|did (?:we|they|the team) decide)\b/i.test(asked)) {
    return decisionReply(analysis);
  }
  if (/\b(disagree\w*|disagreement|pushed back|pushback|objection|objected|conflict|argu\w*)\b/i.test(asked)) {
    return disagreementReply(analysis);
  }
  if (/\brisks?|downsides?|worries|worried|concerns?\b/i.test(asked)) {
    return riskReply(analysis);
  }
  if (/\b(homework|action items?|follow-?ups?|commitments?|next steps?|who is doing|who will|after (?:this|the) meeting)\b/i.test(asked)) {
    return commitmentReply(analysis);
  }
  if (/\b(who spoke|who talked|loudest|quietest|word share|held the floor|who was silent|who never spoke|who did not speak|who didn't speak)\b/i.test(asked)) {
    return floorReply(analysis);
  }
  if (/\b(what questions|which questions|questions were|questions did|who asked)\b/i.test(asked)) {
    return questionsReply(analysis);
  }
  if (/\b(summar\w*|recap|overview|what happened|how did (?:it|the|this)|big picture|in short|how was (?:the|this) meeting)\b/i.test(asked)) {
    return summaryReply(analysis);
  }

  if (/breakout|simulation/i.test(asked)) {
    return {
      text: analysis.breakout.alignment,
      cites: analysis.breakout.themes.map((theme) => clip(theme, 160)),
    };
  }

  if (/\bcharters?\b|\bnorms?\b/i.test(asked)) {
    if (!analysis.charter.provided) {
      return {
        text: "There is no charter loaded. Paste the norms you agreed to, especially anything about who speaks before a decision, and analyze the meeting again.",
        cites: [],
      };
    }
    const gapText =
      analysis.charter.gaps.length === 0
        ? "I did not find a charter gap in this meeting."
        : analysis.charter.gaps
            .map((gap) => `${gap.title}: ${gap.detail}`)
            .join(" ");
    return {
      text: `Charter fit is ${analysis.charter.fit} out of 100. ${gapText}${
        analysis.charter.unchecked ? ` ${analysis.charter.unchecked}` : ""
      } The next-meeting script is there to put the norm back in force: “${analysis.leaderMove.script}”`,
      cites: analysis.charter.norms.slice(0, 3),
    };
  }

  if (/\b(safe|safety|trust|critic\w*)\b/i.test(asked)) {
    const critic = analysis.speakers.find((speaker) => speaker.personalCriticism > 0);
    return {
      text: `Learning signals are ${analysis.safety.score} out of 100. That is not a psychological-safety test. It counts questions, admitted uncertainty, idea challenge, and whether criticism stayed off the person. ${analysis.safety.summary}${
        critic
          ? ` Talk with ${critic.name} about aiming the point at the plan. You could say: “${critic.script}”`
          : ""
      }`,
      cites: analysis.speakers
        .map((speaker) => speaker.quote)
        .filter((quote): quote is string => Boolean(quote))
        .slice(0, 2)
        .map((quote) => clip(quote, 150)),
    };
  }

  if (
    /script|what should i say|how should i open|open the next|next meeting|words to/i.test(
      asked,
    )
  ) {
    return {
      text: `${analysis.leaderMove.why}\n\nSay this at the start: “${analysis.leaderMove.script}”`,
      cites: analysis.decision.quote ? [analysis.decision.quote] : [],
    };
  }

  if (
    /participat|airtime|turn-taking|even participation|more even|share the floor|pass the floor|too much|dominat/i.test(asked)
  ) {
    return participationReply(analysis);
  }

  if (/note|self-assess|assessment|individual/i.test(asked)) {
    const lines = analysis.speakers
      .filter((speaker) => speaker.note)
      .map(
        (speaker) =>
          `${speaker.name}: “${clip(speaker.note ?? "", 100)}” ${speaker.noteFit ?? ""}`,
      );
    if (lines.length === 0) {
      return {
        text: "No individual notes are loaded. Add one line per person, like “Priya: I wait until I am sure.” Then analyze again.",
        cites: [],
      };
    }
    return {
      text: `Notes compared with this meeting:\n\n${lines.join("\n\n")}`,
      cites: [],
    };
  }

  if (/cohes/i.test(asked)) {
    const notes = analysis.cohesion.improvements
      .map((item, index) => `${index + 1}. ${item.title}: ${item.detail}`)
      .join(" ");
    return {
      text: `Team cohesiveness is ${analysis.cohesion.score} out of 100. ${analysis.cohesion.summary} ${notes}`,
      cites: [],
    };
  }

  if (/\b(scores?|equality|measures?|woolley|edmondson|hackman|jehn)\b|what do(?:es)? (?:this|the|that|it|equality) mean/i.test(asked)) {
    return {
      text: `Floor equality is ${analysis.equality}. It is 100 when words are even, including people on the roster who never speak. Woolley and colleagues found that more equal turn-taking tracked with higher collective intelligence. Learning signals are ${analysis.safety.score}: questions, uncertainty, challenge, and the absence of personal criticism. Those are the learning behaviors Edmondson linked to psychological safety, not a diagnosis. Charter fit is ${analysis.charter.fit ?? "not scored, because no charter was pasted"}.`,
      cites: [],
    };
  }

  return retrievalReply(asked, analysis, namedPeople) ?? closestReading(analysis, namedPeople);
}

export function leaderBrief(analysis: Analysis): string {
  const lines = [
    "SpeakSense AI — leader brief",
    `Floor equality: ${analysis.equality}`,
    `Learning signals: ${analysis.safety.score}`,
    `Charter fit: ${analysis.charter.fit ?? "not provided"}`,
    "",
    `Next meeting: ${analysis.leaderMove.title}`,
    analysis.leaderMove.why,
    `Script: ${analysis.leaderMove.script}`,
    "",
    "People:",
    ...analysis.speakers.map(
      (speaker) =>
        `${speaker.name}: ${percent(speaker.wordShare)}% of words, ${speaker.turns} turns — ${speaker.guidanceTitle}. ${speaker.guidanceBody}`,
    ),
  ];
  return lines.join("\n");
}
