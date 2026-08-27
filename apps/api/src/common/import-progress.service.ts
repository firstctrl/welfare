import { Injectable, OnModuleDestroy } from '@nestjs/common';

interface ProgressEntry {
  processed: number;
  total: number;
  done: boolean;
  updatedAt: number;
}

export interface ImportProgress {
  processed: number;
  total: number;
  done: boolean;
}

const SWEEP_INTERVAL_MS = 60_000;
const ENTRY_TTL_MS = 5 * 60_000;

@Injectable()
export class ImportProgressService implements OnModuleDestroy {
  private readonly progress = new Map<string, ProgressEntry>();
  private readonly sweepTimer: NodeJS.Timeout;

  constructor() {
    this.sweepTimer = setInterval(() => this.sweep(), SWEEP_INTERVAL_MS);
    this.sweepTimer.unref?.();
  }

  start(jobId: string, total: number): void {
    this.progress.set(jobId, { processed: 0, total, done: false, updatedAt: Date.now() });
  }

  increment(jobId: string, by = 1): void {
    const entry = this.progress.get(jobId);
    if (!entry) return;
    entry.processed += by;
    entry.updatedAt = Date.now();
  }

  complete(jobId: string): void {
    const entry = this.progress.get(jobId);
    if (!entry) return;
    entry.done = true;
    entry.updatedAt = Date.now();
  }

  get(jobId: string): ImportProgress | null {
    const entry = this.progress.get(jobId);
    if (!entry) return null;
    return { processed: entry.processed, total: entry.total, done: entry.done };
  }

  private sweep(): void {
    const cutoff = Date.now() - ENTRY_TTL_MS;
    for (const [jobId, entry] of this.progress) {
      if (entry.updatedAt < cutoff) this.progress.delete(jobId);
    }
  }

  onModuleDestroy(): void {
    clearInterval(this.sweepTimer);
  }
}
