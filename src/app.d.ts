import "svelte-clerk/env";

import type { AppSession } from "./lib/auth/session";
import type { User } from "./lib/db/users";
import type { CloudflareBindings } from "./platform";

declare global {
  namespace App {
    interface Locals {
      session: AppSession | null;
      user: User | null;
      userId: string | null;
    }
    interface Platform {
      cf: CfProperties;
      ctx: ExecutionContext;
      env: CloudflareBindings;
    }
  }
}

