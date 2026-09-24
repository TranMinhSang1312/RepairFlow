import { Transform, Type } from "class-transformer";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { QcItemResult } from "@prisma/client";

const trimNullable = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

const normalizeUuid = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

const normalizeUuidArray = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? value.map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : entry))
    : value;

export class CreateQcResultDto {
  @Transform(normalizeUuid)
  @IsUUID()
  qcTemplateItemId!: string;

  @IsEnum(QcItemResult)
  result!: QcItemResult;

  @IsOptional()
  @Transform(trimNullable)
  @IsString()
  @MaxLength(1000)
  note?: string | null;

  @Transform(normalizeUuidArray)
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  evidenceMediaAssetIds!: string[];
}

export class CreateQcRunDto {
  @Transform(normalizeUuid)
  @IsUUID()
  qcTemplateId!: string;

  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  expectedLockVersion!: number;

  @IsOptional()
  @Transform(trimNullable)
  @IsString()
  @MaxLength(5000)
  notes?: string | null;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateQcResultDto)
  results!: CreateQcResultDto[];
}
