export function fmtGHS(n: number | null | undefined): string {
  if (n === undefined || n === null || Number.isNaN(n)) return '₵—';
  const abs = Math.abs(n).toLocaleString('en-GH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${n < 0 ? '−' : ''}₵${abs}`;
}

export function fmtDate(d: string | Date | null | undefined): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  const day   = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year  = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export function fmtTime(d: string | Date | null | undefined, withSeconds = false): string {
  if (!d) return '—';
  const date = typeof d === 'string' ? new Date(d) : d;
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  if (!withSeconds) return `${hh}:${mm}`;
  const ss = String(date.getSeconds()).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

export function fmtDateTime(d: string | Date | null | undefined): string {
  if (!d) return '—';
  return `${fmtDate(d)} ${fmtTime(d)}`;
}
