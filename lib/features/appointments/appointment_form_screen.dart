import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../core/failures.dart';
import '../../core/formatting.dart';
import '../../domain/models.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';
import '../clinics/clinic_form_sheet.dart';

class AppointmentFormScreen extends ConsumerStatefulWidget {
  const AppointmentFormScreen({super.key});

  @override
  ConsumerState<AppointmentFormScreen> createState() =>
      _AppointmentFormScreenState();
}

class _AppointmentFormScreenState extends ConsumerState<AppointmentFormScreen> {
  final _formKey = GlobalKey<FormState>();
  final _notes = TextEditingController();

  String? _clinicId;
  DateTime? _date;
  TimeOfDay? _time;
  Duration _duration = const Duration(minutes: 45);
  AppointmentType _type = AppointmentType.followUp;
  bool _transportRequired = true;

  @override
  void initState() {
    super.initState();
    final state = ref.read(careProvider);
    _clinicId =
        state.selectedPatient?.preferredClinicId ??
        (state.clinics.isNotEmpty ? state.clinics.first.id : null);
  }

  @override
  void dispose() {
    _notes.dispose();
    super.dispose();
  }

  DateTime? get _startsAt {
    if (_date == null || _time == null) return null;
    return DateTime(
      _date!.year,
      _date!.month,
      _date!.day,
      _time!.hour,
      _time!.minute,
    );
  }

  Future<void> _pickDate() async {
    final now = ref.read(clockProvider).now();
    final picked = await showDatePicker(
      context: context,
      initialDate: _date ?? now.add(const Duration(days: 1)),
      firstDate: now,
      lastDate: now.add(const Duration(days: 365)),
      helpText: 'Appointment date',
    );
    if (picked != null) setState(() => _date = picked);
  }

