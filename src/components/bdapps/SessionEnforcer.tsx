import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BDAPPS_ACTIVE_LOCK_KEY,
  BDAPPS_MSISDN_KEY,
  BDAPPS_SESSION_EVENT,
  BDAPPS_SESSION_KEY,
  SESSION_REPLACED_TOAST_BN,
  UNSUBSCRIBED_TOAST_BN,
  getBdappsSession,
  isLocalSessionLockConflict,
  isSessionActive,
  purgeAllSubscriberState,
  setBdappsToast,
  verifyActiveSubscriberSession,
} from '../../services/bdappsService';

const FOCUS_DEBOUNCE_MS = 1_000;
const SUBSCRIPTION_POLL_INTERVAL_MS = 10_000;

export function SessionEnforcer() {
  const location = useLocation();
  const navigate = useNavigate();

  const [hasActiveSession, setHasActiveSession] = useState<boolean>(() =>
    isSessionActive(getBdappsSession())
  );
  const hasActiveSessionRef = useRef(hasActiveSession);
  hasActiveSessionRef.current = hasActiveSession;

  const isCheckingRef = useRef(false);
  const lastCheckAtRef = useRef(0);

  const enforceLogout = useCallback(
    (reason: 'session_replaced' | 'unsubscribed', currentSessionToken?: string) => {
      if (reason === 'session_replaced') {
        purgeAllSubscriberState({
          forceClearLock: false,
          currentSessionToken,
        });
        setBdappsToast(SESSION_REPLACED_TOAST_BN);
      } else {
        purgeAllSubscriberState({
          forceClearLock: true,
          currentSessionToken,
        });
        setBdappsToast(UNSUBSCRIBED_TOAST_BN);
      }
      setHasActiveSession(false);
      navigate('/', { replace: true });
    },
    [navigate]
  );

  const runSessionVerification = useCallback(
    async (options?: { force?: boolean; checkSubscription?: boolean }) => {
      const session = getBdappsSession();
      if (!isSessionActive(session)) {
        setHasActiveSession(false);
        return;
      }
      setHasActiveSession(true);

      if (isLocalSessionLockConflict(session)) {
        enforceLogout('session_replaced', session.sessionToken);
        return;
      }

      const now = Date.now();
      if (!options?.force && now - lastCheckAtRef.current < FOCUS_DEBOUNCE_MS) {
        return;
      }
      if (isCheckingRef.current) return;

      isCheckingRef.current = true;
      lastCheckAtRef.current = now;

      try {
        const verdict = await verifyActiveSubscriberSession(session, {
          checkServerSubscription: options?.checkSubscription ?? true,
        });

        // Re-verify the active session is still the same token before acting
        const latest = getBdappsSession();
        if (!isSessionActive(latest) || latest.sessionToken !== session.sessionToken) {
          return;
        }

        if (verdict === 'session_replaced' || verdict === 'unsubscribed') {
          enforceLogout(verdict, session.sessionToken);
        }
      } finally {
        isCheckingRef.current = false;
      }
    },
    [enforceLogout]
  );

  // Sync active-session flag across in-tab login / logout events
  useEffect(() => {
    const onSessionUpdated = () => {
      setHasActiveSession(isSessionActive(getBdappsSession()));
    };
    window.addEventListener(BDAPPS_SESSION_EVENT, onSessionUpdated);
    return () => window.removeEventListener(BDAPPS_SESSION_EVENT, onSessionUpdated);
  }, []);

  // 1. Check on initial mount and every route navigation (skip freshHandoff to avoid racing claim)
  useEffect(() => {
    const state = location.state as { freshHandoff?: boolean } | null;
    if (location.pathname === '/dashboard' && state?.freshHandoff) {
      setHasActiveSession(isSessionActive(getBdappsSession()));
      return;
    }
    void runSessionVerification({
      force: true,
      checkSubscription: true,
    });
  }, [location.pathname, location.state, runSessionVerification]);

  // 2. Lightweight 10-second background polling against Render session verify + check_subscription.php?_t=... while tab is visible
  useEffect(() => {
    if (!hasActiveSession) return;
    const pollId = window.setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void runSessionVerification({
        force: true,
        checkSubscription: true,
      });
    }, SUBSCRIPTION_POLL_INTERVAL_MS);

    return () => window.clearInterval(pollId);
  }, [hasActiveSession, runSessionVerification]);

  // 3. Check on tab focus (visibilitychange & window.focus) + instantaneous cross-tab storage sync
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void runSessionVerification({ checkSubscription: true });
      }
    };

    const onWindowFocus = () => {
      void runSessionVerification({ checkSubscription: true });
    };

    const onStorageChange = (evt: StorageEvent) => {
      // Instant multi-tab global logout when localStorage session/msisdn is cleared
      if (
        evt.key === null ||
        ((evt.key === BDAPPS_SESSION_KEY || evt.key === BDAPPS_MSISDN_KEY) && !evt.newValue)
      ) {
        if (hasActiveSessionRef.current || isSessionActive(getBdappsSession())) {
          enforceLogout('unsubscribed');
        }
        return;
      }

      // Sync if another tab in the same browser activated a subscription
      if (evt.key === BDAPPS_SESSION_KEY && evt.newValue) {
        const hydrated = getBdappsSession();
        setHasActiveSession(isSessionActive(hydrated));
        window.dispatchEvent(new CustomEvent(BDAPPS_SESSION_EVENT, { detail: hydrated }));
        return;
      }

      if (evt.key === BDAPPS_ACTIVE_LOCK_KEY) {
        const session = getBdappsSession();
        if (!isSessionActive(session)) return;
        if (isLocalSessionLockConflict(session)) {
          enforceLogout('session_replaced', session.sessionToken);
        }
      }
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onWindowFocus);
    window.addEventListener('storage', onStorageChange);

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onWindowFocus);
      window.removeEventListener('storage', onStorageChange);
    };
  }, [enforceLogout, runSessionVerification]);

  return null;
}
