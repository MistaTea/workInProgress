import { Injectable, NotFoundException } from "@nestjs/common";
import type { Project, User } from "@ba-workbench/database";
import { PrismaService } from "./prisma.service";

interface ProjectAccess {
  owner: User;
  project: Project;
}

@Injectable()
export class WorkspaceContextService {
  constructor(private readonly prisma: PrismaService) {}

  async getOwner(): Promise<User> {
    const email = process.env.DEFAULT_OWNER_EMAIL ?? "owner@ba-workbench.local";
    const displayName = process.env.DEFAULT_OWNER_NAME ?? "Senior Business Analyst";
    const organisationName = process.env.DEFAULT_ORGANISATION_NAME ?? "My BA Workspace";

    return this.prisma.user.upsert({
      where: { email },
      update: {
        displayName,
        status: "active"
      },
      create: {
        email,
        displayName,
        role: "owner",
        organisation: {
          create: {
            name: organisationName
          }
        }
      }
    });
  }

  async assertProjectAccess(projectId: string): Promise<ProjectAccess> {
    const owner = await this.getOwner();
    const project = await this.prisma.project.findFirst({
      where: {
        id: projectId,
        organisationId: owner.organisationId
      }
    });

    if (!project) {
      throw new NotFoundException(`Project ${projectId} was not found.`);
    }

    return { owner, project };
  }
}
