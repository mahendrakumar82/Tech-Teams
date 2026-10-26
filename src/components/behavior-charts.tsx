import { FloorRing } from "@/components/floor-ring";
import { percent, speakerColor } from "@/lib/format";
import type { Analysis, SpeakerReport, Utterance, UtteranceFlags } from "@/lib/types";

export const BEHAVIORS = [
  { key: "questions", label: "Questions", color: "var(--chart-3)" },
  { key: "uncertainty", label: "Uncertainty", color: "var(--chart-2)" },
  { key: "challenges", label: "Idea challenge", color: "var(--chart-4)" },
  { key: "invitations", label: "Invitations", color: "var(--speaker-3)" },
  { key: "builds", label: "Builds", color: "var(--chart-5)" },
  { key: "personalCriticism", label: "Personal criticism", color: "var(--destructive)" },
] as const;

const MARKS = [
  { kind: "turn", label: "Circle: a turn, in that person’s color" },
  { kind: "learning", label: "Ring: a question, uncertainty, or an invitation" },
  { kind: "challenge", label: "Triangle: idea challenge, or building on an idea" },
  { kind: "decision", label: "Square: a decision line" },
  { kind: "criticism", label: "Diamond: personal criticism" },
] as const;

type MarkKind = (typeof MARKS)[number]["kind"];

export function MeetingCharts({ analysis }: { analysis: Analysis }) {
  return (
    <div className="grid gap-4">
      <FloorCompare analysis={analysis} />
      <BehaviorBars speakers={analysis.speakers} />
      <TurnLanes analysis={analysis} />
      <SignalBars safety={analysis.safety} />
    </div>
  );
}

