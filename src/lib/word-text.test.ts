import assert from "node:assert/strict";
import { deflateRawSync } from "node:zlib";
import test from "node:test";
import { readWordText } from "./word-text";

const DOCUMENT = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Morgan: We should open.</w:t></w:r></w:p>
    <w:p><w:r><w:t>Priya: I am not sure &amp; the rent.</w:t></w:r></w:p>
  </w:body>
</w:document>`;

test("a docx keeps each paragraph as a transcript line", async () => {
  const text = await readWordText(storedDocx(DOCUMENT), "meeting.docx");
  assert.equal(text, "Morgan: We should open.\nPriya: I am not sure & the rent.");
});

test("a compressed docx reads the same paragraphs", async () => {
  const text = await readWordText(deflatedDocx(DOCUMENT), "meeting.docx");
  assert.equal(text, "Morgan: We should open.\nPriya: I am not sure & the rent.");
});

test("a doc file keeps the speaker lines", async () => {
  const spoken = "Morgan: We should open.\rPriya: I am not sure.";
  const text = await readWordText(compoundDoc(spoken), "meeting.doc");
  assert.equal(text, "Morgan: We should open.\nPriya: I am not sure.");
});

function storedDocx(xml: string): Uint8Array {
  return zip([{ name: "word/document.xml", data: new TextEncoder().encode(xml) }]);
}

function deflatedDocx(xml: string): Uint8Array {
  const raw = new TextEncoder().encode(xml);
  return zip([{ name: "word/document.xml", data: raw, compressed: deflateRawSync(raw) }]);
}

function zip(files: { name: string; data: Uint8Array; compressed?: Uint8Array }[]): Uint8Array {
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = new TextEncoder().encode(file.name);
    const stored = file.compressed ?? file.data;
    const method = file.compressed ? 8 : 0;
    const local = new Uint8Array(30 + name.length + stored.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(8, method, true);
    view.setUint32(18, stored.length, true);
    view.setUint32(22, file.data.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(stored, 30 + name.length);
    locals.push(local);
    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(10, method, true);
    centralView.setUint32(20, stored.length, true);
    centralView.setUint32(24, file.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    central.set(name, 46);
    centrals.push(central);
    offset += local.length;
  }
  const directorySize = centrals.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true);
  const out = new Uint8Array(offset + directorySize + end.length);
  let cursor = 0;
  for (const part of [...locals, ...centrals, end]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

function compoundDoc(spoken: string): Uint8Array {
  const sectorSize = 512;
  const word = new Uint8Array(4200);
  const table = new Uint8Array(4200);
  const characters = new TextEncoder().encode(spoken.replaceAll("\r", "\r"));
  const utf16 = new Uint8Array(spoken.length * 2);
  for (let index = 0; index < spoken.length; index += 1) {
    utf16[index * 2] = spoken.charCodeAt(index);
  }
  word.set(utf16, 256);
  word[0x0b] = 0x02;
  const wordView = new DataView(word.buffer);
  wordView.setUint32(0x4c, spoken.length, true);
  wordView.setUint32(0x1a2, 0, true);
  wordView.setUint32(0x1a6, 21, true);
  const piece = new Uint8Array(21);
  const pieceView = new DataView(piece.buffer);
  piece[0] = 0x02;
  pieceView.setUint32(1, 16, true);
  pieceView.setUint32(5, 0, true);
  pieceView.setUint32(9, spoken.length, true);
  pieceView.setUint32(15, 256, true);
  table.set(piece, 0);
  void characters;

  const sectors: Uint8Array[] = [new Uint8Array(sectorSize), new Uint8Array(sectorSize)];
  const wordSectors = splitSectors(word, sectorSize);
  const tableSectors = splitSectors(table, sectorSize);
  const wordStart = sectors.length;
  sectors.push(...wordSectors);
  const tableStart = sectors.length;
  sectors.push(...tableSectors);
  const fat = new DataView(sectors[0].buffer);
  const chain = (start: number, count: number) => {
    for (let index = 0; index < count - 1; index += 1) fat.setUint32((start + index) * 4, start + index + 1, true);
    fat.setUint32((start + count - 1) * 4, 0xfffffffe, true);
  };
  fat.setUint32(0, 0xfffffffe, true);
  fat.setUint32(4, 0xfffffffe, true);
  chain(wordStart, wordSectors.length);
  chain(tableStart, tableSectors.length);
  writeEntry(sectors[1], 0, "Root Entry", 5, 0xffffffff, 0xffffffff, 1, 0xfffffffe, 0);
  writeEntry(sectors[1], 1, "WordDocument", 2, 0xffffffff, 2, 0xffffffff, wordStart, word.length);
  writeEntry(sectors[1], 2, "1Table", 2, 0xffffffff, 0xffffffff, 0xffffffff, tableStart, table.length);

  const header = new Uint8Array(sectorSize);
  const headerView = new DataView(header.buffer);
  header.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1], 0);
  headerView.setUint16(0x1e, 9, true);
  headerView.setUint16(0x20, 6, true);
  headerView.setUint32(0x2c, 1, true);
  headerView.setUint32(0x30, 1, true);
  headerView.setUint32(0x38, 4096, true);
  headerView.setUint32(0x3c, 0xfffffffe, true);
  headerView.setUint32(0x44, 0xfffffffe, true);
  headerView.setUint32(0x4c, 0, true);
  return concat([header, ...sectors]);
}

function splitSectors(bytes: Uint8Array, sectorSize: number): Uint8Array[] {
  const parts: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.length; offset += sectorSize) {
    const part = new Uint8Array(sectorSize);
    part.set(bytes.subarray(offset, offset + sectorSize));
    parts.push(part);
  }
  return parts;
}

function writeEntry(
  sector: Uint8Array,
  index: number,
  name: string,
  type: number,
  left: number,
  right: number,
  child: number,
  start: number,
  size: number,
) {
  const offset = index * 128;
  const view = new DataView(sector.buffer, sector.byteOffset, sector.byteLength);
  for (let char = 0; char < name.length; char += 1) view.setUint16(offset + char * 2, name.charCodeAt(char), true);
  view.setUint16(offset + 64, (name.length + 1) * 2, true);
  sector[offset + 66] = type;
  view.setUint32(offset + 68, left, true);
  view.setUint32(offset + 72, right, true);
  view.setUint32(offset + 76, child, true);
  view.setUint32(offset + 116, start, true);
  view.setUint32(offset + 120, size, true);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}
