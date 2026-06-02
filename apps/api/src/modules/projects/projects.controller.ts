import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CreateProjectDto, ProjectsService } from "./projects.service";

@Controller("projects")
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  listProjects() {
    return this.projectsService.list();
  }

  @Post()
  createProject(@Body() body: CreateProjectDto) {
    return this.projectsService.create(body);
  }

  @Get(":projectId/dashboard")
  getDashboard(@Param("projectId") projectId: string) {
    return this.projectsService.getDashboard(projectId);
  }
}
