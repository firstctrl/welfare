import { Test } from '@nestjs/testing';
import { getModelToken } from '@nestjs/mongoose';
import { getQueueToken } from '@nestjs/bullmq';
import { AnnualStatementJob } from './annual-statement.job';
import { Staff } from '../../staff/schemas/staff.schema';
import { Contribution } from '../../contributions/schemas/contribution.schema';
import { SystemConfigService } from '../../system-config/system-config.service';
import { AuditService } from '../../audit/audit.service';
import { StaffStatus } from '@welfare/shared';

const mockStaffFind = jest.fn();
const mockContribAggregate = jest.fn();
const mockContribFind = jest.fn();
const mockQueueAdd = jest.fn();
const mockConfigGetAll = jest.fn();
const mockAuditLog = jest.fn();

const mockStaffModel = { find: mockStaffFind };
const mockContribModel = { aggregate: mockContribAggregate, find: mockContribFind };
const mockQueue = { add: mockQueueAdd };
const mockConfigService = { getAll: mockConfigGetAll };
const mockAuditService = { log: mockAuditLog };

jest.mock('../templates/contribution-statement.template', () => ({
  renderContributionStatement: jest.fn().mockResolvedValue('<html>statement</html>'),
}));

beforeEach(() => jest.clearAllMocks());

describe('AnnualStatementJob', () => {
  let job: AnnualStatementJob;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      providers: [
        AnnualStatementJob,
        { provide: getModelToken(Staff.name), useValue: mockStaffModel },
        { provide: getModelToken(Contribution.name), useValue: mockContribModel },
        { provide: getQueueToken('email-batch'), useValue: mockQueue },
        { provide: SystemConfigService, useValue: mockConfigService },
        { provide: AuditService, useValue: mockAuditService },
      ],
    }).compile();
    job = module.get<AnnualStatementJob>(AnnualStatementJob);
  });

  it('enqueues one job per eligible staff with email', async () => {
    mockConfigGetAll.mockResolvedValue({
      EMAIL_FROM_NAME: { value: 'Welfare' },
    });
    mockStaffFind.mockReturnValue({
      exec: jest.fn().mockResolvedValue([
        { _id: { toString: () => 's1' }, fullName: 'Alice', staffId: 'GL001', email: 'alice@test.com', status: StaffStatus.Active },
        { _id: { toString: () => 's2' }, fullName: 'Bob', staffId: 'GL002', email: null, status: StaffStatus.Active },
      ]),
    });
    mockContribAggregate.mockReturnValue({
      exec: jest.fn().mockResolvedValue([
        { month: 1, expectedAmount: 100, paidAmount: 100, surplusCarriedForward: 0, status: 'Paid' },
      ]),
    });
    mockContribFind.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
    mockQueueAdd.mockResolvedValue({});
    mockAuditLog.mockResolvedValue({});

    await job.run();

    expect(mockQueueAdd).toHaveBeenCalledTimes(1);
    expect(mockQueueAdd.mock.calls[0][1].recipient.email).toBe('alice@test.com');
  });

  it('logs audit summary on completion', async () => {
    mockConfigGetAll.mockResolvedValue({
      EMAIL_FROM_NAME: { value: 'Welfare' },
    });
    mockStaffFind.mockReturnValue({
      exec: jest.fn().mockResolvedValue([
        { _id: { toString: () => 's1' }, fullName: 'Alice', staffId: 'GL001', email: 'alice@test.com', status: StaffStatus.Active },
      ]),
    });
    mockContribAggregate.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
    mockContribFind.mockReturnValue({ exec: jest.fn().mockResolvedValue([]) });
    mockQueueAdd.mockResolvedValue({});
    mockAuditLog.mockResolvedValue({});

    await job.run();

    expect(mockAuditLog).toHaveBeenCalled();
  });
});
