import { Module } from "@nestjs/common";
import { DocumentIngestionQueueService } from "./document-ingestion-queue.service";
import { DocumentsController } from "./documents.controller";
import { DocumentsService } from "./documents.service";

@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentIngestionQueueService],
  exports: [DocumentsService]
})
export class DocumentsModule {}
