'use client';

import { Suspense, useState, useEffect, FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import Image from 'next/image';
import { login } from '../../../lib/auth';
import { cn } from '@/lib/utils';

type AuthMode = 'ad' | 'local';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [adEnabled, setAdEnabled] = useState<boolean | null>(null);
  const [mode, setMode] = useState<AuthMode>('ad');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/config/public')
      .then((r) => r.json())
      .then((d: { adLoginEnabled: boolean }) => {
        setAdEnabled(d.adLoginEnabled);
        if (!d.adLoginEnabled) setMode('local');
      })
      .catch(() => setAdEnabled(true));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login({ username, password, mode });
      const raw = searchParams.get('from') || '/';
      const from = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/';
      router.push(from);
      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Login failed';
      setError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Mode toggle — only shown when AD login is enabled */}
      {adEnabled && (
        <div className="flex rounded-md border border-neutral-200 p-0.5 bg-neutral-50 gap-0.5">
          {(['ad', 'local'] as AuthMode[]).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMode(m)}
              className={cn(
                'flex-1 py-1.5 text-sm font-medium rounded transition-colors',
                mode === m
                  ? 'bg-white text-neutral-900 shadow-sm'
                  : 'text-neutral-500 hover:text-neutral-700',
              )}
            >
              {m === 'ad' ? 'Active Directory' : 'Local Account'}
            </button>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded text-sm">
          {error}
        </div>
      )}

      <div>
        <label htmlFor="username" className="block text-sm font-medium text-gray-700 mb-1">
          Username
        </label>
        <input
          id="username"
          type="text"
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          disabled={loading}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700 mb-1">
          Password
        </label>
        <input
          id="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={loading}
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-50"
        />
      </div>

      <button
        type="submit"
        disabled={loading || !username || !password}
        className="w-full bg-blue-600 text-white py-2 px-4 rounded-md text-sm font-medium hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
      >
        {loading ? 'Signing in...' : 'Sign in'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="bg-white p-8 rounded-lg shadow-md w-full max-w-md">
      <div className="mb-6 flex items-center gap-3">
        <div className="relative w-10 h-10 shrink-0">
          <Image src="/assets/ncc-logo.png" alt="NCC" fill className="object-contain" priority />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Welfare Department</h1>
          <p className="text-sm text-gray-500">Sign in to your account</p>
        </div>
      </div>

      <Suspense fallback={null}>
        <LoginForm />
      </Suspense>

      <p className="mt-6 text-xs text-center text-gray-400">
        Welfare Management System · IT Department
      </p>
    </div>
  );
}
