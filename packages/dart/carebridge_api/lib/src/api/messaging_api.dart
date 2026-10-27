// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../api_client.dart';
import '../models.dart';

/// Operations tagged "messaging".
class MessagingApi {
  const MessagingApi(this._client);

  final CareBridgeApiClient _client;

  /// Threads the caller is in, newest first, with unread counts
  Future<List<ConversationDto>> inbox() async {
    final response = await _client.send(method: 'GET', path: '/conversations');
    return (response as List<dynamic>)
        .map((e) => ConversationDto.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Find or open a thread
  ///
  /// Returns the existing thread for this subject if there is one.
  /// `organizationId`, `patientId` and `driverId` may be left out where a ride,
  /// or the caller being a driver, already says what they are. 409 when the
  /// colleague is off shift, or a finished trip's thread has closed.
  Future<ConversationDto> open({required OpenConversationDto body}) async {
    final response = await _client.send(
      method: 'POST',
      path: '/conversations',
      body: body.toJson(),
    );
    return ConversationDto.fromJson(response as Map<String, dynamic>);
  }

  /// Totals for a badge
  Future<UnreadSummaryDto> unread() async {
    final response = await _client.send(
      method: 'GET',
      path: '/conversations/unread',
    );
    return UnreadSummaryDto.fromJson(response as Map<String, dynamic>);
  }

  Future<ConversationDto> conversation({required String conversationId}) async {
    final response = await _client.send(
      method: 'GET',
      path: '/conversations/${Uri.encodeComponent(conversationId)}',
    );
    return ConversationDto.fromJson(response as Map<String, dynamic>);
  }

  /// A page of messages, oldest first
  Future<MessagePageDto> messages({
    required String conversationId,
    DateTime? before,
    double? limit,
  }) async {
    final query = <String, String>{
      if (before != null) 'before': before.toString(),
      if (limit != null) 'limit': limit.toString(),
    };
    final response = await _client.send(
      method: 'GET',
      path: '/conversations/${Uri.encodeComponent(conversationId)}/messages',
      query: query,
    );
    return MessagePageDto.fromJson(response as Map<String, dynamic>);
  }

  /// Send a message
  ///
  /// Safe to retry with the same `clientMessageId`: the stored message is
  /// returned rather than a second one posted.
  Future<MessageDto> send({
    required String conversationId,
    required SendMessageDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path: '/conversations/${Uri.encodeComponent(conversationId)}/messages',
      body: body.toJson(),
    );
    return MessageDto.fromJson(response as Map<String, dynamic>);
  }

  /// Mark the thread read up to now
  Future<void> markRead({required String conversationId}) async {
    await _client.send(
      method: 'POST',
      path: '/conversations/${Uri.encodeComponent(conversationId)}/read',
    );
    return;
  }

  /// Drivers at the operator the caller can message, on shift first
  ///
  /// For a dispatcher at the operator or one of its approved drivers.
  Future<List<ColleagueDto>> colleagues({
    required String organizationId,
  }) async {
    final response = await _client.send(
      method: 'GET',
      path: '/organizations/${Uri.encodeComponent(organizationId)}/colleagues',
    );
    return (response as List<dynamic>)
        .map((e) => ColleagueDto.fromJson(e as Map<String, dynamic>))
        .toList();
  }
}
