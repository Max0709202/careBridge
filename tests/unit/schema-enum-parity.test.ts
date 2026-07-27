import { describe, expect, it } from "vitest";

import { ASSIGNMENT_STATUSES } from "@/modules/assignments/domain/status";
import { ROLES } from "@/modules/auth/domain/roles";
import { SERVICE_REQUEST_STATUSES } from "@/modules/service-requests/domain/status";
import { appRole, assignmentStatus, serviceRequestStatus } from "@/server/db/schema/enums";

/**
 * The database enums reuse the domain arrays via a type cast (see
 * schema/_shared.ts `enumValues`). This guards against the runtime values
 * silently drifting from the domain unions the business rules trust.
 */
describe("database enums match the domain unions", () => {
  it("app_role === ROLES", () => {
    expect(appRole.enumValues).toEqual([...ROLES]);
  });

  it("service_request_status === SERVICE_REQUEST_STATUSES", () => {
    expect(serviceRequestStatus.enumValues).toEqual([...SERVICE_REQUEST_STATUSES]);
  });

  it("assignment_status === ASSIGNMENT_STATUSES", () => {
    expect(assignmentStatus.enumValues).toEqual([...ASSIGNMENT_STATUSES]);
  });
});
