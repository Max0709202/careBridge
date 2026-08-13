import 'package:carebridge_api/carebridge_api.dart' as wire;
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../app/theme.dart';
import '../../domain/permissions.dart';
import '../../state/providers.dart';
import '../../widgets/common.dart';

/// Who can see this patient, and who has been asked to.
///
/// An invitation grants standing access to a vulnerable person's home address,
/// appointment schedule and — from Stage 3 — their live position during a
/// ride. The copy on this screen says that plainly, because the person sending
/// one is usually thinking "let my brother see this", not "grant a standing
/// capability".
class CareCircleScreen extends ConsumerStatefulWidget {
  const CareCircleScreen({super.key, required this.patientId});

  final String patientId;

  @override
  ConsumerState<CareCircleScreen> createState() => _CareCircleScreenState();
}

class _CareCircleScreenState extends ConsumerState<CareCircleScreen> {
  List<wire.InvitationDto>? _invitations;
  Object? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _error = null);
    try {
      final invitations =
          await ref.read(careApiProvider).invitations(widget.patientId);
      if (mounted) setState(() => _invitations = invitations);
    } catch (error) {
      if (mounted) setState(() => _error = error);
    }
  }

  Future<void> _invite() async {
    final sent = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => _InviteSheet(patientId: widget.patientId),
    );
    if (sent == true) await _load();
  }

  Future<void> _revoke(wire.InvitationDto invitation) async {
    final confirmed = await confirmAction(
      context,
      title: 'Revoke this invitation?',
      message:
          'The link stops working immediately. You can send a new one at any '
          'time.',
      confirmLabel: 'Revoke it',
      cancelLabel: 'Keep it',
    );
    if (!confirmed) return;

    setState(() => _busy = true);
    try {
      await ref.read(careApiProvider).revokeInvitation(
            patientId: widget.patientId,
            invitationId: invitation.id,
          );
      await _load();
    } catch (error) {
      if (mounted) showFailure(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final state = ref.watch(careProvider);
    final verified = state.user?.isEmailVerified ?? false;

    return Scaffold(
      appBar: AppBar(title: const Text('Care circle')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: verified ? _invite : null,
        icon: const Icon(Icons.person_add_alt),
        label: const Text('Invite someone'),
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          children: [
            ScreenBody(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  if (!verified)
                    AppCard(
                      child: Row(
                        children: [
                          Icon(
                            Icons.mark_email_unread_outlined,
                            color: theme.colorScheme.error,
                          ),
                          const SizedBox(width: AppSpacing.md),
                          Expanded(
                            child: Text(
                              'Confirm your own email address before inviting '
                              'anyone. An unconfirmed address is one nobody has '
                              'proved they own.',
                              style: theme.textTheme.bodyMedium,
                            ),
                          ),
                        ],
                      ),
                    ),
                  if (!verified) const SizedBox(height: AppSpacing.md),

                  AppCard(
                    child: Text(
                      'Anyone you invite can see this person’s home address, '
                      'their appointments, and where they are during a ride. '
                      'The link works once, expires in a week, and only works '
                      'for the address you send it to.',
                      style: theme.textTheme.bodyMedium?.copyWith(
                        color: theme.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ),

                  const SizedBox(height: AppSpacing.lg),
                  const SectionHeader('Invitations'),
                  _list(theme),
                  const SizedBox(height: AppSpacing.xl * 2),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _list(ThemeData theme) {
    if (_error != null) {
      return AppCard(
        child: EmptyState(
          icon: Icons.cloud_off_outlined,
          title: 'Could not load invitations',
          message: 'Check your connection and try again.',
          action: OutlinedButton(onPressed: _load, child: const Text('Retry')),
        ),
      );
    }

    final invitations = _invitations;
    if (invitations == null) {
      return const AppCard(
        child: Padding(
          padding: EdgeInsets.all(AppSpacing.lg),
          child: Center(child: CircularProgressIndicator()),
        ),
      );
    }

    if (invitations.isEmpty) {
      return const AppCard(
        child: EmptyState(
          icon: Icons.mail_outline,
          title: 'No invitations yet',
          message:
              'Invite a relative so they can see appointments and follow a '
              'ride without having to call you.',
        ),
      );
    }

    return AppCard(
      padding: const EdgeInsets.symmetric(vertical: AppSpacing.xs),
      child: Column(
        children: [
          for (final invitation in invitations)
            ListTile(
              leading: Icon(_statusIcon(invitation.status),
                  color: _statusColour(theme, invitation.status)),
              // Masked by the server: enough for the invitee to recognise
              // their own address, not enough for the rest of the circle to
              // harvest one.
              title: Text(invitation.emailHint),
              subtitle: Text(_subtitle(invitation)),
              trailing: invitation.status == wire.InvitationStatus.pending
                  ? IconButton(
                      onPressed: _busy ? null : () => _revoke(invitation),
                      icon: const Icon(Icons.link_off),
                      tooltip: 'Revoke',
                    )
                  : null,
            ),
        ],
      ),
    );
  }
}

IconData _statusIcon(wire.InvitationStatus status) => switch (status) {
      wire.InvitationStatus.pending => Icons.schedule_send_outlined,
      wire.InvitationStatus.accepted => Icons.how_to_reg_outlined,
      wire.InvitationStatus.revoked => Icons.link_off,
      wire.InvitationStatus.expired => Icons.timer_off_outlined,
    };

Color _statusColour(ThemeData theme, wire.InvitationStatus status) =>
    switch (status) {
      wire.InvitationStatus.accepted => theme.colorScheme.primary,
      wire.InvitationStatus.pending => theme.colorScheme.onSurfaceVariant,
      _ => theme.colorScheme.outline,
    };

String _subtitle(wire.InvitationDto invitation) => switch (invitation.status) {
      wire.InvitationStatus.pending =>
        'Invited as ${invitation.relationship.wireName} · expires '
            '${DateFormat.yMMMd().format(invitation.expiresAt.toLocal())}',
      wire.InvitationStatus.accepted => 'Accepted — they have access',
      wire.InvitationStatus.revoked => 'Revoked',
      wire.InvitationStatus.expired => 'Expired without being used',
    };

class _InviteSheet extends ConsumerStatefulWidget {
  const _InviteSheet({required this.patientId});

  final String patientId;

  @override
  ConsumerState<_InviteSheet> createState() => _InviteSheetState();
}

class _InviteSheetState extends ConsumerState<_InviteSheet> {
  final _formKey = GlobalKey<FormState>();
  final _email = TextEditingController();
  wire.RelationshipType _relationship = wire.RelationshipType.son;

  /// `viewProfile` is preselected and cannot be removed: every other
  /// permission stands on it, and a grant that can schedule but not see the
  /// person is not a coherent thing to offer.
  final _permissions = <FamilyPermission>{FamilyPermission.viewProfile};
  bool _busy = false;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!(_formKey.currentState?.validate() ?? false)) return;

    setState(() => _busy = true);
    try {
      await ref.read(careApiProvider).invite(
            patientId: widget.patientId,
            email: _email.text,
            relationship: _relationship.wireName,
            permissions: _permissions.map((p) => p.name).toList(),
          );
      if (mounted) Navigator.of(context).pop(true);
    } catch (error) {
      if (mounted) showFailure(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);

    return Padding(
      padding: EdgeInsets.only(
        left: AppSpacing.lg,
        right: AppSpacing.lg,
        top: AppSpacing.lg,
        bottom: MediaQuery.of(context).viewInsets.bottom + AppSpacing.lg,
      ),
      child: Form(
        key: _formKey,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text('Invite someone', style: theme.textTheme.titleLarge),
              const SizedBox(height: AppSpacing.md),
              TextFormField(
                controller: _email,
                keyboardType: TextInputType.emailAddress,
                autofillHints: const [AutofillHints.email],
                decoration: const InputDecoration(
                  labelText: 'Their email address',
                  helperText:
                      'The invitation only works for this address, and only '
                      'once they have confirmed it.',
                  helperMaxLines: 3,
                ),
                validator: (value) {
                  final text = (value ?? '').trim();
                  if (text.isEmpty) return 'Enter an email address.';
                  if (!text.contains('@') || !text.contains('.')) {
                    return 'That does not look like an email address.';
                  }
                  return null;
                },
              ),
              const SizedBox(height: AppSpacing.md),
              DropdownButtonFormField<wire.RelationshipType>(
                initialValue: _relationship,
                decoration: const InputDecoration(labelText: 'Relationship'),
                items: [
                  for (final relationship in wire.RelationshipType.values)
                    DropdownMenuItem(
                      value: relationship,
                      child: Text(_relationshipLabel(relationship)),
                    ),
                ],
                onChanged: (value) =>
                    setState(() => _relationship = value ?? _relationship),
              ),
              const SizedBox(height: AppSpacing.md),
              Text('What they can do', style: theme.textTheme.titleSmall),
              for (final permission in FamilyPermission.values)
                CheckboxListTile(
                  value: _permissions.contains(permission),
                  // Never removable — see the note on `_permissions`.
                  onChanged: permission == FamilyPermission.viewProfile
                      ? null
                      : (checked) => setState(() {
                            if (checked ?? false) {
                              _permissions.add(permission);
                            } else {
                              _permissions.remove(permission);
                            }
                          }),
                  dense: true,
                  contentPadding: EdgeInsets.zero,
                  title: Text(permission.label),
                ),
              const SizedBox(height: AppSpacing.md),
              FilledButton(
                onPressed: _busy ? null : _submit,
                child: Text(_busy ? 'Sending…' : 'Send the invitation'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

String _relationshipLabel(wire.RelationshipType relationship) =>
    switch (relationship) {
      wire.RelationshipType.son => 'Son',
      wire.RelationshipType.daughter => 'Daughter',
      wire.RelationshipType.spouse => 'Spouse or partner',
      wire.RelationshipType.sibling => 'Sibling',
      wire.RelationshipType.grandchild => 'Grandchild',
      wire.RelationshipType.friend => 'Friend',
      wire.RelationshipType.professionalCaregiver => 'Professional caregiver',
      wire.RelationshipType.other => 'Other',
    };
