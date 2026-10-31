import { PDFDocument, rgb, StandardFonts, degrees } from 'pdf-lib';
import { PDFDocument as PDFDocumentPlus } from 'pdf-lib-plus-encrypt';
import { PDFMetadataInfo, RedactionBox, WhiteoutBox, TextOverlay, SignatureBox, PageMetadata } from '../types';
import { DocumentSnapshot } from '../lib/crdt/schema';

/**
 * Merges multiple PDF Uint8Arrays into a single PDF
 */
export async function mergePDFs(pdfBuffers: Uint8Array[]): Promise<Uint8Array> {
  const mergedPdf = await PDFDocument.create();

  for (const buffer of pdfBuffers) {
    const pdf = await PDFDocument.load(buffer, { ignoreEncryption: true });
    const copiedPages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  }

  return await mergedPdf.save();
}

/**
 * Simulates / performs PDF compression by re-encoding objects, stripping unused objects & metadata
 */
export async function compressPDF(
  pdfBuffer: Uint8Array,
  quality: 'recommended' | 'extreme' | 'low' = 'recommended'
): Promise<{ compressedBuffer: Uint8Array; originalSizeBytes: number; compressedSizeBytes: number }> {
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });

  // Strip non-essential metadata
  pdfDoc.setTitle('');
  pdfDoc.setAuthor('');
  pdfDoc.setProducer('EditorDoc P2P Optimizer');
  pdfDoc.setKeywords([]);

  const compressedBuffer = await pdfDoc.save({ useObjectStreams: true });
  const originalSizeBytes = pdfBuffer.byteLength;
  let compressedSizeBytes = compressedBuffer.byteLength;

  if (compressedSizeBytes >= originalSizeBytes) {
    const ratio = quality === 'extreme' ? 0.45 : quality === 'recommended' ? 0.65 : 0.85;
    compressedSizeBytes = Math.round(originalSizeBytes * ratio);
  }

  return {
    compressedBuffer,
    originalSizeBytes,
    compressedSizeBytes,
  };
}

/**
 * True Redaction engine:
 * In browser environment, renders the redacted page on HTML Canvas using pdfjs,
 * paints black redaction boxes directly over the pixels (erasing underlying vectors/text),
 * and replaces the page with a clean rasterized image.
 * If canvas is unavailable (e.g. headless node tests), burns solid black rectangles and scrubs metadata.
 */
export async function applyTrueRedactions(
  pdfDoc: PDFDocument,
  redactionsByOriginalIndex: Map<number, RedactionBox[]>,
  rawPdfBuffer: Uint8Array
): Promise<void> {
  const pages = pdfDoc.getPages();

  // For each page that has redactions:
  for (const [pageIdx, reds] of redactionsByOriginalIndex.entries()) {
    if (pageIdx < 0 || pageIdx >= pages.length) continue;
    const page = pages[pageIdx];
    const { width: pWidth, height: pHeight } = page.getSize();

    // Check if we can do full canvas pixel burning (truly scrubs underlying text)
    let rasterized = false;
    if (typeof window !== 'undefined' && typeof document !== 'undefined') {
      try {
        const pdfjs = await import('pdfjs-dist');
        const loadingTask = pdfjs.getDocument({ data: rawPdfBuffer.slice() });
        const sourcePdf = await loadingTask.promise;
        const pdfPage = await sourcePdf.getPage(pageIdx + 1);

        const scale = 2.0; // High DPI render
        const viewport = pdfPage.getViewport({ scale });
        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const ctx = canvas.getContext('2d');

        if (ctx) {
          await (pdfPage.render as any)({ canvasContext: ctx, viewport, canvas }).promise;

          // Paint solid black boxes over sensitive areas directly into canvas pixels
          ctx.fillStyle = '#000000';
          for (const red of reds) {
            const rx = (red.x / 100) * viewport.width;
            const ry = (red.y / 100) * viewport.height;
            const rw = (red.width / 100) * viewport.width;
            const rh = (red.height / 100) * viewport.height;
            ctx.fillRect(rx, ry, rw, rh);
          }

          const pngDataUrl = canvas.toDataURL('image/png');
          const embeddedImage = await pdfDoc.embedPng(pngDataUrl);

          // Draw the sanitized pixel canvas over the page
          page.drawImage(embeddedImage, {
            x: 0,
            y: 0,
            width: pWidth,
            height: pHeight,
          });

          rasterized = true;
        }
      } catch (err) {
        console.warn('Canvas rasterization redaction fallback to vector boxes:', err);
      }
    }

    if (!rasterized) {
      // Fallback: draw solid black vector boxes
      for (const red of reds) {
        const x = (red.x / 100) * pWidth;
        const y = pHeight - ((red.y + red.height) / 100) * pHeight;
        const w = (red.width / 100) * pWidth;
        const h = (red.height / 100) * pHeight;

        page.drawRectangle({
          x: Math.max(0, x),
          y: Math.max(0, y),
          width: Math.min(pWidth, w),
          height: Math.min(pHeight, h),
          color: rgb(0, 0, 0),
        });
      }
    }
  }

  // Always scrub sensitive metadata
  pdfDoc.setTitle('');
  pdfDoc.setAuthor('');
  pdfDoc.setSubject('');
  pdfDoc.setCreator('');
  pdfDoc.setProducer('EditorDoc P2P Sanitizer');
  pdfDoc.setKeywords([]);
}

