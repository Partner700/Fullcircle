import type { UserNotification } from './types';

export function isMessageArrival(notification: UserNotification) {
  const type = String(notification.notification_type || '').toLowerCase();
  const sourceTable = String(notification.metadata?.source_table || '').toLowerCase();
  return type === 'direct_message'
    || (type === 'message' && Boolean(notification.metadata?.group_message_id || notification.metadata?.tent_id))
    || (type === 'message_mention' && ['direct_messages', 'tent_group_messages', 'tent_messages'].includes(sourceTable));
}

export function isQuizArrival(notification: UserNotification) {
  const type = String(notification.notification_type || '').toLowerCase();
  return type === 'quiz_release' || type === 'weekly_quiz_reminder';
}

export function isDoveArrival(notification: UserNotification) {
  return isMessageArrival(notification) || isQuizArrival(notification);
}
