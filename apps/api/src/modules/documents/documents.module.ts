import { Module } from "@nestjs/common";
import { DocumentIngestionQueueService } from "./document-ingestion-queue.service";
import { DocumentSearchService, OpenAiQueryEmbeddingService } from "./document-search.service";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentIngestionQueueService, DocumentSearchService, OpenAiQueryEmbeddingService],
  exports: [DocumentsService, DocumentSearchService]
})
export class DocumentsModule {}
