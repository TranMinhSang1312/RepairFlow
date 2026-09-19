import { Transform, Type } from "class-transformer";
import { Priority, RepairOrderStatus } from "@prisma/client";
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  Equals,
  IsArray,
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

const toArray = ({ value }: { value: unknown }): unknown =>
  value === undefined ? value : Array.isArray(value) ? value : [value];

export class IntakeAccessoryDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/\S/, { message: "name must contain a non-whitespace character" })
  name!: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  conditionNote?: string | null;
}

export class CreateRepairOrderDto {
  @IsUUID()
  branchId!: string;

  @IsUUID()
  customerId!: string;

  @IsUUID()
  deviceId!: string;

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
  consentAcknowledged!: true;

  @IsOptional()
  @IsEnum(Priority)
  priority?: Priority;

  @IsOptional()
  @IsDateString({ strict: true })
  promisedAt?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => IntakeAccessoryDto)
  accessories?: IntakeAccessoryDto[];

  @Transform(normalizeUuidArray)
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  mediaAssetIds!: string[];
}

export class ListRepairOrdersQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  cursor?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;

  @Transform(toArray)
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(RepairOrderStatus, { each: true })
  status?: RepairOrderStatus[];

  @IsOptional()
  @IsUUID()
  branchId?: string;

  @IsOptional()
  @IsUUID()
  technicianUserId?: string;
}
