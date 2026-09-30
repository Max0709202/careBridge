/**
 * Out-of-band administration, run on the server by whoever operates it.
 *
 *   node dist/scripts/admin.js <command> [--flag value …]
 *
 * These are the grants the API deliberately has no endpoint for. Creating a
 * transport operator, making somebody its owner and promoting a platform
 * administrator are each the most valuable thing an attacker could find a flaw
 * in; keeping them to a shell on the host means the attack surface is SSH.
 *
 * Every grant names an **existing, verified** account: the person signs up in
 * the family app like anybody else, proves their address, and is then given
 * standing here. Nothing is created on anybody's behalf, and no password ever
 * passes through this script.
 *
 * Each change is written to the audit log with no actor (the operator of the
 * host) and a `cli:` correlation id, so "who made Dana an owner" has an answer.
 */
import { randomUUID } from 'node:crypto';

import { PrismaClient, type OrgRole, type PlatformRole } from '@prisma/client';

const prisma = new PrismaClient();

const ORG_ROLES: OrgRole[] = ['owner', 'admin', 'dispatcher', 'member'];
const PLATFORM_ROLES: PlatformRole[] = ['none', 'support', 'admin'];

type Flags = Record<string, string>;

const COMMANDS: Record<string, { usage: string; run: (flags: Flags) => Promise<void> }> = {
  'create-org': {
    usage:
      'create-org --name "Acme Transit" --slug acme-transit --contact-email ops@acme.com --owner dana@acme.com [--phone +1…] [--time-zone America/New_York]',
    run: createOrg,
  },
  'add-member': {
    usage: 'add-member --org acme-transit --email sam@acme.com --role owner|admin|dispatcher|member',
    run: addMember,
  },
  'revoke-member': {
    usage: 'revoke-member --org acme-transit --email sam@acme.com',
    run: revokeMember,
  },
  'set-platform-role': {
    usage: 'set-platform-role --email you@example.com --role none|support|admin',
    run: setPlatformRole,
  },
  'list-orgs': { usage: 'list-orgs', run: listOrgs },
  account: { usage: 'account --email someone@example.com', run: showAccount },
};

async function createOrg(flags: Flags): Promise<void> {
  const name = required(flags, 'name');
  const slug = required(flags, 'slug').toLowerCase();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    fail('--slug must be lower-case letters, digits and single hyphens, e.g. acme-transit');
  }
  const contactEmail = required(flags, 'contact-email').toLowerCase();
  const owner = await verifiedAccount(required(flags, 'owner'));
  const timeZone = flags['time-zone'] ?? 'America/New_York';
  if (!isTimeZone(timeZone)) fail(`--time-zone ${timeZone} is not an IANA zone`);

  if (await prisma.organization.findUnique({ where: { slug } })) {
    fail(`An organization with slug "${slug}" already exists.`);
  }

  const correlationId = `cli:${randomUUID()}`;
  const org = await prisma.$transaction(async (tx) => {
    const created = await tx.organization.create({
      data: {
        kind: 'dispatchCompany',
        name,
        slug,
        contactEmail,
        phone: flags.phone ?? null,
        timeZone,
      },
    });
    await tx.organizationMembership.create({
      data: { userId: owner.id, organizationId: created.id, role: 'owner' },
    });
    await tx.auditLog.createMany({
      data: [
        { action: 'admin.organization_created', entityType: 'Organization', entityId: created.id, correlationId, changedFields: [] },
        { action: 'admin.membership_granted', entityType: 'User', entityId: owner.id, correlationId, changedFields: ['role:owner', `organization:${created.id}`] },
      ],
    });
    return created;
  });

  console.log(`Created ${org.name} (${org.slug}), owned by ${owner.email}.`);
  console.log('They can now sign in to the ops console, add vehicles and drivers, and dispatch.');
}

async function addMember(flags: Flags): Promise<void> {
  const org = await organization(required(flags, 'org'));
  const user = await verifiedAccount(required(flags, 'email'));
  const role = oneOf(required(flags, 'role'), ORG_ROLES, '--role');

  await prisma.$transaction(async (tx) => {
    await tx.organizationMembership.upsert({
      where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
      update: { role, revokedAt: null },
      create: { userId: user.id, organizationId: org.id, role },
    });
    await tx.auditLog.create({
      data: {
        action: 'admin.membership_granted',
        entityType: 'User',
        entityId: user.id,
        correlationId: `cli:${randomUUID()}`,
        changedFields: [`role:${role}`, `organization:${org.id}`],
      },
    });
  });
  console.log(`${user.email} is now ${role} at ${org.name}.`);
}

async function revokeMember(flags: Flags): Promise<void> {
  const org = await organization(required(flags, 'org'));
  const email = required(flags, 'email').toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) fail(`No account for ${email}.`);

  const membership = await prisma.organizationMembership.findUnique({
    where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
  });
  if (!membership || membership.revokedAt) fail(`${email} is not a current member of ${org.name}.`);

  await prisma.$transaction([
    // Revoked, not deleted: who could see the queue last month is an answer an
    // investigation needs.
    prisma.organizationMembership.update({
      where: { id: membership.id },
      data: { revokedAt: new Date() },
    }),
    prisma.auditLog.create({
      data: {
        action: 'admin.membership_revoked',
        entityType: 'User',
        entityId: user.id,
        correlationId: `cli:${randomUUID()}`,
        changedFields: [`organization:${org.id}`],
      },
    }),
  ]);
  console.log(`Revoked ${email} from ${org.name}. Their current console session ends at its next request.`);
}

