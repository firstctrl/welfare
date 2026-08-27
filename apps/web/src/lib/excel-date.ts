import * as XLSX from 'xlsx';

export function normalizeExcelDate(value: string | number | Date | undefined | null): string {
  if (value === undefined || value === null || value === '') return '';
  if (value instanceof Date) return isNaN(value.getTime()) ? '' : value.toISOString();
  if (typeof value === 'number') {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return '';
    const d = new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.round(parsed.S)));
    return isNaN(d.getTime()) ? '' : d.toISOString();
  }
  const str = String(value).trim();
  const dmy = str.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (dmy) {
    const [, d, m, y] = dmy;
    const iso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    if (!isNaN(new Date(iso).getTime())) return iso;
  }
  return str;
}
