import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../app/theme.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// Sign-in for the console.
///
/// The same credentials as the family app, because they are the same accounts:
/// a person is a `User`, and what they may do here comes from an
/// `OrganizationMembership` rather than from a separate identity. Two account
/// systems would mean two password resets, two MFA enrolments and two places
/// for an offboarded dispatcher to still have access.
class SignInScreen extends ConsumerStatefulWidget {
  const SignInScreen({super.key});

  @override
  ConsumerState<SignInScreen> createState() => _SignInScreenState();
}

class _SignInScreenState extends ConsumerState<SignInScreen> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _busy = false;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() => _busy = true);
    try {
      await ref
          .read(sessionProvider.notifier)
          .signIn(email: _email.text, password: _password.text);
    } catch (error) {
      if (mounted) showFailure(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(AppSpacing.lg),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 380),
            child: Form(
              key: _formKey,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text('CareBridge ops', style: theme.textTheme.titleLarge),
                  const SizedBox(height: AppSpacing.xs),
                  Text(
                    'Dispatch console for transport operators.',
                    style: theme.textTheme.bodyMedium?.copyWith(
                      color: theme.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  TextFormField(
                    controller: _email,
                    autofillHints: const [AutofillHints.username],
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(labelText: 'Email'),
                    validator: (value) =>
                        (value == null || value.trim().isEmpty)
                        ? 'Enter your email address'
                        : null,
                  ),
                  const SizedBox(height: AppSpacing.md),
                  TextFormField(
                    controller: _password,
                    autofillHints: const [AutofillHints.password],
                    obscureText: true,
                    decoration: const InputDecoration(labelText: 'Password'),
                    onFieldSubmitted: (_) => _submit(),
                    validator: (value) => (value == null || value.isEmpty)
                        ? 'Enter your password'
                        : null,
                  ),
                  const SizedBox(height: AppSpacing.lg),
                  FilledButton(
                    onPressed: _busy ? null : _submit,
                    child: Text(_busy ? 'Signing in…' : 'Sign in'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
