import assert from "node:assert/strict";
import test from "node:test";
import { analyzeMeeting, gini } from "./analyze";
import { askCoach } from "./coach";
import { parseTranscript } from "./parse-transcript";
import {
  SAMPLE_BREAKOUT,
  SAMPLE_CHARTER,
  SAMPLE_NOTES,
  SAMPLE_ROSTER,
  SAMPLE_TRANSCRIPT,
} from "./sample";
import { wordCount } from "./format";
import { WRITEUP } from "./writeup";

test("gini is zero when shares are equal", () => {
  assert.equal(gini([1, 1, 1, 1]), 0);
});

test("gini rises when one person holds the words", () => {
  assert.ok(gini([1, 0, 0, 0]) > 0.7);
});

test("sample meeting tells the Northstar story", () => {
  const result = analyzeMeeting({
    transcript: SAMPLE_TRANSCRIPT,
    charter: SAMPLE_CHARTER,
    breakout: SAMPLE_BREAKOUT,
    notes: SAMPLE_NOTES,
    roster: SAMPLE_ROSTER,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;

  const { analysis } = result;
  const byName = Object.fromEntries(analysis.speakers.map((speaker) => [speaker.name, speaker]));
  const shares = Object.fromEntries(
    analysis.speakers.map((speaker) => [speaker.name, Math.round(speaker.wordShare * 100)]),
  );

  assert.ok(byName.Morgan.wordShare > byName.Luis.wordShare, JSON.stringify(shares));
  assert.ok(byName.Priya.wordShare < byName.Avery.wordShare, JSON.stringify(shares));
  assert.equal(byName.Morgan.guidance, "yield");
  assert.equal(byName.Priya.guidance, "invite");
  assert.ok(byName.Sam.personalCriticism > 0);
  assert.match(analysis.decision.quote ?? "", /Let's go with/i);
  assert.match(analysis.leaderMove.why, /Let's go with/i);
  assert.ok(analysis.decision.found);
  assert.ok(analysis.decision.missed.includes("Priya"));
  assert.ok(analysis.decision.missed.includes("Avery"));
  assert.ok(analysis.decision.missed.includes("Sam"));
  assert.ok((analysis.charter.fit ?? 100) < 80);
  assert.ok(analysis.equality < 90);
  assert.match(analysis.leaderMove.script, /I will go last/);
  assert.ok(analysis.cohesion.score >= 0 && analysis.cohesion.score <= 100);
  assert.ok(analysis.cohesion.score < 85);
  assert.equal(analysis.cohesion.improvements.length, 5);
  const improvementText = analysis.cohesion.improvements.map((item) => `${item.title} ${item.detail}`).join(" ");
  assert.match(improvementText, /Priya|Sam|Morgan/);
  assert.match(analysis.breakout.alignment, /uneven|agrees/i);
  assert.match(byName.Priya.noteFit ?? "", /matches/i);
});

test("behaviors are measured from words, not punctuation", () => {
  const result = analyzeMeeting({
    transcript: `Morgan: What do you think about the second shop
Priya: I am not sure the rent works
Luis: What if we wait until fall
Sam: You always decide before operations are checked
Avery: Building on the rent point the staffing still looks thin
Morgan: Anyone else want to weigh in
Jordan: The shop is packed?`,
    roster: "Morgan, Priya, Luis, Sam, Avery, Jordan",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const byName = Object.fromEntries(result.analysis.speakers.map((speaker) => [speaker.name, speaker]));
  assert.ok(byName.Morgan.questions >= 2);
  assert.ok(byName.Morgan.invitations >= 2);
  assert.equal(byName.Priya.uncertainty, 1);
  assert.ok(byName.Luis.questions >= 1);
  assert.ok(byName.Luis.challenges >= 1);
  assert.equal(byName.Sam.personalCriticism, 1);
  assert.equal(byName.Avery.builds, 1);
  assert.equal(byName.Jordan.questions, 0);
});

test("a shared round is more cohesive than one person closing alone", () => {
  const shared = analyzeMeeting({
    transcript: `Morgan: What do you think about the second shop
Priya: I am not sure about the rent. Building on that, the wait matters.
Luis: I agree with Priya. What if we wait a month
Sam: Another way is a smaller counter. Anyone else?
Avery: Building on the staffing point, I can add the note. That is the decision. We open with four hires.`,
    roster: "Morgan, Priya, Luis, Sam, Avery",
  });
  const alone = analyzeMeeting({
    transcript: `Morgan: Let's go with the second location. You always ignore the risks.
Priya: Ok.`,
    roster: "Morgan, Priya, Luis, Sam, Avery",
  });
  assert.equal(shared.ok, true);
  assert.equal(alone.ok, true);
  if (!shared.ok || !alone.ok) return;
  assert.equal(shared.analysis.cohesion.improvements.length, 5);
  assert.ok(shared.analysis.cohesion.score > alone.analysis.cohesion.score);
});

test("a roster name who never speaks counts as not heard", () => {
  const result = analyzeMeeting({
    transcript: "Morgan: We should open.\nPriya: I am not sure yet.",
    roster: "Morgan, Priya, Jordan",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const jordan = result.analysis.speakers.find((speaker) => speaker.name === "Jordan");
  assert.equal(jordan?.guidance, "absent");
  assert.ok(result.analysis.equality < 100);
});

test("a name on its own line keeps the words that follow", () => {
  const result = analyzeMeeting({
    transcript: `Daniel Brooks
Does that timeline work. I am not sure we can finish. What if we slip a week.
Ethan Cole
I disagree with waiting. Building on the timeline, can we check the budget. What do you think.`,
    roster: "Daniel Brooks, Ethan Cole",
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const byName = Object.fromEntries(result.analysis.speakers.map((speaker) => [speaker.name, speaker]));
  assert.ok(byName["Daniel Brooks"].turns > 0);
  assert.ok(byName["Daniel Brooks"].questions > 0);
  assert.ok(byName["Daniel Brooks"].uncertainty > 0);
  assert.ok(byName["Daniel Brooks"].challenges > 0);
  assert.ok(byName["Ethan Cole"].turns > 0);
  assert.ok(byName["Ethan Cole"].challenges > 0);
  assert.ok(byName["Ethan Cole"].builds > 0);
  assert.ok(byName["Ethan Cole"].questions > 0);
  assert.ok(byName["Ethan Cole"].invitations > 0);
});

test("a Decision heading is not treated as a participant", () => {
  const turns = parseTranscript(`Morgan: We should open the second shop
Decision: Let's go with the second location
Priya - I am not sure about the rent`);
  assert.deepEqual(
    turns.map((turn) => turn.speaker),
    ["Morgan", "Priya"],
  );
  assert.match(turns[0]?.text ?? "", /Let's go with the second location/);
});

test("a hyphen separates a name the same way a colon does", () => {
  const turns = parseTranscript(`Morgan - We should open the second shop
Priya — I am not sure about the rent
Mary-Jane: The lease is the risk
[0:13] Luis - What if we wait
Sam- Hold on`);
  assert.deepEqual(
    turns.map((turn) => turn.speaker),
    ["Morgan", "Priya", "Mary-Jane", "Luis", "Sam"],
  );
  assert.equal(turns[1]?.text, "I am not sure about the rent");
  assert.match(turns[2]?.text ?? "", /lease/);
  assert.equal(turns[3]?.startMs, 13000);
  assert.equal(turns[4]?.text, "Hold on");
});

test("vtt cues keep speaker names", () => {
  const turns = parseTranscript(`WEBVTT

00:00:01.000 --> 00:00:03.000
Morgan: We should open.

00:00:04.000 --> 00:00:06.000
<v Priya>I am not sure.
`);
  assert.equal(turns.length, 2);
  assert.equal(turns[1].speaker, "Priya");
  assert.equal(turns[0].startMs, 1000);
});

test("coach gives a participation practice without shaming", () => {
  const result = analyzeMeeting({
    transcript: SAMPLE_TRANSCRIPT,
    charter: SAMPLE_CHARTER,
    notes: SAMPLE_NOTES,
    roster: SAMPLE_ROSTER,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const reply = askCoach("How do I get more even participation?", result.analysis);
  assert.match(reply.text, /Priya/);
  assert.doesNotMatch(reply.text, /why they were quiet/i);
  const named = askCoach("What should Morgan do differently?", result.analysis);
  assert.match(named.text, /Pass the floor|pass it/i);
  const dominating = askCoach("Was Morgan dominating in this meeting?", result.analysis);
  assert.match(dominating.text, /^Yes\./);
  assert.match(dominating.text, /42%|%/);
  const covered = askCoach("Did Priya cover all her points?", result.analysis);
  assert.match(covered.text, /Priya spoke/);
  assert.doesNotMatch(covered.text, /private agenda is complete/i);
  const clear = askCoach("Did Avery speak clearly and was he articulative?", result.analysis);
  assert.match(clear.text, /words/);
  const laurenMeeting = analyzeMeeting({
    transcript: "Lauren Chen: I have the whole plan and I will keep going until we lock it. The second shop should open and I already decided the slide.\nKeaton: Ok.",
    roster: "Lauren Chen, Keaton",
  });
  assert.equal(laurenMeeting.ok, true);
  if (!laurenMeeting.ok) return;
  const byFirst = askCoach("Was Lauren dominating?", laurenMeeting.analysis);
  assert.match(byFirst.text, /^Yes\./);
  const keaton = askCoach("Did Keaton speak clearly?", laurenMeeting.analysis);
  assert.match(keaton.text, /did not say enough|words/i);
  const machine = askCoach("Did anyone talk about the espresso machine?", result.analysis);
  assert.match(machine.text, /Sam/);
  assert.match(machine.text, /machine/i);
  assert.doesNotMatch(machine.text, /Try “Was/);
  const decided = askCoach("What was the outcome of this meeting?", result.analysis);
  assert.match(decided.text, /decision|open/i);
  const payback = askCoach("What did Luis say about payback?", result.analysis);
  assert.match(payback.text, /payback|seventeen|fourteen/i);
  assert.doesNotMatch(payback.text, /pass the floor/i);
  const wait = askCoach("How should we think about the customer wait?", result.analysis);
  assert.match(wait.text, /Priya|wait|minute/i);
  const odd = askCoach("Was the library cafe part of the customer worry?", result.analysis);
  assert.match(odd.text, /Priya|library|cafe/i);
  assert.doesNotMatch(odd.text, /Ask anything about this meeting/);
});

test("write-up stays within 300 words", () => {
  assert.ok(wordCount(WRITEUP) <= 300, `word count ${wordCount(WRITEUP)}`);
  assert.ok(wordCount(WRITEUP) >= 200);
});
