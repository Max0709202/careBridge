import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../core/formatting.dart';
import '../../domain/permissions.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

class PatientDetailScreen extends ConsumerWidget {
  const PatientDetailScreen({required this.patientId, super.key});

  final String patientId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(careProvider);
    final patient = state.patientById(patientId);
    final theme = Theme.of(context);

    // This screen shows a phone number, a home address and the notes a driver
    // uses to find someone's front door. It opens only against a live grant —
    // a revoked one closes it as surely as never having had one.
    if (patient == null || !state.canView(patientId)) {
      return Scaffold(
        appBar: AppBar(),
        body: const EmptyState(
          icon: Icons.search_off,
          title: 'Not available',
          message: 'We could not find that, or you do not have access to it.',
        ),
      );
    }

    final access = state.access[patientId];
    final canEdit = state.can(patientId, FamilyPermission.manageAccess);

    return Scaffold(
      appBar: AppBar(
        title: Text(patient.preferredName),
        actions: [
          // Hidden rather than shown-and-refused: offering a control that the
          // rules will reject teaches people the app is unreliable. The rule
          // itself lives in `upsertPatient`; this only stops us asking.
          if (canEdit)
            IconButton(
              icon: const Icon(Icons.edit_outlined),
              tooltip: 'Edit profile',
              onPressed: () => context.push('/patients/$patientId/edit'),
            ),
        ],
      ),
      body: SingleChildScrollView(
        child: ScreenBody(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        CircleAvatar(
                          radius: 28,
                          backgroundColor: theme.colorScheme.primaryContainer,
                          child: Text(
                            patient.firstInitial,
                            style: theme.textTheme.headlineSmall?.copyWith(
                              color: theme.colorScheme.onPrimaryContainer,
                            ),
                          ),
                        ),
                        const SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                patient.preferredName,
                                style: theme.textTheme.headlineSmall,
                              ),
                              if (patient.legalName != null)
                                Text(
                                  'Legal name: ${patient.legalName}',
                                  style: theme.textTheme.bodySmall?.copyWith(
                                    color: theme.colorScheme.onSurfaceVariant,
                                  ),
                                ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const Divider(height: AppSpacing.lg),
                    InfoRow(
                      icon: Icons.phone_outlined,
                      label: 'Phone',
                      value: patient.phone,
                    ),
                    InfoRow(
                      icon: Icons.home_outlined,
                      label: 'Pickup address',
                      value: patient.homeAddress.singleLine,
                    ),
                    if (patient.homeAddress.accessNotes != null)
                      InfoRow(
                        icon: Icons.info_outline,
                        label: 'How to find them',
                        value: patient.homeAddress.accessNotes!,
                      ),
                    if (patient.ageBand != null)
                      InfoRow(
                        icon: Icons.cake_outlined,
                        label: 'Age range',
                        value: patient.ageBand!.label,
                      ),
                    InfoRow(
                      icon: Icons.translate,
                      label: 'Preferred language',
                      value: patient.preferredLanguage,
                    ),
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.lg),
              const SectionHeader('Getting about'),
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    if (patient.mobilityNeeds.isEmpty)
                      Text(
                        'No mobility needs recorded.',
                        style: theme.textTheme.bodyMedium?.copyWith(
                          color: theme.colorScheme.onSurfaceVariant,
                        ),
                      )
                    else
                      Wrap(
                        spacing: AppSpacing.sm,
                        runSpacing: AppSpacing.sm,
                        children: [
                          for (final need in patient.mobilityNeeds)
                            Chip(
                              avatar: Icon(
                                need.constrainsVehicle
                                    ? Icons.directions_car_outlined
                                    : Icons.volunteer_activism_outlined,
                                size: 18,
                              ),
                              label: Text(need.label),
                            ),
                        ],
                      ),
                    if (patient.mobilityNotes != null) ...[
                      const SizedBox(height: AppSpacing.sm),
                      Text(
                        patient.mobilityNotes!,
                        style: theme.textTheme.bodyMedium,
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.lg),
              const SectionHeader('Emergency contacts'),
              if (patient.emergencyContacts.isEmpty)
                AppCard(
                  child: Text(
                    'No emergency contact recorded. Add one so a driver or '
                    'dispatcher knows who to call.',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                )
              else
                for (final contact in patient.emergencyContacts)
                  Padding(
                    padding: const EdgeInsets.only(bottom: AppSpacing.sm),
                    child: AppCard(
                      child: Row(
                        children: [
                          Icon(
                            contact.isPrimary
                                ? Icons.star
                                : Icons.person_outline,
                            color: theme.colorScheme.primary,
                          ),
                          const SizedBox(width: AppSpacing.md),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  contact.name,
                                  style: theme.textTheme.bodyLarge,
                                ),
                                Text(
                                  '${contact.relationship} · ${maskPhone(contact.phone)}',
                                  style: theme.textTheme.bodyMedium?.copyWith(
                                    color: theme.colorScheme.onSurfaceVariant,
                                  ),
                                ),
                              ],
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
              const SizedBox(height: AppSpacing.lg),
              if (access != null)
                _AccessSection(patientId: patientId, access: access),
              const SizedBox(height: AppSpacing.xl),
            ],
          ),
        ),
      ),
    );
  }
}

/// What this account may do for this person.
///
/// Shown even when the user holds every permission, because the point is to make
/// the access model visible: rights are held per person, not globally.
class _AccessSection extends ConsumerWidget {
  const _AccessSection({required this.patientId, required this.access});

  final String patientId;
  final PatientAccess access;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        SectionHeader(
          'Your access',
          subtitle: access.isPrimary
              ? 'You are the organiser for this person.'
              : 'Granted by another family member.',
        ),
        AppCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              InfoRow(
                icon: Icons.family_restroom,
                label: 'Relationship',
                value: access.relationship.label,
              ),
              const Divider(height: AppSpacing.lg),
              for (final permission in FamilyPermission.values)
                Padding(
                  padding: const EdgeInsets.symmetric(vertical: 6),
                  child: Row(
                    children: [
                      Icon(
                        access.can(permission)
                            ? Icons.check_circle_outline
                            : Icons.remove_circle_outline,
                        color: access.can(permission)
                            ? context.positiveInk
                            : theme.colorScheme.onSurfaceVariant,
                        size: 22,
                      ),
                      const SizedBox(width: AppSpacing.sm + 4),
                      Expanded(
                        child: Text(
                          permission.label,
                          style: theme.textTheme.bodyMedium?.copyWith(
                            color: access.can(permission)
                                ? theme.colorScheme.onSurface
                                : theme.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              if (access.can(FamilyPermission.manageAccess)) ...[
                const Divider(height: AppSpacing.lg),
                OutlinedButton.icon(
                  onPressed: () =>
                      context.push('/patients/$patientId/care-circle'),
                  icon: const Icon(Icons.group_outlined),
                  label: const Text('Manage the care circle'),
                ),
              ],
            ],
          ),
        ),
      ],
    );
  }
}
