import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// The vehicles a driver can be put in.
///
/// `isWheelchairAccessible` is the field that matters and the reason this
/// screen exists separately from the roster. It is a **hard constraint on
/// assignment**, not a preference: the server refuses to give a wheelchair
/// trip to a saloon car, so a fleet recorded wrongly here does not produce a
/// slightly worse match — it produces a trip that cannot be assigned at all,
/// and the dispatcher discovers it twenty minutes before an appointment.
class FleetScreen extends ConsumerWidget {
  const FleetScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final organizationId = ref.watch(selectedOrganizationIdProvider);
    if (organizationId == null) return const LoadingBlock();

    final vehicles = ref.watch(vehiclesProvider(organizationId));
    final organization = ref.watch(selectedOrganizationProvider);

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(vehiclesProvider(organizationId)),
        child: vehicles.when(
          loading: () => const LoadingBlock(),
          error: (error, _) => ListView(
            children: [
              EmptyState(
                icon: Icons.cloud_off_outlined,
                title: 'Could not load the fleet',
                message: 'Check your connection and try again.',
                action: OutlinedButton(
                  onPressed: () =>
                      ref.invalidate(vehiclesProvider(organizationId)),
                  child: const Text('Retry'),
                ),
              ),
            ],
          ),
          data: (list) {
            if (list.isEmpty) {
              return ListView(
                children: const [
                  EmptyState(
                    icon: Icons.directions_car_outlined,
                    title: 'No vehicles yet',
                    message:
                        'A driver is added to a vehicle, so the fleet comes '
                        'first.',
                  ),
                ],
              );
            }

            final accessible = list
                .where((v) => v.isWheelchairAccessible)
                .length;

            return ListView(
              padding: const EdgeInsets.all(AppSpacing.md),
              children: [
                OpsCard(
                  child: Text(
                    '${list.length} vehicle(s) · $accessible wheelchair-accessible',
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                const SizedBox(height: AppSpacing.sm),
                for (final vehicle in list) ...[
                  OpsCard(
                    child: Row(
                      children: [
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                vehicle.label,
                                style: Theme.of(context).textTheme.bodyLarge,
                              ),
                              Text(
                                vehicle.licensePlate,
                                style: Theme.of(context).textTheme.bodySmall,
                              ),
                            ],
                          ),
                        ),
                        if (vehicle.isWheelchairAccessible)
                          const Tooltip(
                            message: 'Wheelchair-accessible',
                            child: Icon(Icons.accessible),
                          ),
                      ],
                    ),
                  ),
                  const SizedBox(height: AppSpacing.sm),
                ],
              ],
            );
          },
        ),
      ),
      floatingActionButton: (organization?.canAdminister ?? false)
          ? FloatingActionButton.extended(
              onPressed: () => _addVehicle(context, ref, organizationId),
              icon: const Icon(Icons.add),
              label: const Text('Add vehicle'),
            )
          : null,
    );
  }

  Future<void> _addVehicle(
    BuildContext context,
    WidgetRef ref,
    String organizationId,
  ) async {
    final added = await showDialog<bool>(
      context: context,
      builder: (context) => _AddVehicleDialog(organizationId: organizationId),
    );
    if (added == true) ref.invalidate(vehiclesProvider(organizationId));
  }
}

class _AddVehicleDialog extends ConsumerStatefulWidget {
  const _AddVehicleDialog({required this.organizationId});

  final String organizationId;

  @override
  ConsumerState<_AddVehicleDialog> createState() => _AddVehicleDialogState();
}

class _AddVehicleDialogState extends ConsumerState<_AddVehicleDialog> {
  final _formKey = GlobalKey<FormState>();
  final _make = TextEditingController();
  final _model = TextEditingController();
  final _color = TextEditingController();
  final _plate = TextEditingController();
  bool _accessible = false;
  bool _busy = false;

  @override
  void dispose() {
    _make.dispose();
    _model.dispose();
    _color.dispose();
    _plate.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() => _busy = true);
    try {
      await ref
          .read(opsApiProvider)
          .addVehicle(
            organizationId: widget.organizationId,
            make: _make.text,
            model: _model.text,
            color: _color.text,
            licensePlate: _plate.text,
            isWheelchairAccessible: _accessible,
          );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) showFailure(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String? _required(String? value) =>
      (value == null || value.trim().isEmpty) ? 'Required' : null;

  @override
  Widget build(BuildContext context) => AlertDialog(
    title: const Text('Add a vehicle'),
    content: SizedBox(
      width: 380,
      child: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              TextFormField(
                controller: _make,
                decoration: const InputDecoration(labelText: 'Make'),
                validator: _required,
              ),
              TextFormField(
                controller: _model,
                decoration: const InputDecoration(labelText: 'Model'),
                validator: _required,
              ),
              TextFormField(
                controller: _color,
                decoration: const InputDecoration(labelText: 'Colour'),
                validator: _required,
              ),
              TextFormField(
                controller: _plate,
                decoration: const InputDecoration(labelText: 'Licence plate'),
                validator: _required,
              ),
              const SizedBox(height: AppSpacing.sm),
              SwitchListTile(
                value: _accessible,
                onChanged: (value) => setState(() => _accessible = value),
                title: const Text('Wheelchair-accessible'),
                // Spelled out because getting it wrong is not a cosmetic
                // error: assignment refuses a wheelchair trip to a vehicle
                // not marked here, and the refusal lands on the dispatcher.
                subtitle: const Text(
                  'Assignment refuses wheelchair trips to vehicles without this.',
                ),
              ),
            ],
          ),
        ),
      ),
    ),
    actions: [
      TextButton(
        onPressed: _busy ? null : () => Navigator.of(context).pop(),
        child: const Text('Cancel'),
      ),
      FilledButton(
        onPressed: _busy ? null : _submit,
        child: Text(_busy ? 'Adding…' : 'Add'),
      ),
    ],
  );
}
