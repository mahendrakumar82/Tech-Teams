import { percent, speakerColor } from "@/lib/format";
import type { SpeakerReport } from "@/lib/types";

export function FloorRing({
  speakers,
  equality,
}: {
  speakers: SpeakerReport[];
  equality: number;
}) {
  const radius = 68;
  const circumference = 2 * Math.PI * radius;
  const arcs = speakers.reduce<
    { name: string; index: number; share: number; length: number; dashOffset: number }[]
  >((list, speaker, index) => {
    if (speaker.wordShare <= 0) return list;
    const used = list.reduce((sum, arc) => sum + arc.share, 0);
    return [
      ...list,
      {
        name: speaker.name,
        index,
        share: speaker.wordShare,
        length: Math.max(speaker.wordShare * circumference - 1.5, 0),
        dashOffset: -used * circumference,
      },
    ];
  }, []);

  const summary = speakers
    .map((speaker) => `${speaker.name} ${percent(speaker.wordShare)} percent`)
    .join(", ");

  return (
    <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center">
      <div className="relative size-44 shrink-0">
        <svg
          viewBox="0 0 200 200"
          className="size-full"
          role="img"
          aria-label={`Word share ring. Equality ${equality} out of 100. ${summary}`}
        >
          <g transform="rotate(-90 100 100)">
            <circle cx="100" cy="100" r={radius} fill="none" stroke="var(--border)" strokeWidth="18" />
            {arcs.map((arc) => (
              <circle
                key={arc.name}
                cx="100"
                cy="100"
                r={radius}
                fill="none"
                stroke={speakerColor(arc.index)}
                strokeWidth="18"
                strokeDasharray={`${arc.length} ${circumference - arc.length}`}
                strokeDashoffset={arc.dashOffset}
              >
                <title>
                  {arc.name}: {percent(arc.share)} percent of the words
                </title>
              </circle>
            ))}
          </g>
        </svg>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="font-heading text-3xl leading-none">{equality}</span>
          <span className="text-xs text-muted-foreground">equality</span>
        </div>
      </div>
      <ul className="grid w-full gap-1.5 text-sm">
        {speakers.map((speaker, index) => (
          <li key={speaker.name} className="flex items-center gap-2">
            <span
              className="size-3 rounded-full"
              style={{ background: speakerColor(index) }}
              aria-hidden="true"
            />
            <span className="flex-1">{speaker.name}</span>
            <span className="tabular-nums">
              {percent(speaker.wordShare)}%
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
