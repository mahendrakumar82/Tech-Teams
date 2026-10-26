"use client";

import { cloneElement, isValidElement, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type ReactElement, type ReactNode } from "react";
import { analyzeMeeting } from "@/lib/analyze";
import { askCoach, openingBrief } from "@/lib/coach";
import { percent, speakerColor, wordCount } from "@/lib/format";
import {
  SAMPLE_BREAKOUT,
  SAMPLE_CHARTER,
  SAMPLE_EMAILS,
  SAMPLE_NOTES,
  SAMPLE_ROSTER,
  SAMPLE_TRANSCRIPT,
} from "@/lib/sample";
import type { Analysis, CoachReply } from "@/lib/types";
import { isTextTranscript, MAX_TEXT_BYTES } from "@/lib/video-assets";
import { isWordDocument, MAX_WORD_BYTES, readWordText } from "@/lib/word-text";
import { WRITEUP } from "@/lib/writeup";
import { BEHAVIORS, MeetingCharts } from "@/components/behavior-charts";
import { MinutesPanel } from "@/components/minutes-panel";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";

type TabId = "setup" | "reading" | "coach";
type ChatMessage = { role: "user" | "coach"; text: string; cites: string[] };

const HOW_TO = [
  "Upload a transcript as .doc, .docx, .txt, .vtt, .srt, or .md, or paste it. Each spoken turn should look like “Morgan: We should open the second shop.” or “Priya - I am not sure about the rent.” Zoom, Teams, and Otter exports also work.",
  "List every person on the team under Roster, then add Participant emails, one person per line: “Morgan: morgan@school.edu” or “Priya - priya@school.edu”. The meeting date turns “Thursday” or “tonight” into a calendar day.",
  "Optional: paste your team charter, especially norms about voice, decisions, and disagreement.",
  "Optional: paste Breakout Learning feedback.",
  "Optional: paste individual notes, one person per line. Example: “Priya: I wait until I am sure.” or “Morgan - I talk to fill silence.”",
  "Click Analyze this meeting. Or click Load sample team to walk through a finished example before your recording is ready.",
  "The charts show word share, learning behaviors, and who spoke in order. The number sits next to each bar, so color is not the only cue. Then ask SpeakSense... Shazaam! a question in your own words.",
  "Email the minutes from the reading. That message includes highlights, decisions, and deadlines with dates. Add the calendar reminders so an alarm fires two days before each deadline. Your mail app and calendar do the sending after you confirm.",
  "Nothing you paste is uploaded. The reading happens in this browser. Closing the tab clears the transcript. Saved reminders stay on this computer until you clear the page data.",
];

function sampleInputs() {
  return {
    transcript: SAMPLE_TRANSCRIPT,
    charter: SAMPLE_CHARTER,
    breakout: SAMPLE_BREAKOUT,
    notes: SAMPLE_NOTES,
    roster: SAMPLE_ROSTER,
  };
}

