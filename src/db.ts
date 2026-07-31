import Dexie, { type Table } from 'dexie';

export interface LocalMessage {
  id: string; // UUID
  chatId: string; // The ID of the contact this message belongs to
  senderId: string;
  type: 'text' | 'image' | 'audio' | 'video' | 'file' | 'call';
  content: string; // Encrypted text content or file metadata (JSON) or call meta (JSON)
  timestamp: number;
  expiresAt?: number; // Optional timestamp when it should be deleted
  fileId?: string; // Reference to files table
  status?: 'sent' | 'delivered' | 'read';
  replyTo?: string; // ID of the message being replied to
}

export interface CallMessageMeta {
  callId: string;
  callerId: string;
  receiverId: string;
  status: 'calling' | 'ongoing' | 'completed' | 'missed';
  duration?: number;
}

export interface LocalFile {
  id: string; // UUID
  data: ArrayBuffer; // Encrypted file blob
}

export class ChatDB extends Dexie {
  messages!: Table<LocalMessage, string>;
  files!: Table<LocalFile, string>;

  constructor() {
    super('whatsapp_clone_db');
    this.version(1).stores({
      messages: 'id, chatId, timestamp, expiresAt',
      files: 'id',
    });
  }
}

export const db = new ChatDB();
