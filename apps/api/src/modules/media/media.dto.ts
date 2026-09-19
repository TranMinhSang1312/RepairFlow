import { Transform } from "class-transformer";
import { MediaPurpose } from "@prisma/client";
import {
  Equals,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

export class PresignIntakeMediaDto {
  @Equals(MediaPurpose.INTAKE)
  purpose!: MediaPurpose;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  originalName!: string;

  @Transform(trim)
  @IsString()
  mimeType!: string;

  @IsInt()
  @Min(1)
  byteSize!: number;

  @Transform(trim)
  @IsOptional()
  @IsString()
  @Matches(/^[a-fA-F0-9]{64}$/)
  checksumSha256?: string | null;
}
