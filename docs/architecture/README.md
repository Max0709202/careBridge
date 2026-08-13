# Architecture documentation

| Document | Answers |
| -------- | ------- |
| [system-overview.md](system-overview.md) | What the pieces are and why each was chosen |
| [container-diagram.md](container-diagram.md) | What runs where, and what talks to what |
| [domain-model.md](domain-model.md) | The entities, and the relationships that carry authorisation |
| [data-flow.md](data-flow.md) | How a request, a transition and a notification actually move |
| [security-model.md](security-model.md) | Authentication, authorisation, audit, encryption |
| [multi-tenancy.md](multi-tenancy.md) | How organisations work, and what we deferred |
| [realtime-tracking.md](realtime-tracking.md) | The Stage 3 design, and its P0 security surface |
| [deployment.md](deployment.md) | Environments, pipeline, rollback |
| [disaster-recovery.md](disaster-recovery.md) | Backups, RPO/RTO, and the rehearsal that makes them real |

Decisions with alternatives considered live in [../adr/](../adr/). These
documents describe the system; the ADRs record why it is that system.
