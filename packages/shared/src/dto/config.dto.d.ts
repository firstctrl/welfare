import { ConfigKey } from '../enums/config-key.enum';
export interface UpdateConfigDto {
    value: string;
    description?: string;
}
export interface ConfigResponseDto {
    _id: string;
    key: ConfigKey;
    value: string;
    description?: string;
    updatedBy: string;
    updatedAt: string;
}
//# sourceMappingURL=config.dto.d.ts.map