function FloorCompare({ analysis }: { analysis: Analysis }) {
  const even = percent(analysis.evenShare);
  return (
    <figure className="grid gap-3">
      <figcaption>
        <h3 className="font-heading text-base">Who held the floor</h3>
        <p className="text-sm text-muted-foreground">
          Each bar is that person’s share of the words. The dark line is an even share, {even}% each.
          A name with 0% was on the roster and did not speak.
        </p>
      </figcaption>
      <FloorRing speakers={analysis.speakers} equality={analysis.equality} />
      <div className="grid gap-2">
        {analysis.speakers.map((speaker, index) => {
          const share = percent(speaker.wordShare);
          return (
            <div key={speaker.name} className="grid grid-cols-[7.5rem_1fr_3rem] items-center gap-2">
              <span className="truncate text-sm font-medium">{speaker.name}</span>
              <div
                className="relative h-3 rounded-full bg-muted"
                role="meter"
                aria-label={`${speaker.name} word share`}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={share}
                aria-valuetext={`${share} percent, even share is ${even} percent`}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${share}%`,
                    background: speakerColor(index),
                  }}
                />
                <span
                  className="absolute top-[-3px] h-[18px] w-0.5 bg-foreground"
                  style={{ left: `${even}%` }}
                  aria-hidden="true"
                />
              </div>
              <span className="text-right text-sm tabular-nums" aria-hidden="true">
                {share}%
              </span>
            </div>
          );
        })}
      </div>
    </figure>
  );
}

function BehaviorBars({ speakers }: { speakers: SpeakerReport[] }) {
  const max = Math.max(
    1,
    ...speakers.flatMap((speaker) => BEHAVIORS.map((behavior) => speaker[behavior.key])),
  );
  const any = speakers.some((speaker) => BEHAVIORS.some((behavior) => speaker[behavior.key] > 0));

  return (
    <figure className="grid gap-3">
      <figcaption>
        <h3 className="font-heading text-base">Learning behaviors</h3>
        <p className="text-sm text-muted-foreground">
          Counted from the words people said. A question mark is not required. A colored bar means those words showed up. An empty slot with 0 means they did not. The number is how many times.
        </p>
      </figcaption>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {BEHAVIORS.map((behavior) => (
          <li key={behavior.key} className="flex items-center gap-1.5">
            <span className="size-3 rounded-sm" style={{ background: behavior.color }} aria-hidden="true" />
            {behavior.label}
          </li>
        ))}
      </ul>
      {any ? (
        <div className="grid gap-4">
          {speakers.map((speaker, index) => (
            <section key={speaker.name} aria-labelledby={`behavior-${index}-${speaker.name.replace(/\s+/g, "-")}`} className="grid gap-1.5">
              <h4 id={`behavior-${index}-${speaker.name.replace(/\s+/g, "-")}`} className="flex items-center gap-2 text-sm font-medium">
                <span className="size-3 rounded-full" style={{ background: speakerColor(index) }} aria-hidden="true" />
                {speaker.name}
              </h4>
              {speaker.turns === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {`No speaking turns were attached to this name, so these behaviors could not be counted. Put their words on the next lines, or write ${speaker.name}: what they said.`}
                </p>
              ) : BEHAVIORS.every((behavior) => speaker[behavior.key] === 0) ? (
                <p className="text-sm text-muted-foreground">
                  Their words were read. None of the phrases counted for these six behaviors showed up.
                </p>
              ) : null}
              {BEHAVIORS.map((behavior) => (
                <BehaviorMeter
                  key={behavior.key}
                  label={behavior.label}
                  count={speaker[behavior.key]}
                  max={max}
                  color={behavior.color}
                />
              ))}
            </section>
          ))}
        </div>
      ) : (
        <p className="text-sm">No questions, uncertainty, challenge, invitations, builds, or personal criticism were counted.</p>
      )}
      <div className="sr-only">
      <table>
        <caption>Learning behaviors by participant</caption>
        <thead>
          <tr>
            <th>Person</th>
            {BEHAVIORS.map((behavior) => (
              <th key={behavior.key}>{behavior.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {speakers.map((speaker) => (
            <tr key={speaker.name}>
              <th scope="row">{speaker.name}</th>
              {BEHAVIORS.map((behavior) => (
                <td key={behavior.key}>{speaker[behavior.key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </figure>
  );
}

function BehaviorMeter({
  label,
  count,
  max,
  color,
}: {
  label: string;
  count: number;
  max: number;
  color: string;
}) {
  const width = count === 0 ? 0 : Math.max((count / max) * 100, 12);
  return (
    <div className="grid min-w-0 grid-cols-[8.5rem_minmax(5.5rem,1fr)_2rem] items-center gap-2">
      <span className="text-sm text-foreground">{label}</span>
      <div
        className="h-4 overflow-hidden rounded-full border border-[oklch(0.82_0.04_250)] bg-[oklch(0.94_0.02_250)]"
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={max}
        aria-valuenow={count}
        aria-valuetext={count === 0 ? "0, none in this meeting" : String(count)}
      >
        <div
          className="h-full rounded-full"
          style={{ width: `${width}%`, background: color }}
        />
      </div>
      <span className="text-right text-sm font-semibold tabular-nums text-foreground">{count}</span>
    </div>
  );
}

function TurnLanes({ analysis }: { analysis: Analysis }) {
  const turns = analysis.utterances;
  if (turns.length === 0) return null;
  const width = turns.length * 28;

  return (
    <figure className="grid gap-3">
      <figcaption>
        <h3 className="font-heading text-base">Who spoke, in order</h3>
        <p className="text-sm text-muted-foreground">
          One mark per turn, left to right. Shape names the behavior.
        </p>
      </figcaption>
      <ul className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {MARKS.map((mark) => (
          <li key={mark.kind} className="flex items-center gap-1.5">
            <MarkGlyph kind={mark.kind} />
            {mark.label}
          </li>
        ))}
      </ul>
      <div
        className="overflow-x-auto rounded-lg border border-border bg-card p-2 focus-visible:outline-3"
        tabIndex={0}
        aria-label="Who spoke on each turn. Scroll sideways when the meeting is long."
      >
        <div className="grid gap-1" style={{ minWidth: width + 132 }}>
          {analysis.speakers.map((speaker, index) => {
            const mine = turns.filter((turn) => turn.speaker === speaker.name);
            return (
              <div key={speaker.name} className="grid grid-cols-[7.5rem_1fr] items-center gap-2">
                <span className="truncate text-sm font-medium">{speaker.name}</span>
                <svg
                  viewBox={`0 0 ${width} 32`}
                  className="h-8 w-full"
                  role="img"
                  aria-label={laneLabel(speaker, mine)}
                >
                  <line x1="0" x2={width} y1="16" y2="16" stroke="var(--border)" strokeWidth="2" />
                  {turns.map((turn, position) =>
                    turn.speaker === speaker.name ? (
                      <TurnMark
                        key={turn.index}
                        x={position * 28 + 14}
                        kind={markKind(turn.flags)}
                        color={speakerColor(index)}
                        label={markLabel(turn)}
                      />
                    ) : null,
                  )}
                </svg>
              </div>
            );
          })}
        </div>
      </div>
    </figure>
  );
}

function laneLabel(speaker: SpeakerReport, turns: Utterance[]): string {
  const bits = [`${speaker.name}: ${turns.length} turns`];
  for (const behavior of BEHAVIORS) {
    const count = speaker[behavior.key];
    if (count > 0) bits.push(`${count} ${behavior.label.toLowerCase()}`);
  }
  return bits.join(", ");
}

function markLabel(turn: Utterance): string {
  const flags = Object.entries(turn.flags)
    .filter(([, on]) => on)
    .map(([name]) => name);
  const detail = flags.length > 0 ? flags.join(", ") : "statement";
  return `Turn ${turn.index + 1}, ${turn.speaker}, ${detail}, ${turn.words} words`;
}

function markKind(flags: UtteranceFlags): MarkKind {
  if (flags.criticism) return "criticism";
  if (flags.decision) return "decision";
  if (flags.challenge || flags.build) return "challenge";
  if (flags.question || flags.uncertainty || flags.invitation) return "learning";
  return "turn";
}

function TurnMark({
  x,
  kind,
  color,
  label,
}: {
  x: number;
  kind: MarkKind;
  color: string;
  label: string;
}) {
  if (kind === "decision") {
    return (
      <rect x={x - 6} y={10} width="12" height="12" rx="2" fill="var(--chart-4)">
        <title>{label}</title>
      </rect>
    );
  }
  if (kind === "criticism") {
    return (
      <polygon points={`${x},8 ${x + 7},16 ${x},24 ${x - 7},16`} fill="var(--destructive)">
        <title>{label}</title>
      </polygon>
    );
  }
  if (kind === "challenge") {
    return (
      <polygon points={`${x},8 ${x + 7},23 ${x - 7},23`} fill="var(--chart-5)">
        <title>{label}</title>
      </polygon>
    );
  }
  if (kind === "learning") {
    return (
      <g>
        <title>{label}</title>
        <circle cx={x} cy="16" r="6.5" fill="var(--card)" stroke="var(--chart-3)" strokeWidth="2.5" />
        <circle cx={x} cy="16" r="2.5" fill="var(--chart-3)" />
      </g>
    );
  }
  return (
    <circle cx={x} cy="16" r="5" fill={color}>
      <title>{label}</title>
    </circle>
  );
}

function MarkGlyph({ kind }: { kind: MarkKind }) {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" aria-hidden="true">
      {kind === "turn" ? <circle cx="8" cy="8" r="4" fill="var(--speaker-1)" /> : null}
      {kind === "learning" ? (
        <>
          <circle cx="8" cy="8" r="5" fill="none" stroke="var(--chart-3)" strokeWidth="2" />
          <circle cx="8" cy="8" r="1.6" fill="var(--chart-3)" />
        </>
      ) : null}
      {kind === "challenge" ? <polygon points="8,2 14,14 2,14" fill="var(--chart-5)" /> : null}
      {kind === "decision" ? <rect x="3" y="3" width="10" height="10" rx="1.5" fill="var(--chart-4)" /> : null}
      {kind === "criticism" ? <polygon points="8,1 15,8 8,15 1,8" fill="var(--destructive)" /> : null}
    </svg>
  );
}

const SIGNALS = [
  { key: "uncertainty", label: "Uncertainty spread", hint: "How many speakers admitted they were unsure" },
  { key: "challenge", label: "Idea challenge", hint: "How many speakers pushed on an idea" },
  { key: "questions", label: "Questions", hint: "Questions across the people who spoke" },
  { key: "respect", label: "Respect", hint: "Starts at 25 and drops when a remark aims at a person" },
] as const;

function SignalBars({ safety }: { safety: Analysis["safety"] }) {
  return (
    <figure className="grid gap-3">
      <figcaption>
        <h3 className="font-heading text-base">Where the learning score comes from</h3>
        <p className="text-sm text-muted-foreground">
          Four parts, 25 points each. {safety.summary}
        </p>
      </figcaption>
      <div className="grid gap-2">
        {SIGNALS.map((signal) => {
          const value = safety[signal.key];
          return (
            <div key={signal.key} className="grid gap-1">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="font-medium">{signal.label}</span>
                <span className="tabular-nums" aria-hidden="true">
                  {value}/25
                </span>
              </div>
              <div
                className="h-4 overflow-hidden rounded-full border border-[oklch(0.82_0.04_250)] bg-[oklch(0.94_0.02_250)]"
                role="meter"
                aria-label={signal.label}
                aria-valuemin={0}
                aria-valuemax={25}
                aria-valuenow={value}
                aria-valuetext={`${value} out of 25. ${signal.hint}`}
              >
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max((value / 25) * 100, value > 0 ? 8 : 0)}%`,
                    background:
                      signal.key === "respect"
                        ? "var(--speaker-3)"
                        : signal.key === "questions"
                          ? "var(--chart-3)"
                          : signal.key === "challenge"
                            ? "var(--chart-4)"
                            : "var(--chart-2)",
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground">{signal.hint}</p>
            </div>
          );
        })}
      </div>
    </figure>
  );
}
