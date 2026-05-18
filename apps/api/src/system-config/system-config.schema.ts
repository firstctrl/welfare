import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ConfigKey } from '@welfare/shared';

@Schema({ timestamps: true, collection: 'configs' })
export class ConfigSetting {
  @Prop({ required: true, unique: true, enum: Object.values(ConfigKey) })
  key!: ConfigKey;

  @Prop({ required: true })
  value!: string;

  @Prop()
  description?: string;

  @Prop({ required: true })
  updatedBy!: string;
}

export type ConfigSettingDocument = HydratedDocument<ConfigSetting>;
export const ConfigSettingSchema = SchemaFactory.createForClass(ConfigSetting);
