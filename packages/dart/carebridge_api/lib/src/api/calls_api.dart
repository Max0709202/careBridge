// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../api_client.dart';
import '../models.dart';

/// Operations tagged "calls".
class CallsApi {
  const CallsApi(this._client);

  final CareBridgeApiClient _client;

  /// Who the caller can ring from a conversation or a ride
  ///
  /// Never includes a number. `available` is false, with a reason to show, when
  /// a call cannot be placed right now.
  Future<List<CallTargetDto>> targets({
    String? conversationId,
    String? rideId,
  }) async {
    final query = <String, String>{
      if (conversationId != null) 'conversationId': conversationId.toString(),
      if (rideId != null) 'rideId': rideId.toString(),
    };
    final response = await _client.send(
      method: 'GET',
      path: '/calls/targets',
      query: query,
    );
    return (response as List<dynamic>).map((e) => CallTargetDto.fromJson(e as Map<String, dynamic>)).toList();
  }

  /// Place a relay call
  ///
  /// Your own phone rings first, from the relay number; answer it and you are
  /// put through. Progress arrives as `call.updated` on the messaging socket.
  Future<CallSessionDto> start({
    required StartCallDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path: '/calls',
      body: body.toJson(),
    );
    return CallSessionDto.fromJson(response as Map<String, dynamic>);
  }

  /// The number your phone rings on when you place a call
  Future<MyNumberDto> myNumber() async {
    final response = await _client.send(
      method: 'GET',
      path: '/calls/my-number',
    );
    return MyNumberDto.fromJson(response as Map<String, dynamic>);
  }

  /// Set or clear it
  Future<MyNumberDto> setMyNumber({
    required SetMyNumberDto body,
  }) async {
    final response = await _client.send(
      method: 'PUT',
      path: '/calls/my-number',
      body: body.toJson(),
    );
    return MyNumberDto.fromJson(response as Map<String, dynamic>);
  }

  Future<CallSessionDto> get_({
    required String callId,
  }) async {
    final response = await _client.send(
      method: 'GET',
      path: '/calls/${Uri.encodeComponent(callId)}',
    );
    return CallSessionDto.fromJson(response as Map<String, dynamic>);
  }
}