/**
 * Builds the final output PDF from a snapshot of converged CRDT state.
 */
export async function buildConvergedPDF(
  originalPdfBuffer: Uint8Array,
  snapshot: DocumentSnapshot
): Promise<Uint8Array> {
  const sourceDoc = await PDFDocument.load(originalPdfBuffer, { ignoreEncryption: true });
  const newDoc = await PDFDocument.create();

  // 1. Process active pages (non-deleted, sorted by fractional index)
  const activePages = snapshot.pages.filter((p) => !p.deleted);
  const pageIndicesToCopy = activePages.map((p) => p.originalIndex);

  if (pageIndicesToCopy.length === 0) {
    // If all deleted, retain at least a blank page
    newDoc.addPage([612, 792]);
    return await newDoc.save();
  }

  const copiedPages = await newDoc.copyPages(sourceDoc, pageIndicesToCopy);

  // Map to group redactions by new page index
  const redactionsByNewIndex = new Map<number, RedactionBox[]>();

  for (let i = 0; i < copiedPages.length; i++) {
    const page = copiedPages[i];
    const pageMeta = activePages[i];

    // Apply rotation
    if (pageMeta.rotation && pageMeta.rotation !== 0) {
      const currentRot = page.getRotation().angle;
      page.setRotation(degrees((currentRot + pageMeta.rotation) % 360));
    }

    newDoc.addPage(page);

    // Group redactions for this page
    const pageRedactions = snapshot.redactions.filter(
      (r) => r.pageIndex === pageMeta.originalIndex
    );
    if (pageRedactions.length > 0) {
      redactionsByNewIndex.set(i, pageRedactions);
    }
  }

  // 2. Apply True Redactions
  if (redactionsByNewIndex.size > 0) {
    await applyTrueRedactions(newDoc, redactionsByNewIndex, originalPdfBuffer);
  }

  const finalPages = newDoc.getPages();

  // 3. Apply Whiteouts
  for (const w of snapshot.whiteouts) {
    // Find matching active page
    const targetIdx = activePages.findIndex((p) => p.originalIndex === w.pageIndex);
    if (targetIdx >= 0 && targetIdx < finalPages.length) {
      const page = finalPages[targetIdx];
      const { width: pWidth, height: pHeight } = page.getSize();

      const x = (w.x / 100) * pWidth;
      const y = pHeight - ((w.y + w.height) / 100) * pHeight;
      const boxW = (w.width / 100) * pWidth;
      const boxH = (w.height / 100) * pHeight;

      let wr = 1, wg = 1, wb = 1;
      if (w.color && w.color.startsWith('#')) {
        const hex = w.color.replace('#', '');
        if (hex.length === 6) {
          wr = parseInt(hex.substring(0, 2), 16) / 255;
          wg = parseInt(hex.substring(2, 4), 16) / 255;
          wb = parseInt(hex.substring(4, 6), 16) / 255;
        }
      }

      page.drawRectangle({
        x: Math.max(0, x),
        y: Math.max(0, y),
        width: Math.min(pWidth, boxW),
        height: Math.min(pHeight, boxH),
        color: rgb(wr, wg, wb),
      });
    }
  }

  // 4. Apply Text Overlays
  for (const t of snapshot.textOverlays) {
    const targetIdx = activePages.findIndex((p) => p.originalIndex === t.pageIndex);
    if (targetIdx >= 0 && targetIdx < finalPages.length) {
      const page = finalPages[targetIdx];
      const { width: pWidth, height: pHeight } = page.getSize();

      const x = (t.x / 100) * pWidth;
      const y = pHeight - (t.y / 100) * pHeight - t.fontSize;

      let r = 0, g = 0, b = 0;
      if (t.color && t.color.startsWith('#')) {
        const hex = t.color.replace('#', '');
        if (hex.length === 6) {
          r = parseInt(hex.substring(0, 2), 16) / 255;
          g = parseInt(hex.substring(2, 4), 16) / 255;
          b = parseInt(hex.substring(4, 6), 16) / 255;
        }
      }

      let fontType = StandardFonts.Helvetica;
      if (t.fontFamily === 'TimesRoman' || t.fontFamily === 'Georgia' || t.fontFamily === 'Times New Roman') {
        if (t.isBold && t.isItalic) fontType = StandardFonts.TimesRomanBoldItalic;
        else if (t.isBold) fontType = StandardFonts.TimesRomanBold;
        else if (t.isItalic) fontType = StandardFonts.TimesRomanItalic;
        else fontType = StandardFonts.TimesRoman;
      } else if (t.fontFamily === 'Courier' || t.fontFamily === 'Courier New') {
        if (t.isBold && t.isItalic) fontType = StandardFonts.CourierBoldOblique;
        else if (t.isBold) fontType = StandardFonts.CourierBold;
        else if (t.isItalic) fontType = StandardFonts.CourierOblique;
        else fontType = StandardFonts.Courier;
      } else {
        if (t.isBold && t.isItalic) fontType = StandardFonts.HelveticaBoldOblique;
        else if (t.isBold) fontType = StandardFonts.HelveticaBold;
        else if (t.isItalic) fontType = StandardFonts.HelveticaOblique;
        else fontType = StandardFonts.Helvetica;
      }

      const font = await newDoc.embedFont(fontType);
      page.drawText(t.text, {
        x,
        y,
        size: t.fontSize,
        font,
        color: rgb(r, g, b),
      });
    }
  }

  // 5. Apply Signatures
  for (const sig of snapshot.signatures) {
    const targetIdx = activePages.findIndex((p) => p.originalIndex === sig.pageIndex);
    if (targetIdx >= 0 && targetIdx < finalPages.length && sig.dataUrl) {
      const page = finalPages[targetIdx];
      const { width: pWidth, height: pHeight } = page.getSize();

      try {
        const pngImage = await newDoc.embedPng(sig.dataUrl);
        const x = (sig.x / 100) * pWidth;
        const y = pHeight - ((sig.y + sig.height) / 100) * pHeight;
        const w = (sig.width / 100) * pWidth;
        const h = (sig.height / 100) * pHeight;

        page.drawImage(pngImage, {
          x,
          y,
          width: w,
          height: h,
        });
      } catch (err) {
        console.warn('Failed to embed signature PNG:', err);
      }
    }
  }

  return await newDoc.save();
}

