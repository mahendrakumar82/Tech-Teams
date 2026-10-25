export const MAX_WORD_BYTES = 15 * 1024 * 1024;

const END_OF_CHAIN = 0xfffffffe;

export function isWordDocument(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith(".doc") ||
    name.endsWith(".docx") ||
    file.type === "application/msword" ||
    file.type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  );
}

export async function readWordText(bytes: Uint8Array, fileName: string): Promise<string> {
  if (bytes.length >= 2 && bytes[0] === 0x50 && bytes[1] === 0x4b) {
    return textFromDocx(await unzip(bytes), fileName);
  }
  if (bytes.length >= 8 && bytes[0] === 0xd0 && bytes[1] === 0xcf && bytes[2] === 0x11 && bytes[3] === 0xe0) {
    return textFromDoc(bytes, fileName);
  }
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 200))).trim();
  if (head.startsWith("<?xml") || head.startsWith("<w:wordDocument") || head.startsWith("<pkg:package")) {
    const text = paragraphsFromXml(new TextDecoder().decode(bytes));
    if (text) return text;
  }
  throw new Error(`${fileName} is not a Word document this page can read. Save it as .docx and try again.`);
}

async function textFromDocx(files: Map<string, Uint8Array>, fileName: string): Promise<string> {
  const document = files.get("word/document.xml");
  if (!document) throw new Error(`${fileName} does not contain a Word document.`);
  const text = paragraphsFromXml(new TextDecoder().decode(document));
  if (!text) throw new Error(`${fileName} did not contain readable text.`);
  return text;
}

function paragraphsFromXml(xml: string): string {
  const lines: string[] = [];
  for (const chunk of xml.split(/<w:p[\s>]/)) {
    const body = chunk.split("</w:p>")[0] ?? "";
    const parts: string[] = [];
    for (const match of body.matchAll(/<w:tab\/>|<w:br\/>|<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>/g)) {
      if (match[0] === "<w:tab/>") parts.push("\t");
      else if (match[0] === "<w:br/>") parts.push("\n");
      else parts.push(decodeXml(match[1] ?? ""));
    }
    const line = parts.join("").replace(/[ \t]+\n/g, "\n").trim();
    if (line) lines.push(line);
  }
  return lines.join("\n");
}

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function textFromDoc(bytes: Uint8Array, fileName: string): string {
  const streams = readCompoundStreams(bytes);
  const word = streams.get("worddocument");
  if (!word) throw new Error(`${fileName} does not contain a Word document.`);
  const flags = word.length >= 12 ? word[0x0a] | (word[0x0b] << 8) : 0;
  const table = streams.get(flags & 0x0200 ? "1table" : "0table");
  const ccpText = word.length >= 0x50 ? viewAt(word).getUint32(0x4c, true) : 0;
  const fcClx = word.length >= 0x1a6 ? viewAt(word).getUint32(0x1a2, true) : 0;
  const lcbClx = word.length >= 0x1aa ? viewAt(word).getUint32(0x1a6, true) : 0;
  if (table && ccpText > 0 && lcbClx > 0 && fcClx + lcbClx <= table.length) {
    const text = textFromPieces(word, table.subarray(fcClx, fcClx + lcbClx), ccpText);
    if (text.trim()) return text.trim();
  }
  const scanned = scanReadableText(word);
  if (scanned) return scanned;
  throw new Error(`${fileName} did not contain readable text.`);
}

