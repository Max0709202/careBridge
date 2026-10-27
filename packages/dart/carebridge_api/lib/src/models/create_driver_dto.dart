// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

/// CreateDriverDto, from the CareBridge API.
class CreateDriverDto {
  const CreateDriverDto({
    required this.displayName,
    required this.vehicleId,
    this.yearsDriving,
    this.email,
    this.userId,
  });

  /// First name and last initial. Never a full legal name.
  final String displayName;

  final String vehicleId;

  final double? yearsDriving;

  /// The address this driver will sign into the driver app with. Recorded, not
  /// invited: the link is only made once an account exists at that address
  /// **and has verified it**, so writing it here grants nothing on its own.
  final String? email;

  /// An existing account to drive as, from `POST drivers/account-lookup`. The
  /// account is linked straight away and the driver starts as `pendingApproval`
  /// rather than `invited`; approval still needs their paperwork. When set,
  /// `email` is ignored and the account's own address is recorded.
  final String? userId;

  factory CreateDriverDto.fromJson(Map<String, dynamic> json) =>
      CreateDriverDto(
        displayName: json['displayName'] as String,
        vehicleId: json['vehicleId'] as String,
        yearsDriving: json['yearsDriving'] == null
            ? null
            : (json['yearsDriving'] as num).toDouble(),
        email: json['email'] as String?,
        userId: json['userId'] as String?,
      );

  Map<String, dynamic> toJson() => <String, dynamic>{
    'displayName': displayName,
    'vehicleId': vehicleId,
    if (yearsDriving != null) 'yearsDriving': yearsDriving,
    if (email != null) 'email': email,
    if (userId != null) 'userId': userId,
  };
}
