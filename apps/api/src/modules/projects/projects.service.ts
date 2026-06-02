import { Injectable } from "@nestjs/common";

export interface CreateProjectDto {
  name: string;
  problemStatement?: string;
  objectives?: string[];
}

interface ProjectRecord extends CreateProjectDto {
  id: string;
  status: "draft" | "active";
  createdAt: string;
}

@Injectable()
export class ProjectsService {
  private readonly projects: ProjectRecord[] = [
    {
      id: "project-demo-payments",
      name: "Payments modernisation",
      problemStatement: "Operational teams need a clearer exception handling process across channels.",
      objectives: ["Reduce manual rework", "Improve traceability", "Prepare Jira-ready delivery scope"],
      status: "active",
      createdAt: new Date().toISOString()
    }
  ];

  list() {
    return this.projects;
  }

  create(input: CreateProjectDto) {
    const project: ProjectRecord = {
      id: `project-${crypto.randomUUID()}`,
      name: input.name,
      problemStatement: input.problemStatement,
      objectives: input.objectives ?? [],
      status: "draft",
      createdAt: new Date().toISOString()
    };

    this.projects.push(project);
    return project;
  }

  getDashboard(projectId: string) {
    return {
      projectId,
      requirementCounts: {
        draft: 12,
        inReview: 7,
        approved: 21,
        baselined: 16
      },
      pendingApprovals: 5,
      aiDraftsAwaitingReview: 18,
      traceabilityCoveragePercent: 72,
      openRisks: 4,
      jiraSyncConflicts: 1
    };
  }
}