export function BeforeWeDecide({ startWithSample = false }: { startWithSample?: boolean }) {
  const seeded = startWithSample ? analyzeMeeting(sampleInputs()) : null;
  const seededAnalysis = seeded?.ok ? seeded.analysis : null;
  const seededOpening = seededAnalysis ? openingBrief(seededAnalysis) : null;
  const [transcript, setTranscript] = useState(startWithSample ? SAMPLE_TRANSCRIPT : "");
  const [charter, setCharter] = useState(startWithSample ? SAMPLE_CHARTER : "");
  const [breakout, setBreakout] = useState(startWithSample ? SAMPLE_BREAKOUT : "");
  const [notes, setNotes] = useState(startWithSample ? SAMPLE_NOTES : "");
  const [roster, setRoster] = useState(startWithSample ? SAMPLE_ROSTER : "");
  const [emails, setEmails] = useState(startWithSample ? SAMPLE_EMAILS : "");
  const [meetingDate, setMeetingDate] = useState("");
  const today = useSyncExternalStore(subscribeToday, todayIso, () => "");
  const [fileName, setFileName] = useState(startWithSample ? "Sample meeting" : "");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState("");
  const [analysis, setAnalysis] = useState<Analysis | null>(seededAnalysis);
  const [tab, setTab] = useState<TabId>(seededAnalysis ? "reading" : "setup");
  const [messages, setMessages] = useState<ChatMessage[]>(
    seededOpening ? [{ role: "coach", text: seededOpening.text, cites: seededOpening.cites }] : [],
  );
  const [question, setQuestion] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [writeupOpen, setWriteupOpen] = useState(false);
  const [copied, setCopied] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);

  const run = (
    next: {
      transcript: string;
      charter: string;
      breakout: string;
      notes: string;
      roster: string;
    },
    label?: string,
  ) => {
    const result = analyzeMeeting(next);
    if (!result.ok) {
      setAnalysis(null);
      setMessages([]);
      setError(result.error);
      setTab("setup");
      return;
    }
    const opening = openingBrief(result.analysis);
    setError("");
    setAnalysis(result.analysis);
    setMessages([{ role: "coach", text: opening.text, cites: opening.cites }]);
    setTab("reading");
    if (label) setFileName(label);
  };

  const loadSample = () => {
    const next = sampleInputs();
    setTranscript(next.transcript);
    setCharter(next.charter);
    setBreakout(next.breakout);
    setNotes(next.notes);
    setRoster(next.roster);
    setEmails(SAMPLE_EMAILS);
    setMeetingDate(todayIso());
    run(next, "Sample meeting");
  };

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  const ingestFiles = async (list: File[]) => {
    const problems: string[] = [];
    const accepted: string[] = [];
    let nextName = "";
    for (const file of list) {
      const lower = file.name.toLowerCase();
      if (lower.endsWith(".mp4") || file.type.startsWith("video/")) {
        problems.push(`${file.name} is a video. Upload a transcript: .doc, .docx, .txt, .vtt, .srt, or .md.`);
        continue;
      }
      if (isWordDocument(file)) {
        if (file.size > MAX_WORD_BYTES) {
          problems.push(`${file.name} is over 15 MB.`);
          continue;
        }
        try {
          const text = await readWordText(new Uint8Array(await file.arrayBuffer()), file.name);
          accepted.push(text);
          nextName = file.name;
        } catch (caught) {
          problems.push(caught instanceof Error ? caught.message : `${file.name} could not be read.`);
        }
      } else if (isTextTranscript(file)) {
        if (file.size > MAX_TEXT_BYTES) {
          problems.push(`${file.name} is over 1 MB.`);
          continue;
        }
        accepted.push(await file.text());
        nextName = file.name;
      } else {
        problems.push(`${file.name} is not a transcript. Use .doc, .docx, .txt, .vtt, .srt, or .md.`);
      }
    }
    if (accepted.length > 0) {
      setTranscript(accepted.join("\n"));
      setFileName(nextName);
    }
    setError(problems.join(" "));
  };

  const chips = useMemo(() => {
    if (!analysis) return [];
    const quiet = [...analysis.speakers].sort((a, b) => a.wordShare - b.wordShare)[0];
    const who = quiet?.name.split(/\s+/)[0];
    return [
      "What did the team decide?",
      "Who disagreed, and about what?",
      "What risks came up?",
      "Who is doing what next?",
      who ? `What did ${who} actually say?` : "Give me a short recap",
    ].filter(Boolean);
  }, [analysis]);

  const ask = (text: string) => {
    if (!analysis || !text.trim()) return;
    const reply: CoachReply = askCoach(text, analysis);
    setMessages((current) => [
      ...current,
      { role: "user", text: text.trim(), cites: [] },
      { role: "coach", text: reply.text, cites: reply.cites },
    ]);
    setQuestion("");
    setTab("coach");
  };

  const copyText = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      window.setTimeout(() => setCopied(""), 2000);
    } catch {
      setCopied("Could not copy");
    }
  };

  const clearAll = () => {
    setTranscript("");
    setCharter("");
    setBreakout("");
    setNotes("");
    setRoster("");
    setEmails("");
    setMeetingDate("");
    setFileName("");
    setAnalysis(null);
    setMessages([]);
    setError("");
    setTab("setup");
  };

  return (
    <div className="relative min-h-full">
      <a className="skip-link" href="#content">
        Skip to the meeting
      </a>
      <div
        className="h-2 bg-[linear-gradient(90deg,var(--speaker-2),white,var(--speaker-1))]"
        aria-hidden="true"
      />
      <header className="border-b border-border/80">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-end sm:justify-between">
          <div className="flex items-start gap-3">
            <Mark />
            <div>
              <p className="text-xs tracking-[0.16em] text-muted-foreground uppercase">
                Team process prototype
              </p>
              <h1 className="font-heading text-3xl leading-tight sm:text-4xl">SpeakSense AI</h1>
              <p className="mt-1 max-w-xl text-sm text-muted-foreground sm:text-base">
                Upload a transcript, see who held the floor, and leave with the words to open next time.
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setHelpOpen(true)}>
              How to use
            </Button>
            <Button variant="outline" onClick={() => setWriteupOpen(true)}>
              Write-up
            </Button>
          </div>
        </div>
      </header>

      <main id="content" className="mx-auto max-w-7xl px-4 py-5">
        <Tabs
          value={tab}
          onValueChange={(value) => {
            if (value === "setup" || value === "reading" || value === "coach") setTab(value);
          }}
          className="mb-4 lg:hidden"
        >
          <TabsList className="h-11! w-full">
            <TabsTrigger value="setup">Setup</TabsTrigger>
            <TabsTrigger value="reading">Reading</TabsTrigger>
            <TabsTrigger value="coach">Shazaam</TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="grid items-start gap-4 lg:grid-cols-12">
          <section className={`min-w-0 lg:col-span-4 ${tab === "setup" ? "" : "max-lg:hidden"}`}>
            <Card className="border-t-4 border-t-[var(--speaker-2)]">
              <CardHeader>
                <CardTitle>Evidence</CardTitle>
                <CardDescription>
                  Upload a Word document or another transcript, or paste one. Charter, Breakout feedback, and individual notes make the coach more specific.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div
                  className={`rounded-xl border border-dashed p-4 text-center ${
                    dragging ? "border-primary bg-primary/5" : "border-border"
                  }`}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    const files = [...event.dataTransfer.files];
                    if (files.length > 0) void ingestFiles(files);
                  }}
                >
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".doc,.docx,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,.txt,.vtt,.srt,.md,.text,text/plain"
                    multiple
                    className="sr-only"
                    onChange={(event) => {
                      const files = [...(event.target.files ?? [])];
                      event.target.value = "";
                      if (files.length > 0) void ingestFiles(files);
                    }}
                  />
                  <p className="text-sm">Drop a transcript.</p>
                  <p className="mt-1 text-xs text-muted-foreground">.doc, .docx, .txt, .vtt, .srt, or .md</p>
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-3"
                    onClick={() => fileRef.current?.click()}
                  >
                    Upload transcript
                  </Button>
                  {fileName ? (
                    <p className="mt-2 text-xs text-muted-foreground">{fileName}</p>
                  ) : null}
                </div>

                <Field
                  label="Transcript"
                  hint="Use “Name: what they said”, “Name - what they said”, or put the name on its own line with the words underneath."
                >
                  <Textarea
                    value={transcript}
                    onChange={(event) => setTranscript(event.target.value)}
                    className="max-h-48 min-h-28 overflow-y-auto font-mono text-xs"
                    placeholder={"Morgan: We should open the second shop.\nPriya - I am not sure about the rent."}
                  />
                </Field>
                <Field label="Participant emails" hint="One person per line, with a colon or hyphen: Morgan: morgan@school.edu. These addresses receive the minutes and the reminders.">
                  <Textarea
                    value={emails}
                    onChange={(event) => setEmails(event.target.value)}
                    className="max-h-36 min-h-20 overflow-y-auto"
                    placeholder={"Morgan: morgan@school.edu\nPriya: priya@school.edu"}
                    autoComplete="off"
                    spellCheck={false}
                  />
                </Field>
                <Field label="Meeting date" hint="Used to turn “Thursday” or “tonight” into a date. Reminders are two days earlier.">
                  <Input
                    type="date"
                    value={meetingDate}
                    max="9999-12-31"
                    onChange={(event) => setMeetingDate(event.target.value)}
                  />
                </Field>
                <Field label="Roster" hint="Optional. Comma-separated. Silence counts only if you list them.">
                  <Input
                    value={roster}
                    onChange={(event) => setRoster(event.target.value)}
                    placeholder="Morgan, Priya, Luis, Sam, Avery"
                  />
                </Field>
                <Field label="Team charter" hint="Optional. Norms about voice, decisions, and disagreement.">
                  <Textarea
                    value={charter}
                    onChange={(event) => setCharter(event.target.value)}
                    className="max-h-36 min-h-20 overflow-y-auto"
                    placeholder="Everyone speaks once before we decide."
                  />
                </Field>
                <Field label="Breakout Learning feedback" hint="Optional. Paste the export or the written summary.">
                  <Textarea
                    value={breakout}
                    onChange={(event) => setBreakout(event.target.value)}
                    className="max-h-32 min-h-16 overflow-y-auto"
                    placeholder="Growth area: participation was uneven."
                  />
                </Field>
                <Field label="Individual notes" hint="Optional. One person per line, with a colon or hyphen.">
                  <Textarea
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    className="max-h-32 min-h-16 overflow-y-auto"
                    placeholder={"Priya: I wait until I am sure.\nMorgan: I talk to fill silence."}
                  />
                </Field>
                {error ? (
                  <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">
                    {error}
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    onClick={() =>
                      run({ transcript, charter, breakout, notes, roster }, fileName || undefined)
                    }
                  >
                    Analyze this meeting
                  </Button>
                  <Button variant="secondary" onClick={loadSample}>
                    Load sample team
                  </Button>
                  <Button variant="ghost" onClick={clearAll}>
                    Clear
                  </Button>
                </div>
              </CardContent>
            </Card>
          </section>

          <section className={`grid min-w-0 gap-4 lg:col-span-5 ${tab === "reading" ? "" : "max-lg:hidden"}`}>
            {analysis ? (
              <Results
                analysis={analysis}
                fileName={fileName}
                emails={emails}
                meetingDate={meetingDate || today}
                today={today}
              />
            ) : (
              <EmptyReading />
            )}
          </section>

          <section className={`min-w-0 lg:col-span-3 ${tab === "coach" ? "" : "max-lg:hidden"}`}>
            <Card className="border-t-4 border-t-[var(--speaker-1)] lg:sticky lg:top-4">
              <CardHeader>
                <CardTitle>SpeakSense... Shazaam!</CardTitle>
                <CardDescription>
                  Ask anything about this meeting. Shazaam answers from the transcript.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-3">
                <ScrollArea className="h-80 rounded-lg border border-border bg-[oklch(0.98_0.01_255)]">
                  <div className="grid gap-3 p-3" aria-live="polite">
                    {messages.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Analyze a meeting, then ask anything about it.
                      </p>
                    ) : (
                      messages.map((message, index) => (
                        <article
                          key={`${message.role}-${index}`}
                          className={message.role === "user" ? "ml-8 justify-self-end" : "mr-6"}
                        >
                          <p className={`mb-1 text-xs font-medium ${message.role === "user" ? "text-right" : ""}`}>
                            {message.role === "user" ? "You" : "Shazaam"}
                          </p>
                          <div
                            className={
                              message.role === "user"
                                ? "rounded-2xl rounded-tr-sm bg-primary px-3 py-2 text-sm text-primary-foreground"
                                : "rounded-2xl rounded-tl-sm bg-[oklch(0.95_0.03_255)] px-3 py-2 text-sm"
                            }
                          >
                            {message.text.split("\n\n").map((paragraph) => (
                              <p key={paragraph.slice(0, 40)} className="mb-2 last:mb-0 whitespace-pre-wrap">
                                {paragraph}
                              </p>
                            ))}
                            {message.cites.length > 0 ? (
                              <ul className="mt-2 grid gap-1 border-t border-border/60 pt-2 text-xs opacity-80">
                                {message.cites.map((cite) => (
                                  <li key={cite}>“{cite}”</li>
                                ))}
                              </ul>
                            ) : null}
                          </div>
                        </article>
                      ))
                    )}
                    <div ref={chatEndRef} />
                  </div>
                </ScrollArea>
                <div className="flex flex-wrap gap-1.5">
                  {chips.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      className="min-h-10 rounded-full border border-border bg-card px-3 py-2 text-left text-sm hover:bg-accent"
                      onClick={() => ask(chip)}
                    >
                      {chip}
                    </button>
                  ))}
                </div>
                <form
                  className="flex gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    ask(question);
                  }}
                >
                  <Input
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder="What happened with the decision?"
                    aria-label="Question for Shazaam"
                    disabled={!analysis}
                  />
                  <Button type="submit" disabled={!analysis || !question.trim()}>
                    Ask
                  </Button>
                </form>
              </CardContent>
            </Card>
          </section>
        </div>

        <EvidenceAccordion />
      </main>

      <footer className="mx-auto max-w-7xl px-4 pb-8 text-xs text-muted-foreground">
        One meeting is a signal. The scores describe the conversation, not a person’s character. Files stay on this computer.
      </footer>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent className="max-h-[min(85vh,40rem)] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>How another team leader uses this</DialogTitle>
            <DialogDescription>
              Bring your own meeting. The sample team is only there so you can try the reading first.
            </DialogDescription>
          </DialogHeader>
          <ol className="grid list-decimal gap-3 pl-4 text-sm">
            {HOW_TO.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <Separator />
          <div className="grid gap-2 text-sm">
            <p className="font-medium">Ask SpeakSense... Shazaam! anything about the meeting</p>
            <ul className="grid gap-1 text-muted-foreground">
              <li>What did the team decide, and who had not spoken yet?</li>
              <li>Who disagreed, and was it about the idea or a person?</li>
              <li>What risks came up, and who is doing what next?</li>
              <li>What did Priya say about the customers?</li>
            </ul>
          </div>
          <Button
            variant="outline"
            onClick={() => {
              const blob = new Blob([SAMPLE_TRANSCRIPT], { type: "text/plain" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = "sample-transcript.txt";
              link.click();
              URL.revokeObjectURL(url);
            }}
          >
            Download the sample transcript
          </Button>
        </DialogContent>
      </Dialog>

      <Dialog open={writeupOpen} onOpenChange={setWriteupOpen}>
        <DialogContent className="max-h-[min(85vh,42rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Assignment description</DialogTitle>
            <DialogDescription>
              {wordCount(WRITEUP)} words. The limit is 300. Replace the local link with your public URL before you submit.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 text-sm leading-6">
            {WRITEUP.split("\n\n").map((paragraph) => (
              <p key={paragraph.slice(0, 32)}>{paragraph}</p>
            ))}
          </div>
          <Button variant="outline" onClick={() => copyText(WRITEUP, "writeup")}>
            {copied === "writeup" ? "Copied" : "Copy write-up"}
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint: string;
  children: ReactNode;
}) {
  const id = useId();
  const hintId = `${id}-hint`;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string; "aria-describedby"?: string }>, {
        id,
        "aria-describedby": hintId,
      })
    : children;
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      {control}
      <p id={hintId} className="text-xs text-muted-foreground">
        {hint}
      </p>
    </div>
  );
}