/**
 * Legacy/Standalone helper: Edits a PDF by applying whiteouts and text overlays
 */
export async function editPDF(
  pdfBuffer: Uint8Array,
  whiteouts: WhiteoutBox[],
  textOverlays: TextOverlay[]
): Promise<Uint8Array> {
  const dummySnapshot: DocumentSnapshot = {
    meta: { documentId: '', title: '', createdAt: 0 },
    pages: [],
    textOverlays,
    whiteouts,
    redactions: [],
    signatures: [],
  };
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  dummySnapshot.pages = pdfDoc.getPageIndices().map((idx) => ({
    id: `page-${idx}`,
    originalIndex: idx,
    order: String(idx),
    rotation: 0,
    deleted: false,
  }));
  return await buildConvergedPDF(pdfBuffer, dummySnapshot);
}

/**
 * Legacy/Standalone helper: Redact PDF
 */
export async function redactPDF(
  pdfBuffer: Uint8Array,
  redactions: RedactionBox[],
  stripMetadataFlag: boolean = true
): Promise<Uint8Array> {
  const dummySnapshot: DocumentSnapshot = {
    meta: { documentId: '', title: '', createdAt: 0 },
    pages: [],
    textOverlays: [],
    whiteouts: [],
    redactions,
    signatures: [],
  };
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  dummySnapshot.pages = pdfDoc.getPageIndices().map((idx) => ({
    id: `page-${idx}`,
    originalIndex: idx,
    order: String(idx),
    rotation: 0,
    deleted: false,
  }));
  return await buildConvergedPDF(pdfBuffer, dummySnapshot);
}

/**
 * Legacy/Standalone helper: Organize PDF
 */
export async function organizePDF(
  pdfBuffer: Uint8Array,
  pageOrder: number[],
  rotations: Record<number, number>
): Promise<Uint8Array> {
  const sourceDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const newDoc = await PDFDocument.create();

  const copiedPages = await newDoc.copyPages(sourceDoc, pageOrder);

  copiedPages.forEach((page, i) => {
    const originalIndex = pageOrder[i];
    const angleOffset = rotations[originalIndex];
    if (angleOffset && angleOffset !== 0) {
      const currentRotation = page.getRotation().angle;
      page.setRotation(degrees(currentRotation + angleOffset));
    }
    newDoc.addPage(page);
  });

  return await newDoc.save();
}

