import 'package:carebridge_client/carebridge_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../app/theme.dart';
import '../../core/money.dart';
import '../../domain/admin.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// Sending money back.
///
/// The screen opens on a lookup rather than on a list, and that is the API's
/// shape rather than an omission: a refund is issued against **one invoice**
/// somebody is already looking at — a support conversation, a dispute, a
/// duplicate charge — and there is no endpoint that lists invoices across
/// every account. Building one would mean a screen that browses everybody's
/// billing history, which is a much larger thing to hold than the ability to
/// credit an invoice whose number you were given.
///
/// Three things are shown before the amount field, deliberately:
///
///   * **What is left.** The ceiling on a new refund is the payment less
///     everything already credited against it. The server enforces it; showing
///     it stops somebody typing a figure that is refused.
///   * **What was already refunded.** Including the reason and who asked for
///     it, because "has this already been done" is the question that precedes
///     every duplicate credit.
///   * **Whether one is still in flight.** A `pending` row is money that may
///     still be moving. Issuing a second refund on top of it is how an account
///     gets credited twice.
class RefundsScreen extends ConsumerStatefulWidget {
  const RefundsScreen({super.key});

  @override
  ConsumerState<RefundsScreen> createState() => _RefundsScreenState();
}

class _RefundsScreenState extends ConsumerState<RefundsScreen> {
  final _invoiceId = TextEditingController();
  RefundableInvoice? _invoice;
  bool _looking = false;
  Object? _error;

  @override
  void dispose() {
    _invoiceId.dispose();
    super.dispose();
  }

  Future<void> _lookUp() async {
    final id = _invoiceId.text.trim();
    if (id.isEmpty) return;

    setState(() {
      _looking = true;
      _error = null;
      _invoice = null;
    });

    try {
      final found = await ref.read(opsApiProvider).refundable(id);
      if (mounted) setState(() => _invoice = found);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    } finally {
      if (mounted) setState(() => _looking = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return ListView(
      padding: const EdgeInsets.all(AppSpacing.md),
      children: [
        OpsCard(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Find an invoice', style: theme.textTheme.titleMedium),
              const SizedBox(height: AppSpacing.sm),
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: TextField(
                      controller: _invoiceId,
                      onSubmitted: (_) => _lookUp(),
                      decoration: const InputDecoration(
                        labelText: 'Invoice id',
                        helperText:
                            'The identifier, not the printed number — it is on '
                            'the invoice the payer is looking at.',
                        isDense: true,
                      ),
                    ),
                  ),
                  const SizedBox(width: AppSpacing.sm),
                  FilledButton(
                    onPressed: _looking ? null : _lookUp,
                    child: Text(_looking ? 'Looking…' : 'Look up'),
                  ),
                ],
              ),
            ],
          ),
        ),
        if (_error != null)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.md),
            child: EmptyState(
              icon: Icons.search_off_outlined,
              title: 'Nothing to refund there',
              // The shared message. The server answers "no such invoice" and
              // "nothing was ever paid on it" and "not yours" the same way,
              // and this screen must not invent a distinction it was not
              // given.
              message: _error is Failure
                  ? (_error! as Failure).message
                  : 'Something went wrong. Please try again.',
            ),
          ),
        if (_invoice != null) ...[
          const SizedBox(height: AppSpacing.md),
          _summary(theme, _invoice!),
          const SectionHeader('Already refunded'),
          if (_invoice!.refunds.isEmpty)
            const EmptyState(
              icon: Icons.history_outlined,
              title: 'Nothing yet',
              message: 'No credit has been issued against this payment.',
            )
          else
            for (final refund in _invoice!.refunds) ...[
              _refundRow(theme, refund),
              const SizedBox(height: AppSpacing.sm),
            ],
        ],
      ],
    );
  }

  Widget _summary(ThemeData theme, RefundableInvoice invoice) => OpsCard(
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          'Invoice ${invoice.invoiceNumber}',
          style: theme.textTheme.titleMedium,
        ),
        const SizedBox(height: AppSpacing.sm),
        _row(theme, 'Paid', formatCents(invoice.paidCents)),
        _row(theme, 'Already refunded', formatCents(invoice.refundedCents)),
        _row(theme, 'Left to refund', formatCents(invoice.refundableCents)),
        if (invoice.hasInFlightRefund)
          Padding(
            padding: const EdgeInsets.only(top: AppSpacing.sm),
            child: Row(
              children: [
                const Icon(Icons.schedule, size: 16, color: OpsColors.imminent),
                const SizedBox(width: AppSpacing.xs),
                Expanded(
                  child: Text(
                    'A refund is still in flight. Wait for it to settle before '
                    'issuing another, or the account is credited twice.',
                    style: theme.textTheme.bodySmall,
                  ),
                ),
              ],
            ),
          ),
        const SizedBox(height: AppSpacing.md),
        if (invoice.isFullyRefunded)
          Text(
            'Everything paid on this invoice has been refunded.',
            style: theme.textTheme.bodyMedium,
          )
        else
          FilledButton.icon(
            onPressed: () => _openRefundForm(invoice),
            icon: const Icon(Icons.undo_outlined),
            label: const Text('Refund'),
          ),
      ],
    ),
  );

  Future<void> _openRefundForm(RefundableInvoice invoice) async {
    final issued = await showDialog<RefundableInvoice>(
      context: context,
      builder: (context) => _RefundDialog(invoice: invoice),
    );
    if (issued != null && mounted) setState(() => _invoice = issued);
  }

  Widget _row(ThemeData theme, String label, String value) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 2),
    child: Row(
      children: [
        Expanded(child: Text(label, style: theme.textTheme.bodyMedium)),
        Text(value, style: theme.textTheme.bodyMedium),
      ],
    ),
  );

  Widget _refundRow(ThemeData theme, Refund refund) {
    final (icon, color) = switch (refund.status) {
      RefundStatus.succeeded => (
        Icons.check_circle_outline,
        OpsColors.positive,
      ),
      RefundStatus.pending => (Icons.schedule, OpsColors.imminent),
      RefundStatus.failed => (Icons.error_outline, OpsColors.overdue),
    };

    return OpsCard(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              // Icon and word, never colour alone.
              Icon(icon, size: 18, color: color),
              const SizedBox(width: AppSpacing.sm),
              Expanded(
                child: Text(
                  '${formatCents(refund.amountCents)} · ${refund.status.label}',
                  style: theme.textTheme.bodyLarge,
                ),
              ),
              Text(
                DateFormat('d MMM y, HH:mm').format(refund.createdAt.toLocal()),
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
          ),
          const SizedBox(height: AppSpacing.xs),
          Text(refund.reason, style: theme.textTheme.bodyMedium),
          Text(
            'Asked for by ${refund.requestedByName}',
            style: theme.textTheme.bodySmall?.copyWith(
              color: theme.colorScheme.onSurfaceVariant,
            ),
          ),
          if (refund.failureMessage != null)
            Padding(
              padding: const EdgeInsets.only(top: AppSpacing.xs),
              child: Text(
                refund.failureMessage!,
                style: theme.textTheme.bodySmall?.copyWith(
                  color: theme.colorScheme.error,
                ),
              ),
            ),
        ],
      ),
    );
  }
}

