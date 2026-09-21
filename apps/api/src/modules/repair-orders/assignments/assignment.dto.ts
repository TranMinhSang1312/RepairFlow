import { Transform } from "class-transformer";
import { IsUUID } from "class-validator";

const normalizeUuid = ({ value }: { value: unknown }): unknown =>
  typeof value === "string" ? value.trim().toLowerCase() : value;

export class AssignTechnicianDto {
  @Transform(normalizeUuid)
  @IsUUID()
  technicianUserId!: string;
}
