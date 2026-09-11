# Store listings

One source for both stores, so that the answers cannot drift apart. They are
checked against each other: Apple's privacy nutrition label and Play's Data
safety form ask the same questions in different words, and an app whose two
answers disagree is the app that gets asked why.

Everything here is derived from [`../privacy/data-map.md`](../privacy/data-map.md)
and the iOS privacy manifests (`ios/Runner/PrivacyInfo.xcprivacy` and
`apps/driver_app/ios/Runner/PrivacyInfo.xcprivacy`). If one of them changes,
this file is wrong until it changes too.

> **Status: ready to fill, not filled.** The copy below is written and usable.
> The screenshots and the two URLs are not, because they need a deployed
> environment and a marketing site. They are marked **TBD** rather than
> guessed, because a placeholder URL in a submitted form is a rejection with a
> week's turnaround.

---

## The two listings

| | CareBridge | CareBridge Driver |
| --- | --- | --- |
| Bundle / application id | `com.carebridge.family` | `com.carebridge.driver` |
| Audience | Adult children coordinating an older relative's care | Drivers working for a transport operator |
| Category (Apple) | Medical → *secondary*: Health & Fitness | Business |
| Category (Play) | Medical | Business |
| Price | Free to download; subscription inside | Free; issued by an operator |

The driver app is **not** a consumer product and its listing should not read
like one. It is downloaded by someone who has been told to download it. Say
so in the description — a store reviewer who thinks it is a consumer ride app
will test it as one, find an empty shift, and reject it.

---

## CareBridge — the family app

**Subtitle (Apple, 30 chars):** `Appointments, rides, arrival`

**Short description (Play, 80 chars):**
`Coordinate an older relative's medical appointments and the rides that get them there.`

**Description:**

> CareBridge is for the person who keeps track of a parent's medical
> appointments from another city.
>
> Book the appointment and the transport in one place. See the car on its way.
> Know they arrived.
>
> **Everyone who should know, knows.** Add a sibling, a neighbour or a paid
> carer to the care circle and they see the same schedule you do. Notifications
> go to everyone with access, not only to whoever tapped the button.
>
> **You can see where they are.** While a ride is under way, the map shows the
> car and an arrival time that counts down. If the position stops updating,
> the app says so — a stale reading is never shown as a current one.
>
> **A round trip is two journeys**, each tracked and priced separately, so a
> long wait at a clinic is not a car sitting on a meter.
>
> **Accessibility is a requirement, not a filter.** A journey booked for a
> wheelchair cannot be assigned to a vehicle that cannot carry one.
>
> CareBridge coordinates appointments and transport. It is not a medical
> service, it does not hold medical records, and it is not for emergencies —
> in an emergency, call your local emergency number.

That last paragraph stays. It is the difference between a Medical-category app
that is reviewed as a coordination tool and one reviewed as a medical device.

**Keywords (Apple, 100 chars):**
`elderly care,caregiver,medical appointment,transport,ride,family,senior,tracking,carer`

---

## CareBridge Driver

**Subtitle (Apple):** `Your shift, one tap at a time`

**Description:**

> CareBridge Driver is for drivers working for a transport operator that uses
> CareBridge. Your operator provides your account — you cannot sign up here.
>
> Today's jobs in the order you will do them. Each one moves one tap at a
> time: on the way, arrived, picked up, at the clinic, done.
>
> While a job is running, the app shares your position with the family of the
> passenger you are carrying, so they can see the car approaching and know
> their relative arrived. It stops when the job stops.
>
> It keeps working through a dead zone — positions are queued and sent when
> signal returns — and it backs off its sampling rate as your battery falls,
> because a driver whose phone dies at four o'clock is a driver with no app.

---

## Apple — App Privacy ("nutrition label")

Answer **Yes** to data collection for both apps. Nothing is used for tracking;
nothing is used for advertising; no data broker is involved.

### CareBridge (family)

| Data | Linked to the user | Used for tracking | Purpose |
| --- | --- | --- | --- |
| Email address | Yes | No | App Functionality |
| Name | Yes | No | App Functionality |
| Phone number | Yes | No | App Functionality |
| Physical address | Yes | No | App Functionality |
| Health | Yes | No | App Functionality |
| Sensitive info | Yes | No | App Functionality |
| Payment info | Yes | No | App Functionality |
| User ID | Yes | No | App Functionality |

**Health** and **Sensitive info** are declared deliberately. CareBridge holds
no diagnosis, no medication and no date of birth — but it holds an appointment
type and the clinic it is at, which a reasonable person reads as health
information, and it holds mobility needs, which is disability information.
Declaring them is cheaper than arguing about them on a review thread, and it is
the truthful answer.

**Payment info** is declared even though no card number reaches the app: the
app holds a processor token and the card sheet belongs to the processor
(ADR-0006). A form of payment on file is still payment information.

