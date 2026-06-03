import { z } from "zod";

export const sourceReferenceSchema = z.object({
  artefactType: z.string(),
  artefactId: z.string(),
  label: z.string(),
  excerpt: z.string().optional(),
  location: z.string().optional()
});

export const extractRequirementsJobInputSchema = z.object({
  sourceArtefactIds: z.array(z.string().min(1)).min(1).max(10),
  instructions: z.string().trim().min(1).max(4_000).optional()
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

const requirementCandidateEditsSchema = z
  .object({
    title: z.string().trim().min(3).max(300).optional(),
    statement: z.string().trim().min(10).max(10_000).optional(),
    type: z.enum(["business", "functional", "non_functional", "transition", "reporting", "data", "integration"]).optional(),
    priority: z.enum(["must", "should", "could", "wont"]).optional(),
    rationale: z.string().trim().min(1).max(4_000).nullable().optional()
  })
  .strict();

export const reviewRequirementCandidateInputSchema = z.discriminatedUnion("decision", [
  z
    .object({
      candidateIndex: z.number().int().min(0),
      decision: z.literal("accepted"),
      comments: z.string().trim().min(1).max(4_000).optional(),
      requirement: requirementCandidateEditsSchema.optional()
    })
    .strict(),
  z
    .object({
      candidateIndex: z.number().int().min(0),
      decision: z.literal("rejected"),
      comments: z.string().trim().min(1).max(4_000)
    })
    .strict()
]);

const structuredDocumentChunkReferenceSchema = z.object({
  artefactType: z.literal("document_chunk"),
  artefactId: z.string()
});

export const requirementExtractionStructuredOutputSchema = z.object({
  summary: z.string(),
  candidates: z.array(
    z.object({
      title: z.string(),
      statement: z.string(),
      type: z.enum(["business", "functional", "non_functional", "transition", "reporting", "data", "integration"]),
      priority: z.enum(["must", "should", "could", "wont"]),
      rationale: z.string().nullable(),
      assumptions: z.array(z.string()),
      openQuestions: z.array(z.string()),
      sourceReferences: z.array(structuredDocumentChunkReferenceSchema)
    })
  ),
  risks: z.array(
    z.object({
      title: z.string(),
      description: z.string(),
      impact: z.enum(["low", "medium", "high", "critical"]),
      sourceReferences: z.array(structuredDocumentChunkReferenceSchema)
    })
  ),
  decisions: z.array(
    z.object({
      decisionText: z.string(),
      rationale: z.string().nullable(),
      decisionMaker: z.string().nullable(),
      sourceReferences: z.array(structuredDocumentChunkReferenceSchema)
    })
  ),
  actions: z.array(
    z.object({
      title: z.string(),
      owner: z.string().nullable(),
      dueDate: z.string().nullable(),
      sourceReferences: z.array(structuredDocumentChunkReferenceSchema)
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
export type RequirementExtractionStructuredOutput = z.infer<typeof requirementExtractionStructuredOutputSchema>;
export type ExtractRequirementsJobInput = z.infer<typeof extractRequirementsJobInputSchema>;
export type ReviewRequirementCandidateInput = z.infer<typeof reviewRequirementCandidateInputSchema>;
export type RequirementQualityReview = z.infer<typeof requirementQualityReviewSchema>;
export type UserStoryGeneration = z.infer<typeof userStoryGenerationSchema>;
export type TestScenarioGeneration = z.infer<typeof testScenarioGenerationSchema>;
