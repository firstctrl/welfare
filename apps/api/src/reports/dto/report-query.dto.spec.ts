import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { ReportQueryDto } from './report-query.dto';

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
