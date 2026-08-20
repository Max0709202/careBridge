import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import 'package:carebridge_client/carebridge_client.dart';
import '../../domain/models.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// Adds a clinic without leaving the appointment being created.
///
/// Clinics are entered by hand in the MVP. A directory lookup is a later
/// concern; forcing one now would block the journey that matters.
Future<Clinic?> showAddClinicSheet(BuildContext context, WidgetRef ref) {
  return showModalBottomSheet<Clinic>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (context) => Padding(
      padding: EdgeInsets.only(
        bottom: MediaQuery.of(context).viewInsets.bottom,
      ),
      child: _ClinicForm(ref: ref),
    ),
  );
}

class _ClinicForm extends StatefulWidget {
  const _ClinicForm({required this.ref});

  final WidgetRef ref;

  @override
  State<_ClinicForm> createState() => _ClinicFormState();
}

class _ClinicFormState extends State<_ClinicForm> {
  final _formKey = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _phone = TextEditingController();
  final _line1 = TextEditingController();
  final _city = TextEditingController();
  final _stateCode = TextEditingController();
  final _postalCode = TextEditingController();
  final _entrance = TextEditingController();

  @override
  void dispose() {
    for (final c in [
      _name,
      _phone,
      _line1,
      _city,
      _stateCode,
      _postalCode,
      _entrance,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _save() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    final clinic = Clinic(
      // Placeholder only. The server assigns the real id, and `addClinic`
      // hands back the stored record — which is what the appointment form
      // then selects.
      id: newId(),
      name: _name.text.trim(),
      phone: _phone.text.trim(),
      address: Address(
        label: _name.text.trim(),
        line1: _line1.text.trim(),
        city: _city.text.trim(),
        state: _stateCode.text.trim(),
        postalCode: _postalCode.text.trim(),
      ),
      entranceNotes: _entrance.text.trim().isEmpty
          ? null
          : _entrance.text.trim(),
    );

    try {
      final saved = await widget.ref
          .read(careProvider.notifier)
          .addClinic(clinic);
      if (!mounted) return;
      Navigator.of(context).pop(saved);
    } catch (error) {
      if (mounted) showFailure(context, error);
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: SingleChildScrollView(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(
            AppSpacing.md,
            0,
            AppSpacing.md,
            AppSpacing.lg,
          ),
          child: Form(
            key: _formKey,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              mainAxisSize: MainAxisSize.min,
              children: [
                const SectionHeader('Add a clinic'),
                TextFormField(
                  controller: _name,
                  textCapitalization: TextCapitalization.words,
                  decoration: const InputDecoration(labelText: 'Clinic name'),
                  validator: (v) =>
                      (v == null || v.trim().isEmpty) ? 'Required' : null,
                ),
                const SizedBox(height: AppSpacing.md),
                TextFormField(
                  controller: _phone,
                  keyboardType: TextInputType.phone,
                  decoration: const InputDecoration(labelText: 'Phone number'),
                  validator: (v) =>
                      (v == null || v.trim().isEmpty) ? 'Required' : null,
                ),
                const SizedBox(height: AppSpacing.md),
                TextFormField(
                  controller: _line1,
                  decoration: const InputDecoration(
                    labelText: 'Street address',
                  ),
                  validator: (v) =>
                      (v == null || v.trim().isEmpty) ? 'Required' : null,
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
                        validator: (v) =>
                            (v == null || v.trim().isEmpty) ? 'Required' : null,
                      ),
                    ),
                    const SizedBox(width: AppSpacing.sm),
                    Expanded(
                      child: TextFormField(
                        controller: _stateCode,
                        textCapitalization: TextCapitalization.characters,
                        decoration: const InputDecoration(labelText: 'State'),
                        validator: (v) =>
                            (v == null || v.trim().isEmpty) ? 'Required' : null,
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: AppSpacing.md),
                TextFormField(
                  controller: _postalCode,
                  keyboardType: TextInputType.number,
                  decoration: const InputDecoration(labelText: 'ZIP code'),
                  validator: (v) =>
                      (v == null || v.trim().isEmpty) ? 'Required' : null,
                ),
                const SizedBox(height: AppSpacing.md),
                TextFormField(
                  controller: _entrance,
                  maxLines: 2,
                  decoration: const InputDecoration(
                    labelText: 'Where should the car stop? (optional)',
                    helperText:
                        'Large campuses are the most common reason a '
                        'driver cannot find someone.',
                  ),
                ),
                const SizedBox(height: AppSpacing.lg),
                FilledButton(onPressed: _save, child: const Text('Add clinic')),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
