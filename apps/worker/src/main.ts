import { Worker } from "bullmq";
import IORedis from "ioredis";
import { handleAiJob } from "./processors/ai-job.processor";
import { handleConfluenceSyncJob } from "./processors/confluence-sync.processor";
import { handleDocumentIngestionJob } from "./processors/document-ingestion.processor";
import { handleJiraSyncJob } from "./processors/jira-sync.processor";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const connection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null
});

const queueHandlers = {
  "document-ingestion": handleDocumentIngestionJob,
  "ai-jobs": handleAiJob,
  "jira-sync": handleJiraSyncJob,
  "confluence-sync": handleConfluenceSyncJob
};

for (const [queueName, processor] of Object.entries(queueHandlers)) {
  const worker = new Worker(queueName, processor, { connection });

  worker.on("completed", (job) => {
    console.info(`[${queueName}] completed ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[${queueName}] failed ${job?.id}: ${error.message}`);
  });
}

console.info("BA Workbench worker started.");
