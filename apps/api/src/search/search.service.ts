import { Inject, Injectable } from '@nestjs/common';
import { MeiliSearch } from 'meilisearch';
import { StaffService } from '../staff/staff.service';
import { LoansService } from '../loans/loans.service';
import { ClaimsService } from '../claims/claims.service';
import { MEILISEARCH_CLIENT } from './meilisearch.module';

export interface SearchResultItem {
  type: 'staff' | 'loan' | 'claim';
  id: string;
  title: string;
  subtitle: string;
  url: string;
}

@Injectable()
export class SearchService {
  constructor(
    @Inject(MEILISEARCH_CLIENT) private readonly meili: MeiliSearch,
    private readonly staffService: StaffService,
    private readonly loansService: LoansService,
    private readonly claimsService: ClaimsService,
  ) {}

  async search(q: string): Promise<{ results: SearchResultItem[] }> {
    if (!q || !q.trim()) return { results: [] };

    const [staffRes, loansRes, claimsRes] = await Promise.all([
      this.meili.index('staff').search(q, { limit: 5 }),
      this.meili.index('loans').search(q, { limit: 5 }),
      this.meili.index('claims').search(q, { limit: 5 }),
    ]);

    const staffItems: SearchResultItem[] = (staffRes.hits as any[]).map((h) => ({
      type: 'staff' as const,
      id: h.id,
      title: h.fullName,
      subtitle: `${h.staffId} · ${new Date(h.dateOfEmployment).toLocaleDateString('en-GB')} · ${h.status}`,
      url: `/staff/${h.id}`,
    }));

    const loanItems: SearchResultItem[] = (loansRes.hits as any[]).map((h) => ({
      type: 'loan' as const,
      id: h.id,
      title: `${h.staffName} - ₵${Number(h.principalAmount).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      subtitle: `${h.status} · ${new Date(h.disbursedDate).toLocaleDateString('en-GB')}`,
      url: `/loans/${h.id}`,
    }));

    const claimItems: SearchResultItem[] = (claimsRes.hits as any[]).map((h) => ({
      type: 'claim' as const,
      id: h.id,
      title: `${h.claimType} claim - ${h.staffName}`,
      subtitle: `${h.status} · GHS ${Number(h.amount).toLocaleString('en-GH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
      url: `/claims/${h.id}`,
    }));

    return { results: [...staffItems, ...loanItems, ...claimItems] };
  }

  async reindex(): Promise<{ staff: number; loans: number; claims: number }> {
    const [staff, loans, claims] = await Promise.all([
      this.staffService.reindexAll(),
      this.loansService.reindexAll(),
      this.claimsService.reindexAll(),
    ]);
    return { staff: staff.indexed, loans: loans.indexed, claims: claims.indexed };
  }
}
