import { z } from "zod";

import { getConfig } from "../../config/loader.js";
import { desktopControlLease } from "../../desktop/desktop-control-lease.js";
import { isVirtualDesktopEnabled } from "../../desktop/virtual-desktop-feature.js";
import { GATEWAY_PRINCIPALS } from "../auth/route-policy.js";
import { NotFoundError } from "./errors.js";
import type { RouteDefinition } from "./types.js";

const request = z.object({ action: z.enum(["take", "allow"]) });
const status = z.object({ state: z.enum(["idle", "assistant", "human"]) });

export const ROUTES: RouteDefinition[] = ["GET", "POST"].map((method) => ({
  operationId:
    method === "GET" ? "desktop_control_status" : "desktop_control_update",
  endpoint: "desktop/control",
  method,
  policy: { requiredScopes: [], allowedPrincipalTypes: GATEWAY_PRINCIPALS },
  ...(method === "POST" ? { requestBody: request } : {}),
  handler: ({ body }) => {
    if (!isVirtualDesktopEnabled(getConfig())) {
      throw new NotFoundError(
        "Virtual desktop control is available only on enabled platform-hosted assistants",
      );
    }
    if (method === "GET") {
      return desktopControlLease.getStatus();
    }
    return request.parse(body).action === "take"
      ? desktopControlLease.takeControl()
      : desktopControlLease.allowAssistant();
  },
  summary:
    method === "GET"
      ? "Get virtual desktop control status"
      : "Hand virtual desktop control between the user and assistant",
  tags: ["desktop"],
  responseBody: status,
}));
