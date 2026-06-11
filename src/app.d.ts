import type { CloudflareBindings } from "./platform";

declare global {
  namespace App {
    interface Platform {
      cf: CfProperties;
      ctx: ExecutionContext;
      env: CloudflareBindings;
    }
  }
}

export {};
