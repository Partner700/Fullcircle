import type { UserNotification } from './types';

export const OPEN_MESSAGE_CONTEXT_EVENT = 'full-circle-open-message-context';

export type OpenMessageContext =
  | { kind: 'direct'; senderId: string }
  | { kind: 'tent_direct'; senderId: string; tentId: string }
  | { kind: 'tent_group'; tentId: string };

let activeContext: OpenMessageContext | null = null;

export function setOpenMessageContext(context: OpenMessageContext | null) {
  activeContext = context;
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(OPEN_MESSAGE_CONTEXT_EVENT, { detail: context }));
  }
}

export function getOpenMessageContext() {
  return activeContext;
}

export function messageNotificationMatchesContext(
  notification: UserNotification,
  context: OpenMessageContext | null = activeContext,
) {
  if (!context) return false;
  const metadata = notification.metadata || {};
  const type = String(notification.notification_type || '').toLowerCase();
  const sourceTable = String(metadata.source_table || '').toLowerCase();
  const senderId = String(metadata.sender_id || notification.actor_id || '').trim();
  const tentId = String(metadata.tent_id || '').trim();
  const hasGroupMessage = Boolean(metadata.group_message_id);

  if (context.kind === 'tent_group') {
    return tentId === context.tentId && hasGroupMessage;
  }

  if (context.kind === 'tent_direct') {
    const looksLikeTentDirect = sourceTable === 'tent_messages'
      || (Boolean(metadata.message_id) && !hasGroupMessage && Boolean(tentId));
    return looksLikeTentDirect
      && tentId === context.tentId
      && senderId === context.senderId;
  }

  const looksLikeDirect = type === 'direct_message'
    || sourceTable === 'direct_messages'
    || Boolean(metadata.direct_message_id);
  return looksLikeDirect && senderId === context.senderId;
}
