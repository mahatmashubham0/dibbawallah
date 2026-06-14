import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Matches } from 'class-validator';
import { CustomerStatus, VendorCustomerStatus } from '@prisma/client';

export class UpdateCustomerDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  fullName?: string;

  @ApiPropertyOptional({
    example: '+919876543210',
    description: 'Indian mobile number in E.164 format',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\+91[6-9]\d{9}$/, {
    message: 'The mobile number must be a valid Indian mobile number in +91 format',
  })
  mobileNumber?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  address?: string;

  @ApiPropertyOptional({ enum: CustomerStatus })
  @IsOptional()
  @IsEnum(CustomerStatus)
  status?: CustomerStatus;

  // Vendor ID to specify which Vendor-Customer relationship to update (optional for Admin)
  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  vendorId?: number;

  // VendorCustomer-specific properties (updated in relation mapping)
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  vendorCustomerNotes?: string;

  @ApiPropertyOptional({ enum: VendorCustomerStatus })
  @IsOptional()
  @IsEnum(VendorCustomerStatus)
  vendorCustomerStatus?: VendorCustomerStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
