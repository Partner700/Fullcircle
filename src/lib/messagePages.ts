import type { DirectMessage, TentGroupMessage, TentMessage } from './types';

export const MESSAGE_PAGE_SIZE = 20;
export type ChatMessage = (DirectMessage | TentMessage | TentGroupMessage) & {
  sender?: { display_name: string; avatar_url: string | null } | null;
};
export type MessageCursor = Pick<ChatMessage, 'id' | 'created_at'>;
export type MessagePage = { messages: ChatMessage[]; hasMore: boolean };
export type MessagePageOptions = { before?: MessageCursor; after?: MessageCursor };

export function messageCursorFilter(cursor: MessageCursor, direction: 'before' | 'after') {
  if (!/^[0-9a-f-]{36}$/i.test(cursor.id) || !/^[0-9T:.+Z-]+$/.test(cursor.created_at) || !Number.isFinite(Date.parse(cursor.created_at))) {
    throw new Error('Invalid message cursor.');
  }
  const op = direction === 'before' ? 'lt' : 'gt';
  return `or(created_at.${op}.${cursor.created_at},and(created_at.eq.${cursor.created_at},id.${op}.${cursor.id}))`;
}

export function mergeMessagePage(current: ChatMessage[], incoming: ChatMessage[]) {
  const byId = new Map(current.map(message => [message.id, message]));
  incoming.forEach(message => byId.set(message.id, { ...byId.get(message.id), ...message }));
  const fraction = (date: string) => (date.match(/\.(\d+)/)?.[1] || '').padEnd(9, '0');
  return [...byId.values()].sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at)
    || fraction(a.created_at).localeCompare(fraction(b.created_at)) || a.id.localeCompare(b.id));
}
