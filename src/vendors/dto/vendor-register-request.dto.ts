import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  ArrayMinSize,
  ArrayUnique,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  IsStrongPassword,
} from 'class-validator';

export class VendorRegisterRequestDto {
  @ApiProperty({
    example: '+919876543210',
    description: 'Indian mobile number in E.164 format',
  })
  @IsNotEmpty()
  @IsString()
  @Matches(/^\+91[6-9]\d{9}$/, {
    message:
      'The mobile number must be a valid Indian mobile number in +91 format',
  })
  mobile!: string;

  @ApiProperty()
  @IsNotEmpty()
  @IsStrongPassword()
  password!: string;

  @ApiProperty({ example: 'Sharma Tiffins' })
  @IsNotEmpty()
  @IsString()
  businessName!: string;

  @ApiProperty({ example: 'Rohit Sharma' })
  @IsNotEmpty()
  @IsString()
  fullName!: string;

  @ApiProperty({ example: 'Indiranagar' })
  @IsNotEmpty()
  @IsString()
  locality!: string;

  @ApiProperty({
    type: [String],
    example: ['Indiranagar', 'Domlur'],
  })
  @IsNotEmpty()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  serviceAreas!: string[];

  @ApiPropertyOptional({ example: 'vendor@upi' })
  @IsOptional()
  @IsString()
  upiId?: string;

  @ApiPropertyOptional({ example: 'https://qr.me/vendor' })
  @IsOptional()
  @IsString()
  qrCode?: string;

  @ApiProperty({
    example: 'India',
    description: 'Country where the vendor is located',
  })
  @IsNotEmpty()
  @IsString()
  country!: string;

  @ApiProperty({
    example: 'Karnataka',
    description: 'State where the vendor is located',
  })
  @IsNotEmpty()
  @IsString()
  state!: string;

  @ApiProperty({
    example: 'Bengaluru',
    description: 'City where the vendor is located',
  })
  @IsNotEmpty()
  @IsString()
  city!: string;
}
