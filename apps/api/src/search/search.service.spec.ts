import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { MEILISEARCH_CLIENT } from './meilisearch.module';
import { StaffService } from '../staff/staff.service';
import { LoansService } from '../loans/loans.service';

const mockStaffIndex = {
  search: jest.fn(),
};
const mockLoansIndex = {
  search: jest.fn(),
};
const mockMeili = {
  index: jest.fn((name: string) => (name === 'staff' ? mockStaffIndex : mockLoansIndex)),
};

describe('SearchService', () => {
  let service: SearchService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: MEILISEARCH_CLIENT, useValue: mockMeili },
        { provide: StaffService, useValue: { reindexAll: jest.fn() } },
        { provide: LoansService, useValue: { reindexAll: jest.fn() } },
      ],
    }).compile();
    service = module.get<SearchService>(SearchService);
    jest.clearAllMocks();
  });

  it('queries both indexes in parallel', async () => {
    mockStaffIndex.search.mockResolvedValue({
      hits: [{ id: 's1', fullName: 'John Doe', staffId: 'STF001', level: 'GL10', status: 'Active' }],
      estimatedTotalHits: 1,
    });
    mockLoansIndex.search.mockResolvedValue({
      hits: [{ id: 'l1', staffName: 'Jane Smith', staffId: 'STF002', principalAmount: 50000, status: 'Active', disbursedDate: '2025-01-01' }],
      estimatedTotalHits: 1,
    });

    const result = await service.search('doe');

    expect(mockStaffIndex.search).toHaveBeenCalledWith('doe', { limit: 5 });
    expect(mockLoansIndex.search).toHaveBeenCalledWith('doe', { limit: 5 });
    expect(result.results).toHaveLength(2);
    const staffResult = result.results.find((r: { type: string }) => r.type === 'staff');
    expect(staffResult).toMatchObject({ type: 'staff', id: 's1', title: 'John Doe', url: '/staff/s1' });
    const loanResult = result.results.find((r: { type: string }) => r.type === 'loan');
    expect(loanResult).toMatchObject({ type: 'loan', id: 'l1', url: '/loans/l1' });
  });

  it('returns empty results when query is blank', async () => {
    const result = await service.search('');
    expect(mockStaffIndex.search).not.toHaveBeenCalled();
    expect(result.results).toEqual([]);
  });
});
