import { z } from "zod";

export const sourceReferenceSchema = z.object({
  artefactType: z.string(),
  artefactId: z.string(),
  label: z.string(),
  excerpt: z.string().optional(),
  location: z.string().optional()
});

export const requirementCandidateSchema = z.object({
  title: z.string().min(3),
  statement: z.string().min(10),
  type: z.enum(["business", "functional", "non_functional", "transition", "reporting", "data", "integration"]),
  priority: z.enum(["must", "should", "could", "wont"]),
  rationale: z.string().optional(),
  assumptions: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
  sourceReferences: z.array(sourceReferenceSchema).default([])
});

export const requirementExtractionSchema = z.object({
  summary: z.string(),
  candidates: z.array(requirementCandidateSchema),
  risks: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      impact: z.enum(["low", "medium", "high", "critical"]),
      sourceReferences: z.array(sourceReferenceSchema).default([])
    })
  ),
  decisions: z.array(
    z.object({
      decisionText: z.string(),
      rationale: z.string().optional(),
      decisionMaker: z.string().optional(),
      sourceReferences: z.array(sourceReferenceSchema).default([])
    })
  ),
  actions: z.array(
    z.object({
      title: z.string(),
      owner: z.string().optional(),
      dueDate: z.string().optional(),
      sourceReferences: z.array(sourceReferenceSchema).default([])
    })
  )
});

export const requirementQualityReviewSchema = z.object({
  requirementId: z.string(),
  overallScore: z.number().min(0).max(100),
  findings: z.array(
    z.object({
      dimension: z.enum(["clarity", "atomicity", "testability", "ambiguity", "completeness", "traceability", "business_value"]),
      severity: z.enum(["info", "minor", "major", "critical"]),
      finding: z.string(),
      recommendation: z.string()
    })
  ),
  rewrittenSuggestion: z.string().optional(),
  followUpQuestions: z.array(z.string()).default([])
});

export const userStoryGenerationSchema = z.object({
  stories: z.array(
    z.object({
      title: z.string(),
      asA: z.string(),
      iWant: z.string(),
      soThat: z.string(),
      acceptanceCriteria: z.array(z.string()).default([]),
      sourceRequirementIds: z.array(z.string()).default([])
    })
  )
});

export const testScenarioGenerationSchema = z.object({
  scenarios: z.array(
    z.object({
      title: z.string(),
      scenario: z.string(),
      coveredRequirementIds: z.array(z.string()).default([]),
      preconditions: z.array(z.string()).default([]),
      expectedOutcome: z.string()
    })
  )
});

export type RequirementExtraction = z.infer<typeof requirementExtractionSchema>;
export type RequirementQualityReview = z.infer<typeof requirementQualityReviewSchema>;
export type UserStoryGeneration = z.infer<typeof userStoryGenerationSchema>;
export type TestScenarioGeneration = z.infer<typeof testScenarioGenerationSchema>;
