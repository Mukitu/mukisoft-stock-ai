import { useCallback, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BDAPPS_ACTIVE_LOCK_KEY,
  SESSION_REPLACED_TOAST_BN,
  getBdappsSession,
  isLocalSessionLockConflict,
  isSessionActive,
  purgeAllSubscriberState,
  setBdappsToast,
  verifyActiveSubscriberSession,
} from '../../services/bdappsService';

const FOCUS_DEBOUNCE_MS = 1_000;
const PERIODIC_SUB_CHECK_MS = 45_000;

export function SessionEnforcer() {
  const location = useLocation();
  const navigate = useNavigate();

  const isCheckingRef = useRef(false);
  const lastCheckAtRef = useRef(0);
  const lastSubRecheckAtRef = useRef(0);

  const enforceLogout = useCallback(
    (reason: 'session_replaced' | 'unsubscribed', currentSessionToken: string) => {
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
        setBdappsToast(
          'আপনার Robi & Cirkle সাবস্ক্রিপশনটি বর্তমানে সক্রিয় নয়। পুনরায় অ্যাক্সেস পেতে নম্বর দিয়ে OTP ভেরিফাই করুন।'
        );
      }
      navigate('/', { replace: true });
    },
    [navigate]
  );

  const runSessionVerification = useCallback(
    async (options?: { force?: boolean; checkSubscription?: boolean }) => {
      const session = getBdappsSession();
      if (!isSessionActive(session)) return;

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

      const shouldCheckSub =
        Boolean(options?.checkSubscription) ||
        now - lastSubRecheckAtRef.current >= PERIODIC_SUB_CHECK_MS;
      if (shouldCheckSub) {
        lastSubRecheckAtRef.current = now;
      }

      try {
        const verdict = await verifyActiveSubscriberSession(session, {
          checkServerSubscription: shouldCheckSub,
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

  // 1. Check on every route navigation (skip initial freshHandoff to avoid racing claim)
  useEffect(() => {
    const state = location.state as { freshHandoff?: boolean } | null;
    if (location.pathname === '/dashboard' && state?.freshHandoff) {
      return;
    }
    void runSessionVerification({
      force: true,
      checkSubscription: location.pathname === '/dashboard',
    });
  }, [location.pathname, location.state, runSessionVerification]);

  // 2. Check on tab focus (visibilitychange & window.focus) + cross-tab localStorage lock event
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void runSessionVerification();
      }
    };

    const onWindowFocus = () => {
      void runSessionVerification();
    };

    const onStorageChange = (evt: StorageEvent) => {
      if (evt.key !== BDAPPS_ACTIVE_LOCK_KEY) return;
      const session = getBdappsSession();
      if (!isSessionActive(session)) return;
      if (isLocalSessionLockConflict(session)) {
        enforceLogout('session_replaced', session.sessionToken);
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
