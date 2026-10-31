import { get, set, createStore } from 'idb-keyval';

// Separate IndexedDB store for large PDF binary blobs
const pdfStoreDb = createStore('editordoc_pdf_db', 'original_pdfs');
const CHUNK_SIZE = 48 * 1024; // 48KB chunks for reliable WebRTC DataChannel transfer

export interface ChunkMessage {
  documentId: string;
  chunkIndex: number;
  totalChunks: number;
  data: ArrayBuffer;
}

export interface TransferProgress {
  documentId: string;
  receivedChunks: number;
  totalChunks: number;
  percentage: number;
}

/**
 * Computes SHA-256 hex digest of Uint8Array bytes.
 */
export async function computeSHA256(bytes: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest('SHA-256', bytes as any);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Store original PDF bytes in IndexedDB by documentId (SHA-256 hash).
 */
export async function storeOriginalPDF(
  documentId: string,
  bytes: Uint8Array,
  filename?: string
): Promise<void> {
  await set(
    documentId,
    {
      bytes,
      filename: filename || 'document.pdf',
      storedAt: Date.now(),
    },
    pdfStoreDb
  );
}

/**
 * Retrieve original PDF bytes from IndexedDB.
 */
export async function getOriginalPDF(
  documentId: string
): Promise<{ bytes: Uint8Array; filename: string } | null> {
  const entry = await get<{ bytes: Uint8Array; filename: string }>(
    documentId,
    pdfStoreDb
  );
  if (!entry || !entry.bytes) return null;
  return {
    bytes: new Uint8Array(entry.bytes),
    filename: entry.filename || 'document.pdf',
  };
}

/**
 * Check if the original PDF exists locally.
 */
export async function hasOriginalPDF(documentId: string): Promise<boolean> {
  const entry = await get(documentId, pdfStoreDb);
  return Boolean(entry);
}

/**
 * Chunk a PDF byte buffer into sequential ArrayBuffers for peer transmission.
 */
export function chunkPDF(
  documentId: string,
  bytes: Uint8Array
): ChunkMessage[] {
  const totalChunks = Math.ceil(bytes.byteLength / CHUNK_SIZE);
  const chunks: ChunkMessage[] = [];

  for (let i = 0; i < totalChunks; i++) {
    const start = i * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, bytes.byteLength);
    const slice = bytes.slice(start, end);
    chunks.push({
      documentId,
      chunkIndex: i,
      totalChunks,
      data: slice.buffer as ArrayBuffer,
    });
  }

  return chunks;
}

/**
 * Reassemble chunks into full PDF bytes and verify SHA-256 checksum.
 */
export class ChunkReassembler {
  private chunks: Map<number, Uint8Array> = new Map();
  private totalChunks: number | null = null;
  public readonly documentId: string;

  constructor(documentId: string) {
    this.documentId = documentId;
  }

  public addChunk(
    chunkIndex: number,
    totalChunks: number,
    data: ArrayBuffer
  ): { isComplete: boolean; progress: number } {
    this.totalChunks = totalChunks;
    this.chunks.set(chunkIndex, new Uint8Array(data));

    const progress = Math.round((this.chunks.size / totalChunks) * 100);
    const isComplete = this.chunks.size === totalChunks;

    return { isComplete, progress };
  }

  public async assembleAndVerify(): Promise<Uint8Array> {
    if (!this.totalChunks || this.chunks.size !== this.totalChunks) {
      throw new Error(`Incomplete chunks: received ${this.chunks.size}/${this.totalChunks}`);
    }

    let totalLength = 0;
    for (let i = 0; i < this.totalChunks; i++) {
      const c = this.chunks.get(i);
      if (!c) throw new Error(`Missing chunk at index ${i}`);
      totalLength += c.byteLength;
    }

    const fullBuffer = new Uint8Array(totalLength);
    let offset = 0;
    for (let i = 0; i < this.totalChunks; i++) {
      const c = this.chunks.get(i)!;
      fullBuffer.set(c, offset);
      offset += c.byteLength;
    }

    // Hash verification
    const computed = await computeSHA256(fullBuffer);
    if (computed !== this.documentId) {
      throw new Error(`SHA-256 mismatch: expected ${this.documentId}, calculated ${computed}`);
    }

    return fullBuffer;
  }
}
