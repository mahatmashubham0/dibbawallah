import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional } from 'class-validator';
import { Type } from 'class-transformer';

export class GetCustomerCalendarQueryDto {
  @ApiPropertyOptional({ description: 'Start date in ISO format (e.g. YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date in ISO format (e.g. YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({ description: 'Vendor ID for admin to filter results' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  vendorId?: number;
}
