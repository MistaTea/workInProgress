import type { Job } from "bullmq";

interface AiJobPayload {
  aiJobId: string;
  projectId: string;
  jobType: string;
  sourceArtefactIds: string[];
}

export async function handleAiJob(job: Job<AiJobPayload>) {
  const { aiJobId, projectId, jobType, sourceArtefactIds } = job.data;

  // Step 3 will replace this contract response with retrieval, OpenAI calls, schema validation, and draft persistence.
  return {
    aiJobId,
    projectId,
    jobType,
    sourceArtefactIds,
    status: "processor_contract_registered"
  };
}
