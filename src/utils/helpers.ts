/**
 * Generates a unique ID using timestamp + random number.
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Formats a Unix timestamp into a human-readable date/time string.
 */
export function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const timeStr = date.toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
  });

  if (isToday) {
    return timeStr;
  }

  const dateStr = date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
  });

  return `${dateStr} ${timeStr}`;
}

/**
 * Formats bytes into a human-readable string (KB, MB, GB).
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unitIndex = 0;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  const fractionDigits = value >= 100 || unitIndex === 0 ? 0 : 1;
  return `${value.toFixed(fractionDigits)} ${units[unitIndex]}`;
}

/**
 * Truncates text to a maximum length, appending ellipsis if needed.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Generates a conversation title from the first message content.
 */
export function generateConversationTitle(firstMessage: string): string {
  const cleaned = firstMessage.trim().replace(/\n/g, ' ');
  return truncateText(cleaned, 40) || 'Nova Conversa';
}
