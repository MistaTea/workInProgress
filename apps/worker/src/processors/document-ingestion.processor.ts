import type { Job } from "bullmq";

interface DocumentIngestionJob {
  documentId: string;
  projectId: string;
  storageUri: string;
  documentType: string;
}

export async function handleDocumentIngestionJob(job: Job<DocumentIngestionJob>) {
  const { documentId, projectId, storageUri, documentType } = job.data;

  // Step 2 will replace this contract response with extraction, chunking, embeddings, and persistence.
  return {
    documentId,
    projectId,
    storageUri,
    documentType,
    status: "processor_contract_registered"
  };
}
