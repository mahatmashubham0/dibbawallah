import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class RegisterTokenDto {
  @ApiProperty({ description: 'FCM device token' })
  @IsNotEmpty()
  @IsString()
  token!: string;

  @ApiPropertyOptional({ description: 'Unique device identifier' })
  @IsOptional()
  @IsString()
  deviceId?: string;

  @ApiPropertyOptional({ description: 'Device platform (e.g., ios, android, web)' })
  @IsOptional()
  @IsString()
  platform?: string;
}

export class SendTestNotificationDto {
  @ApiProperty({ description: 'Notification title' })
  @IsNotEmpty()
  @IsString()
  title!: string;

  @ApiProperty({ description: 'Notification body message' })
  @IsNotEmpty()
  @IsString()
  body!: string;

  @ApiPropertyOptional({ description: 'User ID to send notification to' })
  @IsOptional()
  @IsString()
  userId?: string;
}
