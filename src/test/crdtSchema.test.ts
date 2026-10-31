import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initializeDocument,
  readDocumentSnapshot,
  addTextOverlayCRDT,
  updateTextOverlayCRDT,
  removeTextOverlayCRDT,
  addWhiteoutCRDT,
  addRedactionCRDT,
  addSignatureCRDT,
  movePageCRDT,
  rotatePageCRDT,
  setPageDeletedCRDT,
} from '../lib/crdt/schema';

describe('CRDT Schema & Nested Map Merges', () => {
  it('initializes document metadata and pages with fractional indices', () => {
    const doc = new Y.Doc();
    initializeDocument(doc, 'doc-123', 'My Doc', 3);

    const snapshot = readDocumentSnapshot(doc);
    expect(snapshot.meta.documentId).toBe('doc-123');
    expect(snapshot.meta.title).toBe('My Doc');
    expect(snapshot.pages.length).toBe(3);
    expect(snapshot.pages[0].originalIndex).toBe(0);
    expect(snapshot.pages[0].order < snapshot.pages[1].order).toBe(true);
    expect(snapshot.pages[1].order < snapshot.pages[2].order).toBe(true);
  });

  it('performs nested map per-field merges without last-writer-wins clobbering', () => {
    // Peer A and Peer B start from same baseline
    const docA = new Y.Doc();
    const docB = new Y.Doc();

    const overlayId = addTextOverlayCRDT(docA, {
      id: 'overlay-1',
      pageIndex: 0,
      x: 10,
      y: 20,
      text: 'Original Text',
      fontSize: 16,
      color: '#1a1c1c',
    });

    // Sync baseline to Doc B
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // Peer A edits text content
    updateTextOverlayCRDT(docA, overlayId, { text: 'Edited By Peer A' });

    // Peer B concurrently edits coordinates and font size
    updateTextOverlayCRDT(docB, overlayId, { x: 50, y: 80, fontSize: 24, color: '#005db2' });

    // Cross sync
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    const snapA = readDocumentSnapshot(docA);
    const snapB = readDocumentSnapshot(docB);

    // Both must have merged the text from Peer A and the coordinates/size from Peer B!
    expect(snapA.textOverlays[0].text).toBe('Edited By Peer A');
    expect(snapA.textOverlays[0].x).toBe(50);
    expect(snapA.textOverlays[0].y).toBe(80);
    expect(snapA.textOverlays[0].fontSize).toBe(24);
    expect(snapA.textOverlays[0].color).toBe('#005db2');

    expect(JSON.stringify(snapA)).toEqual(JSON.stringify(snapB));
  });

  it('handles concurrent page moves and deletions', () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    initializeDocument(docA, 'doc-pages', 'Pages Test', 4);
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    // Peer A moves page 3 to the front (before page 0)
    const snapA_before = readDocumentSnapshot(docA);
    movePageCRDT(docA, 'page-3', null, snapA_before.pages[0].order);

    // Peer B marks page 1 as deleted and rotates page 2
    setPageDeletedCRDT(docB, 'page-1', true);
    rotatePageCRDT(docB, 'page-2', 90);

    // Sync
    Y.applyUpdate(docA, Y.encodeStateAsUpdate(docB));
    Y.applyUpdate(docB, Y.encodeStateAsUpdate(docA));

    const snapA = readDocumentSnapshot(docA);
    const snapB = readDocumentSnapshot(docB);

    // Page 3 is first
    expect(snapA.pages[0].id).toBe('page-3');
    // Page 1 is deleted
    expect(snapA.pages.find((p) => p.id === 'page-1')?.deleted).toBe(true);
    // Page 2 is rotated by 90
    expect(snapA.pages.find((p) => p.id === 'page-2')?.rotation).toBe(90);

    // Both converge to identical state
    expect(JSON.stringify(snapA)).toEqual(JSON.stringify(snapB));
  });

  it('tombstones deletions cleanly using Y.Map delete', () => {
    const doc = new Y.Doc();
    const id = addWhiteoutCRDT(doc, { pageIndex: 0, x: 5, y: 5, width: 20, height: 10 });
    expect(readDocumentSnapshot(doc).whiteouts.length).toBe(1);

    removeTextOverlayCRDT(doc, id); // wrong map, should do nothing
    expect(readDocumentSnapshot(doc).whiteouts.length).toBe(1);

    const doc2 = new Y.Doc();
    Y.applyUpdate(doc2, Y.encodeStateAsUpdate(doc));
    expect(readDocumentSnapshot(doc2).whiteouts.length).toBe(1);
  });
});
