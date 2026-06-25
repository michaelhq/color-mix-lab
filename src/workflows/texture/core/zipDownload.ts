export interface ZipTextFile {
  name: string;
  content: string;
}

interface EncodedZipFile {
  name: string;
  nameBytes: Uint8Array;
  data: Uint8Array;
  crc32: number;
  localHeaderOffset: number;
}

const encoder = new TextEncoder();

let crcTable: Uint32Array | null = null;

function getCrcTable(): Uint32Array {
  if (crcTable) return crcTable;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[n] = c >>> 0;
  }
  crcTable = table;
  return table;
}

function crc32(data: Uint8Array): number {
  const table = getCrcTable();
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) {
    crc = table[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()): { date: number; time: number } {
  const year = Math.max(1980, date.getFullYear());
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = Math.floor(date.getSeconds() / 2);
  return {
    date: ((year - 1980) << 9) | (month << 5) | day,
    time: (hours << 11) | (minutes << 5) | seconds,
  };
}

function writeUint16(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
}

function writeUint32(target: Uint8Array, offset: number, value: number): void {
  target[offset] = value & 0xff;
  target[offset + 1] = (value >>> 8) & 0xff;
  target[offset + 2] = (value >>> 16) & 0xff;
  target[offset + 3] = (value >>> 24) & 0xff;
}

function appendBytes(parts: Uint8Array[], bytes: Uint8Array): void {
  parts.push(bytes);
}

function makeLocalHeader(file: EncodedZipFile, modTime: number, modDate: number): Uint8Array {
  const header = new Uint8Array(30 + file.nameBytes.length);
  writeUint32(header, 0, 0x04034b50);
  writeUint16(header, 4, 20); // version needed
  writeUint16(header, 6, 0x0800); // UTF-8 filenames
  writeUint16(header, 8, 0); // store, no compression
  writeUint16(header, 10, modTime);
  writeUint16(header, 12, modDate);
  writeUint32(header, 14, file.crc32);
  writeUint32(header, 18, file.data.length);
  writeUint32(header, 22, file.data.length);
  writeUint16(header, 26, file.nameBytes.length);
  writeUint16(header, 28, 0);
  header.set(file.nameBytes, 30);
  return header;
}

function makeCentralDirectoryHeader(file: EncodedZipFile, modTime: number, modDate: number): Uint8Array {
  const header = new Uint8Array(46 + file.nameBytes.length);
  writeUint32(header, 0, 0x02014b50);
  writeUint16(header, 4, 20); // version made by
  writeUint16(header, 6, 20); // version needed
  writeUint16(header, 8, 0x0800); // UTF-8 filenames
  writeUint16(header, 10, 0); // store
  writeUint16(header, 12, modTime);
  writeUint16(header, 14, modDate);
  writeUint32(header, 16, file.crc32);
  writeUint32(header, 20, file.data.length);
  writeUint32(header, 24, file.data.length);
  writeUint16(header, 28, file.nameBytes.length);
  writeUint16(header, 30, 0);
  writeUint16(header, 32, 0);
  writeUint16(header, 34, 0);
  writeUint16(header, 36, 0);
  writeUint32(header, 38, 0);
  writeUint32(header, 42, file.localHeaderOffset);
  header.set(file.nameBytes, 46);
  return header;
}

function makeEndOfCentralDirectory(fileCount: number, centralDirectorySize: number, centralDirectoryOffset: number): Uint8Array {
  const end = new Uint8Array(22);
  writeUint32(end, 0, 0x06054b50);
  writeUint16(end, 4, 0);
  writeUint16(end, 6, 0);
  writeUint16(end, 8, fileCount);
  writeUint16(end, 10, fileCount);
  writeUint32(end, 12, centralDirectorySize);
  writeUint32(end, 16, centralDirectoryOffset);
  writeUint16(end, 20, 0);
  return end;
}

export function createZipBlob(files: ZipTextFile[]): Blob {
  if (files.length === 0) {
    throw new Error('ZIP enthält keine Dateien.');
  }

  const now = dosDateTime();
  const parts: Uint8Array[] = [];
  const encodedFiles: EncodedZipFile[] = [];
  let offset = 0;

  for (const input of files) {
    const name = input.name.replace(/\\/g, '/').replace(/^\/+/, '');
    const nameBytes = encoder.encode(name);
    const data = encoder.encode(input.content);
    const file: EncodedZipFile = {
      name,
      nameBytes,
      data,
      crc32: crc32(data),
      localHeaderOffset: offset,
    };
    const localHeader = makeLocalHeader(file, now.time, now.date);
    appendBytes(parts, localHeader);
    appendBytes(parts, data);
    encodedFiles.push(file);
    offset += localHeader.length + data.length;
  }

  const centralDirectoryOffset = offset;
  let centralDirectorySize = 0;
  for (const file of encodedFiles) {
    const header = makeCentralDirectoryHeader(file, now.time, now.date);
    appendBytes(parts, header);
    centralDirectorySize += header.length;
    offset += header.length;
  }

  appendBytes(parts, makeEndOfCentralDirectory(encodedFiles.length, centralDirectorySize, centralDirectoryOffset));

  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const archive = new Uint8Array(totalLength);
  let writeOffset = 0;
  for (const part of parts) {
    archive.set(part, writeOffset);
    writeOffset += part.length;
  }

  return new Blob([archive.buffer as ArrayBuffer], { type: 'application/zip' });
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
