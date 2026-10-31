import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { joinRoom } from 'trystero/torrent';
import { SyncTransport, PeerMessage, DocSyncEngine, BroadcastChannelTransport } from './docSync';
import { SyncStatus } from '../../types';

export class TrysteroTransport implements SyncTransport {
  public readonly name = 'Trystero-WebRTC';
  private room: any = null;
  private peerJoinCbs: ((peerId: string) => void)[] = [];
  private peerLeaveCbs: ((peerId: string) => void)[] = [];
  private messageCbs: ((peerId: string, message: PeerMessage) => void)[] = [];
  private sendAction: any = null;
  private appId: string;

  constructor(appId: string = 'editordoc-p2p-v1') {
    this.appId = appId;
  }

  connect(roomId: string): void {
    try {
      this.room = joinRoom({ appId: this.appId }, roomId);

      const [send, receive] = this.room.makeAction('sync_action');
      this.sendAction = send;

      receive((data: any, peerId: string) => {
        this.messageCbs.forEach((cb) => cb(peerId, data));
      });

      this.room.onPeerJoin((peerId: string) => {
        this.peerJoinCbs.forEach((cb) => cb(peerId));
      });

      this.room.onPeerLeave((peerId: string) => {
        this.peerLeaveCbs.forEach((cb) => cb(peerId));
      });
    } catch (err) {
      console.warn('Failed to initialize Trystero WebRTC room:', err);
    }
  }

  disconnect(): void {
    if (this.room) {
      try {
        this.room.leave();
      } catch (e) {}
      this.room = null;
      this.sendAction = null;
    }
  }

  sendToPeer(peerId: string, message: PeerMessage): void {
    if (this.sendAction) {
      this.sendAction(message, peerId);
    }
  }

  broadcast(message: PeerMessage): void {
    if (this.sendAction) {
      this.sendAction(message);
    }
  }

  onPeerJoin(cb: (peerId: string) => void): void {
    this.peerJoinCbs.push(cb);
  }

  onPeerLeave(cb: (peerId: string) => void): void {
    this.peerLeaveCbs.push(cb);
  }

  onMessage(cb: (peerId: string, message: PeerMessage) => void): void {
    this.messageCbs.push(cb);
  }

  getPeers(): string[] {
    if (this.room) {
      return Object.keys(this.room.getPeers() || {});
    }
    return [];
  }
}

export interface P2PProviderHandle {
  doc: Y.Doc;
  documentId: string;
  engine: DocSyncEngine;
  idbProvider: IndexeddbPersistence;
  destroy: () => void;
}

export async function createP2PProvider(
  documentId: string,
  existingDoc?: Y.Doc,
  callbacks?: {
    getLocalPdfBytes?: () => Uint8Array | null;
    onStatusChange?: (status: SyncStatus) => void;
    onPeersChange?: (count: number) => void;
    onPdfAvailable?: (bytes: Uint8Array, filename?: string) => void;
    onPdfProgress?: (progress: number) => void;
  }
): Promise<P2PProviderHandle> {
  const cleanDocId = documentId.trim().toLowerCase();
  const doc = existingDoc || new Y.Doc();

  // 1. Offline persistence with y-indexeddb
  const idbProvider = new IndexeddbPersistence(cleanDocId, doc);
  callbacks?.onStatusChange?.('connecting');

  // Wait for indexeddb to load locally persisted state
  await idbProvider.whenSynced;

  // 2. Transports: WebRTC (Trystero) + BroadcastChannel fallback
  const transports: SyncTransport[] = [
    new BroadcastChannelTransport(),
  ];

  // Try instantiating Trystero in browser environment
  if (typeof window !== 'undefined') {
    try {
      transports.push(new TrysteroTransport('editordoc-p2p-v1'));
    } catch (e) {
      console.warn('Could not initialize Trystero transport:', e);
    }
  }

  // 3. Start DocSyncEngine
  const engine = new DocSyncEngine({
    doc,
    documentId: cleanDocId,
    transports,
    getLocalPdfBytes: callbacks?.getLocalPdfBytes,
    onPeersChange: (count) => {
      callbacks?.onPeersChange?.(count);
      callbacks?.onStatusChange?.(count > 0 ? 'synced' : 'offline');
    },
    onPdfAvailable: callbacks?.onPdfAvailable,
    onPdfProgress: callbacks?.onPdfProgress,
  });

  callbacks?.onStatusChange?.(engine.getConnectedPeerCount() > 0 ? 'synced' : 'offline');

  return {
    doc,
    documentId,
    engine,
    idbProvider,
    destroy: () => {
      engine.destroy();
      idbProvider.destroy();
    },
  };
}
