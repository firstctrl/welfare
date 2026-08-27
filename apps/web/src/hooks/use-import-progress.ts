'use client';

import { useEffect, useState } from 'react';
import { apiClient } from '@/lib/api-client';

export interface ImportProgress {
  processed: number;
  total: number;
  done: boolean;
}

export function useImportProgress(jobId: string | null): ImportProgress | null {
  const [progress, setProgress] = useState<ImportProgress | null>(null);

  useEffect(() => {
    if (!jobId) {
      setProgress(null);
      return;
    }
    let cancelled = false;
    let interval: ReturnType<typeof setInterval>;

    async function poll() {
      try {
        const { data } = await apiClient.get<ImportProgress>(`/import-progress/${jobId}`);
        if (cancelled) return;
        setProgress(data);
        if (data.done) clearInterval(interval);
      } catch {
        // Not started yet, or expired — keep polling silently.
      }
    }

    poll();
    interval = setInterval(poll, 500);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [jobId]);

  return progress;
}
