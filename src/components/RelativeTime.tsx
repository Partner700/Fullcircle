import { useEffect, useState } from 'react';
import { formatRelativeActivityTime } from '../lib/utils';

export function RelativeTime({ value, className }: { value: string | Date; className?: string }) {
  const [, refresh] = useState(0);

  useEffect(() => {
    const interval = window.setInterval(() => refresh((current) => current + 1), 30_000);
    return () => window.clearInterval(interval);
  }, []);

  const label = formatRelativeActivityTime(value);
  if (!label) return null;
  return <time dateTime={typeof value === 'string' ? value : value.toISOString()} className={className}>{label}</time>;
}
