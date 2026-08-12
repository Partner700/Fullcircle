const LINDA_KAREN_BIRTHDAY = { month: 8, day: 12 };

function currentDoualaDate() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Douala',
    month: 'numeric',
    day: 'numeric',
  }).formatToParts(new Date());
  return {
    month: Number(parts.find((part) => part.type === 'month')?.value || 0),
    day: Number(parts.find((part) => part.type === 'day')?.value || 0),
  };
}

export function isLindaKarenBirthday(displayName?: string | null) {
  const name = (displayName || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const today = currentDoualaDate();
  return name.includes('linda karen')
    && today.month === LINDA_KAREN_BIRTHDAY.month
    && today.day === LINDA_KAREN_BIRTHDAY.day;
}

export function BirthdayAvatar({ displayName, className = 'absolute -right-1 -top-1' }: { displayName?: string | null; className?: string }) {
  if (!isLindaKarenBirthday(displayName)) return null;
  return (
    <span className={className} aria-label="Birthday celebrant" role="img">
      🥳
    </span>
  );
}
