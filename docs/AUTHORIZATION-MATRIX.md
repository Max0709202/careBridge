# Authorization matrix

The authoritative statement of who may do what. `server/authz` implements this;
PostgreSQL Row Level Security enforces it a second time; tests assert it.

Legend: **✅** allowed · **❌** denied · **⚠️** allowed but restricted (see notes)

Every ✅ below is additionally conditioned on **ownership** — the row must
belong to the caller's family account, or be assigned to that caregiver. Role
alone never grants access.

---

## Roles

| Role               | Scope                                                       |
| ------------------ | ----------------------------------------------------------- |
| `FAMILY`           | One family account: its seniors, requests, and payments      |
| `CAREGIVER`        | Only assignments offered to or accepted by them              |
| `OPERATIONS_ADMIN` | All requests and assignments, for coordination               |

A user has **exactly one** role. There is no hierarchy and no inheritance.

---

## Resources

| Resource                | Action           | FAMILY | CAREGIVER | OPERATIONS_ADMIN | Notes                                                     |
| ----------------------- | ---------------- | :----: | :-------: | :--------------: | --------------------------------------------------------- |
| **Family account**      | create           |   ✅   |    ❌     |        ✅        | Created on family registration                             |
|                         | read             |   ⚠️   |    ❌     |        ✅        | Own account only                                           |
|                         | update           |   ⚠️   |    ❌     |        ✅        | Own account only                                           |
|                         | invite member    |   ⚠️   |    ❌     |        ✅        | Own account only                                           |
| **Senior profile**      | create           |   ✅   |    ❌     |        ✅        | Audited                                                    |
|                         | read             |   ⚠️   |    ⚠️     |        ✅        | Family: own account. Caregiver: only via an active assignment, limited fields |
|                         | update           |   ⚠️   |    ❌     |        ✅        | Own account only. Audited                                  |
|                         | delete           |   ⚠️   |    ❌     |        ✅        | Own account only. Audited                                  |
| **Service request**     | create           |   ✅   |    ❌     |        ✅        | Audited                                                    |
|                         | read             |   ⚠️   |    ⚠️     |        ✅        | Caregiver sees only requests they are assigned to           |
|                         | update details   |   ⚠️   |    ❌     |        ✅        | Family: only while `DRAFT` or `SUBMITTED`                   |
|                         | submit           |   ⚠️   |    ❌     |        ✅        | `DRAFT → SUBMITTED`                                         |
|                         | review           |   ❌   |    ❌     |        ✅        | `SUBMITTED → UNDER_REVIEW`                                  |
|                         | confirm          |   ❌   |    ❌     |        ✅        | `UNDER_REVIEW → CONFIRMED`                                  |
|                         | cancel           |   ⚠️   |    ❌     |        ✅        | Family: only before `IN_PROGRESS`                           |
|                         | complete         |   ❌   |    ❌     |        ✅        | `IN_PROGRESS → COMPLETED`                                   |
| **Ride details**        | read             |   ⚠️   |    ⚠️     |        ✅        | Caregiver: only for their assignment                        |
|                         | create / update  |   ❌   |    ❌     |        ✅        | Entered manually by operations                              |
| **Caregiver profile**   | read             |   ❌   |    ⚠️     |        ✅        | Caregiver: own profile only                                 |
|                         | update           |   ❌   |    ⚠️     |        ✅        | Caregiver: own profile only                                 |
|                         | verify / activate|   ❌   |    ❌     |        ✅        | Audited                                                     |
| **Caregiver availability**| read           |   ❌   |    ⚠️     |        ✅        | Caregiver: own only                                         |
|                         | create / update  |   ❌   |    ⚠️     |        ✅        | Caregiver: own only                                         |
| **Assignment**          | create (assign)  |   ❌   |    ❌     |        ✅        | **Operations only.** Manual. Audited                        |
|                         | read             |   ⚠️   |    ⚠️     |        ✅        | Family: on own requests. Caregiver: own assignments          |
|                         | accept / reject  |   ❌   |    ⚠️     |        ❌        | **Only the assigned caregiver.** Operations may not accept on their behalf |
|                         | reassign         |   ❌   |    ❌     |        ✅        | Audited                                                     |
|                         | cancel           |   ❌   |    ❌     |        ✅        | Audited                                                     |
| **Check-in / check-out**| create           |   ❌   |    ⚠️     |        ✅        | Caregiver: own assignment only. Audited                     |
|                         | read             |   ⚠️   |    ⚠️     |        ✅        | Family: on own requests                                     |
| **Task checklist**      | read             |   ⚠️   |    ⚠️     |        ✅        | Caregiver: own assignment only                              |
|                         | complete item    |   ❌   |    ⚠️     |        ✅        | Caregiver: own assignment only                              |
| **Incident report**     | create           |   ❌   |    ✅     |        ✅        | Audited                                                     |
|                         | read             |   ❌   |    ⚠️     |        ✅        | Caregiver: only incidents they filed                        |
|                         | update status    |   ❌   |    ❌     |        ✅        | Audited                                                     |
| **Internal notes**      | create           |   ❌   |    ❌     |        ✅        | **Operations only**                                         |
|                         | read             |   ❌   |    ❌     |        ✅        | **Never visible to families or caregivers**                 |
| **Consent record**      | create / update  |   ⚠️   |    ❌     |        ✅        | Own account only. Audited                                   |
|                         | read             |   ⚠️   |    ❌     |        ✅        | Own account only                                            |
| **Payment record**      | read             |   ⚠️   |    ❌     |        ✅        | Own account only                                            |
|                         | create checkout  |   ⚠️   |    ❌     |        ✅        | Own requests only                                           |
|                         | update state     |   ❌   |    ❌     |        ⚠️        | Normally written only by the verified webhook handler       |
| **Notification event**  | read             |   ❌   |    ❌     |        ✅        |                                                             |
| **Audit event**         | read             |   ❌   |    ❌     |        ✅        | Audit viewer                                                |
|                         | create           |   ❌   |    ❌     |        ❌        | Written by the system only                                  |
|                         | update / delete  |   ❌   |    ❌     |        ❌        | **Never.** Audit records are append-only                    |

