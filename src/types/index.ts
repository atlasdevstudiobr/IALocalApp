export type SearchDecision = 'local_only' | 'local_plus_web' | 'local_with_uncertainty';

export type WebValidationStatus = 'not_needed' | 'validated' | 'failed';

export interface MessageSource {
  title: string;
  url: string;
  siteName: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  error?: boolean;
  sources?: MessageSource[];
  searchDecision?: SearchDecision;
  webValidationStatus?: WebValidationStatus;
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
