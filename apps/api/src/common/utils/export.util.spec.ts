import { sendCsv, sendExcel } from './export.util';
import * as XLSX from 'xlsx';

function mockResponse() {
  return {
    setHeader: jest.fn(),
    send: jest.fn(),
  } as any;
}

describe('sendCsv', () => {
  it('sets CSV headers and sends field-keyed rows', () => {
    const res = mockResponse();
    sendCsv(res, 'report.csv', [{ name: 'Alice', amount: 100 }], ['name', 'amount']);

    expect(res.setHeader).toHaveBeenCalledWith('Content-Type', 'text/csv');
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="report.csv"',
    );
    const csv = res.send.mock.calls[0][0];
    expect(csv).toContain('name');
    expect(csv).toContain('Alice');
    expect(csv).toContain('100');
  });
});

describe('sendExcel', () => {
  it('sets xlsx headers and sends a workbook keyed by human-readable headers', () => {
    const res = mockResponse();
    sendExcel(res, 'report.xlsx', [{ name: 'Alice', amount: 100 }], [
      { header: 'Name', field: 'name' },
      { header: 'Amount', field: 'amount' },
    ]);

    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    expect(res.setHeader).toHaveBeenCalledWith(
      'Content-Disposition',
      'attachment; filename="report.xlsx"',
    );
    const buffer = res.send.mock.calls[0][0];
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);
    expect(rows).toEqual([{ Name: 'Alice', Amount: 100 }]);
  });
});
