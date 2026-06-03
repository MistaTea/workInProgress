import { Controller, Inject, Post } from "@nestjs/common";
import { DemoService } from "./demo.service";

@Controller("demo")
export class DemoController {
  constructor(@Inject(DemoService) private readonly demo: DemoService) {}

  @Post("bootstrap")
  bootstrap() {
    return this.demo.bootstrap();
  }
}