### CareBridge Driver

| Data | Linked to the user | Used for tracking | Purpose |
| --- | --- | --- | --- |
| Precise location | Yes | No | App Functionality |
| Email address | Yes | No | App Functionality |
| Name | Yes | No | App Functionality |
| Phone number | Yes | No | App Functionality |
| Photos or videos | Yes | No | App Functionality |
| User ID | Yes | No | App Functionality |

**Precise location** — collected only while a ride is under way. The tracking
window is enforced on the server, on the write path as well as the read path,
so it is not a claim about client behaviour.

**Photos or videos** — licence and insurance documents, uploaded for approval
into a private bucket where every view link is audited (ADR-0012).

---

## Google Play — Data safety

Same facts, Play's vocabulary. **Data is encrypted in transit: yes. Users can
request deletion: yes** — and that answer requires ADR-0013 to be implemented
first, so this form cannot be truthfully submitted before it is.

| Category | Type | Collected | Shared | Optional | Purpose |
| --- | --- | --- | --- | --- | --- |
| Personal info | Name, email, phone, address | Yes | No | Required | App functionality, Account management |
| Financial info | Payment info (family app) | Yes | No | Required for a paid plan | App functionality |
| Health and fitness | Health info | Yes | No | Required | App functionality |
| Location | Precise location (driver app) | Yes | Yes — with the family on the ride | Required | App functionality |
| Photos and videos | Photos (driver app) | Yes | No | Required for approval | App functionality |
| App activity | In-app actions | Yes | No | Required | App functionality |

**"Shared" for driver location is Yes and that is the honest answer.** The
driver's position is shown to the family of the passenger they are carrying.
It is not shared with any third party, and saying "No" because no vendor
receives it would be reading the question the way that suits us.

### Foreground service declaration (driver app)

Play requires a justification for each foreground service type.

> **Type:** `location`.
> The app reports the driver's position to the family tracking the ride the
> driver is currently on, so they can see the vehicle approaching and know
> their relative arrived. The service runs only while a ride is under way and
> posts a notification that says so for the entire time it runs. The app does
> not request `ACCESS_BACKGROUND_LOCATION` and does not collect location
> outside an active ride.

---

## Content rating and age

| | Family app | Driver app |
| --- | --- | --- |
| Apple age rating | 4+ | 4+ |
| Play content rating (IARC) | Everyone | Everyone |

No user-generated content shared between strangers, no ads, no gambling, no
purchases of digital goods beyond the subscription. The caregiver marketplace
would change this answer — reviews between users are user-generated content —
which is one more reason it stays flagged off until there is a reason to turn
it on.

---

## Notes for the reviewer

Paste into App Review Notes and Play's "Instructions for review". This section
prevents more rejections than every other section combined.

> **Family app**
>
> Demo account: `TBD@carebridge.example` / `TBD`
>
> The account has a patient with an upcoming cardiology appointment and a
> booked round trip. From the dashboard, tap the ride, then "Follow the trip"
> to see the live map.
>
> The app coordinates medical appointments and transport. It stores no medical
> records, offers no medical advice, and is not an emergency service.
>
> **Driver app**
>
> Demo account: `TBD@meridiantransit.example` / `TBD`
>
> This app is issued to drivers by a transport operator; there is no public
> sign-up, which is why the sign-in screen has no register link.
>
> The account has an active shift with a job already assigned, so the job
> screen is populated on first launch.
>
> **On the location permission:** tap the assigned job and then "On the way".
> Location is requested at that point, not at launch, and a notification
> appears saying the position is being shared. End the job and the sharing
> stops. The position is shared only with the family of the passenger on that
> ride, and the server refuses a position sent outside a ride's tracking
> window. The app does not request background location on Android.

**The demo accounts must exist, be seeded with a ride, and keep working.** A
reviewer who signs in to an empty account rejects the app as non-functional,
and that is the most common rejection for a product in this shape. The seed
(`apps/api/prisma/seed.ts`) already builds exactly this family; what is missing
is a durable reviewer account on the production environment that the seed does
not reset out from under them.

---

## Graphics

| Asset | Requirement | Status |
| --- | --- | --- |
| App icon | 1024×1024, no alpha, no transparency | **Done** — generated for both apps |
| iPhone screenshots | 6.9" and 6.5", 3–10 each | **TBD** — needs a populated staging build |
| iPad screenshots | Required only if the listing claims iPad support | **TBD** — decide whether to claim it |
| Play feature graphic | 1024×500 | **TBD** |
| Play phone screenshots | 2–8, min 320px | **TBD** |
| Privacy policy URL | Public, reachable, required by both | **TBD** |
| Account deletion URL | Public, required by Play | **TBD** — blocked on ADR-0013 |

Screenshots should be taken against seeded data, not an empty account, and
should not contain a real person's name or address. The demo family is
fictional for exactly this reason.
