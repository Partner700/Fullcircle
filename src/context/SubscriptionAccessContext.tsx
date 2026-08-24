import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';

export type SubscriptionAccessStatus = {
  status: string;
  trial_ends_at: string | null;
  current_period_end: string | null;
};

type SubscriptionAccessContextValue = {
  hasAccess: boolean;
  isExpired: boolean;
  requireSubscription: () => boolean;
};

const SubscriptionAccessContext = createContext<SubscriptionAccessContextValue>({
  hasAccess: true,
  isExpired: false,
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

export function SubscriptionAccessProvider({
  isExpired,
  onSubscriptionRequired,
  children,
}: {
  isExpired: boolean;
  onSubscriptionRequired: () => void;
  children: ReactNode;
}) {
  const requireSubscription = useCallback(() => {
    if (!isExpired) return true;
    onSubscriptionRequired();
    return false;
  }, [isExpired, onSubscriptionRequired]);

  const value = useMemo(() => ({
    hasAccess: !isExpired,
    isExpired,
    requireSubscription,
  }), [isExpired, requireSubscription]);

  return (
    <SubscriptionAccessContext.Provider value={value}>
      {children}
    </SubscriptionAccessContext.Provider>
  );
}

export function useSubscriptionAccess() {
  return useContext(SubscriptionAccessContext);
}
