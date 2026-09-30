import { IsIn, IsUUID } from "class-validator";

import { CHECKLIST_SUGGESTION_PHASES, type ChecklistSuggestionPhase } from "@repairflow/contracts";

export class CreateChecklistSuggestionDto {
  @IsUUID("4")
  repairOrderId!: string;

  @IsUUID("4")
  qcTemplateId!: string;

  @IsIn(CHECKLIST_SUGGESTION_PHASES)
  phase!: ChecklistSuggestionPhase;
}
