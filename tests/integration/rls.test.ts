import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDb, type TestDb } from "./harness";

/**
 * Row Level Security ownership boundaries, verified against real Postgres
 * (pglite) as the `authenticated` / `anon` roles — the same path a request
 * through the Supabase data API would take. This is the database-level
 * defence-in-depth behind the server authz layer.
 *
 * Scenario:
 *   - ops (operations admin)
 *   - family A: account A, senior A, request A (has an assignment to caregiver)
 *   - family B: account B, senior B, request B (no assignment)
 *   - caregiver: assigned to request A only
 *   - an internal note on request A
 */

let t: TestDb;

const ids = {
  ops: "",
  familyA: "",
  familyB: "",
  caregiverUser: "",
  accountA: "",
  accountB: "",
  seniorA: "",
  seniorB: "",
  requestA: "",
  requestB: "",
  caregiverProfile: "",
};

beforeAll(async () => {
  t = await createTestDb();

  ids.ops = await t.seedAuthUser({ email: "ops@carebridge.test", role: "OPERATIONS_ADMIN" });
  ids.familyA = await t.seedAuthUser({
    email: "a.family@example.test",
    role: "FAMILY",
    accountName: "Family A",
  });
  ids.familyB = await t.seedAuthUser({
    email: "b.family@example.test",
    role: "FAMILY",
    accountName: "Family B",
  });
  ids.caregiverUser = await t.seedAuthUser({
    email: "cg@example.test",
    role: "CAREGIVER",
    displayName: "Sam",
  });

  const [accA] = await t.asSuper<{ id: string }>(
    "select id from public.family_accounts where created_by = $1",
    [ids.familyA],
  );
  const [accB] = await t.asSuper<{ id: string }>(
    "select id from public.family_accounts where created_by = $1",
    [ids.familyB],
  );
  const [cgp] = await t.asSuper<{ id: string }>(
    "select id from public.caregiver_profiles where user_id = $1",
    [ids.caregiverUser],
  );
  ids.accountA = accA!.id;
  ids.accountB = accB!.id;
  ids.caregiverProfile = cgp!.id;

  const [seniorA] = await t.asSuper<{ id: string }>(
    `insert into public.senior_profiles (family_account_id, preferred_name, created_by)
     values ($1, 'Eleanor', $2) returning id`,
    [ids.accountA, ids.familyA],
  );
  const [seniorB] = await t.asSuper<{ id: string }>(
    `insert into public.senior_profiles (family_account_id, preferred_name, created_by)
     values ($1, 'Frank', $2) returning id`,
    [ids.accountB, ids.familyB],
  );
  ids.seniorA = seniorA!.id;
  ids.seniorB = seniorB!.id;

  const [reqA] = await t.asSuper<{ id: string }>(
    `insert into public.service_requests (family_account_id, senior_profile_id, status, created_by)
     values ($1, $2, 'CAREGIVER_ASSIGNED', $3) returning id`,
    [ids.accountA, ids.seniorA, ids.familyA],
  );
  const [reqB] = await t.asSuper<{ id: string }>(
    `insert into public.service_requests (family_account_id, senior_profile_id, status, created_by)
     values ($1, $2, 'SUBMITTED', $3) returning id`,
    [ids.accountB, ids.seniorB, ids.familyB],
  );
  ids.requestA = reqA!.id;
  ids.requestB = reqB!.id;

  // Assign the caregiver to request A only.
  await t.asSuper(
    `insert into public.caregiver_assignments (service_request_id, caregiver_profile_id, status, assigned_by)
     values ($1, $2, 'OFFERED', $3)`,
    [ids.requestA, ids.caregiverProfile, ids.ops],
  );

  // An internal note on request A.
  await t.asSuper(
    `insert into public.internal_notes (service_request_id, author_id, body)
     values ($1, $2, 'ops-only note')`,
    [ids.requestA, ids.ops],
  );
});

afterAll(async () => {
  await t?.close();
});

describe("family isolation", () => {
  it("a family sees its own request", async () => {
    const rows = await t.asUser(
      ids.familyA,
      "select id from public.service_requests where id = $1",
      [ids.requestA],
    );
    expect(rows).toHaveLength(1);
  });

  it("a family cannot read another family's request", async () => {
    const rows = await t.asUser(
      ids.familyA,
      "select id from public.service_requests where id = $1",
      [ids.requestB],
    );
    expect(rows).toHaveLength(0);
  });

  it("a family cannot read another family's senior profile", async () => {
    const rows = await t.asUser(
      ids.familyB,
      "select id from public.senior_profiles where id = $1",
      [ids.seniorA],
    );
    expect(rows).toHaveLength(0);
  });

  it("a family cannot update another family's request", async () => {
    const rows = await t.asUser(
      ids.familyB,
      "update public.service_requests set notes = 'tampered' where id = $1 returning id",
      [ids.requestA],
    );
    expect(rows).toHaveLength(0);
  });

  it("a family can update its own request", async () => {
    const rows = await t.asUser(
      ids.familyA,
      "update public.service_requests set notes = 'ok' where id = $1 returning id",
      [ids.requestA],
    );
    expect(rows).toHaveLength(1);
  });
});

