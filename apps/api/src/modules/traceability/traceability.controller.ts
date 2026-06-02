import { Body, Controller, Get, Param, Post } from "@nestjs/common";
import { CreateTraceabilityLinkDto, TraceabilityService } from "./traceability.service";

@Controller()
export class TraceabilityController {
  constructor(private readonly traceability: TraceabilityService) {}

  @Get("projects/:projectId/traceability")
  getMatrix(@Param("projectId") projectId: string) {
    return this.traceability.getMatrix(projectId);
  }

  @Post("traceability-links")
  createLink(@Body() body: CreateTraceabilityLinkDto) {
    return this.traceability.createLink(body);
  }
}
