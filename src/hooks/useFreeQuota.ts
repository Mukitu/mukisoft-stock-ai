import { useCallback, useEffect, useRef, useState } from 'react';
import {
  QUOTA_UPDATED_EVENT,
  authorizeAndConsumeQuota,
  computeLiveResetSeconds,
  createDefaultQuotaState,
  fetchServerQuotaStatus,
  isSymbolAlreadyUnlocked,
  readStoredQuotaState,
  syncQuotaState,
  type FreeQuotaState,
} from '../services/quotaService';
import { BDAPPS_SESSION_EVENT, getBdappsSession, isSessionActive } from '../services/bdappsService';

export function useFreeQuota() {
  const [quota, setQuota] = useState<FreeQuotaState>(() => readStoredQuotaState());
  const [liveResetSeconds, setLiveResetSeconds] = useState<number>(() =>
    computeLiveResetSeconds(readStoredQuotaState())
  );
  const [isSyncing, setIsSyncing] = useState(false);
  const hasTriggeredAutoResetRef = useRef(false);

  const isSubscribed = quota.isSubscribed || isSessionActive(getBdappsSession());

  const refreshQuota = useCallback(async () => {
    setIsSyncing(true);
    try {
      const latest = await fetchServerQuotaStatus();
      setQuota(latest);
      setLiveResetSeconds(computeLiveResetSeconds(latest));
      hasTriggeredAutoResetRef.current = false;
      return latest;
    } finally {
      setIsSyncing(false);
    }
  }, []);

  // Re-hydrate from authoritative server on mount (even if localStorage/cookies were cleared)
  useEffect(() => {
    void refreshQuota();
  }, [refreshQuota]);

  // Listen to cross-component quota & BDApps session updates
  useEffect(() => {
    const onUpdated = (evt: Event) => {
      const detail = (evt as CustomEvent<FreeQuotaState>).detail;
      if (detail) {
        setQuota(detail);
        setLiveResetSeconds(computeLiveResetSeconds(detail));
        hasTriggeredAutoResetRef.current = false;
      }
    };
    const onSessionChanged = () => {
      const nextLocal = readStoredQuotaState();
      setQuota(nextLocal);
      setLiveResetSeconds(computeLiveResetSeconds(nextLocal));
      hasTriggeredAutoResetRef.current = false;
      void refreshQuota();
    };
    window.addEventListener(QUOTA_UPDATED_EVENT, onUpdated);
    window.addEventListener(BDAPPS_SESSION_EVENT, onSessionChanged);
    return () => {
      window.removeEventListener(QUOTA_UPDATED_EVENT, onUpdated);
      window.removeEventListener(BDAPPS_SESSION_EVENT, onSessionChanged);
    };
  }, [refreshQuota]);

  // Live 1-second ticking Bangla countdown timer
  useEffect(() => {
    if (isSubscribed) {
      setLiveResetSeconds(0);
      return;
    }

    const updateTick = () => {
      const secs = computeLiveResetSeconds(quota);
      setLiveResetSeconds(secs);

      // Auto-reset once 24 hours elapse and re-sync with server
      if (secs === 0 && quota.symbols.length > 0 && !hasTriggeredAutoResetRef.current) {
        hasTriggeredAutoResetRef.current = true;
        void refreshQuota();
      }
    };

    updateTick();
    const timer = window.setInterval(updateTick, 1000);
    return () => window.clearInterval(timer);
  }, [isSubscribed, quota, refreshQuota]);

  const authorizeSymbolAnalysis = useCallback(
    async (symbol: string): Promise<{ allowed: boolean; quota: FreeQuotaState }> => {
      if (isSessionActive(getBdappsSession())) {
        const subState = syncQuotaState(createDefaultQuotaState(true));
        setQuota(subState);
        setLiveResetSeconds(0);
        return { allowed: true, quota: subState };
      }

      const result = await authorizeAndConsumeQuota(symbol);
      setQuota(result);
      setLiveResetSeconds(computeLiveResetSeconds(result));
      return { allowed: result.allowed, quota: result };
    },
    []
  );

  const markSubscribed = useCallback(() => {
    const subState = syncQuotaState(createDefaultQuotaState(true));
    setQuota(subState);
    setLiveResetSeconds(0);
  }, []);

  const canAnalyzeWithoutModal = useCallback(
    (symbol: string): boolean => {
      if (isSubscribed) return true;
      if (quota.remaining > 0) return true;
      if (quota.symbols.length > 0 && liveResetSeconds <= 0) return true;
      return isSymbolAlreadyUnlocked(quota, symbol);
    },
    [isSubscribed, quota, liveResetSeconds]
  );

  return {
    quota,
    isSubscribed,
    remaining: isSubscribed ? quota.limit : quota.remaining,
    liveResetSeconds,
    isSyncing,
    refreshQuota,
    authorizeSymbolAnalysis,
    markSubscribed,
    canAnalyzeWithoutModal,
  };
}
