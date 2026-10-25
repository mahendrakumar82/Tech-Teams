import { transcriptFromChunks } from "./video-assets";

type SpeechChunk = { text: string; timestamp: [number, number] };
type SpeechOutput = { text?: string; chunks?: SpeechChunk[] };
type Transcriber = (audio: string, options?: Record<string, unknown>) => Promise<SpeechOutput>;
type SpeechToolkit = {
  pipeline: (
    task: "automatic-speech-recognition",
    model: string,
    options?: Record<string, unknown>,
  ) => Promise<Transcriber>;
  env: {
    allowLocalModels: boolean;
  };
};

type Ffmpeg = {
  load: (config?: {
    classWorkerURL?: string;
    coreURL?: string;
    wasmURL?: string;
  }) => Promise<boolean>;
  writeFile: (path: string, data: Uint8Array) => Promise<boolean>;
  readFile: (path: string) => Promise<Uint8Array | string>;
  deleteFile: (path: string) => Promise<boolean>;
  exec: (args: string[]) => Promise<number>;
  on: (
    event: "progress" | "log",
    callback: (event: { progress?: number; message?: string }) => void,
  ) => void;
};

const SPEECH_MODULE = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1";
const FFMPEG_MODULE = "https://cdn.jsdelivr.net/npm/@ffmpeg/ffmpeg@0.12.15/+esm";
const CORE_BASE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.9/dist/esm";

function importFrom(specifier: string): Promise<Record<string, unknown>> {
  const load = new Function(
    "specifier",
    "return import(specifier)",
  ) as (specifier: string) => Promise<Record<string, unknown>>;
  return load(specifier);
}

let model: Promise<Transcriber> | null = null;
let reader: Promise<Ffmpeg> | null = null;
let report: (message: string) => void = () => {};
let readerLog = "";

async function loadToolkit(): Promise<SpeechToolkit> {
  return importFrom(SPEECH_MODULE) as Promise<SpeechToolkit>;
}

function getTranscriber(onProgress: (message: string) => void): Promise<Transcriber> {
  if (!model) {
    model = loadToolkit()
      .then(({ pipeline, env }) => {
        env.allowLocalModels = false;
        return pipeline("automatic-speech-recognition", "Xenova/whisper-tiny.en", {
          dtype: "q8",
          device: "wasm",
          progress_callback: (update: { status?: string; progress?: number }) => {
            if (update.status === "progress" && typeof update.progress === "number") {
              onProgress(`Downloading the speech model (${Math.round(update.progress)}%).`);
            } else if (update.status === "initiate" || update.status === "download") {
              onProgress("Downloading the speech model. The first MP4 can take a minute.");
            }
          },
        });
      })
      .catch((error: unknown) => {
        model = null;
        throw error;
      });
  }
  return model;
}

async function getReader(onProgress: (message: string) => void): Promise<Ffmpeg> {
  report = onProgress;
  if (!reader) {
    reader = (async () => {
      onProgress("Loading the video reader. The first time can take a minute.");
      const ffmpegModule = await importFrom(FFMPEG_MODULE);
      const FFmpeg = ffmpegModule.FFmpeg as new () => Ffmpeg;
      const ffmpeg = new FFmpeg();
      ffmpeg.on("progress", ({ progress }) => {
        const pct = Math.max(0, Math.min(100, Math.round((progress ?? 0) * 100)));
        report(`Pulling out the soundtrack (${pct}%).`);
      });
      ffmpeg.on("log", ({ message }) => {
        if (message) readerLog = `${readerLog}\n${message}`.slice(-800);
      });
      const download = async (file: string, mime: string) => {
        const response = await fetch(`${CORE_BASE}/${file}`);
        if (!response.ok) {
          throw new Error("The video reader could not download. Check your connection and try the MP4 again.");
        }
        const bytes = await response.arrayBuffer();
        return URL.createObjectURL(new Blob([bytes], { type: mime }));
      };
      await ffmpeg.load({
        classWorkerURL: `${location.origin}/ffmpeg/worker.js`,
        coreURL: await download("ffmpeg-core.js", "text/javascript"),
        wasmURL: await download("ffmpeg-core.wasm", "application/wasm"),
      });
      return ffmpeg as Ffmpeg;
    })().catch((error: unknown) => {
      reader = null;
      throw error;
    });
  }
  return reader;
}

async function removeQuiet(ffmpeg: Ffmpeg, path: string) {
  try {
    await ffmpeg.deleteFile(path);
  } catch {
    // The file is absent when an earlier step failed.
  }
}

async function soundtrackWav(file: File, onProgress: (message: string) => void): Promise<Blob> {
  const ffmpeg = await getReader(onProgress);
  readerLog = "";
  onProgress("Opening the video and pulling out the soundtrack.");
  await removeQuiet(ffmpeg, "input.mp4");
  await removeQuiet(ffmpeg, "output.wav");
  await ffmpeg.writeFile("input.mp4", new Uint8Array(await file.arrayBuffer()));
  try {
    const code = await ffmpeg.exec([
      "-i",
      "input.mp4",
      "-vn",
      "-ac",
      "1",
      "-ar",
      "16000",
      "-f",
      "wav",
      "output.wav",
    ]);
    if (code !== 0) {
      throw new Error(soundtrackError(file.name));
    }
    const raw = await ffmpeg.readFile("output.wav");
    if (typeof raw === "string" || raw.byteLength < 1000) {
      throw new Error(`${file.name} has no soundtrack the tool can hear.`);
    }
    const copy = new Uint8Array(raw.byteLength);
    copy.set(raw);
    return new Blob([copy], { type: "audio/wav" });
  } finally {
    await removeQuiet(ffmpeg, "input.mp4");
    await removeQuiet(ffmpeg, "output.wav");
  }
}

function soundtrackError(fileName: string): string {
  if (/does not contain any stream|Output file is empty|matches no streams|Invalid data found/i.test(readerLog)) {
    return `${fileName} has no soundtrack the tool can hear.`;
  }
  return `${fileName} could not be opened as a video. Export it again as an MP4, or paste a transcript.`;
}

function explain(error: unknown): Error {
  if (!(error instanceof Error)) return new Error("Could not open this video.");
  if (/does not support nodejs/i.test(error.message)) {
    return new Error("The video reader loaded in the wrong place. Refresh the page and try the MP4 again.");
  }
  if (/Failed to fetch|NetworkError|dynamically imported module|cannot be accessed from origin/i.test(error.message)) {
    return new Error("The video reader could not download. Check your connection and try the MP4 again.");
  }
  return error;
}

export async function transcribeMp4(
  file: File,
  onProgress: (message: string) => void,
): Promise<string> {
  let wav: Blob;
  try {
    wav = await soundtrackWav(file, onProgress);
  } catch (error) {
    throw explain(error);
  }
  onProgress("Loading the speech model. A long meeting can take about as long as the video.");
  const transcriber = await getTranscriber(onProgress);
  const url = URL.createObjectURL(wav);
  try {
    onProgress("Transcribing. This stays on your computer.");
    const output = await transcriber(url, {
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
    });
    return transcriptFromChunks(file.name, output.chunks ?? [], output.text ?? "");
  } finally {
    URL.revokeObjectURL(url);
  }
}
