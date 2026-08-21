// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// ReviewBookingDto, from the CareBridge API.
class ReviewBookingDto {
  const ReviewBookingDto({required this.rating, this.comment});

  final double rating;

  final String? comment;

  factory ReviewBookingDto.fromJson(Map<String, dynamic> json) =>
      ReviewBookingDto(
        rating: (json['rating'] as num).toDouble(),
        comment: json['comment'] as String?,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'rating': rating,
    if (comment != null) 'comment': comment,
  };
}
