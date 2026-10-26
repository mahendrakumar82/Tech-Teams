export const MAX_VIDEO_BYTES = 400 * 1024 * 1024;
export const MAX_TEXT_BYTES = 1_000_000;

export type VideoStatus = "queued" | "transcribing" | "done" | "error";

export type VideoAsset = {
  id: string;
  name: string;
  url: string;
  size: number;
  status: VideoStatus;
  message: string;
};

export function isMp4(file: File): boolean {
  return file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4");
}

export function isTextTranscript(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type.startsWith("text/") ||
    name.endsWith(".txt") ||
    name.endsWith(".vtt") ||
    name.endsWith(".srt") ||
    name.endsWith(".md") ||
    name.endsWith(".text")
  );
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  const mb = bytes / (1024 * 1024);
  return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
}

export function formatStamp(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const clock = `${minutes}:${secs.toString().padStart(2, "0")}`;
  return hours > 0 ? `${hours}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}` : clock;
}

export function transcriptFromChunks(
  fileName: string,
  chunks: { text: string; timestamp: [number, number] }[],
  fallbackText: string,
): string {
  const lines = chunks
    .map((chunk) => {
      const text = chunk.text.replace(/\s+/g, " ").trim();
      if (!text) return "";
      return `[${formatStamp(chunk.timestamp[0] ?? 0)}] Speaker: ${text}`;
    })
    .filter(Boolean);

  if (lines.length === 0 && fallbackText.trim()) {
    lines.push(`Speaker: ${fallbackText.replace(/\s+/g, " ").trim()}`);
  }
  if (lines.length === 0) {
    throw new Error(`${fileName} did not contain speech the tool could hear.`);
  }
  return [`NOTE ${fileName}`, ...lines].join("\n");
}
