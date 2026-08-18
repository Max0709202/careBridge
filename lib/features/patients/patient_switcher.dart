import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../domain/models.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// Switches between the people a user cares for.
///
/// Shown even when there is only one person: the name at the top of the screen
/// is the answer to "whose information am I looking at", and a family managing
/// two parents must never have to guess.
class PatientSwitcher extends ConsumerWidget {
  const PatientSwitcher({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final state = ref.watch(careProvider);
    final patient = state.selectedPatient;
    final theme = Theme.of(context);
    if (patient == null) return const SizedBox.shrink();

    final others = state.activePatients
        .where((p) => p.id != patient.id)
        .toList();

    return AppCard(
      onTap: others.isEmpty && state.activePatients.length == 1
          ? () => context.push('/patients/${patient.id}')
          : () => _showPicker(context, ref, state.activePatients, patient),
      semanticLabel:
          'Currently viewing ${patient.preferredName}. '
          '${others.isEmpty ? 'Open profile.' : 'Tap to switch person.'}',
      child: Row(
        children: [
          CircleAvatar(
            radius: 26,
            backgroundColor: theme.colorScheme.primaryContainer,
            child: Text(
              patient.firstInitial,
              style: theme.textTheme.titleLarge?.copyWith(
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
                  'Caring for',
                  style: theme.textTheme.bodySmall?.copyWith(
                    color: theme.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 2),
                Text(patient.preferredName, style: theme.textTheme.titleLarge),
                if (patient.mobilityNeeds.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Wrap(
                      spacing: 6,
                      runSpacing: 6,
                      children: [
                        for (final need in patient.mobilityNeeds.take(2))
                          _NeedChip(need: need),
                        if (patient.mobilityNeeds.length > 2)
                          Text(
                            '+${patient.mobilityNeeds.length - 2} more',
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
          Icon(
            others.isEmpty ? Icons.chevron_right : Icons.swap_horiz,
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ],
      ),
    );
  }

  void _showPicker(
    BuildContext context,
    WidgetRef ref,
    List<Patient> patients,
    Patient current,
  ) {
    showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (sheetContext) => SafeArea(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: AppSpacing.md),
              child: SectionHeader('Who are you caring for?'),
            ),
            for (final p in patients)
              ListTile(
                leading: CircleAvatar(child: Text(p.firstInitial)),
                title: Text(p.preferredName),
                subtitle: Text(p.homeAddress.shortLine),
                trailing: p.id == current.id
                    ? Icon(
                        Icons.check_circle,
                        color: Theme.of(context).colorScheme.primary,
                      )
                    : null,
                onTap: () async {
                  // Closed first: the switch is a preference write, and making
                  // the sheet hang on a round trip would make choosing a person
                  // feel slower than it is. A failure still surfaces.
                  Navigator.of(sheetContext).pop();
                  try {
                    await ref.read(careProvider.notifier).selectPatient(p.id);
                  } catch (error) {
                    if (context.mounted) showFailure(context, error);
                  }
                },
              ),
            const Divider(),
            ListTile(
              leading: const Icon(Icons.person_add_alt_1_outlined),
              title: const Text('Add someone else'),
              onTap: () {
                Navigator.of(sheetContext).pop();
                context.push('/patients/new');
              },
            ),
            const SizedBox(height: AppSpacing.md),
          ],
        ),
      ),
    );
  }
}

class _NeedChip extends StatelessWidget {
  const _NeedChip({required this.need});

  final MobilityNeed need;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: theme.colorScheme.surfaceContainerHighest,
        borderRadius: const BorderRadius.all(Radius.circular(999)),
      ),
      child: Text(
        need.label,
        style: theme.textTheme.bodySmall?.copyWith(
          color: theme.colorScheme.onSurfaceVariant,
        ),
      ),
    );
  }
}
