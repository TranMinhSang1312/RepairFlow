import { Transform, Type } from "class-transformer";
import { Priority } from "@prisma/client";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

const normalizeUuidArray = ({ value }: { value: unknown }): unknown =>
  Array.isArray(value)
    ? value.map((entry) => (typeof entry === "string" ? entry.trim().toLowerCase() : entry))
    : value;

export class WarrantyAccessoryDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  @Matches(/\S/, { message: "name must contain a non-whitespace character" })
  name!: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  conditionNote?: string | null;
}

export class CreateWarrantyFollowUpDto {
  @IsBoolean()
  eligibilityConfirmed!: boolean;

  @IsUUID()
  branchId!: string;

  @IsEnum(Priority)
  priority!: Priority;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  @Matches(/\S/, { message: "reportedProblem must contain a non-whitespace character" })
  reportedProblem!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(5000)
  @Matches(/\S/, { message: "intakeCondition must contain a non-whitespace character" })
  intakeCondition!: string;

  @Equals(true)
  consentAccepted!: true;

  @IsOptional()
  @IsDateString({ strict: true })
  promisedAt?: string | null;

  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => WarrantyAccessoryDto)
  accessories!: WarrantyAccessoryDto[];

  @Transform(normalizeUuidArray)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  intakeMediaAssetIds!: string[];
}
