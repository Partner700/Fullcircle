import type { RealtimeChannel } from '@supabase/supabase-js';

export function subscribeToScopedChanges(channel: RealtimeChannel, table: string, column: string, values: string[], changed: () => void) {
  const unique = [...new Set(values)].filter(value => /^[a-z0-9_-]+$/i.test(value));
  for (let offset = 0; offset < unique.length; offset += 100) {
    const filter = `${column}=in.(${unique.slice(offset, offset + 100).join(',')})`;
    channel.on('postgres_changes', { event: 'INSERT', schema: 'public', table, filter }, changed)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table, filter }, changed);
  }
  // Postgres Changes cannot filter DELETE events. Retain unlike/deletion updates.
  if (unique.length) channel.on('postgres_changes', { event: 'DELETE', schema: 'public', table }, changed);
  return channel;
}
