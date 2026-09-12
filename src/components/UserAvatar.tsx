import { useEffect, useMemo, useState } from 'react';
import { Dove } from './Dove';
import { cn } from '../lib/utils';

const AVATAR_BACKGROUNDS = [
  '#315a99',
  '#a8466c',
  '#2f7b65',
  '#7556a4',
  '#ad6a2f',
  '#24758c',
  '#9a4f45',
  '#607c35',
];

function avatarColour(identity: string) {
  let hash = 0;
  for (let index = 0; index < identity.length; index += 1) {
    hash = ((hash << 5) - hash + identity.charCodeAt(index)) | 0;
  }
  return AVATAR_BACKGROUNDS[Math.abs(hash) % AVATAR_BACKGROUNDS.length];
}

export function UserAvatar({
  userId,
  name,
  avatarUrl,
  className,
  imageClassName,
  doveClassName,
  loading = 'lazy',
}: {
  userId?: string | null;
  name?: string | null;
  avatarUrl?: string | null;
  className?: string;
  imageClassName?: string;
  doveClassName?: string;
  loading?: 'eager' | 'lazy';
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [avatarUrl]);
  const identity = String(userId || name || 'full-circle-member');
  const backgroundColor = useMemo(() => avatarColour(identity), [identity]);
  const showPhoto = Boolean(avatarUrl) && !failed;

  return (
    <span
      className={cn('inline-flex items-center justify-center overflow-hidden rounded-full', className)}
      style={showPhoto ? undefined : { backgroundColor }}
      role="img"
      aria-label={name ? `${name}'s profile picture` : 'Full Circle member profile picture'}
    >
      {showPhoto ? (
        <img
          src={avatarUrl || ''}
          alt=""
          loading={loading}
          decoding="async"
          className={cn('h-full w-full object-cover', imageClassName)}
          onError={() => setFailed(true)}
        />
      ) : (
        <Dove size={96} className={cn('h-[82%] w-[82%] object-contain drop-shadow-sm', doveClassName)} />
      )}
    </span>
  );
}