---

## Rules behind the table

1. **Role plus ownership, always.** `OPERATIONS_ADMIN` is the only role whose
   access is not additionally narrowed by ownership.
2. **Only operations assign caregivers.** There is no automatic matching in the
   MVP, by design.
3. **Only the assigned caregiver may accept or reject.** Operations can cancel
   or reassign, but cannot answer on someone's behalf — the record of who
   agreed to a visit must mean something.
4. **Internal notes never leave operations.** They live in their own table with
   their own RLS policy, so a query mistake cannot expose them.
5. **Caregivers see assignments, not requests.** Queries start from the
   assignment, never from the request, so an unassigned request is not
   reachable at all.
6. **Audit is append-only.** No role can update or delete an audit event through
   the application.
7. **Payment state comes from verified webhooks**, not from the client, and not
   from the browser's success redirect.

---

## Verification

| Check                                              | Where                                       | Status |
| -------------------------------------------------- | ------------------------------------------- | ------ |
| Role permission per status transition               | `tests/unit/service-request-status.test.ts` | ✅     |
| Role permission per assignment transition           | `tests/unit/assignment-status.test.ts`      | ✅     |
| Pure authz predicates (wrong family/caregiver/admin)| `tests/unit/authz-policy.test.ts`           | ✅     |
| Family cannot read another family's records (RLS)   | `tests/integration/rls.test.ts`             | ✅     |
| Caregiver cannot read an unassigned request (RLS)   | `tests/integration/rls.test.ts`             | ✅     |
| Caregiver cannot read internal notes (RLS)          | `tests/integration/rls.test.ts`             | ✅     |
| Non-admin cannot assign a caregiver (RLS)           | `tests/integration/rls.test.ts`             | ✅     |
| Anonymous sees nothing (RLS)                        | `tests/integration/rls.test.ts`             | ✅     |
| Audit trail is append-only and ops-read-only (RLS)  | `tests/integration/rls.test.ts`             | ✅     |
| Signup cannot self-assign a role via user_metadata  | `tests/integration/rls.test.ts`             | ✅     |
| App-layer ownership checks per feature action       | Phases 3–5 (as features land)               | ⬜     |
