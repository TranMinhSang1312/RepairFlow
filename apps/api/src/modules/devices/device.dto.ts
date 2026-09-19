import { Transform } from "class-transformer";
import { DeviceType } from "@prisma/client";
import { IsEnum, IsOptional, IsString, Matches, MaxLength, MinLength } from "class-validator";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

export class CreateDeviceDto {
  @IsEnum(DeviceType)
  type!: DeviceType;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  @Matches(/\S/, { message: "brand must contain a non-whitespace character" })
  brand!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(150)
  @Matches(/\S/, { message: "model must contain a non-whitespace character" })
  model!: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(50)
  color?: string | null;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  serial?: string | null;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(32)
  imei?: string | null;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  notes?: string | null;
}
