// Subset of the Gmail API message schema we actually use.

export interface GmailMessageHeader {
  name: string;
  value: string;
}

export interface GmailMessagePart {
  partId?: string;
  mimeType?: string;
  filename?: string;
  headers?: GmailMessageHeader[];
  body?: {
    attachmentId?: string;
    size?: number;
    data?: string; // base64url encoded
  };
  parts?: GmailMessagePart[];
}

export interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  snippet?: string;
  historyId?: string;
  internalDate?: string;
  sizeEstimate?: number;
  payload?: GmailMessagePart;
  raw?: string; // base64url MIME, only when format=RAW
}

export interface GmailHistoryMessage {
  id: string;
  threadId?: string;
}

export interface GmailHistoryItem {
  id: string;
  messages?: GmailHistoryMessage[];
  messagesAdded?: Array<{ message: GmailHistoryMessage }>;
}

export interface GmailHistoryResponse {
  history?: GmailHistoryItem[];
  nextPageToken?: string;
  historyId?: string;
}

export interface GmailWatchResponse {
  historyId?: string;
  expiration?: string; // Unix timestamp ms as string
}

export interface ParsedEmailHeaders {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string;
  subject: string;
  date: string;
  messageId: string;
  receivedAt: Date | null;
  sentAt: Date | null;
  senderEmail: string;
  senderName: string;
}
