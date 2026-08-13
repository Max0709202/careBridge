// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../api_client.dart';
import '../models.dart';

/// Patients, family access and invitations
class PatientsApi {
  const PatientsApi(this._client);

  final CareBridgeApiClient _client;

  Future<CareStateDto> create({required SavePatientDto body}) async {
    final response = await _client.send(
      method: 'POST',
      path: '/patients',
      body: body.toJson(),
    );
    return CareStateDto.fromJson(response as Map<String, dynamic>);
  }

  Future<CareStateDto> update({
    required String id,
    required SavePatientDto body,
  }) async {
    final response = await _client.send(
      method: 'PUT',
      path: '/patients/${Uri.encodeComponent(id)}',
      body: body.toJson(),
    );
    return CareStateDto.fromJson(response as Map<String, dynamic>);
  }

  Future<CareStateDto> archive({required String id}) async {
    final response = await _client.send(
      method: 'POST',
      path: '/patients/${Uri.encodeComponent(id)}/archive',
    );
    return CareStateDto.fromJson(response as Map<String, dynamic>);
  }

  Future<CareStateDto> setPermissions({
    required String id,
    required SetPermissionsDto body,
  }) async {
    final response = await _client.send(
      method: 'PUT',
      path: '/patients/${Uri.encodeComponent(id)}/permissions',
      body: body.toJson(),
    );
    return CareStateDto.fromJson(response as Map<String, dynamic>);
  }

  Future<CareStateDto> select({required String id}) async {
    final response = await _client.send(
      method: 'POST',
      path: '/patients/${Uri.encodeComponent(id)}/select',
    );
    return CareStateDto.fromJson(response as Map<String, dynamic>);
  }

  /// Invitations issued for this patient
  Future<List<InvitationDto>> listInvitations({required String id}) async {
    final response = await _client.send(
      method: 'GET',
      path: '/patients/${Uri.encodeComponent(id)}/invitations',
    );
    return (response as List<dynamic>)
        .map((e) => InvitationDto.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Invite someone into this patient’s care circle
  ///
  /// Requires manageAccess, a verified address on the inviter, and permissions
  /// no broader than the inviter’s own. The emailed link is single-use,
  /// expiring, and can only be accepted by a verified account with the invited
  /// address.
  Future<InvitationDto> invite({
    required String id,
    required CreateInvitationDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path: '/patients/${Uri.encodeComponent(id)}/invitations',
      body: body.toJson(),
    );
    return InvitationDto.fromJson(response as Map<String, dynamic>);
  }

  /// Revoke an invitation that has not been accepted
  Future<void> revokeInvitation({
    required String id,
    required String invitationId,
  }) async {
    await _client.send(
      method: 'DELETE',
      path:
          '/patients/${Uri.encodeComponent(id)}/invitations/${Uri.encodeComponent(invitationId)}',
    );
    return;
  }

  /// Accept an invitation
  ///
  /// The signed-in account must be the invited address and must have verified
  /// it. Returns the full state snapshot, which now includes the newly shared
  /// patient.
  Future<void> accept({required AcceptInvitationDto body}) async {
    await _client.send(
      method: 'POST',
      path: '/invitations/accept',
      body: body.toJson(),
    );
    return;
  }
}
