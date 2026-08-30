import { Response } from 'express';
import { parse as toCsv } from 'json2csv';
import * as XLSX from 'xlsx';

export interface ExportColumn {
  header: string;
  field: string;
}

/** Sends `rows` as a downloadable CSV. Header row uses raw field names (matches prior per-report behavior). */
export function sendCsv(
  res: Response,
  filename: string,
  rows: object[],
  fields: string[],
): void {
  const csv = toCsv(rows, { fields });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
}

/** Sends `rows` as a downloadable .xlsx workbook. Header row uses human-readable `column.header` labels. */
export function sendExcel(
  res: Response,
  filename: string,
  rows: object[],
  columns: ExportColumn[],
): void {
  const data = rows.map((row) => {
    const record: Record<string, unknown> = {};
    for (const column of columns) {
      record[column.header] = (row as Record<string, unknown>)[column.field];
    }
    return record;
  });
  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Sheet1');
  const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(buffer);
}
