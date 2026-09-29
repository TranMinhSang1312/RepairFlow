import { Type } from "class-transformer";
import { DeviceType } from "@prisma/client";
import {
  Equals,
  IsBoolean,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";

import { INTAKE_DRAFT_SOURCE_TYPES, type IntakeDraftSourceType } from "@repairflow/contracts";

export class IntakeDraftSourceDto {
  @IsIn(INTAKE_DRAFT_SOURCE_TYPES)
  type!: IntakeDraftSourceType;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(8_000)
  text?: string;

  @IsOptional()
  @IsUUID("4")
  sourceMediaAssetId?: string;

  @IsOptional()
  @IsUUID("4")
  mediaAssetId?: string;

  @IsOptional()
  @IsBoolean()
  consentAcknowledged?: boolean;
}

export class CreateIntakeDraftDto {
  @ValidateNested()
  @Type(() => IntakeDraftSourceDto)
  source!: IntakeDraftSourceDto;

  @IsEnum(DeviceType)
  deviceType!: DeviceType;

  @Equals("vi")
  language!: "vi";
}