  Future<void> _pickTime() async {
    final picked = await showTimePicker(
      context: context,
      initialTime: _time ?? const TimeOfDay(hour: 10, minute: 0),
      helpText: 'Appointment time',
    );
    if (picked != null) setState(() => _time = picked);
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    final patient = ref.read(careProvider).selectedPatient;
    final startsAt = _startsAt;

    if (patient == null || _clinicId == null || startsAt == null) {
      showFailure(
        context,
        const ValidationFailure('Choose a clinic, a date and a time.'),
      );
      return;
    }

    try {
      await ref
          .read(careProvider.notifier)
          .createAppointment(
            patientId: patient.id,
            clinicId: _clinicId!,
            startsAt: startsAt,
            expectedDuration: _duration,
            type: _type,
            coordinationNotes: _notes.text.trim().isEmpty
                ? null
                : _notes.text.trim(),
            transportRequired: _transportRequired,
          );
      if (!mounted) return;
      showConfirmationBanner(context, 'Appointment added.');
      context.pop();
    } catch (error) {
      if (mounted) showFailure(context, error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(careProvider);
    final theme = Theme.of(context);
    final patient = state.selectedPatient;

    return Scaffold(
      appBar: AppBar(title: const Text('Add an appointment')),
      body: SingleChildScrollView(
        child: ScreenBody(
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (patient != null)
                  AppCard(
                    child: Row(
                      children: [
                        CircleAvatar(child: Text(patient.firstInitial)),
                        const SizedBox(width: AppSpacing.md),
                        Expanded(
                          child: Text(
                            'For ${patient.preferredName}',
                            style: theme.textTheme.bodyLarge,
                          ),
                        ),
                      ],
                    ),
                  ),
                const SizedBox(height: AppSpacing.lg),
                const SectionHeader('Where'),
                DropdownButtonFormField<String>(
                  initialValue: _clinicId,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Clinic'),
                  items: [
                    for (final clinic in state.clinics)
                      DropdownMenuItem(
                        value: clinic.id,
                        child: Text(
                          clinic.name,
                          overflow: TextOverflow.ellipsis,
                        ),
                      ),
                  ],
                  onChanged: (value) => setState(() => _clinicId = value),
                  validator: (value) =>
                      value == null ? 'Choose a clinic.' : null,
                ),
                const SizedBox(height: AppSpacing.sm),
                Align(
                  alignment: Alignment.centerLeft,
                  child: TextButton.icon(
                    onPressed: () async {
                      final clinic = await showAddClinicSheet(context, ref);
                      if (clinic != null) {
                        setState(() => _clinicId = clinic.id);
                      }
                    },
                    icon: const Icon(Icons.add_location_alt_outlined),
                    label: const Text('Add a clinic'),
                  ),
                ),

                const SizedBox(height: AppSpacing.lg),
                const SectionHeader(
                  'When',
                  subtitle: 'Times are shown in the clinic’s local time.',
                ),
                Row(
                  children: [
                    Expanded(
                      child: _PickerTile(
                        icon: Icons.calendar_today_outlined,
                        label: 'Date',
                        value: _date == null
                            ? 'Choose a date'
                            : formatShortDay(_date!),
                        onTap: _pickDate,
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: _PickerTile(
                        icon: Icons.schedule,
                        label: 'Time',
                        value: _time == null
                            ? 'Choose a time'
                            : _time!.format(context),
                        onTap: _pickTime,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.md),
                DropdownButtonFormField<int>(
                  initialValue: _duration.inMinutes,
                  decoration: const InputDecoration(
                    labelText: 'How long will it take?',
                    helperText: 'Used to plan the ride home.',
                  ),
                  items: const [
                    DropdownMenuItem(value: 20, child: Text('20 minutes')),
                    DropdownMenuItem(value: 30, child: Text('30 minutes')),
                    DropdownMenuItem(value: 45, child: Text('45 minutes')),
                    DropdownMenuItem(value: 60, child: Text('1 hour')),
                    DropdownMenuItem(
                      value: 90,
                      child: Text('1 hour 30 minutes'),
                    ),
                    DropdownMenuItem(value: 120, child: Text('2 hours')),
                  ],
                  onChanged: (value) => setState(
                    () => _duration = Duration(minutes: value ?? 45),
                  ),
                ),

                const SizedBox(height: AppSpacing.lg),
                const SectionHeader(
                  'What kind of visit',
                  subtitle:
                      'Kept deliberately broad — CareBridge does not hold '
                      'medical details.',
                ),
                DropdownButtonFormField<AppointmentType>(
                  initialValue: _type,
                  isExpanded: true,
                  decoration: const InputDecoration(labelText: 'Visit type'),
                  items: [
                    for (final type in AppointmentType.values)
                      DropdownMenuItem(value: type, child: Text(type.label)),
                  ],
                  onChanged: (value) =>
                      setState(() => _type = value ?? AppointmentType.other),
                ),
                const SizedBox(height: AppSpacing.md),
                TextFormField(
                  controller: _notes,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Notes for coordination (optional)',
                    helperText:
                        'Practical reminders only — what to bring, '
                        'which floor. No symptoms or medication.',
                  ),
                ),

                const SizedBox(height: AppSpacing.md),
                SwitchListTile(
                  value: _transportRequired,
                  onChanged: (value) =>
                      setState(() => _transportRequired = value),
                  contentPadding: EdgeInsets.zero,
                  title: const Text('They will need a ride'),
                  subtitle: const Text(
                    'You can arrange the ride once the appointment is saved.',
                  ),
                ),

                const SizedBox(height: AppSpacing.xl),
                FilledButton(
                  onPressed: _save,
                  child: const Text('Save appointment'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _PickerTile extends StatelessWidget {
  const _PickerTile({
    required this.icon,
    required this.label,
    required this.value,
    required this.onTap,
  });

  final IconData icon;
  final String label;
  final String value;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Semantics(
      button: true,
      label: '$label: $value',
      excludeSemantics: true,
      child: AppCard(
        onTap: onTap,
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.md,
        ),
        child: Row(
          children: [
            Icon(icon, color: theme.colorScheme.primary),
            const SizedBox(width: AppSpacing.sm + 4),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  Text(value, style: theme.textTheme.bodyLarge),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
