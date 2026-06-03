import { type ConnectionOptions, type Processor, Worker } from "bullmq";
import { handleAiJob } from "./processors/ai-job.processor";
import { handleConfluenceSyncJob } from "./processors/confluence-sync.processor";
import { handleDocumentIngestionJob } from "./processors/document-ingestion.processor";
import { handleJiraSyncJob } from "./processors/jira-sync.processor";

const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
const parsedRedisUrl = new URL(redisUrl);
const connection: ConnectionOptions = {
  host: parsedRedisUrl.hostname,
  port: Number(parsedRedisUrl.port || "6379"),
  db: Number(parsedRedisUrl.pathname.slice(1) || "0"),
  maxRetriesPerRequest: null,
  ...(parsedRedisUrl.username ? { username: decodeURIComponent(parsedRedisUrl.username) } : {}),
  ...(parsedRedisUrl.password ? { password: decodeURIComponent(parsedRedisUrl.password) } : {}),
  ...(parsedRedisUrl.protocol === "rediss:" ? { tls: {} } : {})
};

function registerWorker<DataType>(queueName: string, processor: Processor<DataType>) {
  const worker = new Worker<DataType>(queueName, processor, { connection });

  worker.on("completed", (job) => {
    console.info(`[${queueName}] completed ${job.id}`);
  });

  worker.on("failed", (job, error) => {
    console.error(`[${queueName}] failed ${job?.id}: ${error.message}`);
  });
}

registerWorker("document-ingestion", handleDocumentIngestionJob);
registerWorker("ai-jobs", handleAiJob);
registerWorker("jira-sync", handleJiraSyncJob);
registerWorker("confluence-sync", handleConfluenceSyncJob);

console.info("BA Workbench worker started.");
