// GENERATED — DO NOT EDIT.
//
// Produced by scripts/generate-dart-client.mjs from
// packages/contracts/openapi.json. Run `make dart-client` to regenerate.
// Hand-editing this file makes the client and the server disagree in exactly
// the way generating it exists to prevent.

import '../api_client.dart';
import '../models.dart';

/// Operations tagged "marketplace".
class MarketplaceApi {
  const MarketplaceApi(this._client);

  final CareBridgeApiClient _client;

  /// Search bookable caregivers
  ///
  /// Ordered by a lower confidence bound on the rating, so a longer good record
  /// always outranks a shorter one and a single five-star review cannot reach
  /// the top. **Not** ordered by verification: ranking by it would be the
  /// platform asserting the safety claim it says it does not make.
  Future<List<CaregiverCardDto>> search({
    String? city,
    String? state,
    String? language,
    double? maxHourlyRateCents,
  }) async {
    final query = <String, String>{
      if (city != null) 'city': city.toString(),
      if (state != null) 'state': state.toString(),
      if (language != null) 'language': language.toString(),
      if (maxHourlyRateCents != null)
        'maxHourlyRateCents': maxHourlyRateCents.toString(),
    };
    final response = await _client.send(
      method: 'GET',
      path: '/marketplace/caregivers',
      query: query,
    );
    return (response as List<dynamic>)
        .map((e) => CaregiverCardDto.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// One caregiver, with their availability and reviews
  Future<CaregiverProfileDto> profile({required String caregiverId}) async {
    final response = await _client.send(
      method: 'GET',
      path: '/marketplace/caregivers/${Uri.encodeComponent(caregiverId)}',
    );
    return CaregiverProfileDto.fromJson(response as Map<String, dynamic>);
  }

  /// Create or update your own listing
  ///
  /// Always lands as `applied`. There is deliberately no endpoint that marks
  /// somebody verified — one that could would be the most valuable thing in
  /// this module to find a flaw in.
  Future<CaregiverProfileDto> saveProfile({
    required SaveCaregiverProfileDto body,
  }) async {
    final response = await _client.send(
      method: 'PUT',
      path: '/marketplace/me',
      body: body.toJson(),
    );
    return CaregiverProfileDto.fromJson(response as Map<String, dynamic>);
  }

  /// Replace your weekly availability
  ///
  /// Weekly rather than a list of dates: somebody who has to re-enter their
  /// availability every Sunday stops by the third week, and a marketplace of
  /// stale availability is a marketplace of dead ends.
  Future<CaregiverProfileDto> setAvailability() async {
    final response = await _client.send(
      method: 'PUT',
      path: '/marketplace/me/availability',
    );
    return CaregiverProfileDto.fromJson(response as Map<String, dynamic>);
  }

  /// Everything you are part of, either side of it
  Future<List<BookingDto>> bookings() async {
    final response = await _client.send(
      method: 'GET',
      path: '/marketplace/bookings',
    );
    return (response as List<dynamic>)
        .map((e) => BookingDto.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// Ask a caregiver for a visit
  ///
  /// Requires the same `requestTransport` grant that arranging a car does.
  /// Booking somebody to sit with a patient is at least as consequential, and a
  /// separate permission would mean two answers to “who may arrange care”.
  Future<BookingDto> book({required CreateBookingDto body}) async {
    final response = await _client.send(
      method: 'POST',
      path: '/marketplace/bookings',
      body: body.toJson(),
    );
    return BookingDto.fromJson(response as Map<String, dynamic>);
  }

  /// The caregiver accepting
  Future<BookingDto> accept({required String bookingId}) async {
    final response = await _client.send(
      method: 'POST',
      path: '/marketplace/bookings/${Uri.encodeComponent(bookingId)}/accept',
    );
    return BookingDto.fromJson(response as Map<String, dynamic>);
  }

  /// The caregiver declining
  Future<BookingDto> decline({required String bookingId}) async {
    final response = await _client.send(
      method: 'POST',
      path: '/marketplace/bookings/${Uri.encodeComponent(bookingId)}/decline',
    );
    return BookingDto.fromJson(response as Map<String, dynamic>);
  }

  /// What cancelling would cost, before committing to it
  ///
  /// Free with more than a day’s notice; half after that, never the whole
  /// visit. A caregiver cancelling never charges the family.
  Future<CancellationQuoteDto> quote({required String bookingId}) async {
    final response = await _client.send(
      method: 'GET',
      path:
          '/marketplace/bookings/${Uri.encodeComponent(bookingId)}/cancellation-quote',
    );
    return CancellationQuoteDto.fromJson(response as Map<String, dynamic>);
  }

  /// Call it off
  Future<BookingDto> cancel({
    required String bookingId,
    required CancelBookingDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path: '/marketplace/bookings/${Uri.encodeComponent(bookingId)}/cancel',
      body: body.toJson(),
    );
    return BookingDto.fromJson(response as Map<String, dynamic>);
  }

  /// The caregiver arriving
  Future<BookingDto> checkIn({required String bookingId}) async {
    final response = await _client.send(
      method: 'POST',
      path: '/marketplace/bookings/${Uri.encodeComponent(bookingId)}/check-in',
    );
    return BookingDto.fromJson(response as Map<String, dynamic>);
  }

  /// The caregiver leaving, and the moment the money is decided
  ///
  /// Charged from the checked times rather than the booked window, rounded up
  /// to a quarter-hour: a visit that ran twenty minutes over is twenty minutes
  /// of somebody’s afternoon, and rounding down would have a caregiver work
  /// fourteen minutes for nothing.
  Future<BookingDto> checkOut({required String bookingId}) async {
    final response = await _client.send(
      method: 'POST',
      path: '/marketplace/bookings/${Uri.encodeComponent(bookingId)}/check-out',
    );
    return BookingDto.fromJson(response as Map<String, dynamic>);
  }

  /// Nobody came
  ///
  /// Reported by the family only. A caregiver marking their own booking as a
  /// no-show would be marking the family.
  Future<BookingDto> noShow({required String bookingId}) async {
    final response = await _client.send(
      method: 'POST',
      path: '/marketplace/bookings/${Uri.encodeComponent(bookingId)}/no-show',
    );
    return BookingDto.fromJson(response as Map<String, dynamic>);
  }

  /// Rate a visit that happened
  ///
  /// Only a completed booking, and only once. A marketplace where a cancelled
  /// engagement can be rated is one where a family who never met somebody can
  /// end their career.
  Future<BookingDto> review({
    required String bookingId,
    required ReviewBookingDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path: '/marketplace/bookings/${Uri.encodeComponent(bookingId)}/review',
      body: body.toJson(),
    );
    return BookingDto.fromJson(response as Map<String, dynamic>);
  }

  /// Raise a disagreement about a visit
  Future<BookingDto> dispute({
    required String bookingId,
    required RaiseDisputeDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path: '/marketplace/bookings/${Uri.encodeComponent(bookingId)}/dispute',
      body: body.toJson(),
    );
    return BookingDto.fromJson(response as Map<String, dynamic>);
  }

  /// Decide a dispute
  ///
  /// Names an outcome, a reason and a person — enforced by a check constraint
  /// as well as here. A decision with none of those is one nobody can defend
  /// when the same question is asked again.
  Future<BookingDto> resolve({
    required String bookingId,
    required ResolveDisputeDto body,
  }) async {
    final response = await _client.send(
      method: 'POST',
      path:
          '/admin/marketplace/bookings/${Uri.encodeComponent(bookingId)}/dispute/resolve',
      body: body.toJson(),
    );
    return BookingDto.fromJson(response as Map<String, dynamic>);
  }
}
