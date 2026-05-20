import { describe, it, expect } from 'vitest';
import { fmtGHS, fmtDate, fmtTime, fmtDateTime } from './format';

describe('fmtGHS', () => {
  it('formats positive amount with cedi symbol and two decimals', () => {
    expect(fmtGHS(12450)).toBe('₵12,450.00');
  });
  it('formats zero', () => {
    expect(fmtGHS(0)).toBe('₵0.00');
  });
  it('formats negative with minus sign not dash', () => {
    expect(fmtGHS(-1200)).toBe('−₵1,200.00');
  });
  it('formats null as em-dash', () => {
    expect(fmtGHS(null)).toBe('₵—');
  });
  it('formats undefined as em-dash', () => {
    expect(fmtGHS(undefined)).toBe('₵—');
  });
  it('formats decimal amount', () => {
    expect(fmtGHS(1234.5)).toBe('₵1,234.50');
  });
  it('formats large amount with comma separator', () => {
    expect(fmtGHS(1000000)).toBe('₵1,000,000.00');
  });
});

describe('fmtDate', () => {
  it('formats date string as DD/MM/YYYY', () => {
    expect(fmtDate('2026-05-20')).toBe('20/05/2026');
  });
  it('formats Date object', () => {
    expect(fmtDate(new Date(2026, 4, 20))).toBe('20/05/2026');
  });
  it('returns dash for null', () => {
    expect(fmtDate(null)).toBe('—');
  });
  it('returns dash for undefined', () => {
    expect(fmtDate(undefined)).toBe('—');
  });
  it('pads single-digit day and month', () => {
    expect(fmtDate('2026-01-05')).toBe('05/01/2026');
  });
});

describe('fmtTime', () => {
  it('formats as HH:mm by default', () => {
    const result = fmtTime(new Date(2026, 4, 20, 14, 32, 5));
    expect(result).toMatch(/^\d{2}:\d{2}$/);
  });
  it('formats as HH:mm:ss when withSeconds=true', () => {
    const result = fmtTime(new Date(2026, 4, 20, 14, 32, 5), true);
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/);
  });
  it('returns dash for null', () => {
    expect(fmtTime(null)).toBe('—');
  });
});

describe('fmtDateTime', () => {
  it('combines date and time with a space', () => {
    const result = fmtDateTime(new Date(2026, 4, 20, 14, 32, 5));
    expect(result).toMatch(/^20\/05\/2026 \d{2}:\d{2}$/);
  });
  it('returns dash for null', () => {
    expect(fmtDateTime(null)).toBe('—');
  });
});
