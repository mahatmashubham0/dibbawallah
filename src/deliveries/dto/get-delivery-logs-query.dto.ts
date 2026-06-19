import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import { SearchablePaginatedDto } from '@Common';

export class GetDeliveryLogsQueryDto extends SearchablePaginatedDto {
  @ApiPropertyOptional({
    description: 'Filter logs by a specific delivery ID',
  })
  @IsOptional()
  @IsString()
  deliveryId?: string;

  @ApiPropertyOptional({
    description: 'Filter logs by customer ID',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  customerId?: number;

  @ApiPropertyOptional({
    description: 'Filter logs by vendor ID (Administrators only)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  vendorId?: number;
}
