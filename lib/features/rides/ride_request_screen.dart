import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../core/failures.dart';
import '../../core/formatting.dart';
import '../../core/geo.dart';
import '../../domain/models.dart';
import '../../domain/pricing.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

class RideRequestScreen extends ConsumerStatefulWidget {
  const RideRequestScreen({required this.appointmentId, super.key});

  final String appointmentId;

  @override
  ConsumerState<RideRequestScreen> createState() => _RideRequestScreenState();
}

class _RideRequestScreenState extends ConsumerState<RideRequestScreen> {
  final _notes = TextEditingController();
  TimeOfDay? _pickupTime;
  bool _roundTrip = true;

  /// Default lead time before the appointment. Deliberately generous: an older
  /// adult with a walker does not leave the house in five minutes, and arriving
  /// early costs nothing next to missing a specialist slot.
  static const _defaultLeadMinutes = 40;

  @override
  void initState() {
    super.initState();
    final appointment =
        ref.read(careProvider).appointmentById(widget.appointmentId);
    if (appointment != null) {
      _pickupTime = TimeOfDay.fromDateTime(
        appointment.startsAt.subtract(
          const Duration(minutes: _defaultLeadMinutes),
        ),
      );
    }
  }

  @override
  void dispose() {
    _notes.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final state = ref.watch(careProvider);
    final theme = Theme.of(context);
    final appointment = state.appointmentById(widget.appointmentId);

    if (appointment == null) {
      return Scaffold(
        appBar: AppBar(),
        body: const EmptyState(
          icon: Icons.search_off,
          title: 'Not available',
          message: 'We could not find that, or you do not have access to it.',
        ),
      );
    }

    final patient = state.patientById(appointment.patientId);
    final clinic = state.clinicById(appointment.clinicId);
    if (patient == null || clinic == null) {
      return Scaffold(appBar: AppBar(), body: const SizedBox.shrink());
    }

    final estimate = _estimate(patient, clinic);
    final hasCoordinates = patient.homeAddress.coordinates != null &&
        clinic.address.coordinates != null;

    return Scaffold(
      appBar: AppBar(title: const Text('Arrange transportation')),
      body: SingleChildScrollView(
        child: ScreenBody(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SectionHeader('The journey'),
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    _RoutePoint(
                      icon: Icons.home_outlined,
                      label: 'Pickup',
                      title: patient.homeAddress.shortLine,
                      detail: patient.homeAddress.accessNotes,
                    ),
                    Padding(
                      padding: const EdgeInsets.only(left: 11),
                      child: SizedBox(
                        height: 24,
                        child: VerticalDivider(
                          color: theme.colorScheme.outlineVariant,
                          thickness: 2,
                        ),
                      ),
                    ),
                    _RoutePoint(
                      icon: Icons.local_hospital_outlined,
                      label: 'Destination',
                      title: clinic.name,
                      detail: clinic.entranceNotes,
                    ),
                  ],
                ),
              ),

              const SizedBox(height: AppSpacing.lg),
              const SectionHeader('When to collect them'),
              AppCard(
                onTap: () async {
                  final picked = await showTimePicker(
                    context: context,
                    initialTime: _pickupTime ??
                        const TimeOfDay(hour: 9, minute: 0),
                    helpText: 'Pickup time',
                  );
                  if (picked != null) setState(() => _pickupTime = picked);
                },
                child: Row(
                  children: [
                    Icon(Icons.schedule, color: theme.colorScheme.primary),
                    const SizedBox(width: AppSpacing.md),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            'Pickup time',
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                          Text(
                            _pickupTime?.format(context) ?? 'Choose a time',
                            style: theme.textTheme.titleMedium,
                          ),
                          Text(
                            'Appointment starts at '
                            '${formatTime(appointment.startsAt)}',
                            style: theme.textTheme.bodySmall?.copyWith(
                              color: theme.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                    const Icon(Icons.chevron_right),
                  ],
                ),
              ),

              const SizedBox(height: AppSpacing.lg),
              const SectionHeader('Getting home'),
              AppCard(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    SegmentedButton<bool>(
                      segments: const [
                        ButtonSegment(
                          value: true,
                          label: Text('Round trip'),
                          icon: Icon(Icons.sync_alt),
                        ),
                        ButtonSegment(
                          value: false,
                          label: Text('One way'),
                          icon: Icon(Icons.arrow_forward),
                        ),
                      ],
                      selected: {_roundTrip},
                      onSelectionChanged: (selection) =>
                          setState(() => _roundTrip = selection.first),
                    ),
                    const SizedBox(height: AppSpacing.md),
                    Text(
                      _roundTrip
                          ? 'A car home as well. The return pickup is flexible — '
                              'we send one when the visit actually ends, not at a '
                              'time guessed days earlier.'
                          : 'Someone else is bringing them home.',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),

              const SizedBox(height: AppSpacing.lg),
              const SectionHeader(
                'What the driver will be told',
                subtitle: 'Taken from the profile — no medical details are '
                    'shared.',
              ),
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
                            Chip(label: Text(need.label)),
                        ],
                      ),
                    if (patient.requiresWheelchairVehicle) ...[
                      const SizedBox(height: AppSpacing.sm),
                      Row(
                        children: [
                          Icon(
                            Icons.accessible_forward,
                            color: context.positiveInk,
                          ),
                          const SizedBox(width: AppSpacing.sm),
                          Expanded(
                            child: Text(
                              'Only wheelchair-accessible vehicles will be '
                              'offered this trip.',
                              style: theme.textTheme.bodyMedium,
                            ),
                          ),
                        ],
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: AppSpacing.md),
              TextFormField(
                controller: _notes,
                maxLines: 3,
                decoration: const InputDecoration(
                  labelText: 'Anything else for the driver? (optional)',
                  hintText: 'Ring the bell twice, allow a few minutes …',
                ),
              ),

              const SizedBox(height: AppSpacing.lg),
              const SectionHeader('Estimated cost'),
              _EstimateCard(
                estimate: estimate,
                roundTrip: _roundTrip,
                hasCoordinates: hasCoordinates,
              ),

              const SizedBox(height: AppSpacing.xl),
              FilledButton.icon(
                onPressed: () => _submit(appointment),
                icon: const Icon(Icons.check),
                label: Text(
                  _roundTrip ? 'Request round trip' : 'Request ride',
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                'You will not be charged until the trip is complete.',
                textAlign: TextAlign.center,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: AppSpacing.xl),
            ],
          ),
        ),
      ),
    );
  }

  PriceEstimate _estimate(Patient patient, Clinic clinic) {
    final from = patient.homeAddress.coordinates;
    final to = clinic.address.coordinates;
    final rule = PricingRule.standard();

    if (from == null || to == null) {
      return estimateFare(
        rule: rule,
        distanceMiles: 0,
        durationMinutes: 0,
        wheelchairAccessRequired: patient.requiresWheelchairVehicle,
        assistanceRequired: patient.requiresAssistance,
      );
    }

    final miles = distanceMiles(from, to);
    return estimateFare(
      rule: rule,
      distanceMiles: double.parse(miles.toStringAsFixed(1)),
      durationMinutes: estimateDriveMinutes(miles),
      wheelchairAccessRequired: patient.requiresWheelchairVehicle,
      assistanceRequired: patient.requiresAssistance,
    );
  }

  void _submit(Appointment appointment) {
    final time = _pickupTime;
    if (time == null) {
      showFailure(context, const ValidationFailure('Choose a pickup time.'));
      return;
    }

    final pickupAt = DateTime(
      appointment.startsAt.year,
      appointment.startsAt.month,
      appointment.startsAt.day,
      time.hour,
      time.minute,
    );

    try {
      ref.read(careProvider.notifier).requestTransport(
            appointmentId: appointment.id,
            pickupAt: pickupAt,
            roundTrip: _roundTrip,
            notesForDriver:
                _notes.text.trim().isEmpty ? null : _notes.text.trim(),
          );
      if (!mounted) return;
      showConfirmationBanner(
        context,
        'Requested. We are finding a driver.',
      );
      context.pop();
    } catch (error) {
      if (mounted) showFailure(context, error);
    }
  }
}

