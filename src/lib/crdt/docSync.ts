import * as Y from 'yjs';
import { ChunkMessage, ChunkReassembler, chunkPDF, getOriginalPDF, storeOriginalPDF } from './pdfStore';

export interface PeerMessage {
  type: 'state-vector' | 'state-update' | 'request-pdf' | 'pdf-chunk';
  payload: any;
}

export interface SyncTransport {
  name: string;
  connect(roomId: string): void;
  disconnect(): void;
  sendToPeer(peerId: string, message: PeerMessage): void;
  broadcast(message: PeerMessage): void;
  onPeerJoin(cb: (peerId: string) => void): void;
  onPeerLeave(cb: (peerId: string) => void): void;
  onMessage(cb: (peerId: string, message: PeerMessage) => void): void;
  getPeers(): string[];
}

export interface DocSyncOptions {
  doc: Y.Doc;
  documentId: string;
  transports: SyncTransport[];
  onPeersChange?: (peersCount: number) => void;
  onPdfAvailable?: (bytes: Uint8Array) => void;
  onPdfProgress?: (progress: number) => void;
}

/**
 * DocSyncEngine orchestrates CRDT state synchronization across transports.
 * Implements the mandatory state-vector handshake on peer join and live update relaying.
 */
export class DocSyncEngine {
  private doc: Y.Doc;
  public readonly documentId: string;
  private transports: SyncTransport[];
  private activePeers: Set<string> = new Set();
  private pdfReassembler: ChunkReassembler | null = null;
  private destroyed = false;

  private onPeersChange?: (peersCount: number) => void;
  private onPdfAvailable?: (bytes: Uint8Array) => void;
  private onPdfProgress?: (progress: number) => void;

  constructor(options: DocSyncOptions) {
    this.doc = options.doc;
    this.documentId = options.documentId;
    this.transports = options.transports;
    this.onPeersChange = options.onPeersChange;
    this.onPdfAvailable = options.onPdfAvailable;
    this.onPdfProgress = options.onPdfProgress;

    this.init();
  }

  private init() {
    // 1. Listen for local Y.Doc mutations and broadcast to peers
    this.doc.on('update', this.handleLocalDocUpdate);

    // 2. Initialize all transports
    for (const transport of this.transports) {
      transport.onPeerJoin((peerId) => this.handlePeerJoin(transport, peerId));
      transport.onPeerLeave((peerId) => this.handlePeerLeave(peerId));
      transport.onMessage((peerId, message) => this.handlePeerMessage(transport, peerId, message));
      transport.connect(this.documentId);
    }
  }

  private handleLocalDocUpdate = (update: Uint8Array, origin: any) => {
    if (this.destroyed) return;
    // Skip if incoming from remote peer or file sync
    if (origin === 'p2p' || origin === 'file-sync') {
      return;
    }

    const message: PeerMessage = {
      type: 'state-update',
      payload: update,
    };

    for (const transport of this.transports) {
      transport.broadcast(message);
    }
  };

  /**
   * On EVERY peer join: Handshake step 1
   * Send local state vector to remote peer so they can send us whatever history we missed.
   */
  private handlePeerJoin(transport: SyncTransport, peerId: string) {
    if (this.destroyed) return;
    this.activePeers.add(peerId);
    this.notifyPeers();

    const localStateVector = Y.encodeStateVector(this.doc);
    transport.sendToPeer(peerId, {
      type: 'state-vector',
      payload: localStateVector,
    });
  }

  private handlePeerLeave(peerId: string) {
    if (this.destroyed) return;
    this.activePeers.delete(peerId);
    this.notifyPeers();
  }

  /**
   * Handle incoming messages from peers
   */
  private async handlePeerMessage(
    transport: SyncTransport,
    peerId: string,
    message: PeerMessage
  ) {
    if (this.destroyed) return;

    switch (message.type) {
      case 'state-vector': {
        // Peer sent their state vector -> Send them the delta diff
        const remoteVector = new Uint8Array(message.payload);
        const update = Y.encodeStateAsUpdate(this.doc, remoteVector);
        if (update.byteLength > 0) {
          transport.sendToPeer(peerId, {
            type: 'state-update',
            payload: update,
          });
        }
        break;
      }

      case 'state-update': {
        // Apply remote update to our Y.Doc
        const update = new Uint8Array(message.payload);
        Y.applyUpdate(this.doc, update, 'p2p');
        break;
      }

      case 'request-pdf': {
        // Peer requested original PDF bytes
        const pdfEntry = await getOriginalPDF(this.documentId);
        if (pdfEntry && pdfEntry.bytes) {
          const chunks = chunkPDF(this.documentId, pdfEntry.bytes);
          for (const chunk of chunks) {
            transport.sendToPeer(peerId, {
              type: 'pdf-chunk',
              payload: chunk,
            });
          }
        }
        break;
      }

      case 'pdf-chunk': {
        // Received a PDF chunk from peer
        const chunk = message.payload as ChunkMessage;
        if (chunk.documentId !== this.documentId) return;

        if (!this.pdfReassembler) {
          this.pdfReassembler = new ChunkReassembler(this.documentId);
        }

        const { isComplete, progress } = this.pdfReassembler.addChunk(
          chunk.chunkIndex,
          chunk.totalChunks,
          chunk.data
        );

        if (this.onPdfProgress) {
          this.onPdfProgress(progress);
        }

        if (isComplete) {
          try {
            const assembledBytes = await this.pdfReassembler.assembleAndVerify();
            await storeOriginalPDF(this.documentId, assembledBytes);
            if (this.onPdfAvailable) {
              this.onPdfAvailable(assembledBytes);
            }
          } catch (err) {
            console.error('Failed to assemble and verify PDF chunks:', err);
          }
          this.pdfReassembler = null;
        }
        break;
      }
    }
  }

