import 'package:carebridge_api/carebridge_api.dart' as wire;
import 'package:carebridge_client/carebridge_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../app/theme.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// The driver's paperwork.
///
/// Two things this screen has to do well, and they pull against each other. It
/// has to make an upload easy enough that somebody does it in a car park on a
/// Tuesday — one tap per document, camera or gallery. And it has to say
/// clearly *why* something was rejected, because being told "you cannot drive"
/// without being told which document and why is how the same unreadable
/// photograph gets uploaded three times and then telephoned about.
class DocumentsScreen extends ConsumerWidget {
  const DocumentsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final documents = ref.watch(documentsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Your paperwork')),
      body: documents.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => FailureBlock(
          message: error is Failure ? error.message : 'Please try again.',
          onRetry: () => ref.invalidate(documentsProvider),
        ),
        data: (data) => RefreshIndicator(
          onRefresh: () async => ref.invalidate(documentsProvider),
          child: ListView(
            padding: const EdgeInsets.all(DriverSpacing.md),
            children: [
              _Summary(documents: data),
              const SizedBox(height: DriverSpacing.md),
              for (final kind in _kinds) ...[
                _DocumentTile(kind: kind, documents: data),
                const SizedBox(height: DriverSpacing.sm),
              ],
            ],
          ),
        ),
      ),
    );
  }

  /// The order they are asked for, which is the order somebody has them to
  /// hand: the licence in a wallet, then the two papers in a glovebox.
  static const _kinds = [
    'driversLicence',
    'vehicleInsurance',
    'vehicleRegistration',
    'backgroundCheck',
  ];
}

String _label(String kind) => switch (kind) {
  'driversLicence' => 'Driving licence',
  'vehicleInsurance' => 'Vehicle insurance',
  'vehicleRegistration' => 'Vehicle registration',
  'backgroundCheck' => 'Background check',
  _ => kind,
};

class _Summary extends StatelessWidget {
  const _Summary({required this.documents});

  final wire.DriverDocumentsDto documents;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    if (documents.compliant) {
      return InfoCard(
        child: Row(
          children: [
            Icon(Icons.check_circle_outline, color: theme.colorScheme.primary),
            const SizedBox(width: DriverSpacing.md),
            const Expanded(
              child: Text(
                'Everything your operator needs is on file. They can approve you '
                'to drive.',
              ),
            ),
          ],
        ),
      );
    }

    return InfoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Still needed', style: theme.textTheme.titleMedium),
          const SizedBox(height: DriverSpacing.xs),
          // Every missing document, not just the first. "Nothing is on file"
          // and "the insurance is missing" are two different afternoons.
          Text(documents.missing.map(_label).join(', ')),
          if (documents.expiringSoon.isNotEmpty) ...[
            const SizedBox(height: DriverSpacing.md),
            Text(
              'Renew soon: ${documents.expiringSoon.map(_label).join(', ')}. '
              'These lapse within a month, and you come off the road the day '
              'they do.',
              style: theme.textTheme.bodyMedium,
            ),
          ],
        ],
      ),
    );
  }
}

class _DocumentTile extends ConsumerStatefulWidget {
  const _DocumentTile({required this.kind, required this.documents});

  final String kind;
  final wire.DriverDocumentsDto documents;

  @override
  ConsumerState<_DocumentTile> createState() => _DocumentTileState();
}

class _DocumentTileState extends ConsumerState<_DocumentTile> {
  bool _busy = false;

  wire.DriverDocumentDto? get _current {
    for (final document in widget.documents.documents) {
      if (document.kind.name == widget.kind && !document.superseded) {
        return document;
      }
    }
    return null;
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final document = _current;

    return InfoCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  _label(widget.kind),
                  style: theme.textTheme.titleMedium,
                ),
              ),
              _StatusChip(status: document?.status.name),
            ],
          ),
          if (document?.reviewNote != null) ...[
            const SizedBox(height: DriverSpacing.sm),
            // The reason, in the reviewer's own words. Without it somebody
            // re-uploads the same photograph and telephones.
            Text(
              document!.reviewNote!,
              style: theme.textTheme.bodyMedium?.copyWith(
                color: theme.colorScheme.error,
              ),
            ),
          ],
          if (document?.expiresAt != null) ...[
            const SizedBox(height: DriverSpacing.xs),
            Text(
              'Expires ${document!.expiresAt!.toLocal().toString().split(' ').first}',
              style: theme.textTheme.bodySmall,
            ),
          ],
          const SizedBox(height: DriverSpacing.md),
          OutlinedButton.icon(
            onPressed: _busy ? null : _upload,
            icon: _busy
                ? const SizedBox.square(
                    dimension: 18,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Icon(Icons.upload_file),
            label: Text(document == null ? 'Add a photo' : 'Replace'),
          ),
        ],
      ),
    );
  }

  /// Authorise, upload, confirm.
  ///
  /// Three steps rather than one because the bytes never pass through the API:
  /// the server signs a URL that permits exactly this file, this size and this
  /// type for ten minutes, the phone PUTs straight to storage, and the server
  /// then checks storage rather than believing this app.
  Future<void> _upload() async {
    final picker = ImagePicker();
    final picked = await picker.pickImage(
      source: ImageSource.gallery,
      // Enough to read an expiry date, small enough to send on a car park's
      // signal. A twelve-megapixel original is four times the size for no
      // extra legibility.
      maxWidth: 2400,
      imageQuality: 85,
    );
    if (picked == null || !mounted) return;

    setState(() => _busy = true);
    final messenger = ScaffoldMessenger.of(context);

    try {
      final api = ref.read(driverApiProvider);
      final bytes = await picked.readAsBytes();

      final slot = await api.authoriseUpload(
        kind: widget.kind,
        contentType: 'image/jpeg',
      );
      await api.uploadBytes(slot: slot, bytes: bytes);
      await api.confirmUpload(slot.documentId);

      ref.invalidate(documentsProvider);
      ref.invalidate(profileProvider);
      messenger.showSnackBar(
        const SnackBar(content: Text('Sent to your operator to review.')),
      );
    } on Failure catch (failure) {
      messenger.showSnackBar(SnackBar(content: Text(failure.message)));
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }
}

class _StatusChip extends StatelessWidget {
  const _StatusChip({required this.status});

  final String? status;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    // Icon and word, never colour alone — the same WCAG 1.4.1 rule the rest of
    // this app follows.
    final (IconData icon, String label, Color colour) = switch (status) {
      'approved' => (Icons.check_circle_outline, 'Approved', scheme.primary),
      'submitted' => (
        Icons.hourglass_empty,
        'With your operator',
        scheme.tertiary,
      ),
      'rejected' => (Icons.error_outline, 'Not accepted', scheme.error),
      'expired' => (Icons.event_busy_outlined, 'Expired', scheme.error),
      'awaitingUpload' => (Icons.upload_outlined, 'Not sent', scheme.outline),
      _ => (Icons.remove_circle_outline, 'Nothing yet', scheme.outline),
    };

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icon, size: 18, color: colour),
        const SizedBox(width: DriverSpacing.xs),
        Text(
          label,
          style: TextStyle(color: colour, fontWeight: FontWeight.w600),
        ),
      ],
    );
  }
}
