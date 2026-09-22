import { Transform } from "class-transformer";
import { IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from "class-validator";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

export class CreateDiagnosisDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  @Matches(/\S/, { message: "finding must contain a non-whitespace character" })
  finding!: string;

  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  @Matches(/\S/, { message: "recommendation must contain a non-whitespace character" })
  recommendation!: string;

  @IsOptional()
  @IsUUID()
  supersedesId?: string | null;
}