  /**
   * Request original PDF bytes from connected peers
   */
  public requestPDFFromPeers() {
    const msg: PeerMessage = {
      type: 'request-pdf',
      payload: { documentId: this.documentId },
    };
    for (const t of this.transports) {
      t.broadcast(msg);
    }
  }

  private notifyPeers() {
    if (this.onPeersChange) {
      this.onPeersChange(this.activePeers.size);
    }
  }

  public getConnectedPeerCount(): number {
    return this.activePeers.size;
  }

  public destroy() {
    this.destroyed = true;
    this.doc.off('update', this.handleLocalDocUpdate);
    for (const transport of this.transports) {
      transport.disconnect();
    }
    this.activePeers.clear();
  }
}

/**
 * BroadcastChannelTransport enables same-browser tab-to-tab synchronization
 * with zero network requirement.
 */
export class BroadcastChannelTransport implements SyncTransport {
  public readonly name = 'BroadcastChannel';
  private channel: BroadcastChannel | null = null;
  private myPeerId: string = crypto.randomUUID();
  private peerJoinCbs: ((peerId: string) => void)[] = [];
  private peerLeaveCbs: ((peerId: string) => void)[] = [];
  private messageCbs: ((peerId: string, message: PeerMessage) => void)[] = [];
  private peers: Set<string> = new Set();
  private heartbeatInterval: any = null;

  connect(roomId: string): void {
    this.channel = new BroadcastChannel(`editordoc_room_${roomId}`);

    this.channel.onmessage = (event) => {
      const { senderId, targetId, type, message } = event.data || {};
      if (!senderId || senderId === this.myPeerId) return;

      if (type === 'announce') {
        if (!this.peers.has(senderId)) {
          this.peers.add(senderId);
          this.peerJoinCbs.forEach((cb) => cb(senderId));
          // Reply with ack so they know about us
          this.channel?.postMessage({
            senderId: this.myPeerId,
            targetId: senderId,
            type: 'announce-ack',
          });
        }
      } else if (type === 'announce-ack') {
        if (targetId === this.myPeerId && !this.peers.has(senderId)) {
          this.peers.add(senderId);
          this.peerJoinCbs.forEach((cb) => cb(senderId));
        }
      } else if (type === 'leave') {
        if (this.peers.has(senderId)) {
          this.peers.delete(senderId);
          this.peerLeaveCbs.forEach((cb) => cb(senderId));
        }
      } else if (type === 'data') {
        if (!targetId || targetId === this.myPeerId) {
          if (!this.peers.has(senderId)) {
            this.peers.add(senderId);
            this.peerJoinCbs.forEach((cb) => cb(senderId));
          }
          this.messageCbs.forEach((cb) => cb(senderId, message));
        }
      }
    };

    // Announce presence
    this.channel.postMessage({
      senderId: this.myPeerId,
      type: 'announce',
    });

    // Heartbeat to keep track of live peers
    this.heartbeatInterval = setInterval(() => {
      this.channel?.postMessage({
        senderId: this.myPeerId,
        type: 'announce',
      });
    }, 5000);
  }

  disconnect(): void {
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    if (this.channel) {
      try {
        this.channel.postMessage({
          senderId: this.myPeerId,
          type: 'leave',
        });
        this.channel.close();
      } catch (e) {}
      this.channel = null;
    }
    this.peers.clear();
  }

  sendToPeer(peerId: string, message: PeerMessage): void {
    this.channel?.postMessage({
      senderId: this.myPeerId,
      targetId: peerId,
      type: 'data',
      message,
    });
  }

  broadcast(message: PeerMessage): void {
    this.channel?.postMessage({
      senderId: this.myPeerId,
      type: 'data',
      message,
    });
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
    return Array.from(this.peers);
  }
}
