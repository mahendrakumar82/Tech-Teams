import { formatShort, type RaciRow } from "./deadlines";

const HEADERS = [
  "Description",
  "Due",
  "Reminder",
  "Responsible",
  "Accountable",
  "Consulted",
  "Informed",
];

export function raciReminderLabel(remindOn: string, today: string): string {
  const label = formatShort(remindOn);
  return today && remindOn < today ? `${label} · passed` : label;
}

export function raciWorkbook(rows: RaciRow[], today: string): Uint8Array {
  const values = [
    HEADERS,
    ...rows.map((row) => [
      row.description,
      formatShort(row.due),
      raciReminderLabel(row.remindOn, today),
      row.responsible,
      row.accountable,
      row.consulted,
      row.informed,
    ]),
  ];
  return zipStore([
    { name: "[Content_Types].xml", data: text(contentTypes()) },
    { name: "_rels/.rels", data: text(rootRels()) },
    { name: "xl/workbook.xml", data: text(workbook()) },
    { name: "xl/_rels/workbook.xml.rels", data: text(workbookRels()) },
    { name: "xl/worksheets/sheet1.xml", data: text(worksheet(values)) },
  ]);
}

function worksheet(values: string[][]): string {
  const lastColumn = columnName(HEADERS.length - 1);
  const rows = values
    .map((cells, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cellsXml = cells
        .map((value, columnIndex) => {
          const ref = `${columnName(columnIndex)}${rowNumber}`;
          return `<c r="${ref}" t="inlineStr"><is><t>${xmlText(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowNumber}">${cellsXml}</row>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="A1:${lastColumn}${values.length}"/>
  <cols>
    <col min="1" max="1" width="42" customWidth="1"/>
    <col min="2" max="3" width="18" customWidth="1"/>
    <col min="4" max="7" width="22" customWidth="1"/>
  </cols>
  <sheetData>${rows}</sheetData>
</worksheet>`;
}

function contentTypes(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;
}

function rootRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;
}

function workbook(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="RACI" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;
}

function workbookRels(): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;
}

function columnName(index: number): string {
  return String.fromCharCode(65 + index);
}

function xmlText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      const mask = -(crc & 1);
      crc = (crc >>> 1) ^ (0xedb88320 & mask);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function zipStore(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const time = (12 << 11) | (0 << 5) | 0;
  const date = ((2026 - 1980) << 9) | (10 << 5) | 25;
  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = text(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length + file.data.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(4, 20, true);
    localView.setUint16(8, 0, true);
    localView.setUint16(10, time, true);
    localView.setUint16(12, date, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, file.data.length, true);
    localView.setUint32(22, file.data.length, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    local.set(file.data, 30 + name.length);
    locals.push(local);

    const central = new Uint8Array(46 + name.length);
    const centralView = new DataView(central.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint16(12, time, true);
    centralView.setUint16(14, date, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, file.data.length, true);
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
