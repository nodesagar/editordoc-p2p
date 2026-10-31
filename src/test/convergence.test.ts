import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initializeDocument,
  readDocumentSnapshot,
  addTextOverlayCRDT,
  updateTextOverlayCRDT,
  addWhiteoutCRDT,
  addRedactionCRDT,
  addSignatureCRDT,
  rotatePageCRDT,
  setPageDeletedCRDT,
  movePageCRDT,
} from '../lib/crdt/schema';

describe('Multi-Peer Offline Convergence', () => {
  it('converges 3 peers editing offline for weeks regardless of sync order', () => {
    const doc1 = new Y.Doc();
    const doc2 = new Y.Doc();
    const doc3 = new Y.Doc();

    const baselineId = 'contract-sha256-abc';
    initializeDocument(doc1, baselineId, 'Master Agreement', 4);

    // Initial state distributed
    const initUpdate = Y.encodeStateAsUpdate(doc1);
    Y.applyUpdate(doc2, initUpdate);
    Y.applyUpdate(doc3, initUpdate);

    // === Peer 1 offline for 2 weeks ===
    const t1 = addTextOverlayCRDT(doc1, {
      pageIndex: 0,
      x: 15,
      y: 25,
      text: 'Peer 1 Clause',
      fontSize: 18,
    });
    rotatePageCRDT(doc1, 'page-0', 90);
    movePageCRDT(doc1, 'page-2', null, readDocumentSnapshot(doc1).pages[0].order);

    // === Peer 2 offline for 3 weeks ===
    setPageDeletedCRDT(doc2, 'page-1', true);
    addRedactionCRDT(doc2, {
      pageIndex: 0,
      x: 30,
      y: 40,
      width: 40,
      height: 10,
      label: 'CONFIDENTIAL',
    });

    // === Peer 3 offline for 4 weeks ===
    addWhiteoutCRDT(doc3, {
      pageIndex: 3,
      x: 10,
      y: 10,
      width: 50,
      height: 20,
      color: '#ffffff',
    });
    addSignatureCRDT(doc3, {
      pageIndex: 3,
      x: 20,
      y: 70,
      width: 30,
      height: 15,
      dataUrl: 'data:image/png;base64,sampleSig',
    });

    // Prepare deltas
    const update1 = Y.encodeStateAsUpdate(doc1);
    const update2 = Y.encodeStateAsUpdate(doc2);
    const update3 = Y.encodeStateAsUpdate(doc3);

    // Scenario A: Sync in order 1 -> 2 -> 3
    const testDocA = new Y.Doc();
    Y.applyUpdate(testDocA, update1);
    Y.applyUpdate(testDocA, update2);
    Y.applyUpdate(testDocA, update3);

    // Scenario B: Sync in reverse order 3 -> 2 -> 1
    const testDocB = new Y.Doc();
    Y.applyUpdate(testDocB, update3);
    Y.applyUpdate(testDocB, update2);
    Y.applyUpdate(testDocB, update1);

    // Scenario C: Sync in scrambled order 2 -> 1 -> 3
    const testDocC = new Y.Doc();
    Y.applyUpdate(testDocC, update2);
    Y.applyUpdate(testDocC, update1);
    Y.applyUpdate(testDocC, update3);

    const snapA = readDocumentSnapshot(testDocA);
    const snapB = readDocumentSnapshot(testDocB);
    const snapC = readDocumentSnapshot(testDocC);

    // Mathematical equivalence
    expect(snapA).toEqual(snapB);
    expect(snapB).toEqual(snapC);

    // Verify all individual edits survived
    expect(snapA.textOverlays.length).toBe(1);
    expect(snapA.textOverlays[0].text).toBe('Peer 1 Clause');
    expect(snapA.redactions.length).toBe(1);
    expect(snapA.whiteouts.length).toBe(1);
    expect(snapA.signatures.length).toBe(1);
    expect(snapA.pages.find((p) => p.id === 'page-1')?.deleted).toBe(true);
    expect(snapA.pages.find((p) => p.id === 'page-0')?.rotation).toBe(90);
  });
});
