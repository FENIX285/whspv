import { io, Socket } from "socket.io-client";
import { v4 as uuidv4 } from "uuid";
import { db } from "./db";
import { encryptText, decryptText, encryptFile, decryptFile } from "./crypto";
import Peer from "simple-peer";

type MessageCallback = (msg: any) => void;
type CallCallback = (contactId: string, stream: MediaStream) => void;
type CallEndedCallback = (contactId: string) => void;

class WebRTCManager {
  socket: Socket | null = null;
  peers = new Map<string, RTCPeerConnection>();
  dataChannels = new Map<string, RTCDataChannel>();
  callPeers = new Map<string, Peer.Instance>();
  callStreams = new Map<string, MediaStream>();
  activeCallIds = new Map<string, string>();
  callStartTimes = new Map<string, number>();
  
  setActiveCallId(contactId: string, callId: string) {
    this.activeCallIds.set(contactId, callId);
  }

  getActiveCallId(contactId: string): string | undefined {
    return this.activeCallIds.get(contactId);
  }

  clearActiveCallId(contactId: string) {
    this.activeCallIds.delete(contactId);
    this.callStartTimes.delete(contactId);
  }

  setCallStartTime(contactId: string, time: number = Date.now()) {
    if (!this.callStartTimes.has(contactId)) {
      this.callStartTimes.set(contactId, time);
    }
  }

  getCallStartTime(contactId: string): number | undefined {
    return this.callStartTimes.get(contactId);
  }

  clearCallStartTime(contactId: string) {
    this.callStartTimes.delete(contactId);
  }
  
  messageListeners = new Set<MessageCallback>();
  typingListeners = new Set<(contactId: string, isTyping: boolean) => void>();
  callListeners = new Set<CallCallback>();
  callEndedListeners = new Set<CallEndedCallback>();
  callInviteListeners = new Set<(contactId: string, payload?: any) => void>();
  callAcceptListeners = new Set<(contactId: string, payload?: any) => void>();
  callConnectedListeners = new Set<(contactId: string) => void>();
  callStatusUpdateListeners = new Set<(contactId: string, payload?: any) => void>();
  callBusyListeners = new Set<(contactId: string, payload?: any) => void>();
  
  public isBusy: boolean = false;
  userId: string | null = null;
  aesKey: CryptoKey | null = null;
  private hashedPassword?: string;

  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.userId = null;
    this.aesKey = null;
    this.hashedPassword = undefined;
    
    // Close all connections
    this.peers.forEach(peer => peer.close());
    this.peers.clear();
    this.dataChannels.clear();
    
    this.callPeers.forEach(peer => peer.destroy());
    this.callPeers.clear();
    
