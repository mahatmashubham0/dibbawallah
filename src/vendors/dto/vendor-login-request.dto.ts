import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class VendorLoginRequestDto {
  @ApiProperty({
    example: '+919876543210',
    description: 'Indian mobile number in E.164 format',
  })
  @IsString()
  @Matches(/^\+91[6-9]\d{9}$/, {
    message:
      'The mobile number must be a valid Indian mobile number in +91 format',
  })
  mobile!: string;

  @ApiProperty({ example: 'Test@123', description: 'Vendor password' })
  @IsString()
  password!: string;
}
