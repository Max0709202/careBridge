import 'package:carebridge_api/carebridge_api.dart' as wire;
import 'package:carebridge_client/carebridge_client.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/theme.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

final onboardingProvider = FutureProvider.autoDispose<wire.DriverOnboardingDto>(
  (ref) => ref.watch(driverApiProvider).onboarding(),
);

/// Applying to a transport company: the code they handed out, a number
/// dispatch can ring, and the vehicle. The application then waits for the
/// company to approve it, and the paperwork upload is the next screen.
class ApplyScreen extends ConsumerWidget {
  const ApplyScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final onboarding = ref.watch(onboardingProvider);

    // Already somebody's driver — including a place the company made for this
    // address, which reading onboarding has just claimed.
    ref.listen(onboardingProvider, (_, next) {
      if (next.value?.hasDriverProfile ?? false) {
        ref.invalidate(profileProvider);
        context.go('/today');
      }
    });

    return Scaffold(
      appBar: AppBar(
        title: const Text('Apply to drive'),
        actions: [
          IconButton(
            tooltip: 'Sign out',
            onPressed: () => ref.read(sessionProvider.notifier).signOut(),
            icon: const Icon(Icons.logout),
          ),
        ],
      ),
      body: onboarding.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => FailureBlock(
          message: error is Failure ? error.message : 'Please try again.',
          onRetry: () => ref.invalidate(onboardingProvider),
        ),
        data: (data) {
          if (data.hasDriverProfile) {
            return const Center(child: CircularProgressIndicator());
          }
          if (!data.emailVerified) return _VerifyFirst(email: data.email);
          return _ApplicationForm(fullName: data.fullName);
        },
      ),
    );
  }
}

class _VerifyFirst extends ConsumerStatefulWidget {
  const _VerifyFirst({required this.email});

  final String email;

  @override
  ConsumerState<_VerifyFirst> createState() => _VerifyFirstState();
}

class _VerifyFirstState extends ConsumerState<_VerifyFirst> {
  bool _sent = false;

  Future<void> _resend() async {
    final messenger = ScaffoldMessenger.of(context);
    try {
      await ref.read(driverApiProvider).resendVerification(widget.email);
      if (mounted) setState(() => _sent = true);
    } on Failure catch (failure) {
      messenger.showSnackBar(SnackBar(content: Text(failure.message)));
    }
  }

  @override
  Widget build(BuildContext context) {
    return EmptyState(
      icon: Icons.mark_email_read_outlined,
      title: 'Verify your email first',
      message:
          'We sent a link to ${widget.email}. Open it on this phone or any '
          'other device, then come back and tap “I’ve verified”.',
      action: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          FilledButton.icon(
            onPressed: () => ref.invalidate(onboardingProvider),
            icon: const Icon(Icons.refresh),
            label: const Text('I’ve verified'),
          ),
          const SizedBox(height: DriverSpacing.sm),
          OutlinedButton.icon(
            onPressed: _sent ? null : _resend,
            icon: const Icon(Icons.send_outlined),
            label: Text(_sent ? 'Email sent again' : 'Send the email again'),
          ),
        ],
      ),
    );
  }
}

class _ApplicationForm extends ConsumerStatefulWidget {
  const _ApplicationForm({required this.fullName});

  final String fullName;

  @override
  ConsumerState<_ApplicationForm> createState() => _ApplicationFormState();
}

class _ApplicationFormState extends ConsumerState<_ApplicationForm> {
  final _formKey = GlobalKey<FormState>();
  final _joinCode = TextEditingController();
  final _phone = TextEditingController();
  final _years = TextEditingController();
  final _make = TextEditingController();
  final _model = TextEditingController();
  final _color = TextEditingController();
  final _plate = TextEditingController();

  bool _accessible = false;
  bool _busy = false;
  String? _error;

  /// A field the server named, shown under that field.
  final Map<String, String> _fieldErrors = {};

