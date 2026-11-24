import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

export type SubscriptionAccessStatus = {
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
};

type SubscriptionAccessContextValue = {
  hasAccess: boolean;
  isExpired: boolean;
  hasPremiumAccess: boolean;
  requirePremiumAccess: () => boolean;
  requireSubscription: () => boolean;
};

const SubscriptionAccessContext = createContext<SubscriptionAccessContextValue>({
  hasAccess: true,
  isExpired: false,
  hasPremiumAccess: false,
  requirePremiumAccess: () => false,
  requireSubscription: () => true,
});

export function subscriptionIsExpired(
  subscription: SubscriptionAccessStatus | null | undefined,
  nowMs = Date.now(),
) {
  if (!subscription) return false;
  const status = String(subscription.status || '').toLowerCase();
  if (status === 'expired') return true;
  if (status === 'trial' && subscription.trial_ends_at) {
    return new Date(subscription.trial_ends_at).getTime() <= nowMs;
  }
  if (status === 'active' && subscription.current_period_end) {
    return new Date(subscription.current_period_end).getTime() <= nowMs;
  }
  return false;
}

export function subscriptionHasPremiumAccess(subscription: SubscriptionAccessStatus | null, nowMs: number) {
  if (!subscription || subscriptionIsExpired(subscription, nowMs)) return false;
  return subscription.status === 'active' || subscription.status === 'grace'
    || (subscription.status === 'trial' && Boolean(subscription.trial_ends_at));
}

export function SubscriptionAccessProvider({
  isExpired,
  hasPremiumAccess = false,
  onSubscriptionRequired,
  children,
}: {
  isExpired: boolean;
  hasPremiumAccess?: boolean;
  onSubscriptionRequired: () => void;
  children: ReactNode;
}) {
  const requireSubscription = useCallback(() => {
    if (!isExpired) return true;
    onSubscriptionRequired();
    return false;
  }, [isExpired, onSubscriptionRequired]);

  const requirePremiumAccess = useCallback(() => {
    if (hasPremiumAccess) return true;
    onSubscriptionRequired();
    return false;
  }, [hasPremiumAccess, onSubscriptionRequired]);

  const value = useMemo(() => ({
    hasAccess: !isExpired,
    isExpired,
    requireSubscription,
    hasPremiumAccess,
    requirePremiumAccess,
  }), [isExpired, requireSubscription, hasPremiumAccess, requirePremiumAccess]);

  return (
    <SubscriptionAccessContext.Provider value={value}>
      {children}
    </SubscriptionAccessContext.Provider>
  );
}

export function useSubscriptionAccess() {
  return useContext(SubscriptionAccessContext);
}
