export interface TechnicianSummaryView {
  userId: string;
  displayName: string;
}

export interface TechnicianListResponse {
  data: TechnicianSummaryView[];
}

export interface AssignmentView {
  id: string;
  repairOrderId: string;
  technicianUserId: string;
  technicianDisplayName: string;
  assignedByUserId: string;
  assignedAt: string;
  unassignedAt: string | null;
}

export interface AssignmentResponse {
  data: AssignmentView;
}

export interface AssignmentRecord {
  id: string;
  repairOrderId: string;
  technicianUserId: string;
  assignedByUserId: string;
  assignedAt: Date;
  unassignedAt: Date | null;
  technician: { user: { displayName: string } };
}

export function toAssignmentView(assignment: AssignmentRecord): AssignmentView {
  return {
    id: assignment.id,
    repairOrderId: assignment.repairOrderId,
    technicianUserId: assignment.technicianUserId,
    technicianDisplayName: assignment.technician.user.displayName,
    assignedByUserId: assignment.assignedByUserId,
    assignedAt: assignment.assignedAt.toISOString(),
    unassignedAt: assignment.unassignedAt?.toISOString() ?? null,
  };
}