function textFromPieces(word: Uint8Array, clx: Uint8Array, ccpText: number): string {
  let index = 0;
  const view = viewAt(clx);
  while (index < clx.length && clx[index] === 0x01) {
    const size = view.getUint16(index + 1, true);
    index += 3 + size;
  }
  if (clx[index] !== 0x02) return "";
  const length = view.getUint32(index + 1, true);
  const pieces = clx.subarray(index + 5, index + 5 + length);
  const pieceView = viewAt(pieces);
  const count = Math.floor((length - 4) / 12);
  if (count <= 0) return "";
  const characters: number[] = [];
  for (let piece = 0; piece <= count; piece += 1) characters.push(pieceView.getUint32(piece * 4, true));
  let text = "";
  for (let piece = 0; piece < count; piece += 1) {
    const start = characters[piece] ?? 0;
    const end = characters[piece + 1] ?? start;
    if (end <= 0 || start >= ccpText) continue;
    const from = Math.max(0, start);
    const to = Math.min(ccpText, end);
    const descriptor = pieceView.getUint32((count + 1) * 4 + piece * 8 + 2, true);
    const compressed = (descriptor & 0x40000000) !== 0;
    const position = descriptor & 0x3fffffff;
    const offset = compressed ? position / 2 + (from - start) : position + (from - start) * 2;
    const amount = to - from;
    if (compressed) {
      text += new TextDecoder("windows-1252").decode(word.subarray(offset, offset + amount));
    } else {
      text += new TextDecoder("utf-16le").decode(word.subarray(offset, offset + amount * 2));
    }
  }
  return text.replace(/\r/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim();
}

function scanReadableText(bytes: Uint8Array): string {
  const lines: string[] = [];
  let current = "";
  for (let index = 0; index + 1 < bytes.length; index += 2) {
    const code = bytes[index] | (bytes[index + 1] << 8);
    if (code === 13 || code === 10) {
      if (current.trim().length > 1) lines.push(current.trim());
      current = "";
    } else if (code >= 32 && code !== 0xfffe && code !== 0xffff) {
      current += String.fromCharCode(code);
    } else if (current.trim().length > 8) {
      lines.push(current.trim());
      current = "";
    } else {
      current = "";
    }
  }
  if (current.trim().length > 1) lines.push(current.trim());
  return lines.join("\n");
}

type CompoundEntry = {
  name: string;
  type: number;
  left: number;
  right: number;
  child: number;
  start: number;
  size: number;
};

function readCompoundStreams(bytes: Uint8Array): Map<string, Uint8Array> {
  const header = viewAt(bytes);
  const sectorShift = header.getUint16(0x1e, true);
  const sectorSize = 2 ** sectorShift;
  const miniShift = header.getUint16(0x20, true);
  const miniSize = 2 ** miniShift;
  const fatCount = header.getUint32(0x2c, true);
  const directoryStart = header.getUint32(0x30, true);
  const miniCutoff = header.getUint32(0x38, true);
  const miniFatStart = header.getUint32(0x3c, true);
  const sector = (id: number) => bytes.subarray((id + 1) * sectorSize, (id + 2) * sectorSize);

  const fatSectorIds: number[] = [];
  for (let index = 0; index < Math.min(fatCount, 109); index += 1) {
    const id = header.getUint32(0x4c + index * 4, true);
    if (id <= 0x0ffffff0) fatSectorIds.push(id);
  }
  let difat = header.getUint32(0x44, true);
  let difatLeft = header.getUint32(0x48, true);
  while (difat <= 0x0ffffff0 && difatLeft > 0) {
    const block = sector(difat);
    const blockView = viewAt(block);
    const entries = sectorSize / 4;
    for (let index = 0; index < entries - 1; index += 1) {
      const id = blockView.getUint32(index * 4, true);
      if (id <= 0x0ffffff0) fatSectorIds.push(id);
    }
    difat = blockView.getUint32((entries - 1) * 4, true);
    difatLeft -= 1;
  }
  const fat: number[] = [];
  for (const id of fatSectorIds) {
    const blockView = viewAt(sector(id));
    for (let index = 0; index < sectorSize / 4; index += 1) fat.push(blockView.getUint32(index * 4, true));
  }

  const directoryBytes = readChain(directoryStart, Number.MAX_SAFE_INTEGER, fat, sectorSize, sector);
  const entries: CompoundEntry[] = [];
  const directoryView = viewAt(directoryBytes);
  for (let offset = 0; offset + 128 <= directoryBytes.length; offset += 128) {
    const nameLength = directoryView.getUint16(offset + 64, true);
    if (nameLength < 2) break;
    const name = new TextDecoder("utf-16le")
      .decode(directoryBytes.subarray(offset, offset + nameLength - 2))
      .replace(/\0/g, "");
    entries.push({
      name,
      type: directoryBytes[offset + 66] ?? 0,
      left: directoryView.getUint32(offset + 68, true),
      right: directoryView.getUint32(offset + 72, true),
      child: directoryView.getUint32(offset + 76, true),
      start: directoryView.getUint32(offset + 116, true),
      size: directoryView.getUint32(offset + 120, true),
    });
  }

  const root = entries[0];
  const miniStream = root
    ? readChain(root.start, root.size, fat, sectorSize, sector)
    : new Uint8Array();
  const miniFat = readMiniFat(miniFatStart, fat, sectorSize, sector);
  const streams = new Map<string, Uint8Array>();
  const seen = new Set<number>();
  const visit = (id: number) => {
    if (id > 0x0ffffff0 || seen.has(id)) return;
    seen.add(id);
    const entry = entries[id];
    if (!entry) return;
    visit(entry.left);
    if (entry.type === 2) {
      const data =
        entry.size < miniCutoff
          ? readChain(entry.start, entry.size, miniFat, miniSize, (mini) =>
              miniStream.subarray(mini * miniSize, (mini + 1) * miniSize),
            )
          : readChain(entry.start, entry.size, fat, sectorSize, sector);
      streams.set(entry.name.toLowerCase(), data);
    }
    visit(entry.right);
    visit(entry.child);
  };
  if (root) visit(root.child);
  return streams;
}

function readMiniFat(
  start: number,
  fat: number[],
  sectorSize: number,
  sector: (id: number) => Uint8Array,
): number[] {
  if (start > 0x0ffffff0) return [];
  const bytes = readChain(start, Number.MAX_SAFE_INTEGER, fat, sectorSize, sector);
  const mini: number[] = [];
  const miniView = viewAt(bytes);
  for (let offset = 0; offset + 4 <= bytes.length; offset += 4) mini.push(miniView.getUint32(offset, true));
  return mini;
}

function readChain(
  start: number,
  size: number,
  fat: number[],
  sectorSize: number,
  sector: (id: number) => Uint8Array,
): Uint8Array {
  if (start > 0x0ffffff0 || size === 0) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let sectorId = start;
  let remaining = size;
  const seen = new Set<number>();
  while (sectorId <= 0x0ffffff0 && remaining > 0 && !seen.has(sectorId)) {
    seen.add(sectorId);
    const block = sector(sectorId);
    const take = Math.min(sectorSize, remaining, block.length);
    chunks.push(block.subarray(0, take));
    remaining -= take;
    sectorId = fat[sectorId] ?? END_OF_CHAIN;
  }
  const out = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
  let cursor = 0;
  for (const chunk of chunks) {
    out.set(chunk, cursor);
    cursor += chunk.length;
  }
  return out;
}

function viewAt(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

async function unzip(data: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = viewAt(data);
  let end = -1;
  for (let index = data.length - 22; index >= Math.max(0, data.length - 22 - 65535); index -= 1) {
    if (view.getUint32(index, true) === 0x06054b50) {
      end = index;
      break;
    }
  }
  if (end < 0) throw new Error("This Word file could not be opened.");
  const count = view.getUint16(end + 10, true);
  let offset = view.getUint32(end + 16, true);
  const files = new Map<string, Uint8Array>();
  for (let index = 0; index < count; index += 1) {
    if (offset + 46 > data.length || view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const local = view.getUint32(offset + 42, true);
    const name = new TextDecoder().decode(data.subarray(offset + 46, offset + 46 + nameLength));
    const localName = view.getUint16(local + 26, true);
    const localExtra = view.getUint16(local + 28, true);
    const start = local + 30 + localName + localExtra;
    const compressed = data.subarray(start, start + compressedSize);
    files.set(name.replaceAll("\\", "/"), method === 0 ? compressed : await inflateRaw(compressed));
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return files;
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