class _RoutePoint extends StatelessWidget {
  const _RoutePoint({
    required this.icon,
    required this.label,
    required this.title,
    this.detail,
  });

  final IconData icon;
  final String label;
  final String title;
  final String? detail;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Icon(icon, color: theme.colorScheme.primary),
        const SizedBox(width: AppSpacing.md),
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
              Text(title, style: theme.textTheme.bodyLarge),
              if (detail != null)
                Padding(
                  padding: const EdgeInsets.only(top: 2),
                  child: Text(
                    detail!,
                    style: theme.textTheme.bodySmall?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
            ],
          ),
        ),
      ],
    );
  }
}

/// Itemised, because an unexplained total on a care bill generates a support
/// call — and because a surcharge for an accessible vehicle should be visible
/// rather than buried.
class _EstimateCard extends StatelessWidget {
  const _EstimateCard({
    required this.estimate,
    required this.roundTrip,
    required this.hasCoordinates,
  });

  final PriceEstimate estimate;
  final bool roundTrip;
  final bool hasCoordinates;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final legs = roundTrip ? 2 : 1;

    return AppCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          if (!hasCoordinates)
            Padding(
              padding: const EdgeInsets.only(bottom: AppSpacing.sm),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.info_outline, color: context.cautionInk, size: 20),
                  const SizedBox(width: AppSpacing.sm),
                  Expanded(
                    child: Text(
                      'This address has not been verified yet, so only the '
                      'minimum fare can be shown. The final price is confirmed '
                      'before the trip.',
                      style: theme.textTheme.bodySmall?.copyWith(
                        color: context.cautionInk,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          _line(context, 'Base fare', estimate.base.format()),
          if (hasCoordinates) ...[
            _line(
              context,
              'Distance (${estimate.distanceMiles} mi)',
              estimate.distanceCharge.format(),
            ),
            _line(
              context,
              'Time (about ${estimate.durationMinutes} min)',
              estimate.timeCharge.format(),
            ),
          ],
          for (final surcharge in estimate.surcharges)
            _line(context, surcharge.label, surcharge.amount.format()),
          if (estimate.minimumApplied)
            _line(context, 'Minimum fare applied', '', muted: true),
          const Divider(height: AppSpacing.lg),
          Row(
            children: [
              Expanded(
                child: Text(
                  roundTrip ? 'Estimated total (2 legs)' : 'Estimated total',
                  style: theme.textTheme.titleMedium,
                ),
              ),
              Text(
                (estimate.total * legs).format(),
                style: theme.textTheme.titleLarge,
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(
            'An estimate, not a quote. Traffic and waiting time can change it.',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
        ],
      ),
    );
  }

  Widget _line(
    BuildContext context,
    String label,
    String value, {
    bool muted = false,
  }) {
    final theme = Theme.of(context);
    final style = theme.textTheme.bodyMedium?.copyWith(
      color: muted ? theme.colorScheme.onSurfaceVariant : null,
    );
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(child: Text(label, style: style)),
          Text(value, style: style),
        ],
      ),
    );
  }
}