  @override
  void dispose() {
    for (final c in [
      _joinCode,
      _phone,
      _years,
      _make,
      _model,
      _color,
      _plate,
    ]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    setState(() {
      _error = null;
      _fieldErrors.clear();
    });
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() => _busy = true);
    try {
      await ref
          .read(driverApiProvider)
          .apply(
            joinCode: _joinCode.text,
            phone: _phone.text,
            yearsDriving: int.parse(_years.text.trim()),
            make: _make.text,
            model: _model.text,
            color: _color.text,
            licensePlate: _plate.text,
            isWheelchairAccessible: _accessible,
          );
      ref.invalidate(profileProvider);
      // Approval waits on the paperwork, so that is the next thing to do.
      if (mounted) context.go('/documents');
    } on ValidationFailure catch (failure) {
      if (!mounted) return;
      setState(() {
        if (failure.field != null) {
          _fieldErrors[failure.field!] = failure.message;
          _formKey.currentState?.validate();
        } else {
          _error = failure.message;
        }
      });
    } on Failure catch (failure) {
      if (mounted) setState(() => _error = failure.message);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String? _required(String? value) =>
      (value ?? '').trim().isEmpty ? 'Required' : null;

  Widget _field(
    TextEditingController controller,
    String label, {
    String? field,
    String? helper,
    String? hint,
    TextInputType? keyboard,
    TextCapitalization capitalization = TextCapitalization.words,
    String? Function(String?)? validator,
  }) => Padding(
    padding: const EdgeInsets.only(bottom: DriverSpacing.md),
    child: TextFormField(
      controller: controller,
      keyboardType: keyboard,
      textCapitalization: capitalization,
      decoration: InputDecoration(
        labelText: label,
        helperText: helper,
        helperMaxLines: 2,
        hintText: hint,
        border: const OutlineInputBorder(),
      ),
      validator: (value) =>
          (field != null ? _fieldErrors[field] : null) ??
          (validator ?? _required)(value),
    ),
  );

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Form(
      key: _formKey,
      child: ListView(
        padding: const EdgeInsets.all(DriverSpacing.md),
        children: [
          InfoCard(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Applying as', style: theme.textTheme.labelLarge),
                Text(widget.fullName, style: theme.textTheme.titleLarge),
                const SizedBox(height: DriverSpacing.xs),
                Text(
                  'Your transport company checks this against the licence '
                  'you upload next.',
                  style: theme.textTheme.bodySmall,
                ),
              ],
            ),
          ),
          const SizedBox(height: DriverSpacing.md),
          _field(
            _joinCode,
            'Company code',
            field: 'joinCode',
            helper: 'Eight letters and numbers, like K7QM-2RXD.',
            capitalization: TextCapitalization.characters,
            validator: (value) => (value ?? '').trim().isEmpty
                ? 'Enter the code from your transport company'
                : null,
          ),
          _field(
            _phone,
            'Phone number',
            field: 'phone',
            helper: 'So dispatch can reach you during a trip.',
            keyboard: TextInputType.phone,
          ),
          _field(
            _years,
            'Years driving',
            field: 'yearsDriving',
            keyboard: TextInputType.number,
            validator: (value) {
              final years = int.tryParse((value ?? '').trim());
              return years == null || years < 0 || years > 60
                  ? 'A whole number from 0 to 60'
                  : null;
            },
          ),
          Text('Your vehicle', style: theme.textTheme.titleMedium),
          const SizedBox(height: DriverSpacing.sm),
          _field(_make, 'Make', hint: 'Toyota'),
          _field(_model, 'Model', hint: 'Sienna'),
          _field(_color, 'Colour', hint: 'Silver'),
          _field(
            _plate,
            'Licence plate',
            capitalization: TextCapitalization.characters,
          ),
          SwitchListTile(
            value: _accessible,
            contentPadding: EdgeInsets.zero,
            onChanged: (value) => setState(() => _accessible = value),
            title: const Text('Wheelchair accessible'),
          ),
          if (_error != null) ...[
            const SizedBox(height: DriverSpacing.sm),
            Text(_error!, style: TextStyle(color: theme.colorScheme.error)),
          ],
          const SizedBox(height: DriverSpacing.md),
          FilledButton(
            onPressed: _busy ? null : _submit,
            child: _busy
                ? const SizedBox.square(
                    dimension: 24,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                : const Text('Send application'),
          ),
          const SizedBox(height: DriverSpacing.sm),
          Text(
            'Next you upload your licence, insurance and registration. Your '
            'company approves you once it has checked them.',
            textAlign: TextAlign.center,
            style: theme.textTheme.bodySmall,
          ),
        ],
      ),
    );
  }
}
