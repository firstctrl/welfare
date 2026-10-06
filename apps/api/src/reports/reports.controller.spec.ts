import { BadRequestException } from '@nestjs/common';
import { ReportsController } from './reports.controller';

describe('ReportsController.triggerBulkSend', () => {
  const user = { _id: { toString: () => 'u1' }, displayName: 'Admin' };
  let bulkQueue: any;
  let auditService: any;
  let controller: ReportsController;

  beforeEach(() => {
    bulkQueue = { add: jest.fn().mockResolvedValue({ id: 'job-1' }) };
    auditService = { log: jest.fn().mockResolvedValue(undefined) };
    controller = new ReportsController({} as any, {} as any, bulkQueue, {} as any, auditService);
  });

  it('queues a year-scoped send when a year is given', async () => {
    await controller.triggerBulkSend(2025, 'selected', ['a'], user);

    expect(bulkQueue.add).toHaveBeenCalledWith('bulk-send', { staffIds: ['a'], year: 2025, triggeredBy: 'manual' });
  });

  it('queues a full-history send when no year is given', async () => {
    await controller.triggerBulkSend(undefined, 'selected', ['a'], user);

    expect(bulkQueue.add).toHaveBeenCalledWith('bulk-send', { staffIds: ['a'], year: undefined, triggeredBy: 'manual' });
    expect(auditService.log.mock.calls[0][6]).toMatchObject({ year: 'all' });
  });

  it('treats a null year as full history', async () => {
    await controller.triggerBulkSend(null, 'selected', ['a'], user);

    expect(bulkQueue.add.mock.calls[0][1].year).toBeUndefined();
  });

  it('rejects a non-integer year', async () => {
    await expect(controller.triggerBulkSend('2025' as any, 'selected', ['a'], user)).rejects.toThrow(BadRequestException);
    expect(bulkQueue.add).not.toHaveBeenCalled();
  });
});
