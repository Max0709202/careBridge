# Real-device field test

**Status: not run.** The instrumentation, the arithmetic and the protocol are
built. Executing it needs two physical phones, a car and a driver, and it is
the one Stage 3 acceptance item that cannot be satisfied from a keyboard.

Everything below is written so that the person who does run it produces a
result rather than an impression.

## Why it exists

Two claims in this system are currently *designed for* and not *measured*:

1. **Battery.** ADR-0005 says the decision is revisited if drain exceeds
   **25% over four hours**. The adaptive cadence in
   `apps/driver_app/lib/domain/location_cadence.dart` is an argument that it
   will not. An argument is not a measurement.
2. **Coverage.** The offline queue is designed to survive a dead zone. Whether
   real dead zones on real roads are shorter than the queue is a fact about
   the local network, not about the code.

A third thing is only learnable outdoors: whether Android actually keeps
delivering positions with the screen off, behind a navigation app, for half an
hour. Every emulator says yes.

## What the app records

Run the driver app with:

```bash
flutter run --release \
  --dart-define=CAREBRIDGE_FIELD_TEST=true \
  --dart-define=CAREBRIDGE_API_BASE_URL=https://staging.carebridge.example/api/v1
```

`FieldRecorder` then writes one row per fix, per cadence change, per flush —
success or failure — and a heartbeat every thirty seconds carrying the battery
level. Export is a CSV.

**The export carries no coordinates.** It is a record of how the app behaved,
not of where the driver went; a diagnostic file with a passenger's route in it
would have to be handled like a medical record. This is asserted in
`test/field_test_test.dart`.

`--release`, not debug. A debug build runs the Dart VM in JIT mode and its
battery figures are meaningless.

## Setup

| | |
| --- | --- |
| Devices | One Android (API 34+), one iPhone (iOS 17+). Both **mid-range**, not flagships — a flagship battery hides exactly the regression this test looks for. |
| Charge | Start at 90–100%. **Not on a charger.** A cradle charger invalidates the battery half entirely, and the arithmetic refuses to report a figure if it sees a charging reading. |
| Screen | Off, or a navigation app in front. That is how a driver actually holds a shift. |
| Environment | Staging, with fictional passengers. Never a real family's ride. |
| Duration | 90 minutes minimum. Below that the four-hour extrapolation is noise. |

## The route

Pick one that contains all four, and write down roughly where each begins:

1. **A dense urban stretch** — traffic lights, tall buildings, frequent stops.
   Exercises the stationary cadence and multipath GPS error.
2. **A tunnel or a multi-storey car park.** The dead zone the queue exists
   for. A hospital's underground car park is ideal, because it is where the
   product's trips actually end.
3. **A fast open road.** Exercises the moving cadence and the re-route rule.
4. **A five-minute stop with the engine off**, at a kerb. This is the
   `driverArrived` phase, and the one where the cadence should visibly slow.

## The script

1. Sign in as the seeded driver, start a shift.
2. Have a dispatcher assign a ride from the ops console.
3. Accept, then drive the route, moving the ride through its states at the
   points they would really happen.
4. Watch the **family app** on the second phone throughout. Somebody who is
   not driving does this.
5. Complete the ride. Export the CSV. Note the battery percentage by hand as
   well — a cross-check against what the app recorded.

## What is being watched, live

| Watch for | Where | Means |
| --- | --- | --- |
| Marker stops moving for more than two minutes | family app | Coverage failure. Note where. |
| "Position may be out of date" | family app | Expected in the tunnel; a problem anywhere else. |
| Foreground notification disappears | Android tray | The service was killed. This is the finding the whole test exists to catch. |
| ETA jumps backwards or sits at "1 minute" | family app | Routing or the decay rule. |
| Queue depth climbing outside the tunnel | driver app sharing card | Uploads failing for a reason other than coverage. |

## Pass or fail

Computed by `verdictFor`, not by judgement:

| | Threshold | Source |
| --- | --- | --- |
| Battery | ≤ 25% projected over four hours | ADR-0005's revisit trigger |
| Longest gap between fixes | ≤ 2 minutes | the tracking design's lost bound |
| Queue overflow | never | the queue is sized for six hours |

A run that passes two of three is a **fail with a known cause**, which is a
better outcome than a pass — it names what to change.

## Results

Fill in. One row per run; keep the failures.

| Date | Device | OS | Route | Duration | Fixes | Longest gap | Battery (4h projected) | Queue overflow | Verdict | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | | | | | | |

## If it fails

**Battery over threshold.** The cadence constants are in one file with the
reasoning beside each. Lengthening `_approaching` is the first lever and the
one that costs the most product value; raising the stationary threshold costs
nothing and should be tried first.

**Gaps longer than two minutes outside a tunnel.** Almost always the Android
foreground service being killed. Check `ACCESS_FINE_LOCATION` is granted rather
than coarse, and that battery optimisation is disabled for the app — some
manufacturers ignore the foreground service otherwise, which is itself a
finding worth recording against the device.

**Queue overflow.** The dead zone outlasted six hours, which means the device
was off rather than out of signal. Check the log for the gap in heartbeats.

## What this test does not cover

- **iOS backgrounded for a long clinic wait.** ADR-0005 names it as the
  specific case that would force the "Always" entitlement. It needs a
  three-hour appointment, not a drive.
- **Cost.** Routing spend per ride is measured from the vendor's console
  against `EtaService`'s call count, not from a car.
- **Multiple concurrent drivers.** The fan-out is a load test, and load tests
  belong on staging with synthetic clients.
