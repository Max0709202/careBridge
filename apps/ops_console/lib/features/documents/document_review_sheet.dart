import 'package:carebridge_api/carebridge_api.dart' as wire;
import 'package:carebridge_client/carebridge_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../app/theme.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// Reviewing a driver's paperwork.
///
/// Three things this panel is careful about, and each is a decision rather
/// than a layout:
///
///   * **The compliance line is the reason the approve button is grey.** A
///     dispatcher who cannot see why approval is refused telephones support
///     about a bug that is not one.
///   * **Opening a document is a deliberate act.** It mints a short-lived link
///     and writes an audit row naming the person who looked. The button says
///     "Open" rather than showing a thumbnail, because a thumbnail would mean
///     every licence in the roster was fetched by anybody who scrolled past.
///   * **A rejection needs its reason typed before the button works.** The
///     server refuses one without it; making the UI refuse first turns a
///     round-trip error into a form that is simply not finished yet.
class DocumentReviewSheet extends ConsumerWidget {
  const DocumentReviewSheet({
    super.key,
    required this.organizationId,
    required this.driverId,
    required this.driverName,
  });

  final String organizationId;
  final String driverId;
  final String driverName;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final key = (organizationId: organizationId, driverId: driverId);
    final documents = ref.watch(driverDocumentsProvider(key));
    final theme = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.all(AppSpacing.lg),
      child: documents.when(
        loading: () => const LoadingBlock(),
        error: (error, _) => EmptyState(
          icon: Icons.error_outline,
          title: 'Could not load the paperwork',
          message: error is Failure ? error.message : 'Please try again.',
        ),
        data: (data) => Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('$driverName — paperwork', style: theme.textTheme.titleLarge),
            const SizedBox(height: AppSpacing.sm),
            _ComplianceLine(compliance: data),
            const SizedBox(height: AppSpacing.md),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final document in data.documents.where(
                    (d) => !d.superseded,
                  ))
                    _DocumentRow(
                      organizationId: organizationId,
                      driverId: driverId,
                      document: document,
                    ),
                  if (data.documents.every((d) => d.superseded))
                    const Padding(
                      padding: EdgeInsets.symmetric(vertical: AppSpacing.lg),
                      child: Text('Nothing has been handed in yet.'),
                    ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ComplianceLine extends StatelessWidget {
  const _ComplianceLine({required this.compliance});

  final wire.DriverComplianceDto compliance;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    if (compliance.compliant) {
      return Row(
        children: [
          Icon(
            Icons.check_circle_outline,
            size: 20,
            color: theme.colorScheme.primary,
          ),
          const SizedBox(width: AppSpacing.sm),
          Expanded(
            child: Text(
              compliance.expiringSoon.isEmpty
                  ? 'Everything current. This driver can be approved.'
                  : 'Approvable, but renew soon: ${compliance.expiringSoon.join(', ')}.',
            ),
          ),
        ],
      );
    }

    return Row(
      children: [
        Icon(Icons.pending_outlined, size: 20, color: theme.colorScheme.error),
        const SizedBox(width: AppSpacing.sm),
        Expanded(
          // Everything missing, not just the first. "Nothing is on file" and
          // "the insurance is missing" need different telephone calls.
          child: Text(
            'Cannot be approved yet — still missing: ${compliance.missing.join(', ')}.',
          ),
        ),
      ],
    );
  }
}

class _DocumentRow extends ConsumerStatefulWidget {
  const _DocumentRow({
    required this.organizationId,
    required this.driverId,
    required this.document,
  });

  final String organizationId;
  final String driverId;
  final wire.DriverDocumentDto document;

  @override
  ConsumerState<_DocumentRow> createState() => _DocumentRowState();
}

class _DocumentRowState extends ConsumerState<_DocumentRow> {
  final _note = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _note.dispose();
    super.dispose();
  }

  bool get _awaitingDecision => widget.document.status.name == 'submitted';

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final document = widget.document;

    return Padding(
      padding: const EdgeInsets.only(bottom: AppSpacing.md),
      child: OpsCard(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    document.kind.name,
                    style: theme.textTheme.titleMedium,
                  ),
                ),
                Text(document.status.name, style: theme.textTheme.labelLarge),
              ],
            ),
            if (document.reviewNote != null) ...[
              const SizedBox(height: AppSpacing.xs),
              Text(document.reviewNote!, style: theme.textTheme.bodySmall),
            ],
            const SizedBox(height: AppSpacing.sm),
            Row(
              children: [
                OutlinedButton.icon(
                  onPressed: _busy ? null : _open,
                  icon: const Icon(Icons.open_in_new, size: 18),
                  label: const Text('Open'),
                ),
                if (_awaitingDecision) ...[
                  const SizedBox(width: AppSpacing.sm),
                  FilledButton(
                    onPressed: _busy ? null : () => _review(approve: true),
                    child: const Text('Approve'),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  OutlinedButton(
                    // Grey until a reason is typed. The server refuses a
                    // rejection without one; refusing here first turns a
                    // round-trip error into a form that is not finished yet.
                    onPressed: _busy || _note.text.trim().isEmpty
                        ? null
                        : () => _review(approve: false),
                    child: const Text('Reject'),
                  ),
                ],
              ],
            ),
            if (_awaitingDecision) ...[
              const SizedBox(height: AppSpacing.sm),
              TextField(
                controller: _note,
                onChanged: (_) => setState(() {}),
                decoration: const InputDecoration(
                  labelText: 'Reason, if rejecting',
                  helperText:
                      'The driver sees this. “Rejected” with no reason is the same '
                      'photograph uploaded three times.',
                  border: OutlineInputBorder(),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _open() async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);

    try {
      final view = await ref
          .read(opsApiProvider)
          .viewDocument(
            organizationId: widget.organizationId,
            driverId: widget.driverId,
            documentId: widget.document.id,
          );
      // A new tab rather than an inline image: the link is short-lived and
      // single-purpose, and rendering it here would keep it alive in this page
      // for as long as the panel is open.
      await launchUrl(Uri.parse(view.url), webOnlyWindowName: '_blank');
    } on Failure catch (failure) {
      messenger.showSnackBar(SnackBar(content: Text(failure.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _review({required bool approve}) async {
    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);

    try {
      await ref
          .read(opsApiProvider)
          .reviewDocument(
            organizationId: widget.organizationId,
            driverId: widget.driverId,
            documentId: widget.document.id,
            approve: approve,
            note: _note.text.trim(),
          );

      ref.invalidate(
        driverDocumentsProvider((
          organizationId: widget.organizationId,
          driverId: widget.driverId,
        )),
      );
      // The roster shows approvability, so it has to re-read too.
      ref.invalidate(driversProvider(widget.organizationId));
    } on Failure catch (failure) {
      messenger.showSnackBar(SnackBar(content: Text(failure.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}