function Mark() {
  return (
    <svg viewBox="0 0 48 48" className="mt-1 size-12 shrink-0" aria-hidden="true">
      <circle cx="16" cy="18" r="7" fill="var(--speaker-2)" />
      <circle cx="32" cy="14" r="6" fill="var(--speaker-1)" />
      <circle cx="34" cy="30" r="7" fill="var(--speaker-2)" />
      <circle cx="18" cy="33" r="6" fill="var(--speaker-1)" />
      <circle cx="24" cy="23" r="4.5" fill="white" stroke="var(--speaker-2)" strokeWidth="1.5" />
    </svg>
  );
}

function EmptyReading() {
  const previews = [
    ["Floor equality", "Who held the words and the turns, including anyone on the roster who never spoke.", "var(--speaker-2)"],
    ["Learning behaviors", "Questions, uncertainty, idea challenge, invitations, and builds, kept separate from personal criticism.", "var(--speaker-3)"],
    ["Charter fit", "Your norms, especially “everyone speaks before we decide,” checked against the first decision line.", "var(--speaker-4)"],
  ];
  return (
    <Card className="border-t-4 border-t-[var(--speaker-1)]">
      <CardHeader>
        <CardTitle>What you will get</CardTitle>
        <CardDescription>
          Analyze a meeting, or load the sample, to see the charts.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3">
        {previews.map(([title, body, color]) => (
          <div key={title} className="rounded-lg border border-border bg-card px-3 py-3" style={{ borderLeft: `6px solid ${color}` }}>
            <p className="font-medium">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">{body}</p>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

const IMPROVEMENT_TONES = [
  { wash: "oklch(0.95 0.045 255)", accent: "var(--speaker-2)" },
  { wash: "oklch(0.97 0.045 70)", accent: "var(--speaker-1)" },
  { wash: "oklch(0.96 0.05 155)", accent: "oklch(0.42 0.12 155)" },
  { wash: "oklch(0.96 0.05 95)", accent: "var(--speaker-4)" },
  { wash: "oklch(0.95 0.045 300)", accent: "var(--speaker-7)" },
];

function Results({
  analysis,
  fileName,
  emails,
  meetingDate,
  today,
}: {
  analysis: Analysis;
  fileName: string;
  emails: string;
  meetingDate: string;
  today: string;
}) {
  const meters = [
    ["Floor equality", analysis.equality, "Equal turn-taking (Woolley et al., 2010)", "var(--speaker-2)", "oklch(0.95 0.04 255)"],
    ["Learning signals", analysis.safety.score, "Questions, uncertainty, challenge (Edmondson, 1999)", "var(--speaker-3)", "oklch(0.95 0.03 250)"],
    ["Charter fit", analysis.charter.fit, "Norms actually used (Mathieu & Rapp, 2009)", "var(--speaker-1)", "oklch(0.96 0.04 70)"],
  ] as const;

  return (
    <>
      <Card aria-live="polite" className="border-t-4 border-t-[var(--speaker-1)]">
        <CardHeader>
          <CardTitle>This meeting</CardTitle>
          <CardDescription>
            {analysis.totalWords.toLocaleString()} words across {analysis.totalTurns} turns
            {analysis.rosterUsed ? ". Roster silence counts." : ". Add a roster if someone never spoke."}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {analysis.cohesion ? (
          <>
          <section aria-labelledby="team-cohesiveness" className="rounded-lg bg-[oklch(0.96_0.03_155)] px-3 py-3">
            <h2 id="team-cohesiveness" className="text-[14px] font-semibold leading-5 text-foreground">
              Team cohesiveness
            </h2>
            <p className="font-heading text-2xl">{analysis.cohesion.score}</p>
            <div
              className="mt-2 h-2.5 rounded-full bg-card"
              role="meter"
              aria-label="Team cohesiveness"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={analysis.cohesion.score}
              aria-valuetext={`${analysis.cohesion.score} out of 100`}
            >
              <div
                className="h-full rounded-full bg-[oklch(0.45_0.12_155)]"
                style={{ width: `${analysis.cohesion.score}%` }}
              />
            </div>
            <p className="mt-2 text-sm">{analysis.cohesion.summary}</p>
            <p className="mt-2 text-xs text-muted-foreground">
              Voice, building on ideas, invitations, and disagreement that stays on the work (Beal et al., 2003). A meeting signal, not a trait.
            </p>
          </section>
          <section aria-labelledby="areas-of-improvement" className="grid gap-2">
            <h2 id="areas-of-improvement" className="text-[14px] font-semibold leading-5 text-foreground">
              Areas of improvement
            </h2>
            <ol className="grid gap-2">
              {analysis.cohesion.improvements.map((item, index) => {
                const tone = IMPROVEMENT_TONES[index % IMPROVEMENT_TONES.length];
                return (
                  <li
                    key={item.title}
                    className="rounded-lg border-l-4 px-3 py-2"
                    style={{ background: tone.wash, borderLeftColor: tone.accent }}
                  >
                    <p className="font-medium">
                      <span className="mr-2 inline-block w-4" style={{ color: tone.accent }}>
                        {index + 1}.
                      </span>
                      {item.title}
                    </p>
                    <p className="mt-1 text-sm">{item.detail}</p>
                  </li>
                );
              })}
            </ol>
          </section>
          </>
          ) : (
            <p className="text-sm">Analyze the meeting again to score team cohesiveness.</p>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            {meters.map(([label, value, source, color, wash]) => (
              <div key={label} className="rounded-lg px-3 py-3" style={{ background: wash }}>
                <p className="text-xs font-medium">{label}</p>
                <p className="font-heading text-2xl">{value === null ? "Not scored" : value}</p>
                {value === null ? null : (
                  <div
                    className="mt-2 h-2.5 rounded-full bg-card"
                    role="meter"
                    aria-label={label}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={value}
                    aria-valuetext={`${value} out of 100`}
                  >
                    <div className="h-full rounded-full" style={{ width: `${value}%`, background: color }} />
                  </div>
                )}
                <p className="mt-2 text-xs text-muted-foreground">{source}</p>
              </div>
            ))}
          </div>
          <section aria-labelledby="participant-behaviors" className="grid gap-4">
            <h2 id="participant-behaviors" className="font-heading text-xl">
              Participant behaviors
            </h2>
            <MeetingCharts analysis={analysis} />
          </section>
        </CardContent>
      </Card>

      <MinutesPanel
        analysis={analysis}
        fileName={fileName}
        emails={emails}
        meetingDate={meetingDate}
        today={today}
      />

      <div className="grid gap-3">
        {analysis.speakers.map((speaker, index) => (
          <Card key={speaker.name} size="sm" className="border-l-4" style={{ borderLeftColor: speakerColor(index) }}>
            <CardHeader>
              <div className="flex items-start justify-between gap-3">
                <CardTitle>{speaker.name}</CardTitle>
                <Badge variant={badgeVariant(speaker.guidance)}>{speaker.guidanceTitle}</Badge>
              </div>
              <CardDescription>
                {percent(speaker.wordShare)}% of words · {speaker.turns} turns
                {speaker.role ? ` · ${speaker.role}` : ""}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2">
              <div
                className="h-2 overflow-hidden rounded-full bg-muted"
                role="meter"
                aria-label={`${speaker.name} word share`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percent(speaker.wordShare)}
                aria-valuetext={`${percent(speaker.wordShare)} percent of the words`}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(percent(speaker.wordShare), speaker.turns ? 2 : 0)}%`,
                    background: speakerColor(index),
                  }}
                />
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {BEHAVIORS.map((behavior) => (
                  <li
                    key={behavior.key}
                    className="inline-flex min-h-8 items-center gap-1.5 rounded-full border border-border bg-card px-2 py-1 text-xs"
                  >
                    <span className="size-2.5 rounded-full" style={{ background: behavior.color }} aria-hidden="true" />
                    {behavior.label} {speaker[behavior.key]}
                  </li>
                ))}
              </ul>
              <p>{speaker.guidanceBody}</p>
              {speaker.quote ? (
                <p className="border-l-2 border-primary/40 pl-3 text-sm text-muted-foreground">
                  “{speaker.quote}”
                </p>
              ) : null}
              {speaker.personalCriticism > 0 ? (
                <p className="text-sm">
                  One line aimed at a person. Keep the point about the work and drop the label.
                </p>
              ) : null}
              {speaker.noteFit ? (
                <p className="text-sm text-muted-foreground">{speaker.noteFit}</p>
              ) : null}
              <p className="text-sm">
                <span className="font-medium">Try: </span>
                {speaker.script}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {analysis.charter.provided ? (
        <Card size="sm">
          <CardHeader>
            <CardTitle>Charter check</CardTitle>
            <CardDescription>
              {analysis.charter.gaps.length === 0
                ? "No gap found between these norms and this meeting."
                : `${analysis.charter.gaps.length} places where the meeting left the charter.`}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3">
            {analysis.charter.gaps.map((gap) => (
              <div key={gap.title}>
                <p className="font-medium">{gap.title}</p>
                <p className="text-sm text-muted-foreground">{gap.detail}</p>
              </div>
            ))}
            {analysis.charter.unchecked ? (
              <p className="text-sm text-muted-foreground">{analysis.charter.unchecked}</p>
            ) : null}
          </CardContent>
        </Card>
      ) : null}
    </>
  );
}

function subscribeToday() {
  return () => {};
}

function todayIso() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function badgeVariant(guidance: Analysis["speakers"][number]["guidance"]) {
  if (guidance === "yield") return "default" as const;
  if (guidance === "absent") return "destructive" as const;
  if (guidance === "invite") return "secondary" as const;
  return "outline" as const;
}

function EvidenceAccordion() {
  return (
    <section className="mt-6">
      <h2 className="font-heading mb-2 text-xl">Why these measures</h2>
      <Accordion>
        <AccordionItem value="floor">
          <AccordionTrigger>Floor equality</AccordionTrigger>
          <AccordionContent>
            Woolley, Chabris, Pentland, Hashmi, and Malone (2010) found a collective intelligence factor in groups. It tracked with equal conversational turn-taking and social sensitivity, more than with the average intelligence of the members. The ring and the bars are each person’s share of words. The dark line is an even share. People listed on the roster who never speak count as zero.
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="safety">
          <AccordionTrigger>Learning signals</AccordionTrigger>
          <AccordionContent>
            Edmondson (1999) linked psychological safety with learning behavior: asking questions, admitting uncertainty, and raising disagreement. This is a count of those behaviors in one transcript. It is not a test of whether the team is safe. Personal criticism is scored apart from idea challenge because Jehn (1995) found that relationship conflict hurts even when task conflict can help.
          </AccordionContent>
        </AccordionItem>
        <AccordionItem value="charter">
          <AccordionTrigger>Charter fit and the next launch</AccordionTrigger>
          <AccordionContent>
            Mathieu and Rapp (2009) found that a high-quality team charter improves performance when the team actually uses it. The check compares a norm such as “everyone speaks before we decide” with the first decision line. Hackman (2002) argued that coaching helps most at the launch, the midpoint, and the reflection after a performance. A recorded meeting sits between reflection and the next launch, so the tool gives one script rather than a stack of tips.
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </section>
  );
}
