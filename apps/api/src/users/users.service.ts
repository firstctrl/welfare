import { Injectable, ConflictException, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import * as bcrypt from 'bcrypt';
import { User, UserDocument } from './schemas/user.schema';
import { UserRole } from '@welfare/shared';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(@InjectModel(User.name) private readonly userModel: Model<UserDocument>) {}

  async findByUsername(username: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ username }).exec();
  }

  async findByUsernameWithPassword(username: string): Promise<UserDocument | null> {
    return this.userModel.findOne({ username }).select('+passwordHash').exec();
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userModel.findById(id).exec();
  }

  async findAll(): Promise<UserDocument[]> {
    return this.userModel.find().exec();
  }

  async provisionFromLdap(ldapUser: { username: string; displayName: string; email?: string }): Promise<UserDocument> {
    const user = await this.userModel.findOneAndUpdate(
      { username: ldapUser.username },
      {
        $set: { lastLogin: new Date(), displayName: ldapUser.displayName, ...(ldapUser.email && { email: ldapUser.email }) },
        $setOnInsert: { role: UserRole.WelfareOfficer, source: 'ldap', isActive: true },
      },
      { upsert: true, new: true },
    ).exec();
    return user!;
  }

  async createLocal(dto: { username: string; displayName: string; email?: string; password: string }): Promise<Omit<User, 'passwordHash'> & { _id: unknown }> {
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = new this.userModel({
      username: dto.username,
      displayName: dto.displayName,
      email: dto.email,
      role: UserRole.WelfareOfficer,
      source: 'local',
      passwordHash,
      isActive: true,
    });
    try {
      const saved = await user.save();
      const obj = saved.toObject();
      delete obj.passwordHash;
      return obj;
    } catch (err: unknown) {
      if ((err as { code?: number }).code === 11000) {
        throw new ConflictException('Username already exists');
      }
      throw err;
    }
  }

  async updateUser(id: string, dto: { displayName?: string; email?: string; isActive?: boolean }): Promise<UserDocument> {
    const user = await this.userModel.findByIdAndUpdate(id, { $set: dto }, { new: true }).exec();
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async validatePassword(user: UserDocument, password: string): Promise<boolean> {
    if (!user.passwordHash) return false;
    return bcrypt.compare(password, user.passwordHash);
  }

  async seedAdminIfEmpty(): Promise<void> {
    if (process.env.NODE_ENV === 'production' && !process.env.SEED_ADMIN_PASSWORD) {
      this.logger.warn('SEED_ADMIN_PASSWORD not set — skipping admin seed in production');
      return;
    }
    const count = await this.userModel.countDocuments().exec();
    if (count === 0) {
      const password = process.env.SEED_ADMIN_PASSWORD || 'Admin@123';
      const passwordHash = await bcrypt.hash(password, 12);
      const user = new this.userModel({
        username: 'admin',
        displayName: 'System Administrator',
        role: UserRole.Admin,
        source: 'local',
        passwordHash,
        isActive: true,
      });
      await user.save();
      this.logger.log('Default admin account seeded. Change password before production use.');
    }
  }
}
