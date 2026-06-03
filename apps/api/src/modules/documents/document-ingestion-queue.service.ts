import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { type ConnectionOptions, Queue } from "bullmq";

export interface DocumentIngestionJob {
  documentId: string;
  projectId: string;
}

function createRedisConnection(): ConnectionOptions {
  const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";
  const parsedRedisUrl = new URL(redisUrl);

  return {
    host: parsedRedisUrl.hostname,
    port: Number(parsedRedisUrl.port || "6379"),
    db: Number(parsedRedisUrl.pathname.slice(1) || "0"),
    ...(parsedRedisUrl.username ? { username: decodeURIComponent(parsedRedisUrl.username) } : {}),
    ...(parsedRedisUrl.password ? { password: decodeURIComponent(parsedRedisUrl.password) } : {}),
    ...(parsedRedisUrl.protocol === "rediss:" ? { tls: {} } : {})
  };
}

@Injectable()
export class DocumentIngestionQueueService implements OnModuleDestroy {
  private readonly queue = new Queue<DocumentIngestionJob>("document-ingestion", {
    connection: createRedisConnection()
  });

  async enqueue(job: DocumentIngestionJob) {
    await this.queue.add("ingest-document", job, {
      removeOnComplete: 100,
      removeOnFail: 500
    });
  }

  async onModuleDestroy() {
    await this.queue.close();
  }
}
