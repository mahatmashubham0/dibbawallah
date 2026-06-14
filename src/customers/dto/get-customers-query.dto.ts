import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsBoolean } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { CustomerStatus } from '@prisma/client';
import { SearchablePaginatedDto } from '@Common';

export class GetCustomersQueryDto extends SearchablePaginatedDto {
  @ApiPropertyOptional({ enum: CustomerStatus })
  @IsOptional()
  @IsEnum(CustomerStatus)
  status?: CustomerStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  vendorId?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Transform(({ value }) => {
    if (value === 'true' || value === true) return true;
    if (value === 'false' || value === false) return false;
    return undefined;
  })
  @IsBoolean()
  isActive?: boolean;
}
