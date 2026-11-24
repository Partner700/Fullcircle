/** Only a previously verified *non-staff* camp result may be opened offline.
 * Camp administrator and instructor access is never cached or elevated here. */
const PREFIX = 'full-circle-verified-member-camp:';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function readVerifiedMemberCamp(userId: string): { role: 'none' } | null {
  if (!userId) return null;
  try {
    const stored = localStorage.getItem(PREFIX + userId);
    if (!stored) return null;
    const parsed: { userId?: string; checkedAt?: number; role?: string } = JSON.parse(stored);
    if (parsed.userId !== userId || parsed.role !== 'none'
      || !Number.isFinite(parsed.checkedAt) || Date.now() - Number(parsed.checkedAt) > MAX_AGE_MS
      || Number(parsed.checkedAt) > Date.now() + 60_000) {
      localStorage.removeItem(PREFIX + userId);
      return null;
    }
    return { role: 'none' };
  } catch {
    return null;
  }
}

export function rememberVerifiedMemberCamp(userId: string, role: string): void {
  if (!userId) return;
  try {
    if (role !== 'none') {
      localStorage.removeItem(PREFIX + userId);
      return;
    }
    localStorage.setItem(PREFIX + userId, JSON.stringify({ userId, role: 'none', checkedAt: Date.now() }));
  } catch {
    // Private browsing must not block member login.
  }
}

export function clearVerifiedMemberCamp(userId: string): void {
  if (!userId) return;
  try { localStorage.removeItem(PREFIX + userId); } catch { /* no storage */ }
}
