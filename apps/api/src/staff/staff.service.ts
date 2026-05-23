import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Client as MinioClient } from 'minio';
import { MeiliSearch } from 'meilisearch';
import { AuditAction, AuditEntity, LoanStatus, PaginatedResult, StaffStatus } from '@welfare/shared';
import { Staff, StaffDocument } from './schemas/staff.schema';
import { Loan, LoanDocument } from '../loans/schemas/loan.schema';
import { AuditService } from '../audit/audit.service';
import { SystemConfigService } from '../system-config/system-config.service';
import { MINIO_CLIENT } from '../storage/minio.module';
import { MEILISEARCH_CLIENT } from '../search/meilisearch.module';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { ChangeStatusDto } from './dto/change-status.dto';
import { StaffQueryDto } from './dto/staff-query.dto';

const TERMINAL_STATUSES: StaffStatus[] = [
  StaffStatus.Resigned,
  StaffStatus.Retired,
  StaffStatus.Dismissed,
  StaffStatus.Deceased,
];

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_PHOTO_BYTES = 2 * 1024 * 1024;
const PHOTO_BUCKET = 'staff-photos';
const PHOTO_PRESIGN_TTL = 15 * 60;

@Injectable()
export class StaffService implements OnModuleInit {
  constructor(
    @InjectModel(Staff.name) private readonly staffModel: Model<StaffDocument>,
    @InjectModel(Loan.name) private readonly loanModel: Model<LoanDocument>,
    private readonly auditService: AuditService,
    private readonly configService: SystemConfigService,
    @Inject(MINIO_CLIENT) private readonly minioClient: MinioClient,
    @Inject(MEILISEARCH_CLIENT) private readonly meiliClient: MeiliSearch,
  ) {}

  async onModuleInit() {
    await this.meiliClient
      .index('staff')
      .updateSettings({
        searchableAttributes: ['fullName', 'staffId', 'pfNo', 'phoneNumber'],
        filterableAttributes: ['level', 'status'],
        sortableAttributes: ['fullName'],
      })
      .catch(() => { /* non-fatal if Meilisearch unavailable at startup */ });
  }

  async create(
    dto: CreateStaffDto,
    actorId: string,
    actorName: string,
    ip?: string,
  ): Promise<StaffDocument> {
    let staff: StaffDocument;
    try {
      staff = await this.staffModel.create({
        ...dto,
        status: dto.status ?? StaffStatus.Active,
        dateOfBirth: new Date(dto.dateOfBirth),
        dateOfEmployment: new Date(dto.dateOfEmployment),
        dateOfFirstContribution: dto.dateOfFirstContribution ? new Date(dto.dateOfFirstContribution) : undefined,
      });
    } catch (err: any) {
      if (err?.code === 11000) {
        throw new ConflictException(`Staff ID '${dto.staffId}' already exists`);
      }
      throw err;
    }
    this.auditService.log(
      actorId, actorName, AuditAction.Create, AuditEntity.Staff,
      staff._id.toString(), undefined, staff.toObject() as unknown as Record<string, unknown>, ip,
    );
    this.syncToMeilisearch(staff);
    return staff;
  }

