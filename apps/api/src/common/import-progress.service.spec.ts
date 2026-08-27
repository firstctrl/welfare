import { ImportProgressService } from './import-progress.service';

describe('ImportProgressService', () => {
  let service: ImportProgressService;

  beforeEach(() => {
    service = new ImportProgressService();
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  it('returns null for an unknown jobId', () => {
    expect(service.get('unknown')).toBeNull();
  });

  it('tracks processed/total/done across start → increment → complete', () => {
    service.start('job-1', 10);
    expect(service.get('job-1')).toEqual({ processed: 0, total: 10, done: false });

    service.increment('job-1');
    service.increment('job-1');
    expect(service.get('job-1')).toEqual({ processed: 2, total: 10, done: false });

    service.complete('job-1');
    expect(service.get('job-1')).toEqual({ processed: 2, total: 10, done: true });
  });

  it('increment/complete on an unknown jobId is a no-op, not a throw', () => {
    expect(() => service.increment('missing')).not.toThrow();
    expect(() => service.complete('missing')).not.toThrow();
    expect(service.get('missing')).toBeNull();
  });

  it('sweeps entries older than the TTL', () => {
    jest.useFakeTimers();
    const sweepingService = new ImportProgressService();
    sweepingService.start('old-job', 5);
    jest.advanceTimersByTime(6 * 60_000); // past 5-minute TTL, past the 60s sweep tick
    expect(sweepingService.get('old-job')).toBeNull();
    sweepingService.onModuleDestroy();
    jest.useRealTimers();
  });
});
