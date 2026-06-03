import { Inject, Injectable } from "@nestjs/common";
import type { Prisma } from "@ba-workbench/database";
import { PrismaService } from "../database/prisma.service";
import { WorkspaceContextService } from "../database/workspace-context.service";

@Injectable()
export class DemoService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(WorkspaceContextService) private readonly workspaceContext: WorkspaceContextService
  ) {}

  async bootstrap() {
    const owner = await this.workspaceContext.getOwner();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

    return this.prisma.$transaction(async (transaction) => {
      const project = await transaction.project.create({
        data: {
          organisationId: owner.organisationId,
          ownerId: owner.id,
          name: `Payments modernisation demo ${timestamp}`,
          problemStatement: "Payment exceptions require too much manual analysis and weak traceability.",
          objectives: ["Reduce payment exception rework", "Improve approval evidence", "Prepare UAT scenarios"] as Prisma.InputJsonValue,
          status: "active",
          members: {
            create: {
              userId: owner.id,
              role: "owner"
            }
          }
        }
      });

      const document = await transaction.document.create({
        data: {
          projectId: project.id,
          name: "Payments discovery notes",
          documentType: "text/markdown",
          storageUri: `native://documents/demo-${project.id}`,
          sourceText:
            "Operations needs clearer payment exception reasons. Stakeholders need monthly reporting before UAT begins.",
          extractionStatus: "completed",
          embeddingStatus: "skipped",
          extractedAt: new Date()
        }
      });

      const chunk = await transaction.documentChunk.create({
        data: {
          documentId: document.id,
          chunkIndex: 0,
          chunkText:
            "Operations needs clearer payment exception reasons. Stakeholders need monthly reporting before UAT begins.",
          metadata: {
            startOffset: 0,
            endOffset: 99,
            characterCount: 99
          } as Prisma.InputJsonValue
        }
      });

      const sourceReference = {
        artefactType: "document_chunk",
        artefactId: chunk.id,
        label: document.name,
        excerpt: chunk.chunkText,
        location: "Characters 1-99"
      };

      const aiJob = await transaction.aiJob.create({
        data: {
          projectId: project.id,
          jobType: "extract_requirements",
          status: "completed",
          input: {
            sourceArtefactIds: [document.id],
            instructions: "Demo requirement extraction"
          } as Prisma.InputJsonValue,
          startedAt: new Date(),
          completedAt: new Date()
        }
      });

      const aiDraft = await transaction.aiDraftOutput.create({
        data: {
          projectId: project.id,
          aiJobId: aiJob.id,
          outputType: "requirement_extraction",
          reviewStatus: "generated",
          promptVersion: "demo",
          model: "demo-seed",
          sourceRefs: [sourceReference] as Prisma.InputJsonValue,
          payload: {
            summary: "Payments operations needs clearer exception handling and stakeholder reporting.",
            candidates: [
              {
                title: "Capture payment exception reason",
                statement: "The system must capture a standardised payment exception reason when validation fails.",
                type: "functional",
                priority: "must",
                rationale: "Operations needs consistent reporting and faster exception triage.",
                assumptions: ["Payment validation failures are already detected by the payment platform."],
                openQuestions: ["Which exception reason codes should be available at launch?"],
                sourceReferences: [sourceReference]
              },
              {
                title: "Provide monthly payment exception reporting",
                statement: "The system should provide monthly reporting of payment exception trends for stakeholders.",
                type: "reporting",
                priority: "should",
                rationale: "Stakeholders need evidence before UAT and operational readiness decisions.",
                assumptions: [],
                openQuestions: ["Which stakeholder group owns the monthly report sign-off?"],
                sourceReferences: [sourceReference]
              }
            ],
            risks: [],
            decisions: [],
            actions: []
          } as Prisma.InputJsonValue
        }
      });

      await transaction.auditEvent.create({
        data: {
          projectId: project.id,
          actorId: owner.id,
          actorType: "system",
          action: "demo.bootstrap_created",
          artefactType: "project",
          artefactId: project.id,
          summary: "Created demo project, source document, and AI requirement draft."
        }
      });

      return {
        project,
        document,
        aiJob,
        aiDraft
      };
    });
  }
}
