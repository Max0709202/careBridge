// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// ReviewDto, from the CareBridge API.
class ReviewDto {
  const ReviewDto({
    required this.id,
    required this.rating,
    this.comment,
    required this.createdAt,
  });

  final String id;

  final int rating;

  final String? comment;

  final DateTime createdAt;

  factory ReviewDto.fromJson(Map<String, dynamic> json) => ReviewDto(
    id: json['id'] as String,
    rating: json['rating'] as int,
    comment: json['comment'] as String?,
    createdAt: DateTime.parse(json['createdAt'] as String),
  );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'id': id,
    'rating': rating,
    if (comment != null) 'comment': comment,
    'createdAt': createdAt.toIso8601String(),
  };
}
