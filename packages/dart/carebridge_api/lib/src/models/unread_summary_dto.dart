// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// UnreadSummaryDto, from the CareBridge API.
class UnreadSummaryDto {
  const UnreadSummaryDto({
    required this.unreadConversations,
    required this.unreadMessages,
  });

  final double unreadConversations;

  final double unreadMessages;

  factory UnreadSummaryDto.fromJson(Map<String, dynamic> json) =>
      UnreadSummaryDto(
        unreadConversations: (json['unreadConversations'] as num).toDouble(),
        unreadMessages: (json['unreadMessages'] as num).toDouble(),
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'unreadConversations': unreadConversations,
    'unreadMessages': unreadMessages,
  };
}
