export type ArtefactType =
  | "project"
  | "requirement"
  | "requirement_baseline"
  | "stakeholder"
  | "workshop"
  | "document"
  | "epic"
  | "feature"
  | "user_story"
  | "acceptance_criteria"
  | "test_scenario"
  | "risk"
  | "decision"
  | "traceability_link"
  | "ai_draft_output";

export type RequirementType = "business" | "functional" | "non_functional" | "transition" | "reporting" | "data" | "integration";

export type RequirementStatus =
  | "draft"
  | "in_review"
  | "approved"
  | "baselined"
  | "change_requested"
  | "rejected"
  | "superseded";

export type AiReviewStatus =
  | "generated"
  | "under_ba_review"
  | "accepted_by_ba"
  | "rejected_by_ba"
  | "sent_to_stakeholder"
  | "approved_by_stakeholder"
  | "published"
  | "superseded";

export type ApprovalDecision = "approved" | "changes_requested" | "rejected";

export type TraceabilityLinkType =
  | "satisfies"
  | "decomposes_to"
  | "validated_by"
  | "depends_on"
  | "impacts"
  | "derived_from"
  | "mitigates"
  | "decided_by"
  | "implemented_by"
  | "tests";

export interface SourceReference {
  artefactType: ArtefactType | "document_chunk" | "external";
  artefactId: string;
  label: string;
  excerpt?: string;
  location?: string;
}

export interface RequirementSummary {
  id: string;
  reference: string;
  title: string;
  statement: string;
  type: RequirementType;
  status: RequirementStatus;
  priority: "must" | "should" | "could" | "wont";
  qualityScore?: number;
  sourceReferences: SourceReference[];
}

export interface AuditActor {
  id: string;
  type: "user" | "stakeholder_link" | "system" | "ai";
  displayName: string;
}
