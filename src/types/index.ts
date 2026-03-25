export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  error?: boolean;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export type ModelStatus = 'not_downloaded' | 'downloading' | 'ready' | 'error';

export interface ModelInfo {
  name: string;
  displayName: string;
  sizeGB: number;
  status: ModelStatus;
  downloadProgress?: number;
  filePath?: string;
}

export interface AppLog {
  id: string;
  level: 'info' | 'warn' | 'error';
  tag: string;
  message: string;
  timestamp: number;
  details?: string;
}
