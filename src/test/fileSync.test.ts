import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initializeDocument,
  readDocumentSnapshot,
  addTextOverlayCRDT,
  addWhiteoutCRDT,
} from '../lib/crdt/schema';
import { exportSyncFile, importSyncFile } from '../lib/crdt/fileSync';

describe('.cdsync Store-and-Forward File Sync', () => {
  it('exports and imports updates with idempotency and order independence', async () => {
    const docSource = new Y.Doc();
    const docId = 'test-file-sync-doc';
    initializeDocument(docSource, docId, 'FileSync Test', 2);

    addTextOverlayCRDT(docSource, {
      pageIndex: 0,
      x: 10,
      y: 10,
      text: 'Exported Annotation',
      fontSize: 14,
    });

    // 1. Export .cdsync file
    const { blob, filename } = exportSyncFile(docSource, docId);
    expect(filename.startsWith('test-fil')).toBe(true);
    expect(filename.endsWith('.cdsync')).toBe(true);

    // 2. Import into a fresh doc
    const docTarget = new Y.Doc();
    await importSyncFile(blob, docTarget, docId);

    const snapTarget = readDocumentSnapshot(docTarget);
    expect(snapTarget.textOverlays.length).toBe(1);
    expect(snapTarget.textOverlays[0].text).toBe('Exported Annotation');

    // 3. Test IDEMPOTENCY: importing the same file again must not duplicate or corrupt
    await importSyncFile(blob, docTarget, docId);
    const snapTarget2 = readDocumentSnapshot(docTarget);
    expect(snapTarget2.textOverlays.length).toBe(1);
    expect(snapTarget2.textOverlays[0].text).toBe('Exported Annotation');

    // 4. Test expectedDocId validation
    await expect(
      importSyncFile(blob, docTarget, 'wrong-document-id')
    ).rejects.toThrow('Document mismatch');
  });

  it('merges multiple .cdsync files in any order', async () => {
    const docId = 'multi-cdsync';
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();

    initializeDocument(doc1, docId, 'Multi File', 2);
    initializeDocument(doc2, docId, 'Multi File', 2);

    addTextOverlayCRDT(doc1, { pageIndex: 0, x: 5, y: 5, text: 'File 1 Text', fontSize: 14 });
    addWhiteoutCRDT(doc2, { pageIndex: 1, x: 20, y: 20, width: 30, height: 10 });

    const file1 = exportSyncFile(doc1, docId);
    const file2 = exportSyncFile(doc2, docId);

    // Target A applies file 1 then file 2
    const docA = new Y.Doc();
    await importSyncFile(file1.blob, docA, docId);
    await importSyncFile(file2.blob, docA, docId);

    // Target B applies file 2 then file 1
    const docB = new Y.Doc();
    await importSyncFile(file2.blob, docB, docId);
    await importSyncFile(file1.blob, docB, docId);

    const snapA = readDocumentSnapshot(docA);
    const snapB = readDocumentSnapshot(docB);

    expect(snapA.textOverlays.length).toBe(1);
    expect(snapA.whiteouts.length).toBe(1);
    expect(JSON.stringify(snapA)).toEqual(JSON.stringify(snapB));
  });
});