    this.callStreams.forEach(stream => stream.getTracks().forEach(t => t.stop()));
    this.callStreams.clear();
  }

  init(userId: string, aesKey: CryptoKey) {
    this.userId = userId;
    this.aesKey = aesKey;
    // Assuming backend is hosted on the same domain or proxied in AI Studio
    this.socket = io({ path: '/socket.io' });

    this.socket.on("connect", () => {
      // Re-authenticate if socket reconnects
      if (this.userId && this.hashedPassword) {
        this.socket?.emit("login", { userId: this.userId, hashedPassword: this.hashedPassword }, (res: any) => {
          if (res.success) {
            // Trigger a refresh of contacts to update presence
            window.dispatchEvent(new CustomEvent("refresh_contacts"));
            this.startPresencePing();
          }
        });
      }
    });

    this.socket.on("signal", async ({ from, type, payload }) => {
      if (type === "offer") {
        await this.handleOffer(from, payload);
      } else if (type === "answer") {
        await this.handleAnswer(from, payload);
      } else if (type === "ice-candidate") {
        await this.handleIceCandidate(from, payload);
      } else if (type === "call-signal") {
        this.handleCallSignal(from, payload);
      } else if (type === "call-end") {
        const callId = payload?.callId || this.getActiveCallId(from);
        const startTime = this.getCallStartTime(from);
        let finalDuration = payload?.duration || 0;
        if (startTime) {
          finalDuration = Math.max(finalDuration, Math.floor((Date.now() - startTime) / 1000));
        }

        let finalStatus = payload?.status;
        if (!finalStatus) {
          finalStatus = startTime ? 'completed' : 'missed';
        }

        if (callId) {
          const existing = await db.messages.get(callId);
          let callerId = payload?.callerId || from;
          if (existing && existing.senderId) {
            callerId = existing.senderId;
          }

          await this.saveOrUpdateCallMessage(from, callerId, callId, finalStatus, finalDuration);
          this.clearActiveCallId(from);
        }
        this.handleCallEnd(from);
      } else if (type === "call-invite") {
        const callId = payload?.callId;
        if (this.isBusy) {
          if (this.socket) {
            this.socket.emit("signal", { to: from, type: "call-busy", payload: { callId, callerId: payload?.callerId || from } });
          }
          if (callId) {
            await this.saveOrUpdateCallMessage(from, payload?.callerId || from, callId, 'missed', 0);
          }
        } else {
          if (callId) {
            this.setActiveCallId(from, callId);
            await this.saveOrUpdateCallMessage(from, payload?.callerId || from, callId, 'calling', 0);
          }
          for (const cb of this.callInviteListeners) cb(from, payload);
        }
      } else if (type === "call-busy") {
        const callId = payload?.callId || this.getActiveCallId(from);
        if (callId) {
          await this.saveOrUpdateCallMessage(from, this.userId || '', callId, 'missed', 0);
          this.clearActiveCallId(from);
        }
        for (const cb of this.callBusyListeners) cb(from, payload);
      } else if (type === "call-accept") {
        const callId = payload?.callId || this.getActiveCallId(from);
        if (callId) {
          this.setActiveCallId(from, callId);
          await this.saveOrUpdateCallMessage(from, payload?.callerId || from, callId, 'ongoing', 0);
        }
        for (const cb of this.callAcceptListeners) cb(from, payload);
      } else if (type === "call-status-update") {
        const callId = payload?.callId || this.getActiveCallId(from);
        if (callId) {
          this.setActiveCallId(from, callId);
          await this.saveOrUpdateCallMessage(from, payload?.callerId || from, callId, payload.status, payload.duration || 0);
          if (payload.status === 'completed' || payload.status === 'missed') {
            this.clearActiveCallId(from);
          }
        }
        for (const cb of this.callStatusUpdateListeners) cb(from, payload);
      }
    });
  }

  private pingInterval: any;
  
  private startPresencePing() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    // Ping immediately
    this.socket?.emit("ping_presence");
    this.pingInterval = setInterval(() => {
      this.socket?.emit("ping_presence");
    }, 30000); // 30 seconds
  }

  async login(userId: string, hashedPassword: string): Promise<boolean> {
    this.hashedPassword = hashedPassword;
    return new Promise((resolve) => {
      if (!this.socket) return resolve(false);
      this.socket.emit("login", { userId, hashedPassword }, (res: any) => {
        if (res.success) {
           this.startPresencePing();
        }
        resolve(res.success);
      });
    });
  }

  async getContacts(): Promise<any[]> {
    return new Promise((resolve) => {
      if (!this.socket) return resolve([]);
      this.socket.emit("get_contacts", {}, (res: any) => {
        resolve(res.success ? res.contacts : []);
      });
    });
  }

  async removeContact(contactId: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.socket) return resolve(false);
      this.socket.emit("remove_contact", { contactId }, (res: any) => resolve(res?.success || false));
    });
  }

  async updateContactAlias(contactId: string, alias: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.socket) return resolve(false);
      this.socket.emit("update_contact_alias", { contactId, alias }, (res: any) => resolve(res?.success || false));
    });
  }

  async addContact(contactId: string, alias: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.socket) return resolve(false);
      this.socket.emit("add_contact", { contactId, alias }, (res: any) => {
        resolve(res.success);
      });
    });
  }

  async deleteContact(contactId: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.socket) return resolve(false);
      this.socket.emit("delete_contact", { contactId }, (res: any) => {
        resolve(res.success);
      });
    });
  }

  onMessage(cb: MessageCallback) {
    this.messageListeners.add(cb);
    return () => this.messageListeners.delete(cb);
  }

  onCall(cb: CallCallback) {
    this.callListeners.add(cb);
    return () => this.callListeners.delete(cb);
  }

  onCallEnded(cb: CallEndedCallback) {
    this.callEndedListeners.add(cb);
    return () => this.callEndedListeners.delete(cb);
  }

  onCallInvite(cb: (contactId: string, payload?: any) => void) {
    this.callInviteListeners.add(cb);
    return () => this.callInviteListeners.delete(cb);
  }
  
  onCallAccept(cb: (contactId: string, payload?: any) => void) {
    this.callAcceptListeners.add(cb);
    return () => this.callAcceptListeners.delete(cb);
  }

  onCallConnected(cb: (contactId: string) => void) {
    this.callConnectedListeners.add(cb);
    return () => this.callConnectedListeners.delete(cb);
  }

  onCallStatusUpdate(cb: (contactId: string, payload?: any) => void) {
    this.callStatusUpdateListeners.add(cb);
    return () => this.callStatusUpdateListeners.delete(cb);
  }

  onCallBusy(cb: (contactId: string, payload?: any) => void) {
    this.callBusyListeners.add(cb);
    return () => this.callBusyListeners.delete(cb);
  }

  setIsBusy(busy: boolean) {
    this.isBusy = busy;
  }

  sendCallInvite(contactId: string, payload?: any) {
    if (this.socket) {
      this.socket.emit("signal", { to: contactId, type: "call-invite", payload });
    }
  }

  sendCallAccept(contactId: string, payload?: any) {
    if (this.socket) {
      this.socket.emit("signal", { to: contactId, type: "call-accept", payload });
    }
  }

  sendCallStatusUpdate(contactId: string, payload?: any) {
    if (this.socket) {
      this.socket.emit("signal", { to: contactId, type: "call-status-update", payload });
    }
  }

  async saveOrUpdateCallMessage(
    chatId: string,
    callerId: string,
    callId: string,
    status: 'calling' | 'ongoing' | 'completed' | 'missed',
    duration?: number
  ) {
    if (!this.aesKey || !this.userId) return;
    try {
      const existing = await db.messages.get(callId);
      let existingStatus = 'calling';
      if (existing?.content) {
        try {
          const decStr = await decryptText(existing.content, this.aesKey);
          const parsed = JSON.parse(decStr);
          if (parsed?.status) existingStatus = parsed.status;
        } catch(e){}
      }

      const startTime = this.getCallStartTime(chatId);
      let calcDuration = duration || 0;
      if (startTime) {
        calcDuration = Math.max(calcDuration, Math.floor((Date.now() - startTime) / 1000));
      }

      let finalStatus = status;
      if (existingStatus === 'ongoing' || existingStatus === 'completed' || startTime) {
        if (finalStatus === 'missed' || finalStatus === 'calling') {
          finalStatus = 'completed';
        }
      }

      let receiverId = chatId;
      if (callerId === this.userId) {
        receiverId = chatId;
      } else {
        receiverId = this.userId;
      }

      const meta = { callId, callerId, receiverId, status: finalStatus, duration: calcDuration };
      const encContent = await encryptText(JSON.stringify(meta), this.aesKey);

      const messageData = {
        id: callId,
        chatId,
        senderId: callerId,
        type: 'call' as const,
        content: encContent,
        timestamp: existing ? existing.timestamp : Date.now(),
        status: 'delivered' as const
      };

      await db.messages.put(messageData);
      this.notifyMessage(messageData);
      for (const cb of this.callStatusUpdateListeners) {
        cb(chatId, { callId, callerId, status: finalStatus, duration: calcDuration });
      }
    } catch (e) {
      console.error("Failed to save/update call message:", e);
    }
  }

  onTyping(cb: (contactId: string, isTyping: boolean) => void) {
    this.typingListeners.add(cb);
    return () => this.typingListeners.delete(cb);
  }

  private notifyTyping(contactId: string, isTyping: boolean) {
    for (const cb of this.typingListeners) {
      cb(contactId, isTyping);
    }
  }

  private createPeerConnection(contactId: string): RTCPeerConnection {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });

    pc.onicecandidate = (event) => {
      if (event.candidate && this.socket) {
        this.socket.emit("signal", {
          to: contactId,
          type: "ice-candidate",
          payload: event.candidate,
        });
      }
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === "disconnected" || pc.iceConnectionState === "failed" || pc.iceConnectionState === "closed") {
        this.peers.delete(contactId);
        this.dataChannels.delete(contactId);
      }
    };

    pc.ondatachannel = (event) => {
      const dc = event.channel;
      this.setupDataChannel(contactId, dc);
    };

    this.peers.set(contactId, pc);
    return pc;
  }

  private setupDataChannel(contactId: string, dc: RTCDataChannel) {
    this.dataChannels.set(contactId, dc);
    
    // To handle large files over DataChannel, we need a buffer
    let fileBuffer: ArrayBuffer[] = [];
    let receivingFile = false;
    let expectedSize = 0;
    let currentMetadata: any = null;

    dc.onmessage = async (event) => {
      if (typeof event.data === "string") {
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'typing') {
            this.notifyTyping(contactId, data.isTyping);
            return;
          } else if (data.type === 'delete-message') {
            await db.messages.delete(data.messageId);
            this.notifyMessage({ type: 'delete', messageId: data.messageId, chatId: contactId });
            return;
          } else if (data.type === 'ack') {
            // Update local message status
            const localMsg = await db.messages.get(data.messageId);
            if (localMsg) {
              if (data.status === 'read' || (data.status === 'delivered' && localMsg.status !== 'read')) {
                await db.messages.update(data.messageId, { status: data.status });
                this.notifyMessage({ ...localMsg, status: data.status });
              }
            }
          } else if (data.type === 'file-start') {
            receivingFile = true;
            expectedSize = data.size;
            currentMetadata = data.metadata;
            fileBuffer = [];
          } else if (data.type === 'file-end') {
            receivingFile = false;
            // Reconstruct file
            const blob = new Blob(fileBuffer);
            const arrayBuffer = await blob.arrayBuffer();
            fileBuffer = [];
            
            // We received a file via WebRTC (already E2E encrypted by WebRTC itself)
            // Now encrypt it for local IndexedDB storage
            if (this.aesKey) {
              const fileId = currentMetadata.fileId || uuidv4();
              const encFile = await encryptFile(arrayBuffer, this.aesKey);
              await db.files.put({ id: fileId, data: encFile });
              
              const encContent = await encryptText(JSON.stringify(currentMetadata.contentData), this.aesKey);
              const messageData = {
                id: currentMetadata.messageId || uuidv4(),
                chatId: contactId,
                senderId: contactId,
                type: currentMetadata.msgType,
                content: encContent,
                timestamp: currentMetadata.timestamp,
                expiresAt: currentMetadata.expiresAt,
                fileId: fileId,
                status: 'delivered' as const,
                replyTo: currentMetadata.replyTo
              };
              await db.messages.put(messageData);
              this.notifyMessage(messageData);
              this.sendAck(contactId, messageData.id, 'delivered');
            }
          } else if (data.type === 'text') {
            // Text message
            if (this.aesKey) {
              const encContent = await encryptText(data.content, this.aesKey);
              const messageData = {
                id: data.messageId || uuidv4(),
                chatId: contactId,
                senderId: contactId,
                type: 'text' as const,
                content: encContent,
                timestamp: data.timestamp,
                expiresAt: data.expiresAt,
                status: 'delivered' as const,
                replyTo: data.replyTo
              };
              await db.messages.put(messageData);
              this.notifyMessage(messageData);
              this.sendAck(contactId, messageData.id, 'delivered');
            }
          }
        } catch(e) {
          console.error("Data channel JSON error", e);
        }
      } else {
        // ArrayBuffer chunk
        if (receivingFile) {
          fileBuffer.push(event.data);
        }
      }
    };
  }

  private notifyMessage(msg: any) {
    for (const cb of this.messageListeners) {
      cb(msg);
    }
  }

  async connectToContact(contactId: string) {
    if (this.peers.has(contactId)) return;
    
    const pc = this.createPeerConnection(contactId);
    const dc = pc.createDataChannel("chat");
    this.setupDataChannel(contactId, dc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    
    if (this.socket) {
      this.socket.emit("signal", {
        to: contactId,
        type: "offer",
        payload: offer,
      });
    }
  }

  private async handleOffer(from: string, offer: RTCSessionDescriptionInit) {
    const pc = this.peers.get(from) || this.createPeerConnection(from);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    if (this.socket) {
      this.socket.emit("signal", {
        to: from,
        type: "answer",
        payload: answer,
      });
    }
  }

  private async handleAnswer(from: string, answer: RTCSessionDescriptionInit) {
    const pc = this.peers.get(from);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  private async handleIceCandidate(from: string, candidate: RTCIceCandidateInit) {
    const pc = this.peers.get(from);
    if (pc) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    }
  }

  // --- Voice Call Methods using Simple-Peer ---
  pendingCallStreams = new Map<string, MediaStream>();

  startVoiceCall(contactId: string, stream: MediaStream) {
    this.setupCallPeer(contactId, true, stream);
  }

  acceptVoiceCall(contactId: string, stream: MediaStream) {
    const peer = this.callPeers.get(contactId);
    if (peer) {
      peer.addStream(stream);
    } else {
      this.pendingCallStreams.set(contactId, stream);
    }
  }

  endVoiceCall(contactId: string, payload?: any) {
    const peer = this.callPeers.get(contactId);
    if (peer) {
      peer.destroy();
      this.callPeers.delete(contactId);
      this.callStreams.delete(contactId);
    }
    this.pendingCallStreams.delete(contactId);
    
    // Also notify other side
    if (this.socket) {
      this.socket.emit("signal", {
        to: contactId,
        type: "call-end",
        payload: payload || null
      });
    }

    for (const cb of this.callEndedListeners) {
      cb(contactId);
    }
    this.clearCallStartTime(contactId);
  }

  private setupCallPeer(contactId: string, initiator: boolean, stream?: MediaStream) {
    console.log("setupCallPeer", { contactId, initiator, hasStream: !!stream });
    const peer = new Peer({
      initiator,
      stream,
      trickle: true,
      config: { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] }
    });

    peer.on("signal", (data) => {
      console.log("Call peer generated signal", data.type);
      if (this.socket) {
        this.socket.emit("signal", {
          to: contactId,
          type: "call-signal",
          payload: data
        });
      }
    });

    peer.on("connect", () => {
      console.log("Call peer connected!");
      this.setCallStartTime(contactId);
      for (const cb of this.callConnectedListeners) {
        cb(contactId);
      }
    });

    peer.on("stream", (remoteStream) => {
      console.log("Call peer received stream!", remoteStream.getTracks());
      this.setCallStartTime(contactId);
      this.callStreams.set(contactId, remoteStream);
      for (const cb of this.callListeners) {
        cb(contactId, remoteStream);
      }
    });

    peer.on("track", (track, remoteStream) => {
      console.log("Call peer received track!", track.kind, remoteStream.getTracks());
      this.callStreams.set(contactId, remoteStream);
      for (const cb of this.callListeners) {
        cb(contactId, remoteStream);
      }
    });

    peer.on("close", () => {
      console.log("Call peer closed");
      this.callPeers.delete(contactId);
      this.callStreams.delete(contactId);
      for (const cb of this.callEndedListeners) {
        cb(contactId);
      }
    });

    peer.on("error", (err) => {
      console.warn("Simple peer notice:", err?.message || err);
      this.callPeers.delete(contactId);
      this.callStreams.delete(contactId);
    });

    this.callPeers.set(contactId, peer);
    return peer;
  }

  private handleCallSignal(from: string, signalData: any) {
    let peer = this.callPeers.get(from);
    if (!peer) {
      // Incoming call
      const stream = this.pendingCallStreams.get(from);
      peer = this.setupCallPeer(from, false, stream);
      this.pendingCallStreams.delete(from);
    }
    peer.signal(signalData);
  }

  private handleCallEnd(from: string) {
    const peer = this.callPeers.get(from);
    if (peer) {
      peer.destroy();
      this.callPeers.delete(from);
      this.callStreams.delete(from);
    }
    for (const cb of this.callEndedListeners) {
      cb(from);
    }
  }

  // --- End Voice Call Methods ---

  private async getOpenDataChannel(contactId: string): Promise<RTCDataChannel> {
    return new Promise(async (resolve, reject) => {
      let dc = this.dataChannels.get(contactId);
      
      if (dc && dc.readyState === "open") {
        return resolve(dc);
      }

      if (!dc || dc.readyState === "closed" || dc.readyState === "closing") {
        this.peers.delete(contactId);
        this.dataChannels.delete(contactId);
        await this.connectToContact(contactId);
        dc = this.dataChannels.get(contactId);
      }
      
      if (!dc) {
        return reject(new Error("Failed to create data channel"));
      }

      if (dc.readyState === "open") {
        return resolve(dc);
      }

      const handleOpen = () => {
        dc!.removeEventListener("open", handleOpen);
        resolve(dc!);
      };
      
      const handleError = (e: any) => {
        dc!.removeEventListener("error", handleError);
        reject(e);
      }

      dc.addEventListener("open", handleOpen);
      dc.addEventListener("error", handleError);
      
      // Safety timeout
      setTimeout(() => {
        dc!.removeEventListener("open", handleOpen);
        dc!.removeEventListener("error", handleError);
        reject(new Error("Data channel timeout"));
      }, 15000);
    });
  }

  async sendDeleteMessage(contactId: string, messageId: string) {
    try {
      const dc = await this.getOpenDataChannel(contactId);
      dc.send(JSON.stringify({
        type: 'delete-message',
        messageId
      }));
    } catch (e) {
      console.error("Failed to send delete-message:", e);
    }
  }

  async sendTyping(contactId: string, isTyping: boolean) {
    try {
      const dc = await this.getOpenDataChannel(contactId);
      dc.send(JSON.stringify({
        type: 'typing',
        isTyping
      }));
    } catch (e) {
      // It's okay if typing indicator fails to send
    }
  }

  async sendAck(contactId: string, messageId: string, status: 'delivered' | 'read') {
    try {
      const dc = await this.getOpenDataChannel(contactId);
      dc.send(JSON.stringify({
        type: 'ack',
        messageId,
        status
      }));
    } catch (e) {
      // Ignored
    }
  }

  async sendMessage(contactId: string, content: string, expiresInMs?: number, replyTo?: string) {
    const messageId = uuidv4();
    const timestamp = Date.now();
    const expiresAt = expiresInMs ? timestamp + expiresInMs : undefined;

    // Save locally
    if (this.aesKey && this.userId) {
      const encContent = await encryptText(content, this.aesKey);
      const messageData = {
        id: messageId,
        chatId: contactId,
        senderId: this.userId,
        type: 'text' as const,
        content: encContent,
        timestamp,
        expiresAt,
        status: 'sent' as const,
        replyTo
      };
      await db.messages.put(messageData);
      this.notifyMessage(messageData);
    }

    try {
      const dc = await this.getOpenDataChannel(contactId);
      dc.send(JSON.stringify({
        type: 'text',
        messageId,
        content,
        timestamp,
        expiresAt,
        replyTo
      }));
    } catch (e) {
      console.error("Failed to send message:", e);
    }
  }

  async sendFile(contactId: string, fileData: ArrayBuffer, type: 'image' | 'audio' | 'video' | 'file', metadata: any, expiresInMs?: number, replyTo?: string) {
    const messageId = uuidv4();
    const fileId = uuidv4();
    const timestamp = Date.now();
    const expiresAt = expiresInMs ? timestamp + expiresInMs : undefined;

    // Save locally
    if (this.aesKey && this.userId) {
      const encFile = await encryptFile(fileData, this.aesKey);
      await db.files.put({ id: fileId, data: encFile });
      
      const encContent = await encryptText(JSON.stringify(metadata), this.aesKey);
      const messageData = {
        id: messageId,
        chatId: contactId,
        senderId: this.userId,
        type,
        content: encContent,
        timestamp,
        expiresAt,
        fileId,
        status: 'sent' as const,
        replyTo
      };
      await db.messages.put(messageData);
      this.notifyMessage(messageData);
    }

    try {
      const dc = await this.getOpenDataChannel(contactId);
      
      dc.send(JSON.stringify({
        type: 'file-start',
        size: fileData.byteLength,
        metadata: {
          messageId,
          fileId,
          msgType: type,
          contentData: metadata,
          timestamp,
          expiresAt,
          replyTo
        }
      }));

      // Chunk size 16KB for WebRTC Data Channel
      const chunkSize = 16384; 
      for (let i = 0; i < fileData.byteLength; i += chunkSize) {
        const chunk = fileData.slice(i, i + chunkSize);
        dc.send(chunk);
      }

      dc.send(JSON.stringify({ type: 'file-end' }));
    } catch (e) {
      console.error("Failed to send file:", e);
    }
  }
}

export const rtcManager = new WebRTCManager();
