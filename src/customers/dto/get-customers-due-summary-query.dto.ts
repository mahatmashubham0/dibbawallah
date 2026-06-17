import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsInt, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class GetCustomersDueSummaryQueryDto {
  @ApiPropertyOptional({
    description: 'Number of past days to filter the summary',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  days?: number;

  @ApiPropertyOptional({ description: 'Start date in ISO format' })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiPropertyOptional({ description: 'End date in ISO format' })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiPropertyOptional({
    description: 'Negative credit threshold limit (e.g. -10, -15)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Max(0)
  minNegativeCredit?: number;

  @ApiPropertyOptional({ description: 'Vendor ID for admin to filter results' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  vendorId?: number;
}
