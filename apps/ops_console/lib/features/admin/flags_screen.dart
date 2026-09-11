import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../app/theme.dart';
import '../../domain/admin.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// Feature flags, and the one confirmation that matters.
///
/// Widening a rollout is ordinary. **Narrowing one takes a feature away from
/// people who already have it**, which reads to them as a bug rather than as a
/// decision — so it is confirmed, in words, before it is sent. The server
/// refuses a narrowing that did not say so; this screen exists so the refusal
/// is a question rather than an error.
///
/// Turning the master switch off is the widest possible narrowing and is
/// confirmed the same way. It is also the thing somebody reaches for at three
/// in the afternoon when a release is misbehaving, so the confirmation says
/// what it will do and does not stand in the way.
class FlagsScreen extends ConsumerWidget {
  const FlagsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final flags = ref.watch(featureFlagsProvider);

    return Scaffold(
      body: RefreshIndicator(
        onRefresh: () async => ref.invalidate(featureFlagsProvider),
        child: flags.when(
          loading: () => const LoadingBlock(),
          error: (error, _) => ListView(
            children: [
              EmptyState(
                icon: Icons.cloud_off_outlined,
                title: 'Could not load the flags',
                message: 'Check your connection and try again.',
                action: OutlinedButton(
                  onPressed: () => ref.invalidate(featureFlagsProvider),
                  child: const Text('Retry'),
                ),
              ),
            ],
          ),
          data: (list) => ListView(
            padding: const EdgeInsets.all(AppSpacing.md),
            children: [
              if (list.isEmpty)
                const EmptyState(
                  icon: Icons.toggle_off_outlined,
                  title: 'No flags yet',
                  message:
                      'A flag appears here once something creates it. Adding '
                      'one below creates it.',
                )
              else
                for (final flag in list) ...[
                  _FlagCard(flag: flag),
                  const SizedBox(height: AppSpacing.sm),
                ],
            ],
          ),
        ),
      ),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: () => _edit(context, ref, null),
        icon: const Icon(Icons.add),
        label: const Text('New flag'),
      ),
    );
  }
}

/// One flag, with what it is doing said in a sentence rather than as two
/// numbers a reader has to combine.
class _FlagCard extends ConsumerWidget {
  const _FlagCard({required this.flag});

  final FeatureFlag flag;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = Theme.of(context);

    return OpsCard(
      onTap: () => _edit(context, ref, flag),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Icon(
                flag.enabled
                    ? Icons.toggle_on_outlined
                    : Icons.toggle_off_outlined,
                color: flag.enabled
                    ? OpsColors.positive
                    : theme.colorScheme.outline,
              ),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(flag.key, style: theme.textTheme.titleMedium),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(flag.description, style: theme.textTheme.bodyMedium),
          const SizedBox(height: AppSpacing.xs),
          Text(
            flag.summary,
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          Text(
            'Changed ${DateFormat('d MMM y, HH:mm').format(flag.updatedAt.toLocal())}'
            '${flag.updatedByName == null ? '' : ' by ${flag.updatedByName}'}',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.outline,
            ),
          ),
        ],
      ),
    );
  }
}

/// Opens the editor. [existing] null creates a flag.
Future<void> _edit(
  BuildContext context,
  WidgetRef ref,
  FeatureFlag? existing,
) async {
  final saved = await showDialog<bool>(
    context: context,
    builder: (context) => _FlagDialog(existing: existing),
  );
  if (saved ?? false) ref.invalidate(featureFlagsProvider);
}

class _FlagDialog extends ConsumerStatefulWidget {
  const _FlagDialog({required this.existing});

  final FeatureFlag? existing;

  @override
  ConsumerState<_FlagDialog> createState() => _FlagDialogState();
}

class _FlagDialogState extends ConsumerState<_FlagDialog> {
  late final TextEditingController _key = TextEditingController(
    text: widget.existing?.key ?? '',
  );
  late final TextEditingController _description = TextEditingController(
    text: widget.existing?.description ?? '',
  );
  late bool _enabled = widget.existing?.enabled ?? false;
  late double _percent = (widget.existing?.rolloutPercent ?? 100).toDouble();
  bool _busy = false;

  @override
  void dispose() {
    _key.dispose();
    _description.dispose();
    super.dispose();
  }

