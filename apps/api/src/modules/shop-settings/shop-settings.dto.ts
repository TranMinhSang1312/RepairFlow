import { Transform } from "class-transformer";
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

export class UpdateShopSettingsDto {
  @IsInt()
  @Min(0)
  expectedLockVersion!: number;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  timezone?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(30)
  contactPhone?: string | null;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Matches(/^[A-Z0-9]{1,8}$/)
  orderCodePrefix?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  intakePhotoMinimum?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(720)
  defaultQuoteExpiryHours?: number;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  defaultWarrantyTerms?: string | null;
}

export class CreateBranchDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name!: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;
}

export class UpdateBranchDto {
  @IsInt()
  @Min(0)
  expectedLockVersion!: number;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  name?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
