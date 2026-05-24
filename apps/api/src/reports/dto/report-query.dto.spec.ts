import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ReportQueryDto, FundSummaryQueryDto } from './report-query.dto';

describe('ReportQueryDto', () => {
  it('accepts empty query (all optional)', async () => {
    const dto = plainToInstance(ReportQueryDto, {});
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects invalid format', async () => {
    const dto = plainToInstance(ReportQueryDto, { format: 'xml' });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'format')).toBe(true);
  });

  it('coerces month/year strings to numbers', async () => {
    const dto = plainToInstance(ReportQueryDto, { month: '3', year: '2025' });
    expect(dto.month).toBe(3);
    expect(dto.year).toBe(2025);
  });
});

describe('FundSummaryQueryDto', () => {
  it('requires year', async () => {
    const dto = plainToInstance(FundSummaryQueryDto, {});
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'year')).toBe(true);
  });

  it('accepts year only (fromMonth/toMonth/quarter optional)', async () => {
    const dto = plainToInstance(FundSummaryQueryDto, { year: 2025 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('accepts year with quarter', async () => {
    const dto = plainToInstance(FundSummaryQueryDto, { year: 2025, quarter: 2 });
    const errors = await validate(dto);
    expect(errors).toHaveLength(0);
  });

  it('rejects quarter outside 1–4', async () => {
    const dto = plainToInstance(FundSummaryQueryDto, { year: 2025, quarter: 5 });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'quarter')).toBe(true);
  });

  it('rejects fromMonth outside 1–12', async () => {
    const dto = plainToInstance(FundSummaryQueryDto, { year: 2025, fromMonth: 13 });
    const errors = await validate(dto);
    expect(errors.some(e => e.property === 'fromMonth')).toBe(true);
  });

  it('coerces string values to numbers', async () => {
    const dto = plainToInstance(FundSummaryQueryDto, { year: '2025', quarter: '1' });
    expect(dto.year).toBe(2025);
    expect(dto.quarter).toBe(1);
  });
});
