import { Body, Controller, Get, Inject, Param, Patch, Post } from "@nestjs/common";
import { CreateRequirementDto, RequirementsService, UpdateRequirementDto } from "./requirements.service";

@Controller()
export class RequirementsController {
  constructor(@Inject(RequirementsService) private readonly requirementsService: RequirementsService) {}

  @Get("projects/:projectId/requirements")
  listProjectRequirements(@Param("projectId") projectId: string) {
    return this.requirementsService.listByProject(projectId);
  }

  @Post("projects/:projectId/requirements")
  createRequirement(@Param("projectId") projectId: string, @Body() body: CreateRequirementDto) {
    return this.requirementsService.create(projectId, body);
  }

  @Get("requirements/:requirementId")
  getRequirement(@Param("requirementId") requirementId: string) {
    return this.requirementsService.get(requirementId);
  }

  @Patch("requirements/:requirementId")
  updateRequirement(@Param("requirementId") requirementId: string, @Body() body: UpdateRequirementDto) {
    return this.requirementsService.update(requirementId, body);
  }
}
