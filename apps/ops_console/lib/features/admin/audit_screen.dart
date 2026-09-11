import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../app/theme.dart';
import '../../domain/admin.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// The audit log.
///
/// Two properties of this screen are not stylistic choices.
///
/// **It pages by cursor and appends.** The audit table is written to on every
/// authenticated action, so rows arrive while somebody is reading. An offset
/// page would skip the rows that shifted under it, and a log that quietly
/// omits rows is the one failure a log cannot have. The cursor comes from the
/// previous page and from nowhere else.
///
/// **It shows field names, never values.** That is the server's restraint —
/// `changedFields` carries names alone — and it is what lets support staff
/// read this log without being entitled to the records it describes. Nothing
/// here fetches the record behind a row to fill the gap in.
class AuditScreen extends ConsumerStatefulWidget {
  const AuditScreen({super.key});

  @override
  ConsumerState<AuditScreen> createState() => _AuditScreenState();
}

class _AuditScreenState extends ConsumerState<AuditScreen> {
  final _action = TextEditingController();
  final _entityType = TextEditingController();
  final _entityId = TextEditingController();

  final List<AuditEntry> _entries = [];
  AuditFilter _filter = const AuditFilter();
  String? _cursor;
  bool _loading = true;
  bool _appending = false;
  Object? _error;

  @override
  void initState() {
    super.initState();
    _reload();
  }

  @override
  void dispose() {
    _action.dispose();
    _entityType.dispose();
    _entityId.dispose();
    super.dispose();
  }

