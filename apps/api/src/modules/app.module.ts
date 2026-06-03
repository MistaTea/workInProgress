import { Module } from "@nestjs/common";
import { AiModule } from "./ai/ai.module";
import { DatabaseModule } from "./database/database.module";
import { DocumentsModule } from "./documents/documents.module";
import { HealthController } from "./health/health.controller";
import { ProjectsModule } from "./projects/projects.module";
import { RequirementsModule } from "./requirements/requirements.module";
import { ReviewsModule } from "./reviews/reviews.module";
import { TraceabilityModule } from "./traceability/traceability.module";

@Module({
  imports: [DatabaseModule, ProjectsModule, DocumentsModule, RequirementsModule, AiModule, ReviewsModule, TraceabilityModule],
  controllers: [HealthController]
})
export class AppModule {}
