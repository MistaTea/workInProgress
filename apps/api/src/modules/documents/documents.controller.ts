import { Body, Controller, Get, Inject, Param, Post } from "@nestjs/common";
import { DocumentSearchService, type SearchDocumentsDto } from "./document-search.service";
import { CreateDocumentDto, DocumentsService } from "./documents.service";

@Controller()
export class DocumentsController {
  constructor(
    @Inject(DocumentsService) private readonly documentsService: DocumentsService,
    @Inject(DocumentSearchService) private readonly documentSearchService: DocumentSearchService
  ) {}

  @Get("projects/:projectId/documents")
  listProjectDocuments(@Param("projectId") projectId: string) {
    return this.documentsService.listByProject(projectId);
  }

  @Post("projects/:projectId/documents")
  createDocument(@Param("projectId") projectId: string, @Body() body: CreateDocumentDto) {
    return this.documentsService.create(projectId, body);
  }

  @Post("projects/:projectId/documents/search")
  searchDocuments(@Param("projectId") projectId: string, @Body() body: SearchDocumentsDto) {
    return this.documentSearchService.search(projectId, body);
  }

  @Get("documents/:documentId")
  getDocument(@Param("documentId") documentId: string) {
    return this.documentsService.get(documentId);
  }

  @Post("documents/:documentId/ingest")
  reingestDocument(@Param("documentId") documentId: string) {
    return this.documentsService.reingest(documentId);
  }
}
