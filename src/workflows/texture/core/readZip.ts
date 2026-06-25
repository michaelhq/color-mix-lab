function readUint16(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

function readUint32(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectory(view: DataView): number {
  const minOffset = Math.max(0, view.byteLength - 0xffff - 22);
  for (let offset = view.byteLength - 22; offset >= minOffset; offset -= 1) {
    if (readUint32(view, offset) === 0x06054b50) return offset;
  }
  throw new Error('ZIP file could not be read: end directory not found.');
}

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const maybeDecompressionStream = (globalThis as typeof globalThis & {
    DecompressionStream?: new (format: CompressionFormat | 'deflate-raw') => DecompressionStream;
  }).DecompressionStream;

  if (!maybeDecompressionStream) {
    throw new Error('ZIP file uses compression. This browser does not provide the required DecompressionStream API. Extract the ZIP before loading.');
  }

  const stream = new Blob([data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer]).stream().pipeThrough(new maybeDecompressionStream('deflate-raw'));
  const buffer = await new Response(stream).arrayBuffer();
  return new Uint8Array(buffer);
}

function safeZipFileName(name: string): string {
  const cleaned = name.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = cleaned.split('/').filter((part) => part && part !== '.' && part !== '..');
  return parts.join('/');
}

function fileExtensionFromName(name: string): string {
  const fileName = name.toLowerCase().split('/').at(-1) ?? '';
  const parts = fileName.split('.');
  return parts.length > 1 ? parts.at(-1) ?? '' : '';
}

const SUPPORTED_ZIP_ASSET_EXTENSIONS = new Set([
  'obj',
  'mtl',
  'glb',
  'gltf',
  'bin',
  'png',
  'jpg',
  'jpeg',
  'webp',
  'bmp',
  'gif',
]);

export interface ZipExtractionResult {
  files: File[];
  skippedFiles: number;
  archiveFiles: number;
  nestedArchiveFiles: number;
}

interface ZipExtractionInternalResult extends ZipExtractionResult {
  scannedEntries: number;
}

async function extractZipInternal(zipFile: File, prefix: string, depth: number, maxDepth: number): Promise<ZipExtractionInternalResult> {
  const buffer = await zipFile.arrayBuffer();
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  const eocdOffset = findEndOfCentralDirectory(view);
  const entryCount = readUint16(view, eocdOffset + 10);
  const centralDirectoryOffset = readUint32(view, eocdOffset + 16);
  const textDecoder = new TextDecoder('utf-8');
  const files: File[] = [];
  let skippedFiles = 0;
  let archiveFiles = 1;
  let nestedArchiveFiles = 0;
  let scannedEntries = 0;
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (readUint32(view, offset) !== 0x02014b50) {
      throw new Error('ZIP file could not be read: invalid central-directory entry.');
    }

    const flags = readUint16(view, offset + 8);
    const compressionMethod = readUint16(view, offset + 10);
    const compressedSize = readUint32(view, offset + 20);
    const uncompressedSize = readUint32(view, offset + 24);
    const fileNameLength = readUint16(view, offset + 28);
    const extraLength = readUint16(view, offset + 30);
    const commentLength = readUint16(view, offset + 32);
    const localHeaderOffset = readUint32(view, offset + 42);
    const nameBytes = bytes.slice(offset + 46, offset + 46 + fileNameLength);
    const rawName = textDecoder.decode(nameBytes);
    const safeName = safeZipFileName(rawName);
    const combinedName = safeZipFileName(prefix ? `${prefix}/${safeName}` : safeName);
    offset += 46 + fileNameLength + extraLength + commentLength;
    scannedEntries += 1;

    if (!safeName || safeName.endsWith('/')) {
      skippedFiles += 1;
      continue;
    }

    const extension = fileExtensionFromName(safeName);
    const isNestedZip = extension === 'zip';
    const isSupportedAsset = SUPPORTED_ZIP_ASSET_EXTENSIONS.has(extension);

    if (!isSupportedAsset && !isNestedZip) {
      skippedFiles += 1;
      continue;
    }

    if (readUint32(view, localHeaderOffset) !== 0x04034b50) {
      throw new Error(`ZIP file could not read ${combinedName} local header missing.`);
    }

    if (readUint32(view, localHeaderOffset + 18) === 0xffffffff || readUint32(view, localHeaderOffset + 22) === 0xffffffff) {
      throw new Error('ZIP64 archives are not supported yet. Extract the ZIP before loading.');
    }

    const localFileNameLength = readUint16(view, localHeaderOffset + 26);
    const localExtraLength = readUint16(view, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localFileNameLength + localExtraLength;
    const compressedData = bytes.slice(dataStart, dataStart + compressedSize);
    let fileData: Uint8Array;

    if (compressionMethod === 0) {
      fileData = compressedData;
    } else if (compressionMethod === 8) {
      fileData = await inflateRaw(compressedData);
    } else {
      throw new Error(`ZIP entry ${combinedName} uses an unsupported compression method (${compressionMethod}).`);
    }

    if (uncompressedSize > 0 && fileData.length !== uncompressedSize && !(flags & 0x08)) {
      throw new Error(`ZIP entry ${combinedName} could not be fully extracted.`);
    }

    const file = new File([fileData.buffer.slice(fileData.byteOffset, fileData.byteOffset + fileData.byteLength) as ArrayBuffer], combinedName, {
      type: extension === 'obj' || extension === 'mtl' || extension === 'gltf' ? 'text/plain' : '',
      lastModified: zipFile.lastModified,
    });

    if (isNestedZip) {
      if (depth >= maxDepth) {
        skippedFiles += 1;
        continue;
      }
      nestedArchiveFiles += 1;
      const nested = await extractZipInternal(file, combinedName.replace(/\.zip$/i, ''), depth + 1, maxDepth);
      files.push(...nested.files);
      skippedFiles += nested.skippedFiles;
      archiveFiles += nested.archiveFiles;
      nestedArchiveFiles += nested.nestedArchiveFiles;
      scannedEntries += nested.scannedEntries;
      continue;
    }

    files.push(file);
  }

  return { files, skippedFiles, archiveFiles, nestedArchiveFiles, scannedEntries };
}

export async function extractSupportedModelFilesFromZip(zipFile: File): Promise<ZipExtractionResult> {
  const result = await extractZipInternal(zipFile, '', 0, 2);
  return {
    files: result.files,
    skippedFiles: result.skippedFiles,
    archiveFiles: result.archiveFiles,
    nestedArchiveFiles: result.nestedArchiveFiles,
  };
}