describe("caregiver isolation", () => {
  it("sees a request they are assigned to", async () => {
    const rows = await t.asUser(
      ids.caregiverUser,
      "select id from public.service_requests where id = $1",
      [ids.requestA],
    );
    expect(rows).toHaveLength(1);
  });

  it("cannot see a request they are not assigned to", async () => {
    const rows = await t.asUser(
      ids.caregiverUser,
      "select id from public.service_requests where id = $1",
      [ids.requestB],
    );
    expect(rows).toHaveLength(0);
  });

  it("can read the senior for an assigned request, but not others", async () => {
    const seen = await t.asUser(
      ids.caregiverUser,
      "select id from public.senior_profiles where id = $1",
      [ids.seniorA],
    );
    const unseen = await t.asUser(
      ids.caregiverUser,
      "select id from public.senior_profiles where id = $1",
      [ids.seniorB],
    );
    expect(seen).toHaveLength(1);
    expect(unseen).toHaveLength(0);
  });

  it("cannot read internal operations notes", async () => {
    const rows = await t.asUser(
      ids.caregiverUser,
      "select id from public.internal_notes where service_request_id = $1",
      [ids.requestA],
    );
    expect(rows).toHaveLength(0);
  });
});

describe("internal notes are operations-only", () => {
  it("the owning family cannot read them", async () => {
    const rows = await t.asUser(
      ids.familyA,
      "select id from public.internal_notes where service_request_id = $1",
      [ids.requestA],
    );
    expect(rows).toHaveLength(0);
  });

  it("operations can read them", async () => {
    const rows = await t.asUser(
      ids.ops,
      "select id from public.internal_notes where service_request_id = $1",
      [ids.requestA],
    );
    expect(rows).toHaveLength(1);
  });
});

describe("assignment is operations-only", () => {
  it("a caregiver cannot assign themselves to a request", async () => {
    await expect(
      t.asUser(
        ids.caregiverUser,
        `insert into public.caregiver_assignments (service_request_id, caregiver_profile_id, status, assigned_by)
         values ($1, $2, 'OFFERED', $3)`,
        [ids.requestB, ids.caregiverProfile, ids.caregiverUser],
      ),
    ).rejects.toThrow();
  });

  it("a family cannot create an assignment", async () => {
    await expect(
      t.asUser(
        ids.familyB,
        `insert into public.caregiver_assignments (service_request_id, caregiver_profile_id, status, assigned_by)
         values ($1, $2, 'OFFERED', $3)`,
        [ids.requestB, ids.caregiverProfile, ids.familyB],
      ),
    ).rejects.toThrow();
  });

  it("operations can create an assignment", async () => {
    const rows = await t.asUser(
      ids.ops,
      `insert into public.caregiver_assignments (service_request_id, caregiver_profile_id, status, assigned_by)
       values ($1, $2, 'OFFERED', $3) returning id`,
      [ids.requestB, ids.caregiverProfile, ids.ops],
    );
    expect(rows).toHaveLength(1);
  });
});

describe("audit trail visibility", () => {
  beforeAll(async () => {
    await t.asSuper(
      `insert into public.audit_events (actor_id, action, entity_type, entity_id, metadata)
       values ($1, 'service_request.created', 'service_request', $2, '{"status":"SUBMITTED"}'::jsonb)`,
      [ids.familyA, ids.requestA],
    );
  });

  it("is not readable by families", async () => {
    const rows = await t.asUser(ids.familyA, "select id from public.audit_events");
    expect(rows).toHaveLength(0);
  });

  it("is readable by operations", async () => {
    const rows = await t.asUser(ids.ops, "select id from public.audit_events");
    expect(rows.length).toBeGreaterThanOrEqual(1);
  });

  it("cannot be modified through the data API, even by operations", async () => {
    // No UPDATE/DELETE policy exists, so RLS matches zero rows: the write is a
    // no-op rather than an error. Either way, nothing is mutated.
    const updated = await t.asUser(
      ids.ops,
      "update public.audit_events set action = 'tampered' returning id",
    );
    expect(updated).toHaveLength(0);

    const deleted = await t.asUser(ids.ops, "delete from public.audit_events returning id");
    expect(deleted).toHaveLength(0);
  });
});

describe("anonymous access", () => {
  it("sees no senior profiles", async () => {
    const rows = await t.asAnon("select id from public.senior_profiles");
    expect(rows).toHaveLength(0);
  });

  it("sees no service requests", async () => {
    const rows = await t.asAnon("select id from public.service_requests");
    expect(rows).toHaveLength(0);
  });
});

describe("signup trigger does not trust client metadata for role", () => {
  it("ignores a role smuggled in user_metadata and defaults to FAMILY", async () => {
    // No app_metadata role; a malicious user_metadata role must be ignored.
    const [row] = await t.asSuper<{ id: string }>(
      `insert into auth.users (email, raw_app_meta_data, raw_user_meta_data)
       values ('sneaky@example.test', '{}'::jsonb, '{"role":"OPERATIONS_ADMIN"}'::jsonb)
       returning id`,
    );
    const [profile] = await t.asSuper<{ role: string }>(
      "select role from public.users where id = $1",
      [row!.id],
    );
    expect(profile!.role).toBe("FAMILY");
  });
});