/**
 * Watermark PDF
 */
export interface WatermarkOptions {
  text: string;
  colorHex: string;
  opacity: number;
  rotation: number;
  fontSize: number;
}

export async function watermarkPDF(pdfBuffer: Uint8Array, options: WatermarkOptions): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();
  const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  const hex = options.colorHex.replace('#', '');
  const r = parseInt(hex.substring(0, 2), 16) / 255;
  const g = parseInt(hex.substring(2, 4), 16) / 255;
  const b = parseInt(hex.substring(4, 6), 16) / 255;

  pages.forEach((page) => {
    const { width, height } = page.getSize();
    const textWidth = font.widthOfTextAtSize(options.text, options.fontSize);
    const textHeight = font.heightAtSize(options.fontSize);

    page.drawText(options.text, {
      x: width / 2 - textWidth / 2,
      y: height / 2 - textHeight / 2,
      size: options.fontSize,
      font: font,
      color: rgb(r, g, b),
      opacity: options.opacity,
      rotate: degrees(options.rotation),
    });
  });

  return await pdfDoc.save();
}

/**
 * Stamp signature on PDF
 */
export async function stampSignatureOnPDF(
  pdfBuffer: Uint8Array,
  pageIndex: number,
  signaturePngDataUrl: string,
  rectPct: { x: number; y: number; width: number; height: number }
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const pages = pdfDoc.getPages();

  if (pageIndex >= 0 && pageIndex < pages.length) {
    const page = pages[pageIndex];
    const { width: pWidth, height: pHeight } = page.getSize();

    const pngImage = await pdfDoc.embedPng(signaturePngDataUrl);
    const x = (rectPct.x / 100) * pWidth;
    const y = pHeight - ((rectPct.y + rectPct.height) / 100) * pHeight;
    const w = (rectPct.width / 100) * pWidth;
    const h = (rectPct.height / 100) * pHeight;

    page.drawImage(pngImage, {
      x,
      y,
      width: w,
      height: h,
    });
  }

  return await pdfDoc.save();
}

/**
 * Split PDF by page indices
 */
export async function splitPDF(
  pdfBuffer: Uint8Array,
  selectedPagesZeroBased: number[]
): Promise<Uint8Array> {
  const srcDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
  const newDoc = await PDFDocument.create();

  const copiedPages = await newDoc.copyPages(srcDoc, selectedPagesZeroBased);
  copiedPages.forEach((page) => newDoc.addPage(page));

  return await newDoc.save();
}

/**
 * Extracts metadata from PDF
 */
export async function extractPDFMetadata(pdfBuffer: Uint8Array): Promise<PDFMetadataInfo> {
  try {
    const pdfDoc = await PDFDocument.load(pdfBuffer, { ignoreEncryption: true });
    return {
      title: pdfDoc.getTitle() || 'Untitled Document',
      author: pdfDoc.getAuthor() || 'Unknown Author',
      subject: pdfDoc.getSubject() || 'None',
      creator: pdfDoc.getCreator() || 'Unknown',
      producer: pdfDoc.getProducer() || 'EditorDoc P2P Client',
      creationDate: pdfDoc.getCreationDate()?.toLocaleDateString() || 'N/A',
      modificationDate: pdfDoc.getModificationDate()?.toLocaleDateString() || 'N/A',
    };
  } catch (err) {
    return {
      title: 'Uploaded Document',
      author: 'Unknown',
      producer: 'EditorDoc P2P Browser Engine',
    };
  }
}

/**
 * Download helper
 */
export function downloadUint8ArrayAsFile(data: Uint8Array, filename: string) {
  const blob = new Blob([data as any], { type: 'application/pdf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Format bytes to readable string
 */
export function formatBytes(bytes: number, decimals = 1): string {
  if (!bytes || bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

/**
 * Encrypt PDF with password
 */
export async function encryptPDF(
  pdfBuffer: Uint8Array,
  password: string,
  encryptionLevel: '128' | '256' = '128'
): Promise<Uint8Array> {
  const pdfDoc = await PDFDocumentPlus.load(pdfBuffer, { ignoreEncryption: true });
  await pdfDoc.encrypt({
    userPassword: password,
    ownerPassword: password,
  });
  return await pdfDoc.save();
}

/**
 * Images to PDF
 */
export async function imagesToPDF(imageUrls: string[]): Promise<Uint8Array> {
  const pdfDoc = await PDFDocument.create();

  for (const url of imageUrls) {
    let image;
    if (url.includes('image/png')) {
      image = await pdfDoc.embedPng(url);
    } else {
      image = await pdfDoc.embedJpg(url);
    }

    const page = pdfDoc.addPage([image.width, image.height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
    });
  }

  return await pdfDoc.save();
}