  /// Reads the first page under the current filter, discarding what was held.
  ///
  /// A filter change starts a new keyset walk. Keeping the old rows and
  /// appending the new ones would produce a list that matches two different
  /// questions and says which for neither.
  Future<void> _reload() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final page = await ref.read(opsApiProvider).auditLog(filter: _filter);
      if (!mounted) return;
      setState(() {
        _entries
          ..clear()
          ..addAll(page.entries);
        _cursor = page.nextCursor;
        _loading = false;
      });
    } catch (error) {
      if (!mounted) return;
      setState(() {
        _error = error;
        _loading = false;
      });
    }
  }

  Future<void> _appendPage() async {
    final cursor = _cursor;
    if (cursor == null || _appending) return;

    setState(() => _appending = true);
    try {
      final page = await ref
          .read(opsApiProvider)
          .auditLog(filter: _filter, cursor: cursor);
      if (!mounted) return;
      setState(() {
        _entries.addAll(page.entries);
        _cursor = page.nextCursor;
      });
    } catch (error) {
      if (mounted) showFailure(context, error);
    } finally {
      if (mounted) setState(() => _appending = false);
    }
  }

  void _applyFilter() {
    setState(
      () => _filter = AuditFilter(
        action: _action.text.trim(),
        entityType: _entityType.text.trim(),
        entityId: _entityId.text.trim(),
      ),
    );
    _reload();
  }

  void _clearFilter() {
    _action.clear();
    _entityType.clear();
    _entityId.clear();
    setState(() => _filter = const AuditFilter());
    _reload();
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Column(
      children: [
        _filters(theme),
        const Divider(height: 1),
        Expanded(child: _list(theme)),
      ],
    );
  }

  Widget _filters(ThemeData theme) => Padding(
    padding: const EdgeInsets.all(AppSpacing.md),
    child: Wrap(
      spacing: AppSpacing.sm,
      runSpacing: AppSpacing.sm,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        SizedBox(
          width: 220,
          child: TextField(
            controller: _action,
            onSubmitted: (_) => _applyFilter(),
            decoration: const InputDecoration(
              labelText: 'Action',
              // Matched as a prefix by the server, which is the whole reason
              // the hint says so: "driver." is a useful query and "driver"
              // alone looks like it should be one.
              helperText: 'Prefix, e.g. driver.',
              isDense: true,
            ),
          ),
        ),
        SizedBox(
          width: 180,
          child: TextField(
            controller: _entityType,
            onSubmitted: (_) => _applyFilter(),
            decoration: const InputDecoration(
              labelText: 'Entity type',
              helperText: 'e.g. Ride',
              isDense: true,
            ),
          ),
        ),
        SizedBox(
          width: 260,
          child: TextField(
            controller: _entityId,
            onSubmitted: (_) => _applyFilter(),
            decoration: const InputDecoration(
              labelText: 'Entity id',
              helperText: 'Everything that happened to one record',
              isDense: true,
            ),
          ),
        ),
        FilledButton(onPressed: _applyFilter, child: const Text('Search')),
        if (!_filter.isEmpty)
          TextButton(onPressed: _clearFilter, child: const Text('Clear')),
      ],
    ),
  );

  Widget _list(ThemeData theme) {
    if (_loading) return const LoadingBlock();

    if (_error != null) {
      return ListView(
        children: [
          EmptyState(
            icon: Icons.cloud_off_outlined,
            title: 'Could not read the log',
            message: 'Check your connection and try again.',
            action: OutlinedButton(
              onPressed: _reload,
              child: const Text('Retry'),
            ),
          ),
        ],
      );
    }

    if (_entries.isEmpty) {
      return ListView(
        children: [
          EmptyState(
            icon: Icons.history_toggle_off_outlined,
            title: 'Nothing matches',
            // Said plainly, because an empty audit result under a filter is
            // ambiguous in a way an empty queue is not: it can mean "nothing
            // happened" or "that is not what the action is called".
            message: _filter.isEmpty
                ? 'No audited actions have been recorded yet.'
                : 'No audited action matches that filter. Actions are dotted, '
                      'like driver.approved or ride.assigned.',
          ),
        ],
      );
    }

    return ListView.separated(
      padding: const EdgeInsets.all(AppSpacing.md),
      itemCount: _entries.length + 1,
      separatorBuilder: (_, _) => const SizedBox(height: AppSpacing.sm),
      itemBuilder: (context, index) {
        if (index == _entries.length) return _footer(theme);
        return _row(theme, _entries[index]);
      },
    );
  }

  Widget _footer(ThemeData theme) => Padding(
    padding: const EdgeInsets.symmetric(vertical: AppSpacing.md),
    child: Center(
      child: _cursor == null
          ? Text(
              'End of the log for this filter.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            )
          : OutlinedButton(
              onPressed: _appending ? null : _appendPage,
              child: Text(_appending ? 'Loading…' : 'Load more'),
            ),
    ),
  );

  Widget _row(ThemeData theme, AuditEntry entry) => OpsCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(
              // A person and a scheduled job are different kinds of actor and
              // the difference is the first thing anybody reading this log
              // needs: "who did this" has a different answer when the answer
              // is "the renewal sweep".
              entry.isSystem
                  ? Icons.settings_suggest_outlined
                  : Icons.person_outline,
              size: 18,
              color: theme.colorScheme.onSurfaceVariant,
            ),
            const SizedBox(width: AppSpacing.sm),
            Expanded(
              child: Text(
                '${entry.actorLabel} — ${entry.action}',
                style: theme.textTheme.bodyLarge,
              ),
            ),
            Text(
              DateFormat('d MMM y, HH:mm:ss').format(entry.at.toLocal()),
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
        const SizedBox(height: AppSpacing.xs),
        Text(
          entry.entityId == null
              ? entry.entityType
              : '${entry.entityType} ${entry.entityId}',
          style: theme.textTheme.bodySmall?.copyWith(
            color: theme.colorScheme.onSurfaceVariant,
          ),
        ),
        if (entry.changedFields.isNotEmpty)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.xs),
            child: Text(
              // Names, never values. The wording says so out loud rather than
              // leaving a reader to wonder whether the values were withheld or
              // simply not changed.
              'Fields changed: ${entry.changedFields.join(', ')}',
              style: theme.textTheme.bodySmall,
            ),
          ),
        if (entry.correlationId != null)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.xs),
            child: Text(
              // The join between this row and the request logs. Printed
              // because it is the only way to get from "somebody did this" to
              // "and here is everything else that request did".
              'Correlation ${entry.correlationId}',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.outline,
              ),
            ),
          ),
      ],
    ),
  );
}
