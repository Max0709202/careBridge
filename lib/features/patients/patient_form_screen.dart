import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import 'package:carebridge_client/carebridge_client.dart';
import '../../domain/models.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// Create or edit the person being cared for.
///
/// Every field here has to earn its place. Date of birth is absent by design —
/// see [Patient]. The fields that look like afterthoughts (access notes,
/// mobility notes) are the ones drivers actually rely on.
class PatientFormScreen extends ConsumerStatefulWidget {
  const PatientFormScreen({this.patientId, super.key});

  final String? patientId;

  @override
  ConsumerState<PatientFormScreen> createState() => _PatientFormScreenState();
}

class _PatientFormScreenState extends ConsumerState<PatientFormScreen> {
  final _formKey = GlobalKey<FormState>();

  late final TextEditingController _preferredName;
  late final TextEditingController _legalName;
  late final TextEditingController _phone;
  late final TextEditingController _line1;
  late final TextEditingController _line2;
  late final TextEditingController _city;
  late final TextEditingController _stateCode;
  late final TextEditingController _postalCode;
  late final TextEditingController _accessNotes;
  late final TextEditingController _mobilityNotes;
  late final TextEditingController _contactName;
  late final TextEditingController _contactRelationship;
  late final TextEditingController _contactPhone;

  Set<MobilityNeed> _needs = {};
  AgeBand? _ageBand;
  Patient? _existing;

  bool get _isEditing => widget.patientId != null;

  @override
  void initState() {
    super.initState();
    final existing = widget.patientId == null
        ? null
        : ref.read(careProvider).patientById(widget.patientId!);
    _existing = existing;

    final contact = existing?.emergencyContacts.isNotEmpty ?? false
        ? existing!.emergencyContacts.first
        : null;

    _preferredName = TextEditingController(text: existing?.preferredName ?? '');
    _legalName = TextEditingController(text: existing?.legalName ?? '');
    _phone = TextEditingController(text: existing?.phone ?? '');
    _line1 = TextEditingController(text: existing?.homeAddress.line1 ?? '');
    _line2 = TextEditingController(text: existing?.homeAddress.line2 ?? '');
    _city = TextEditingController(text: existing?.homeAddress.city ?? '');
    _stateCode = TextEditingController(text: existing?.homeAddress.state ?? '');
    _postalCode = TextEditingController(
      text: existing?.homeAddress.postalCode ?? '',
    );
    _accessNotes = TextEditingController(
      text: existing?.homeAddress.accessNotes ?? '',
    );
    _mobilityNotes = TextEditingController(text: existing?.mobilityNotes ?? '');
    _contactName = TextEditingController(text: contact?.name ?? '');
    _contactRelationship = TextEditingController(
      text: contact?.relationship ?? '',
    );
    _contactPhone = TextEditingController(text: contact?.phone ?? '');
    _needs = {...?existing?.mobilityNeeds};
    _ageBand = existing?.ageBand;
  }

