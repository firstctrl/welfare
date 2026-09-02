import { BadRequestException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { MeiliSearch } from 'meilisearch';
import { AuditAction, AuditEntity, ClaimSource, ClaimStatus, CreateClaimDto, PaginatedResult } from '@welfare/shared';
import { Claim, ClaimDocument } from './schemas/claim.schema';
import { Contribution, ContributionDocument } from '../contributions/schemas/contribution.schema';
import { AuditService } from '../audit/audit.service';
import { StaffService } from '../staff/staff.service';
import { MEILISEARCH_CLIENT } from '../search/meilisearch.module';
import { ClaimQueryDto } from './dto/claim-query.dto';

@Injectable()
export class ClaimsService implements OnModuleInit {
  constructor(
    @InjectModel(Claim.name) private readonly claimModel: Model<ClaimDocument>,
    @InjectModel(Contribution.name) private readonly contributionModel: Model<ContributionDocument>,
    private readonly auditService: AuditService,
    private readonly staffService: StaffService,
    @Inject(MEILISEARCH_CLIENT) private readonly meiliClient: MeiliSearch,
  ) {}

  async onModuleInit() {
    await this.meiliClient
      .index('claims')
      .updateSettings({
        searchableAttributes: ['staffName', 'staffId', 'claimType'],
        filterableAttributes: ['status', 'claimType'],
        sortableAttributes: ['year', 'month'],
      })
      .catch(() => { /* non-fatal */ });
  }

  private syncClaimToMeilisearch(claim: ClaimDocument, staffName: string, staffBusinessId: string): void {
    const doc = {
      id: claim._id.toString(),
      staffId: staffBusinessId,
      staffName,
      claimType: claim.claimType,
      amount: claim.amount,
      status: claim.status,
      month: claim.month,
      year: claim.year,
    };
    this.meiliClient
      .index('claims')
      .addDocuments([doc], { primaryKey: 'id' })
      .catch(() => { /* fire-and-forget */ });
  }

  async reindexAll(): Promise<{ indexed: number }> {
    const allClaims = await this.claimModel.find().lean().exec();
    const staffMongoIds = [...new Set(allClaims.map((c) => c.staffId))];
    const staffMap = new Map<string, { fullName: string; staffId: string }>();
    await Promise.all(
      staffMongoIds.map(async (id) => {
        const s = await this.staffService.findById(id).catch(() => null);
        if (s) staffMap.set(id, { fullName: s.fullName, staffId: s.staffId });
      }),
    );
    const docs = allClaims.map((c) => {
      const staff = staffMap.get(c.staffId);
      return {
        id: (c._id as any).toString(),
        staffId: staff?.staffId ?? c.staffId,
        staffName: staff?.fullName ?? c.staffId,
        claimType: c.claimType,
        amount: c.amount,
        status: c.status,
        month: c.month,
        year: c.year,
      };
    });
    if (docs.length > 0) {
      await this.meiliClient.index('claims').addDocuments(docs, { primaryKey: 'id' });
    }
    return { indexed: docs.length };
  }

  async getStaffBalance(staffId: string): Promise<number> {
    const [contribResult, claimResult] = await Promise.all([
      this.contributionModel
        .aggregate([
          { $match: { staffId, isDebit: { $ne: true } } },
          { $group: { _id: null, total: { $sum: '$paidAmount' } } },
        ])
        .exec(),
      this.claimModel
        .aggregate([
          { $match: { staffId, status: ClaimStatus.Approved } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ])
        .exec(),
    ]);
    const totalPaid = (contribResult as { total: number }[])[0]?.total ?? 0;
    const totalApprovedClaims = (claimResult as { total: number }[])[0]?.total ?? 0;
    return totalPaid - totalApprovedClaims;
  }

  async createClaim(dto: CreateClaimDto, actorId: string, actorName: string): Promise<ClaimDocument> {
    const balance = await this.getStaffBalance(dto.staffId);
    if (dto.amount > balance) {
      throw new BadRequestException(`Claim amount exceeds available balance of GHS ${balance.toFixed(2)}`);
    }
    const claim = await this.claimModel.create({
      ...dto,
      status: ClaimStatus.Pending,
      source: ClaimSource.ManualEntry,
      recordedBy: actorName,
    });
    this.auditService.log(
      actorId, actorName, AuditAction.Create, AuditEntity.Claim,
      claim._id.toString(), undefined, claim.toObject() as unknown as Record<string, unknown>,
    );
    const staff = await this.staffService.findById(claim.staffId);
    this.syncClaimToMeilisearch(claim, staff.fullName, staff.staffId);
    return claim;
  }

  async approveClaim(id: string, actorId: string, actorName: string): Promise<ClaimDocument> {
    const claim = await this.findById(id);
    const balance = await this.getStaffBalance(claim.staffId);
    if (claim.amount > balance) {
      throw new BadRequestException(`Cannot approve — claim amount exceeds current available balance of GHS ${balance.toFixed(2)}`);
    }
    const before = claim.toObject() as unknown as Record<string, unknown>;
    claim.status = ClaimStatus.Approved;
    claim.approvedBy = actorName;
    claim.approvedAt = new Date();
    await claim.save();
    this.auditService.log(
      actorId, actorName, AuditAction.Approve, AuditEntity.Claim,
      id, before, claim.toObject() as unknown as Record<string, unknown>,
    );
    const staff = await this.staffService.findById(claim.staffId);
    this.syncClaimToMeilisearch(claim, staff.fullName, staff.staffId);
    return claim;
  }

  async rejectClaim(id: string, reason: string, actorId: string, actorName: string): Promise<ClaimDocument> {
    const claim = await this.findById(id);
    const before = claim.toObject() as unknown as Record<string, unknown>;
    claim.status = ClaimStatus.Rejected;
    claim.rejectedReason = reason;
    await claim.save();
    this.auditService.log(
      actorId, actorName, AuditAction.Reject, AuditEntity.Claim,
      id, before, claim.toObject() as unknown as Record<string, unknown>,
    );
    const staff = await this.staffService.findById(claim.staffId);
    this.syncClaimToMeilisearch(claim, staff.fullName, staff.staffId);
    return claim;
  }

  async findById(id: string): Promise<ClaimDocument> {
    const claim = await this.claimModel.findById(id).exec();
    if (!claim) throw new NotFoundException(`Claim ${id} not found`);
    return claim;
  }

  async findByIdWithStaff(id: string): Promise<any> {
    const result = await this.claimModel.aggregate([
      { $match: { _id: new Types.ObjectId(id) } },
      { $addFields: { _staffObjId: { $toObjectId: '$staffId' } } },
      {
        $lookup: {
          from: 'staff',
          localField: '_staffObjId',
          foreignField: '_id',
          as: '_staffArr',
          pipeline: [{ $project: { staffId: 1, fullName: 1 } }],
        },
      },
      { $addFields: { staffInfo: { $arrayElemAt: ['$_staffArr', 0] } } },
      { $project: { _staffArr: 0, _staffObjId: 0 } },
    ]).exec();
    if (!result.length) throw new NotFoundException(`Claim ${id} not found`);
    return result[0];
  }

  async findByStaff(staffId: string): Promise<ClaimDocument[]> {
    return this.claimModel.find({ staffId }).sort({ year: -1, month: -1 }).exec();
  }

  async listClaims(query: ClaimQueryDto): Promise<PaginatedResult<any>> {
    const { page = 1, limit = 20, staffId, claimType, status, year } = query;
    const match: Record<string, unknown> = {};
    if (staffId) {
      // staffId query is the employee code (e.g. "SCW001"); resolve to MongoDB _id(s) via regex
      const matched = await this.staffService.findManyByStaffIdPattern(staffId);
      if (!matched.length) return { data: [], total: 0, page, limit, totalPages: 0 };
      const ids = matched.map((s) => s._id.toString());
      match.staffId = ids.length === 1 ? ids[0] : { $in: ids };
    }
    if (claimType) match.claimType = claimType;
    if (status) match.status = status;
    if (year) match.year = year;
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.claimModel.aggregate([
        { $match: match },
        { $sort: { year: -1, month: -1 } },
        { $skip: skip },
        { $limit: limit },
        { $addFields: { _staffObjId: { $toObjectId: '$staffId' } } },
        {
          $lookup: {
            from: 'staff',
            localField: '_staffObjId',
            foreignField: '_id',
            as: '_staffArr',
            pipeline: [{ $project: { staffId: 1, fullName: 1 } }],
          },
        },
        {
          $addFields: {
            staffInfo: { $arrayElemAt: ['$_staffArr', 0] },
          },
        },
        { $project: { _staffArr: 0, _staffObjId: 0 } },
      ]).exec(),
      this.claimModel.countDocuments(match).exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async deleteClaim(id: string, actorId: string, actorName: string): Promise<void> {
    const claim = await this.findById(id);
    await this.claimModel.findByIdAndDelete(id).exec();
    this.auditService.log(
      actorId, actorName, AuditAction.Delete, AuditEntity.Claim,
      id, claim.toObject() as unknown as Record<string, unknown>, undefined,
    );
  }

  async bulkDeleteClaims(ids: string[], actorId: string, actorName: string): Promise<{ deleted: number }> {
    for (const id of ids) {
      await this.deleteClaim(id, actorId, actorName);
    }
    return { deleted: ids.length };
  }
}
