import { PartialType } from '@nestjs/swagger';
import { VendorRegisterRequestDto } from './vendor-register-request.dto';

export class UpdateVendorProfileRequestDto extends PartialType(
  VendorRegisterRequestDto,
) {}