/// The amount and the reason, with the ceiling enforced before it is sent.
class _RefundDialog extends ConsumerStatefulWidget {
  const _RefundDialog({required this.invoice});

  final RefundableInvoice invoice;

  @override
  ConsumerState<_RefundDialog> createState() => _RefundDialogState();
}

class _RefundDialogState extends ConsumerState<_RefundDialog> {
  late final TextEditingController _amount = TextEditingController(
    // Defaults to the whole remaining balance, because a full refund is the
    // common case and typing the figure again is a chance to mistype it.
    text: (widget.invoice.refundableCents / 100).toStringAsFixed(2),
  );
  final _reason = TextEditingController();
  bool _busy = false;
  String? _amountError;

  @override
  void dispose() {
    _amount.dispose();
    _reason.dispose();
    super.dispose();
  }

  /// Dollars typed by a person, as integer cents.
  ///
  /// Parsed as a decimal and multiplied, then rounded once. Never held as a
  /// double beyond that line: money in this system is cents everywhere, and
  /// this is the single point where a person's "12.34" becomes 1234.
  int? get _cents {
    final parsed = double.tryParse(_amount.text.trim().replaceAll(',', ''));
    if (parsed == null) return null;
    return (parsed * 100).round();
  }

  Future<void> _issue() async {
    final cents = _cents;
    final reason = _reason.text.trim();

    setState(() {
      _amountError = switch (cents) {
        null => 'Enter an amount, like 24.50.',
        <= 0 => 'A refund has to be more than nothing.',
        _ when cents > widget.invoice.refundableCents =>
          'Only ${formatCents(widget.invoice.refundableCents)} is left on this '
              'payment.',
        _ => null,
      };
    });
    if (_amountError != null || cents == null) return;
    if (reason.length < 3) return;

    setState(() => _busy = true);
    try {
      final updated = await ref
          .read(opsApiProvider)
          .issueRefund(
            invoiceId: widget.invoice.invoiceId,
            // Carried from the lookup rather than resolved on the server, so
            // the credit lands on the payment that was on screen.
            paymentId: widget.invoice.paymentId,
            amountCents: cents,
            reason: reason,
          );
      if (mounted) Navigator.of(context).pop(updated);
    } catch (error) {
      if (mounted) showFailure(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return AlertDialog(
      title: Text('Refund invoice ${widget.invoice.invoiceNumber}'),
      content: SizedBox(
        width: 440,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            TextField(
              controller: _amount,
              autofocus: true,
              keyboardType: const TextInputType.numberWithOptions(
                decimal: true,
              ),
              onChanged: (_) => setState(() => _amountError = null),
              decoration: InputDecoration(
                labelText: 'Amount',
                prefixText: '\$',
                errorText: _amountError,
                helperText:
                    '${formatCents(widget.invoice.refundableCents)} left on '
                    'this payment.',
              ),
            ),
            const SizedBox(height: AppSpacing.sm),
            TextField(
              controller: _reason,
              maxLength: 300,
              maxLines: 2,
              onChanged: (_) => setState(() {}),
              decoration: const InputDecoration(
                labelText: 'Why',
                // Required by the server, and the sentence says why rather
                // than reporting a validation rule.
                helperText:
                    'An unexplained credit is something somebody has to '
                    'justify to an accountant a quarter later.',
              ),
            ),
            Text(
              'The refund is recorded here before the processor is called, so '
              'a credit that succeeded externally and failed to record is '
              'still explicable.',
              style: theme.textTheme.bodySmall?.copyWith(
                color: theme.colorScheme.onSurfaceVariant,
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _busy ? null : () => Navigator.of(context).pop(),
          child: const Text('Cancel'),
        ),
        FilledButton(
          onPressed: _busy || _reason.text.trim().length < 3 ? null : _issue,
          child: Text(_busy ? 'Sending…' : 'Send the money back'),
        ),
      ],
    );
  }
}
