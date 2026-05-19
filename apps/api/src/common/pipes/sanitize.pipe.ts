import { PipeTransform, Injectable, ArgumentMetadata } from '@nestjs/common';

function sanitizeValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.trim().replace(/<[^>]*>/g, '');
  }
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, sanitizeValue(v)]),
    );
  }
  return value;
}

@Injectable()
export class SanitizePipe implements PipeTransform {
  transform(value: unknown, metadata: ArgumentMetadata) {
    if (metadata.type !== 'body') return value;
    return sanitizeValue(value);
  }
}
