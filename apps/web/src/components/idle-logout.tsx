'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '../store/auth.store';
import { getConfig } from '../lib/config';

const FALLBACK_IDLE_MINUTES = 30;
const WARN_MS = 60 * 1000; // show warning 60 s before logout

const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'scroll'] as const;

export function IdleLogout() {
  const router = useRouter();
  const token = useAuthStore((s) => s.token);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const lastActive = useRef(Date.now());
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);
  const [idleMs, setIdleMs] = useState(FALLBACK_IDLE_MINUTES * 60 * 1000);

  // Load timeout from config once when logged in
  useEffect(() => {
    if (!token) return;
    getConfig()
      .then((cfg) => {
        const raw = cfg['SESSION_IDLE_TIMEOUT_MINUTES']?.value;
        const mins = raw ? parseInt(raw, 10) : FALLBACK_IDLE_MINUTES;
        setIdleMs((isNaN(mins) || mins < 1 ? FALLBACK_IDLE_MINUTES : mins) * 60 * 1000);
      })
      .catch(() => { /* keep fallback */ });
  }, [token]);

  const resetTimer = useCallback(() => {
    lastActive.current = Date.now();
    setSecondsLeft(null);
  }, []);

  const doLogout = useCallback(() => {
    clearAuth();
    router.push('/login');
  }, [clearAuth, router]);

  useEffect(() => {
    if (!token) return;

    ACTIVITY_EVENTS.forEach((e) => window.addEventListener(e, resetTimer, { passive: true }));

    const interval = setInterval(() => {
      const idle = Date.now() - lastActive.current;
      const remaining = idleMs - idle;

      if (remaining <= 0) {
        doLogout();
      } else if (remaining <= WARN_MS) {
        setSecondsLeft(Math.ceil(remaining / 1000));
      } else {
        setSecondsLeft(null);
      }
    }, 1000);

    return () => {
      clearInterval(interval);
      ACTIVITY_EVENTS.forEach((e) => window.removeEventListener(e, resetTimer));
    };
  }, [token, idleMs, resetTimer, doLogout]);

  if (secondsLeft === null || !token) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-lg shadow-xl p-6 max-w-sm w-full mx-4 space-y-4">
        <h2 className="text-base font-semibold text-neutral-900">Session Expiring</h2>
        <p className="text-sm text-neutral-600">
          You have been inactive. You will be logged out in{' '}
          <span className="font-semibold text-danger-600">{secondsLeft}s</span>.
        </p>
        <div className="flex gap-2">
          <button
            onClick={resetTimer}
            className="flex-1 h-9 bg-primary-600 text-white text-sm font-semibold rounded-sm hover:bg-primary-700 transition-colors"
          >
            Stay Logged In
          </button>
          <button
            onClick={doLogout}
            className="flex-1 h-9 border border-neutral-200 text-neutral-700 text-sm font-semibold rounded-sm hover:bg-neutral-50 transition-colors"
          >
            Log Out
          </button>
        </div>
      </div>
    </div>
  );
}
