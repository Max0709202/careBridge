import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../domain/models.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// Picks a driver for a ride.
///
/// Ineligible candidates are **listed, not hidden**, each with every reason
/// they cannot take it. Hiding them would produce a shorter list and a worse
/// screen: a dispatcher whose roster has eight drivers and whose sheet shows
/// two has no way to tell whether the other six are busy, off shift, or in the
/// wrong vehicle — and those are three different phone calls. What the sheet
/// does refuse to do is let one be *chosen*; the server refuses too, and this
/// is the copy of that rule that keeps the refusal from being a surprise.
Future<bool?> showAssignSheet({
  required BuildContext context,
  required WidgetRef ref,
  required String organizationId,
  required QueueItem item,
}) => showModalBottomSheet<bool>(
  context: context,
  isScrollControlled: true,
  builder: (context) =>
      _AssignSheet(organizationId: organizationId, item: item),
);

class _AssignSheet extends ConsumerStatefulWidget {
  const _AssignSheet({required this.organizationId, required this.item});

  final String organizationId;
  final QueueItem item;

  @override
  ConsumerState<_AssignSheet> createState() => _AssignSheetState();
}

class _AssignSheetState extends ConsumerState<_AssignSheet> {
  final _reason = TextEditingController();
  String? _selectedDriverId;
  bool _busy = false;

  @override
  void dispose() {
    _reason.dispose();
    super.dispose();
  }

  bool get _needsReason => widget.item.isReassignment;

  bool get _canSubmit =>
      _selectedDriverId != null &&
      (!_needsReason || _reason.text.trim().isNotEmpty);

  Future<void> _submit() async {
    final driverId = _selectedDriverId;
    if (driverId == null) return;

    setState(() => _busy = true);
    try {
      await ref
          .read(opsApiProvider)
          .assign(
            organizationId: widget.organizationId,
            rideId: widget.item.rideId,
            driverId: driverId,
            reason: _needsReason ? _reason.text.trim() : null,
          );
      if (mounted) {
        Navigator.of(context).pop(true);
      }
    } catch (error) {
      // The server asserts eligibility rather than advising it, so a race —
      // the driver taking another trip between the queue loading and this tap
      // — arrives here as a refusal. Shown as it is, and the sheet stays open
      // so another driver can be picked.
      if (mounted) showFailure(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final candidates = [...widget.item.candidates]
      // Eligible first, then alphabetical. Ineligible candidates stay in the
      // list — see the note at the top of the file — they simply stop being
      // the first thing the eye lands on.
      ..sort((a, b) {
        if (a.eligible != b.eligible) return a.eligible ? -1 : 1;
        return a.displayName.compareTo(b.displayName);
      });

    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.md,
        right: AppSpacing.md,
        top: AppSpacing.md,
        bottom: MediaQuery.viewInsetsOf(context).bottom + AppSpacing.md,
      ),
      child: ConstrainedBox(
        constraints: BoxConstraints(
          maxHeight: MediaQuery.sizeOf(context).height * 0.85,
        ),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              widget.item.isReassignment
                  ? 'Reassign this trip'
                  : 'Assign a driver',
              style: theme.textTheme.titleMedium,
            ),
            const SizedBox(height: AppSpacing.xs),
            Text(
              '${widget.item.patientName} · ${widget.item.pickupLine}',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
            if (widget.item.wheelchairRequired)
              Padding(
                padding: const EdgeInsets.only(top: AppSpacing.xs),
                child: Row(
                  children: [
                    const Icon(Icons.accessible, size: 16),
                    const SizedBox(width: AppSpacing.xs),
                    Text(
                      'Needs a wheelchair-accessible vehicle',
                      style: theme.textTheme.bodySmall,
                    ),
                  ],
                ),
              ),
            const SizedBox(height: AppSpacing.md),
            Flexible(
              child: ListView.separated(
                shrinkWrap: true,
                itemCount: candidates.length,
                separatorBuilder: (_, _) => const Divider(height: 1),
                itemBuilder: (context, index) =>
                    _candidateTile(theme, candidates[index]),
              ),
            ),
            if (_needsReason) ...[
              const SizedBox(height: AppSpacing.md),
              TextField(
                controller: _reason,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                  labelText: 'Why is this being reassigned?',
                  // Recorded against the ride and shown on the family's
                  // timeline, so they are not left wondering why the name at
                  // the kerb changed.
                  helperText: 'The family sees that the trip changed driver.',
                ),
                maxLength: 300,
              ),
            ],
            const SizedBox(height: AppSpacing.sm),
            FilledButton(
              onPressed: _busy || !_canSubmit ? null : _submit,
              child: Text(_busy ? 'Assigning…' : 'Confirm'),
            ),
          ],
        ),
      ),
    );
  }

  Widget _candidateTile(ThemeData theme, Candidate candidate) {
    final selected = _selectedDriverId == candidate.driverId;

    return ListTile(
      enabled: candidate.eligible,
      selected: selected,
      leading: Icon(
        candidate.eligible ? Icons.check_circle_outline : Icons.block_outlined,
        color: candidate.eligible
            ? OpsColors.positive
            : theme.colorScheme.outline,
      ),
      title: Text(candidate.displayName),
      subtitle: candidate.eligible
          ? null
          // Every reason, not the first. See the note at the top of the file.
          : Text(candidate.reasonLabels.join(' · ')),
      trailing: selected ? const Icon(Icons.radio_button_checked) : null,
      onTap: candidate.eligible
          ? () => setState(() => _selectedDriverId = candidate.driverId)
          : null,
    );
  }
}
