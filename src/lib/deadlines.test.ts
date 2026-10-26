import assert from "node:assert/strict";
import test from "node:test";
import { analyzeMeeting } from "./analyze";
import { addDays, extractDeadlines, formatLong, raciRows, resolveWhen } from "./deadlines";
import { calendarIcs, meetingMinutes, parseParticipantEmails, reminderMessage } from "./minutes";
import { raciReminderLabel, raciWorkbook } from "./raci-xlsx";
import { SAMPLE_BREAKOUT, SAMPLE_CHARTER, SAMPLE_EMAILS, SAMPLE_NOTES, SAMPLE_ROSTER, SAMPLE_TRANSCRIPT } from "./sample";

const MEETING = "2026-10-24";

test("thursday after a saturday meeting is the coming thursday", () => {
  assert.equal(resolveWhen("Thursday", MEETING), "2026-10-29");
  assert.equal(resolveWhen("before Thursday", MEETING), "2026-10-29");
  assert.equal(addDays("2026-10-29", -2), "2026-10-27");
});

test("tonight stays on the meeting date", () => {
  assert.equal(resolveWhen("tonight", MEETING), MEETING);
});

test("a month and day rolls forward when it is already past", () => {
  assert.equal(resolveWhen("October 2", MEETING), "2027-10-02");
  assert.equal(resolveWhen("October 30, 2026", MEETING), "2026-10-30");
  assert.equal(resolveWhen("11/2/2026", MEETING), "2026-11-02");
});

test("the sample meeting yields dated deadlines and a two-day reminder", () => {
  const result = analyzeMeeting({
    transcript: SAMPLE_TRANSCRIPT,
    charter: SAMPLE_CHARTER,
    breakout: SAMPLE_BREAKOUT,
    notes: SAMPLE_NOTES,
    roster: SAMPLE_ROSTER,
  });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  const deadlines = extractDeadlines(result.analysis.utterances, MEETING);
  const phrases = deadlines.map((item) => item.phrase.toLowerCase());
  assert.ok(phrases.includes("tonight"));
  assert.ok(phrases.some((phrase) => phrase.includes("thursday")));
  const thursday = deadlines.find((item) => item.phrase.toLowerCase().includes("thursday"));
  assert.equal(thursday?.due, "2026-10-29");
  assert.equal(thursday?.remindOn, "2026-10-27");
  const minutes = meetingMinutes(result.analysis, deadlines, MEETING);
  assert.match(minutes, /Highlights/);
  assert.match(minutes, /Decisions/);
  assert.match(minutes, /Let's go with/i);
  assert.match(minutes, new RegExp(formatLong("2026-10-29")));
  const rows = raciRows(
    deadlines,
    result.analysis.speakers.map((speaker) => ({ name: speaker.name, role: speaker.role })),
  );
  const slide = rows.find((row) => /slide/i.test(row.description) && row.responsible === "Morgan");
  const cases = rows.find((row) => row.responsible === "Luis");
  const review = rows.find((row) => row.responsible === "Team");
  assert.equal(slide?.accountable, "Morgan");
  assert.match(slide?.description ?? "", /Draft the slide/i);
  assert.equal(cases?.accountable, "Morgan");
  assert.match(cases?.informed ?? "", /Priya/);
  assert.equal(review?.accountable, "Morgan");
  assert.equal(review?.informed, "—");
  assert.match(reminderMessage(deadlines[0]), /two days/i);
  const ics = calendarIcs(deadlines, parseParticipantEmails(SAMPLE_EMAILS));
  assert.match(ics, /TRIGGER:-P2D/);
  assert.match(ics, /mailto:morgan@northstar\.example/);
  const workbook = new TextDecoder().decode(raciWorkbook(rows, "2026-10-25"));
  assert.match(workbook, /<sheet name="RACI"/);
  assert.match(workbook, /Description/);
  assert.match(workbook, /Responsible/);
  assert.match(workbook, /Draft the slide/);
  assert.match(workbook, /Oct 29, 2026/);
  assert.equal(raciReminderLabel("2026-10-23", "2026-10-25"), "Oct 23, 2026 · passed");
  assert.equal(workbook.includes("&amp;"), false);
  const escaped = new TextDecoder().decode(
    raciWorkbook(
      [{ ...rows[0], description: "Draft & review <the> slide" }],
      "2026-10-25",
    ),
  );
  assert.match(escaped, /Draft &amp; review &lt;the&gt; slide/);
});

test("participant emails keep the name and reject a broken address", () => {
  const rows = parseParticipantEmails(
    "Morgan: morgan@northstar.example\nnot-an-email\nPriya <priya@northstar.example>\nLuis - luis@northstar.example",
  );
  assert.equal(rows[0]?.name, "Morgan");
  assert.equal(rows[0]?.valid, true);
  assert.equal(rows[1]?.valid, false);
  assert.equal(rows[1]?.email, "not-an-email");
  assert.equal(rows[2]?.email, "priya@northstar.example");
  assert.equal(rows[3]?.name, "Luis");
  assert.equal(rows[3]?.valid, true);
});