  async findAll(query: StaffQueryDto): Promise<PaginatedResult<StaffDocument>> {
    const { page = 1, limit = 20, status, level, q } = query;
    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (level) filter.level = level;
    if (q) {
      const rx = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ fullName: rx }, { staffId: rx }, { pfNo: rx }];
    }
    const skip = (page - 1) * limit;
    const [data, total] = await Promise.all([
      this.staffModel.find(filter).sort({ fullName: 1 }).skip(skip).limit(limit).exec(),
      this.staffModel.countDocuments(filter).exec(),
    ]);
    return { data, total, page, limit, totalPages: Math.ceil(total / limit) };
  }

  async findById(id: string): Promise<StaffDocument> {
    const staff = await this.staffModel.findById(id).exec();
    if (!staff) throw new NotFoundException(`Staff ${id} not found`);
    return staff;
  }

  async findByStaffId(staffId: string): Promise<StaffDocument | null> {
    return this.staffModel.findOne({ staffId }).exec();
  }

  async findManyByStaffIdPattern(pattern: string): Promise<StaffDocument[]> {
    return this.staffModel
      .find({ staffId: { $regex: pattern, $options: 'i' } })
      .select('_id staffId')
      .exec();
  }

  async update(
    id: string,
    dto: UpdateStaffDto,
    actorId: string,
    actorName: string,
    ip?: string,
  ): Promise<StaffDocument> {
    const before = await this.findById(id);
    const patch: Record<string, unknown> = { ...dto };
    if (dto.dateOfBirth) patch.dateOfBirth = new Date(dto.dateOfBirth as string);
    if (dto.dateOfEmployment) patch.dateOfEmployment = new Date(dto.dateOfEmployment as string);
    if (dto.dateOfFirstContribution) patch.dateOfFirstContribution = new Date(dto.dateOfFirstContribution as string);
    delete patch.staffId;
    const after = await this.staffModel
      .findByIdAndUpdate(id, { $set: patch }, { new: true, runValidators: true })
      .exec();
    if (!after) throw new NotFoundException(`Staff ${id} not found`);
    this.auditService.log(
      actorId, actorName, AuditAction.Update, AuditEntity.Staff,
      id, before.toObject() as unknown as Record<string, unknown>, after.toObject() as unknown as Record<string, unknown>, ip,
    );
    this.syncToMeilisearch(after);
    return after;
  }

  async changeStatus(
    id: string,
    dto: ChangeStatusDto,
    actorId: string,
    actorName: string,
    ip?: string,
  ): Promise<{ staff: StaffDocument; requiresSettlement: boolean }> {
    const staff = await this.findById(id);
    if (TERMINAL_STATUSES.includes(staff.status)) {
      throw new BadRequestException(
        `Cannot change status from terminal state '${staff.status}'`,
      );
    }
    if (staff.status === dto.status) {
      throw new BadRequestException(`Staff already has status '${dto.status}'`);
    }
    const before = staff.toObject() as unknown as Record<string, unknown>;
    staff.status = dto.status;
    await staff.save();
    this.auditService.log(
      actorId, actorName, AuditAction.Update, AuditEntity.Staff,
      id, before, staff.toObject() as unknown as Record<string, unknown>, ip,
    );
    this.syncToMeilisearch(staff);
    const requiresSettlement = [StaffStatus.Resigned, StaffStatus.Dismissed].includes(dto.status);
    return { staff, requiresSettlement };
  }

  async isLoanEligible(id: string): Promise<{ eligible: boolean; reason?: string }> {
    const staff = await this.findById(id);
    if (staff.status !== StaffStatus.Active) {
      return { eligible: false, reason: 'Staff is not active' };
    }
    const config = await this.configService.getAll();
    const threshold = parseInt((config as any)['ELIGIBILITY_MONTHS']?.value ?? '6', 10);
    const employedMs = Date.now() - new Date(staff.dateOfEmployment).getTime();
    const employedMonths = employedMs / (1000 * 60 * 60 * 24 * 30.44);
    if (employedMonths < threshold) {
      return {
        eligible: false,
        reason: `Eligibility requires ${threshold} months of employment`,
      };
    }
    const maxActiveLoans = parseInt((config as any)['MAX_LOANS_PER_STAFF']?.value ?? '1', 10);
    const activeCount = await this.loanModel
      .countDocuments({ staffId: id, status: LoanStatus.Active })
      .exec();
    if (activeCount >= maxActiveLoans) {
      return { eligible: false, reason: 'Staff already has an active loan' };
    }
    return { eligible: true };
  }

  async uploadPhoto(id: string, buffer: Buffer, mimetype: string): Promise<StaffDocument> {
    if (!ALLOWED_IMAGE_TYPES.includes(mimetype)) {
      throw new BadRequestException('Only JPEG, PNG, and WebP images are allowed');
    }
    if (buffer.length > MAX_PHOTO_BYTES) {
      throw new BadRequestException('Photo must be 2 MB or smaller');
    }
    const staff = await this.findById(id);
    const ext = mimetype.split('/')[1].replace('jpeg', 'jpg');
    const key = `${staff.staffId}/photo.${ext}`;
    await this.minioClient.putObject(PHOTO_BUCKET, key, buffer, buffer.length, {
      'Content-Type': mimetype,
    });
    return this.update(id, { photoKey: key } as UpdateStaffDto, 'system', 'system');
  }

  async getPhotoUrl(id: string): Promise<string> {
    const staff = await this.findById(id);
    if (!staff.photoKey) throw new NotFoundException('Staff has no photo');
    return this.minioClient.presignedGetObject(PHOTO_BUCKET, staff.photoKey, PHOTO_PRESIGN_TTL);
  }

  async reindexAll(): Promise<{ indexed: number }> {
    const allStaff = await this.staffModel.find().lean().exec();
    const docs = allStaff.map((s) => ({
      id: (s._id as any).toString(),
      fullName: s.fullName,
      staffId: s.staffId,
      pfNo: s.pfNo,
      phoneNumber: s.phoneNumber,
      level: s.level,
      status: s.status,
    }));
    if (docs.length > 0) {
      await this.meiliClient.index('staff').addDocuments(docs, { primaryKey: 'id' });
    }
    return { indexed: docs.length };
  }

  private syncToMeilisearch(staff: StaffDocument): void {
    const doc = {
      id: staff._id.toString(),
      fullName: staff.fullName,
      staffId: staff.staffId,
      pfNo: staff.pfNo,
      phoneNumber: staff.phoneNumber,
      level: staff.level,
      status: staff.status,
    };
    this.meiliClient
      .index('staff')
      .addDocuments([doc], { primaryKey: 'id' })
      .catch(() => { /* fire-and-forget */ });
  }
}
