import type { Job } from "bullmq";

interface ConfluenceSyncJob {
  connectionId: string;
  projectId: string;
  publishMode: "create_new" | "update_existing" | "create_draft";
  artefactIds: string[];
}

export async function handleConfluenceSyncJob(job: Job<ConfluenceSyncJob>) {
  return {
    ...job.data,
    status: "processor_contract_registered",
    publishPolicy: "explicit_user_confirmation_required"
  };
}