async function setPlatformRole(flags: Flags): Promise<void> {
  const role = oneOf(required(flags, 'role'), PLATFORM_ROLES, '--role');
  // Demoting needs no verified address; promoting does.
  const user =
    role === 'none'
      ? await existingAccount(required(flags, 'email'))
      : await verifiedAccount(required(flags, 'email'));

  await prisma.$transaction([
    prisma.user.update({
      where: { id: user.id },
      // A role change is a change in standing: every token minted before it
      // stops working, so a demoted administrator is not still one for the
      // life of their access token.
      data: { platformRole: role, tokenVersion: { increment: 1 } },
    }),
    prisma.auditLog.create({
      data: {
        action: 'admin.platform_role_changed',
        entityType: 'User',
        entityId: user.id,
        correlationId: `cli:${randomUUID()}`,
        changedFields: [`platformRole:${role}`],
      },
    }),
  ]);
  console.log(`${user.email} now has platform role "${role}". They need to sign in again.`);
  if (role !== 'none') {
    console.log('Platform staff must turn on two-factor authentication (Settings → Security) before the admin screens open.');
  }
}

async function listOrgs(): Promise<void> {
  const orgs = await prisma.organization.findMany({
    orderBy: { createdAt: 'asc' },
    include: {
      memberships: { where: { revokedAt: null }, include: { user: { select: { email: true } } } },
      _count: { select: { drivers: true, vehicles: true } },
    },
  });
  if (orgs.length === 0) {
    console.log('No organizations yet. Create one with: create-org …');
    return;
  }
  for (const org of orgs) {
    console.log(`${org.slug}  ${org.name}${org.archivedAt ? '  (archived)' : ''}`);
    console.log(`  ${org._count.vehicles} vehicle(s), ${org._count.drivers} driver(s)`);
    for (const m of org.memberships) console.log(`  ${m.role.padEnd(10)} ${m.user.email}`);
  }
}

async function showAccount(flags: Flags): Promise<void> {
  const user = await existingAccount(required(flags, 'email'));
  const detail = await prisma.user.findUniqueOrThrow({
    where: { id: user.id },
    include: {
      memberships: { where: { revokedAt: null }, include: { organization: true } },
      driverProfile: { include: { organization: true } },
      mfaEnrolment: { select: { confirmedAt: true } },
    },
  });
  console.log(`${detail.email}  ${detail.fullName}`);
  console.log(`  email verified: ${detail.emailVerifiedAt ? detail.emailVerifiedAt.toISOString() : 'no'}`);
  console.log(`  two-factor:     ${detail.mfaEnrolment?.confirmedAt ? 'on' : 'off'}`);
  console.log(`  platform role:  ${detail.platformRole}`);
  for (const m of detail.memberships) console.log(`  ${m.role} at ${m.organization.name} (${m.organization.slug})`);
  if (detail.driverProfile) {
    console.log(`  driver at ${detail.driverProfile.organization.name}, status ${detail.driverProfile.status}`);
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

async function existingAccount(email: string) {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || user.isTombstone) {
    fail(`No account for ${email}. They sign up in the family app first.`);
  }
  return user;
}

async function verifiedAccount(email: string) {
  const user = await existingAccount(email);
  // The same rule the API applies to every invitation and access grant: an
  // unproven address is not somebody we give standing to.
  if (!user.emailVerifiedAt) {
    fail(`${user.email} has not verified their email address yet. Ask them to click the link we sent.`);
  }
  if (user.deletionRequestedAt) fail(`${user.email} has asked for their account to be deleted.`);
  return user;
}

async function organization(slug: string) {
  const org = await prisma.organization.findUnique({ where: { slug: slug.toLowerCase() } });
  if (!org) fail(`No organization with slug "${slug}". See: list-orgs`);
  return org;
}

function oneOf<T extends string>(value: string, allowed: readonly T[], flag: string): T {
  if (!(allowed as readonly string[]).includes(value)) {
    fail(`${flag} must be one of: ${allowed.join(', ')}`);
  }
  return value as T;
}

function required(flags: Flags, name: string): string {
  const value = flags[name]?.trim();
  if (!value) fail(`--${name} is required`);
  return value;
}

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch {
    return false;
  }
}

class UsageError extends Error {}

function fail(message: string): never {
  throw new UsageError(message);
}

function parseFlags(args: string[]): Flags {
  const flags: Flags = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) fail(`Unexpected argument: ${arg}`);
    const [key, inline] = arg.slice(2).split(/=(.*)/s, 2);
    if (inline !== undefined) {
      flags[key!] = inline;
    } else {
      const next = args[i + 1];
      if (next === undefined || next.startsWith('--')) fail(`--${key} needs a value`);
      flags[key!] = next;
      i++;
    }
  }
  return flags;
}

function printUsage(): void {
  console.log('CareBridge administration\n');
  for (const { usage } of Object.values(COMMANDS)) console.log(`  ${usage}`);
}

async function main(): Promise<void> {
  const [name, ...rest] = process.argv.slice(2);
  const command = name ? COMMANDS[name] : undefined;
  if (!command) {
    printUsage();
    process.exitCode = name && name !== 'help' ? 2 : 0;
    return;
  }
  await command.run(parseFlags(rest));
}

main()
  .catch((error: unknown) => {
    if (error instanceof UsageError) {
      console.error(error.message);
      process.exitCode = 1;
    } else {
      console.error(error);
      process.exitCode = 1;
    }
  })
  .finally(() => prisma.$disconnect());
