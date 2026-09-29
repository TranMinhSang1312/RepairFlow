import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsOptional,
  IsUUID,
} from "class-validator";

import { DEVICE_OCR_FIELDS, type DeviceOcrField } from "@repairflow/contracts";

export class CreateDeviceOcrDto {
  @IsUUID("4")
  mediaAssetId!: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(DEVICE_OCR_FIELDS.length)
  @ArrayUnique()
  @IsIn(DEVICE_OCR_FIELDS, { each: true })
  allowedFields?: DeviceOcrField[];
}
