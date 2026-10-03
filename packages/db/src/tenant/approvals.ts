/**
 * Approvals (ticket 31): a Property Manager's recorded consent for an action
 * beyond a role's limit. Until ticket 31 builds the request and consent flow,
 * every request is denied, so the actions that need one are refused.
 */
export interface ApprovalRequest {
  kind: "refund_over_limit";
  propertyId: string;
  requestedBy: string;
  amount: number;
  /** What the approval is for, e.g. the payment id. */
  subjectId: string;
}

export interface ApprovalDecision {
  granted: boolean;
  approvedBy: string | null;
}

// TODO(ticket 31): look up a granted Approval for this request
export async function approvalFor(request: ApprovalRequest): Promise<ApprovalDecision> {
  void request;
  return { granted: false, approvedBy: null };
}
