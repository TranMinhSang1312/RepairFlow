import { Transform } from "class-transformer";
import { IsDateString, IsInt, IsOptional, IsString, Max, Min } from "class-validator";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

export class ListAuditLogsQueryDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  action?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  entityType?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  actorUserId?: string;

  @Transform(trim)
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 50;
}
