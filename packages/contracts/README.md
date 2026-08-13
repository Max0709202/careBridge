# `@carebridge/contracts`

`openapi.json` is **generated**, never hand-written.

```
make openapi        # regenerate from the NestJS decorators
make dart-client    # regenerate, then rebuild packages/dart/carebridge_api
make contract-drift # fail if the committed document is stale
```

It is committed rather than built on demand for two reasons: a reviewer can see
an API change in the diff of a pull request, and the Dart client generator does
not need a running database to produce a client.

`make contract-drift` runs in CI. A pull request that changes a controller or a
DTO without regenerating this file fails there, which is the only reliable way
to stop the contract and the implementation drifting apart.
