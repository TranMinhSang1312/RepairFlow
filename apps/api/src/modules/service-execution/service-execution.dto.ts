import { Transform } from "class-transformer";
import {
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";
import { PartRequirementStatus, WorkLogType } from "@prisma/client";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

const normalizeUuid = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

export class CreateWorkLogDto {
  @IsEnum(WorkLogType)
  type!: WorkLogType;

  @Transform(trim)
  @IsString()
  @MaxLength(10_000)
  @Matches(/\S/, { message: "content must contain a non-whitespace character" })
  content!: string;

  @IsOptional()
  @Transform(normalizeUuid)
  @IsUUID()
  quoteItemId?: string | null;

  @IsOptional()
  @Transform(normalizeUuid)
  @IsUUID()
  supersedesId?: string | null;
}

export class CreatePartRequirementDto {
  @Transform(normalizeUuid)
  @IsUUID()
  quoteItemId!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  sku?: string | null;
}

export class UpdatePartRequirementDto {
  @IsIn([PartRequirementStatus.ORDERED, PartRequirementStatus.AVAILABLE])
  targetStatus!: PartRequirementStatus;

  @IsInt()
  @Min(0)
  expectedLockVersion!: number;
}

export class CreatePartUsedDto {
  @Transform(normalizeUuid)
  @IsUUID()
  quoteItemId!: string;

  @Transform(trim)
  @IsString()
  @MaxLength(300)
  @Matches(/\S/, { message: "name must contain a non-whitespace character" })
  name!: string;

  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(100)
  sku?: string | null;

  @IsNumber({ allowInfinity: false, allowNaN: false, maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9_999_999_999.99)
  quantity!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  unitCost?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(Number.MAX_SAFE_INTEGER)
  unitSalePrice?: number | null;

  @IsOptional()
  @Transform(normalizeUuid)
  @IsUUID()
  supersedesId?: string | null;
}
