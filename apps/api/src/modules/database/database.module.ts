import { Global, Module } from "@nestjs/common";
import { PrismaService } from "./prisma.service";
import { WorkspaceContextService } from "./workspace-context.service";

@Global()
@Module({
  providers: [PrismaService, WorkspaceContextService],
  exports: [PrismaService, WorkspaceContextService]
})
export class DatabaseModule {}