  bool get _isNew => widget.existing == null;

  /// Whether saving would take the feature away from anybody who has it.
  ///
  /// Mirrors `rolloutTakesFeatureAway` on the server. A new flag can never
  /// narrow — there is nobody holding it yet.
  bool get _takesAway =>
      widget.existing?.takesAwayBy(
        nextEnabled: _enabled,
        nextPercent: _percent.round(),
      ) ??
      false;

  Future<void> _save() async {
    if (_key.text.trim().isEmpty || _description.text.trim().isEmpty) return;

    if (_takesAway && !await _confirmNarrowing()) return;

    setState(() => _busy = true);
    try {
      await ref
          .read(opsApiProvider)
          .setFlag(
            key: _key.text.trim(),
            description: _description.text.trim(),
            enabled: _enabled,
            rolloutPercent: _percent.round(),
            // Sent only when it was actually asked. Always sending it would
            // turn a deliberate speed bump into a field nobody reads.
            confirmNarrowing: _takesAway,
          );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      // Includes the refusal a support account gets for a write: the server
      // answers it with the same message every refused lookup uses, which is
      // the right thing for it to say and the right thing for this to show.
      if (mounted) showFailure(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<bool> _confirmNarrowing() async {
    final existing = widget.existing!;
    final next = _percent.round();

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('This takes the feature away'),
        content: Text(
          !_enabled
              ? 'Switching ${existing.key} off removes it from everybody who '
                    'has it right now, including the '
                    '${existing.rolloutPercent}% it was rolled out to. They '
                    'will see it disappear.'
              : 'Narrowing ${existing.key} from ${existing.rolloutPercent}% to '
                    '$next% removes it from people who already have it. To '
                    'them that reads as a bug rather than as a decision.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Keep as it is'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Take it away'),
          ),
        ],
      ),
    );

    return confirmed ?? false;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return AlertDialog(
      title: Text(_isNew ? 'New flag' : widget.existing!.key),
      // Scrollable rather than sized to fit: the form is a field taller when
      // it is creating a flag than when it is editing one, and a dialog that
      // overflows on a short window hides the save button behind the fold.
      content: SizedBox(
        width: 460,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              if (_isNew)
                TextField(
                  controller: _key,
                  autofocus: true,
                  decoration: const InputDecoration(
                    labelText: 'Key',
                    helperText: 'What the code asks for, e.g. marketplace',
                  ),
                ),
              const SizedBox(height: AppSpacing.sm),
              TextField(
                controller: _description,
                maxLength: 200,
                decoration: const InputDecoration(
                  labelText: 'Description',
                  helperText:
                      'What this switches on, for whoever reads it next',
                ),
              ),
              SwitchListTile(
                contentPadding: EdgeInsets.zero,
                value: _enabled,
                onChanged: (value) => setState(() => _enabled = value),
                title: const Text('Enabled'),
                // The master switch is checked before the percentage, so turning
                // it off is instant and complete rather than "off for the ninety
                // per cent who were not in the rollout".
                subtitle: const Text(
                  'Off here means off for everybody, whatever the rollout says.',
                ),
              ),
              const SizedBox(height: AppSpacing.sm),
              Text(
                'Rollout: ${_percent.round()}%',
                style: theme.textTheme.bodyMedium,
              ),
              Slider(
                value: _percent,
                max: 100,
                divisions: 100,
                label: '${_percent.round()}%',
                onChanged: _enabled
                    ? (value) => setState(() => _percent = value)
                    : null,
              ),
              Text(
                'Applied to a stable hash of the subject, so the same person is '
                'on the same side of the line on every request.',
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
              if (_takesAway)
                Padding(
                  padding: const EdgeInsets.only(top: AppSpacing.sm),
                  child: Row(
                    children: [
                      const Icon(
                        Icons.warning_amber_outlined,
                        size: 16,
                        color: OpsColors.imminent,
                      ),
                      const SizedBox(width: AppSpacing.xs),
                      Expanded(
                        child: Text(
                          'This takes the feature away from people who have it. '
                          'You will be asked to confirm.',
                          style: theme.textTheme.bodySmall,
                        ),
                      ),
                    ],
                  ),
                ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _busy ? null : _save,
          child: Text(_busy ? 'Saving…' : 'Save'),
        ),
      ],
    );
  }
}
