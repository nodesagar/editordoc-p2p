import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  initializeDocument,
  readDocumentSnapshot,
  addTextOverlayCRDT,
  addWhiteoutCRDT,
} from '../lib/crdt/schema';

describe('State-Vector Handshake Protocol', () => {
  it('delivers all historical changes made before peers connected', () => {
    // Peer A and Peer B have never met before, but share the same base documentId
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const documentId = 'shared-sha256-hash';

    // Peer A made 5 edits offline over 2 weeks
    initializeDocument(docA, documentId, 'Handshake Test', 2);
    for (let i = 0; i < 5; i++) {
      addTextOverlayCRDT(docA, {
        pageIndex: 0,
        x: 10 + i * 5,
        y: 10 + i * 5,
        text: `Peer A Edit #${i + 1}`,
        fontSize: 14,
      });
    }

    // Peer B made 3 edits offline independently
    initializeDocument(docB, documentId, 'Handshake Test', 2);
    for (let i = 0; i < 3; i++) {
      addWhiteoutCRDT(docB, {
        pageIndex: 1,
        x: 20 + i * 10,
        y: 20 + i * 10,
        width: 15,
        height: 10,
      });
    }

    // ================= Simulated Handshake =================
    // 1. Peer A joins, sends its state vector to Peer B
    const vectorA = Y.encodeStateVector(docA);
    // 2. Peer B calculates delta for A using vectorA, sends update back
    const diffForA = Y.encodeStateAsUpdate(docB, vectorA);

    // 3. Peer B sends its state vector to Peer A
    const vectorB = Y.encodeStateVector(docB);
    // 4. Peer A calculates delta for B using vectorB, sends update back
    const diffForB = Y.encodeStateAsUpdate(docA, vectorB);

    // Apply reciprocal delta updates
    Y.applyUpdate(docA, diffForA);
    Y.applyUpdate(docB, diffForB);

    const snapA = readDocumentSnapshot(docA);
    const snapB = readDocumentSnapshot(docB);

    // Both peers now have 5 text overlays from A and 3 whiteouts from B
    expect(snapA.textOverlays.length).toBe(5);
    expect(snapA.whiteouts.length).toBe(3);
    expect(snapB.textOverlays.length).toBe(5);
    expect(snapB.whiteouts.length).toBe(3);

    // Full convergence
    expect(JSON.stringify(snapA)).toEqual(JSON.stringify(snapB));
  });
});
