import { MembershipRole, MembershipStatus } from "@prisma/client";
import { Transform, Type } from "class-transformer";
import {
  IsEmail,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from "class-validator";

const trim = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim() : value;

export class ListStaffMembershipsQueryDto {
  @Transform(trim)
  @IsOptional()
  @IsString()
  @MaxLength(100)
  query?: string;

  @IsOptional()
  @IsEnum(MembershipRole)
  role?: MembershipRole;

  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;

  @Transform(trim)
  @IsOptional()
  @IsString()
  cursor?: string;

  @Type(() => Number)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 30;
}

export class CreateStaffInvitationDto {
  @Transform(trim)
  @IsEmail()
  @MaxLength(254)
  email!: string;

  @IsEnum(MembershipRole)
  role!: MembershipRole;
}

export class VersionedInvitationDto {
  @IsInt()
  @Min(0)
  expectedLockVersion!: number;
}

export class UpdateStaffMembershipDto {
  @IsOptional()
  @IsEnum(MembershipRole)
  role?: MembershipRole;

  @IsOptional()
  @IsEnum(MembershipStatus)
  status?: MembershipStatus;

  @IsInt()
  @Min(0)
  expectedLockVersion!: number;
}

export class AcceptNewStaffInvitationDto {
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  displayName!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password!: string;
}
