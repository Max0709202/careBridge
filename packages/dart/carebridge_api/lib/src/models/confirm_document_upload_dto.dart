// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// ConfirmDocumentUploadDto, from the CareBridge API.
class ConfirmDocumentUploadDto {
  const ConfirmDocumentUploadDto({required this.documentId});

  /// The slot the upload was authorised against. The server checks storage
  /// rather than believing this — a client that says “done” is a client that
  /// could say it without having uploaded anything.
  final String documentId;

  factory ConfirmDocumentUploadDto.fromJson(Map<String, dynamic> json) =>
      ConfirmDocumentUploadDto(documentId: json['documentId'] as String);

  Map<String, dynamic> toJson() => <String, dynamic>{'documentId': documentId};
}
