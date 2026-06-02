import type { Job } from "bullmq";

interface JiraSyncJob {
  connectionId: string;
  projectId: string;
  mode: "push" | "pull" | "bidirectional";
}

export async function handleJiraSyncJob(job: Job<JiraSyncJob>) {
  return {
    ...job.data,
    status: "processor_contract_registered",
    conflictPolicy: "never_overwrite_without_user_review"
  };
}