  @override
  void dispose() {
    for (final controller in [
      _preferredName,
      _legalName,
      _phone,
      _line1,
      _line2,
      _city,
      _stateCode,
      _postalCode,
      _accessNotes,
      _mobilityNotes,
      _contactName,
      _contactRelationship,
      _contactPhone,
    ]) {
      controller.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    final address = Address(
      label: 'Home',
      line1: _line1.text.trim(),
      line2: _line2.text.trim().isEmpty ? null : _line2.text.trim(),
      city: _city.text.trim(),
      state: _stateCode.text.trim(),
      postalCode: _postalCode.text.trim(),
      accessNotes: _accessNotes.text.trim().isEmpty
          ? null
          : _accessNotes.text.trim(),
      // Coordinates come from geocoding, which is a server concern. Until then
      // they stay null and price estimates say so rather than inventing one.
      coordinates: _existing?.homeAddress.coordinates,
    );

    final contacts = <EmergencyContact>[
      if (_contactName.text.trim().isNotEmpty)
        EmergencyContact(
          id: _existing?.emergencyContacts.isNotEmpty ?? false
              ? _existing!.emergencyContacts.first.id
              : newId(),
          name: _contactName.text.trim(),
          relationship: _contactRelationship.text.trim().isEmpty
              ? 'Family'
              : _contactRelationship.text.trim(),
          phone: _contactPhone.text.trim(),
          isPrimary: true,
        ),
      if (_existing != null && _existing!.emergencyContacts.length > 1)
        ..._existing!.emergencyContacts.skip(1),
    ];

    final patient = Patient(
      id: _existing?.id ?? newId(),
      preferredName: _preferredName.text.trim(),
      legalName: _legalName.text.trim().isEmpty ? null : _legalName.text.trim(),
      phone: _phone.text.trim(),
      homeAddress: address,
      ageBand: _ageBand,
      mobilityNeeds: _needs,
      mobilityNotes: _mobilityNotes.text.trim().isEmpty
          ? null
          : _mobilityNotes.text.trim(),
      emergencyContacts: contacts,
      preferredClinicId: _existing?.preferredClinicId,
      archivedAt: _existing?.archivedAt,
    );

    try {
      await ref.read(careProvider.notifier).savePatient(patient);
      if (!mounted) return;
      showConfirmationBanner(
        context,
        _isEditing ? 'Profile updated.' : '${patient.preferredName} added.',
      );
      context.pop();
    } catch (error) {
      if (mounted) showFailure(context, error);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      appBar: AppBar(
        title: Text(_isEditing ? 'Edit profile' : 'Add a profile'),
      ),
      body: SingleChildScrollView(
        child: ScreenBody(
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const SectionHeader(
                  'Who they are',
                  subtitle: 'Only what is needed to arrange a trip safely.',
                ),
                TextFormField(
                  controller: _preferredName,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(
                    labelText: 'Preferred name',
                    helperText: 'What they like to be called.',
                  ),
                  validator: (value) => (value == null || value.trim().isEmpty)
                      ? 'Enter the name they like to be called.'
                      : null,
                ),
                const SizedBox(height: AppSpacing.md),
                TextFormField(
                  controller: _legalName,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(
                    labelText: 'Legal name (optional)',
                    helperText:
                        'Only needed if a clinic or transport provider '
                        'has to match their records.',
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                TextFormField(
                  controller: _phone,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(
                    labelText: 'Their phone number',
                  ),
                  validator: (value) => (value == null || value.trim().isEmpty)
                      ? 'A phone number is needed so a driver can make contact.'
                      : null,
                ),
                const SizedBox(height: AppSpacing.md),
                DropdownButtonFormField<AgeBand>(
                  initialValue: _ageBand,
                  decoration: const InputDecoration(
                    labelText: 'Age range (optional)',
                    helperText:
                        'A range, not a date of birth — enough to plan '
                        'mobility support, and not enough to identify anyone.',
                  ),
                  items: [
                    for (final band in AgeBand.values)
                      DropdownMenuItem(value: band, child: Text(band.label)),
                  ],
                  onChanged: (value) => setState(() => _ageBand = value),
                ),

                const SizedBox(height: AppSpacing.lg),
                const SectionHeader(
                  'Where they are collected',
                  subtitle:
                      'The details a driver needs to find the right door.',
                ),
                TextFormField(
                  controller: _line1,
                  decoration: const InputDecoration(
                    labelText: 'Street address',
                  ),
                  validator: (value) => (value == null || value.trim().isEmpty)
                      ? 'Enter the pickup address.'
                      : null,
                ),
                const SizedBox(height: AppSpacing.md),
                TextFormField(
                  controller: _line2,
                  decoration: const InputDecoration(
                    labelText: 'Flat, unit or floor (optional)',
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      flex: 3,
                      child: TextFormField(
                        controller: _city,
                        decoration: const InputDecoration(labelText: 'City'),
                        validator: (value) =>
                            (value == null || value.trim().isEmpty)
                            ? 'Required'
                            : null,
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: TextFormField(
                        controller: _stateCode,
                        textCapitalization: TextCapitalization.characters,
                        decoration: const InputDecoration(labelText: 'State'),
                        validator: (value) =>
                            (value == null || value.trim().isEmpty)
                            ? 'Required'
                            : null,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.md),
                TextFormField(
                  controller: _postalCode,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'ZIP code'),
                  validator: (value) => (value == null || value.trim().isEmpty)
                      ? 'Required'
                      : null,
                ),
                const SizedBox(height: AppSpacing.md),
                TextFormField(
                  controller: _accessNotes,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'How to find them',
                    helperText:
                        'Gate codes, which door, how long to wait. This '
                        'is what stops a driver waiting at the wrong entrance.',
                  ),
                ),

                const SizedBox(height: AppSpacing.lg),
                const SectionHeader(
                  'Getting about',
                  subtitle:
                      'Determines which vehicle is sent and what help is '
                      'offered on the day.',
                ),
                Wrap(
                  spacing: AppSpacing.sm,
                  runSpacing: AppSpacing.sm,
                  children: [
                    for (final need in MobilityNeed.values)
                      FilterChip(
                        label: Text(need.label),
                        selected: _needs.contains(need),
                        onSelected: (selected) => setState(() {
                          if (selected) {
                            _needs.add(need);
                          } else {
                            _needs.remove(need);
                          }
                        }),
                      ),
                  ],
                ),
                if (_needs.contains(MobilityNeed.wheelchair))
                  Padding(
                    padding: const EdgeInsets.only(top: AppSpacing.md),
                    child: AppCard(
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Icon(
                            Icons.accessible_forward,
                            color: theme.colorScheme.primary,
                          ),
                          const SizedBox(width: AppSpacing.sm + 4),
                          Expanded(
                            child: Text(
                              'Every trip will require a wheelchair-accessible '
                              'vehicle. This is treated as a hard requirement, '
                              'never a preference.',
                              style: theme.textTheme.bodyMedium,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                const SizedBox(height: AppSpacing.md),
                TextFormField(
                  controller: _mobilityNotes,
                  maxLines: 3,
                  decoration: const InputDecoration(
                    labelText: 'Anything a driver should know',
                    helperText:
                        'How to help, not why help is needed. No medical '
                        'details.',
                  ),
                ),

                const SizedBox(height: AppSpacing.lg),
                const SectionHeader(
                  'Emergency contact',
                  subtitle: 'Who should be called if something goes wrong.',
                ),
                TextFormField(
                  controller: _contactName,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(labelText: 'Name'),
                ),
                const SizedBox(height: AppSpacing.md),
                TextFormField(
                  controller: _contactRelationship,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(
                    labelText: 'Relationship',
                    hintText: 'Daughter, neighbour, …',
                  ),
                ),
                const SizedBox(height: AppSpacing.md),
                TextFormField(
                  controller: _contactPhone,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(labelText: 'Phone number'),
                ),

                const SizedBox(height: AppSpacing.xl),
                FilledButton(
                  onPressed: _save,
                  child: Text(_isEditing ? 'Save changes' : 'Add profile'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
