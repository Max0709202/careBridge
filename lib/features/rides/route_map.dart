import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../app/theme.dart';
import '../../domain/models.dart';

/// A schematic route view.
///
/// This is **not** a map and does not pretend to be one: no streets, no road
/// geometry, no claim that the car is on a particular corner. It shows pickup,
/// destination, and roughly where the vehicle is between them.
///
/// That restraint is deliberate. A real map tile provider arrives with the
/// routing vendor in Stage 3; until then, drawing a car on a convincing street
/// grid would imply a precision we do not have, about the location of a
/// vulnerable person. A schematic that is obviously a schematic cannot mislead.
///
/// When position data goes stale the whole drawing dims and the marker hollows
/// out, so "we have lost contact" is visible at a glance rather than buried in
/// a caption.
class RouteMap extends StatelessWidget {
  const RouteMap({
    required this.pickup,
    required this.destination,
    this.driver,
    this.isStale = false,
    this.passengerOnboard = false,
    super.key,
  });

  final Coordinates pickup;
  final Coordinates destination;
  final Coordinates? driver;
  final bool isStale;
  final bool passengerOnboard;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    return Semantics(
      label: driver == null
          ? 'Route diagram from pickup to destination. Vehicle position not '
                'available.'
          : 'Route diagram showing the vehicle between pickup and destination.'
                '${isStale ? ' The position may be out of date.' : ''}',
      excludeSemantics: true,
      child: ClipRRect(
        borderRadius: AppRadius.cardAll,
        child: Container(
          height: 240,
          decoration: BoxDecoration(
            color: scheme.surfaceContainerHighest,
            border: Border.all(color: scheme.outlineVariant),
            borderRadius: AppRadius.cardAll,
          ),
          child: CustomPaint(
            painter: _RoutePainter(
              pickup: pickup,
              destination: destination,
              driver: driver,
              isStale: isStale,
              passengerOnboard: passengerOnboard,
              routeColor: scheme.primary,
              markerColor: scheme.onSurface,
              vehicleColor: isStale ? scheme.outline : scheme.primary,
              labelStyle: Theme.of(context).textTheme.bodySmall!.copyWith(
                color: scheme.onSurfaceVariant,
                fontWeight: FontWeight.w600,
              ),
            ),
            child: const SizedBox.expand(),
          ),
        ),
      ),
    );
  }
}

class _RoutePainter extends CustomPainter {
  _RoutePainter({
    required this.pickup,
    required this.destination,
    required this.driver,
    required this.isStale,
    required this.passengerOnboard,
    required this.routeColor,
    required this.markerColor,
    required this.vehicleColor,
    required this.labelStyle,
  });

  final Coordinates pickup;
  final Coordinates destination;
  final Coordinates? driver;
  final bool isStale;
  final bool passengerOnboard;
  final Color routeColor;
  final Color markerColor;
  final Color vehicleColor;
  final TextStyle labelStyle;

  @override
  void paint(Canvas canvas, Size size) {
    const inset = 44.0;
    final points = <Coordinates>[pickup, destination, ?driver];

    final minLat = points.map((p) => p.latitude).reduce(math.min);
    final maxLat = points.map((p) => p.latitude).reduce(math.max);
    final minLng = points.map((p) => p.longitude).reduce(math.min);
    final maxLng = points.map((p) => p.longitude).reduce(math.max);

    Offset project(Coordinates c) {
      final spanLat = maxLat - minLat;
      final spanLng = maxLng - minLng;
      final x = spanLng.abs() < 1e-9
          ? size.width / 2
          : inset + (c.longitude - minLng) / spanLng * (size.width - inset * 2);
      final y = spanLat.abs() < 1e-9
          ? size.height / 2
          // Latitude increases northwards; screen y increases downwards.
          : inset + (maxLat - c.latitude) / spanLat * (size.height - inset * 2);
      return Offset(x, y);
    }

    final start = project(pickup);
    final end = project(destination);

    _paintGrid(canvas, size);

    // A gentle curve rather than a straight line: roads bend, and a ruler-straight
    // line reads as a claim about the route that we are not making.
    final control = Offset(
      (start.dx + end.dx) / 2 + (end.dy - start.dy) * 0.18,
      (start.dy + end.dy) / 2 - (end.dx - start.dx) * 0.18,
    );
    final path = Path()
      ..moveTo(start.dx, start.dy)
      ..quadraticBezierTo(control.dx, control.dy, end.dx, end.dy);

    canvas.drawPath(
      path,
      Paint()
        ..color = routeColor.withValues(alpha: isStale ? 0.25 : 0.45)
        ..strokeWidth = 6
        ..strokeCap = StrokeCap.round
        ..style = PaintingStyle.stroke,
    );

    _paintEndpoint(canvas, start, Icons.home_rounded, 'Pickup');
    _paintEndpoint(canvas, end, Icons.local_hospital_rounded, 'Clinic');

    if (driver != null) {
      _paintVehicle(canvas, project(driver!));
    }
  }

  void _paintGrid(Canvas canvas, Size size) {
    final paint = Paint()
      ..color = markerColor.withValues(alpha: 0.04)
      ..strokeWidth = 1;
    const step = 28.0;
    for (double x = 0; x < size.width; x += step) {
      canvas.drawLine(Offset(x, 0), Offset(x, size.height), paint);
    }
    for (double y = 0; y < size.height; y += step) {
      canvas.drawLine(Offset(0, y), Offset(size.width, y), paint);
    }
  }

  void _paintEndpoint(Canvas canvas, Offset at, IconData icon, String label) {
    canvas.drawCircle(
      at,
      16,
      Paint()..color = markerColor.withValues(alpha: 0.10),
    );
    canvas.drawCircle(
      at,
      16,
      Paint()
        ..color = markerColor.withValues(alpha: 0.5)
        ..strokeWidth = 2
        ..style = PaintingStyle.stroke,
    );

    _paintIcon(canvas, icon, at, 17, markerColor.withValues(alpha: 0.75));
    _paintLabel(canvas, label, at + const Offset(0, 24));
  }

  void _paintVehicle(Canvas canvas, Offset at) {
    // Hollow when stale: a filled, confident marker for a position we no longer
    // trust is exactly the false certainty this screen exists to avoid.
    if (!isStale) {
      canvas.drawCircle(
        at,
        26,
        Paint()..color = vehicleColor.withValues(alpha: 0.16),
      );
    }
    canvas.drawCircle(
      at,
      17,
      Paint()
        ..color = isStale ? Colors.transparent : vehicleColor
        ..style = PaintingStyle.fill,
    );
    canvas.drawCircle(
      at,
      17,
      Paint()
        ..color = vehicleColor
        ..strokeWidth = isStale ? 2.5 : 1
        ..style = PaintingStyle.stroke,
    );

    _paintIcon(
      canvas,
      passengerOnboard
          ? Icons.airline_seat_recline_normal
          : Icons.directions_car_filled,
      at,
      18,
      isStale ? vehicleColor : Colors.white,
    );
  }

  void _paintIcon(
    Canvas canvas,
    IconData icon,
    Offset center,
    double size,
    Color color,
  ) {
    final builder = TextPainter(
      textDirection: TextDirection.ltr,
      text: TextSpan(
        text: String.fromCharCode(icon.codePoint),
        style: TextStyle(
          fontSize: size,
          fontFamily: icon.fontFamily,
          package: icon.fontPackage,
          color: color,
        ),
      ),
    )..layout();
    builder.paint(
      canvas,
      center - Offset(builder.width / 2, builder.height / 2),
    );
  }

  void _paintLabel(Canvas canvas, String text, Offset at) {
    final painter = TextPainter(
      textDirection: TextDirection.ltr,
      text: TextSpan(text: text, style: labelStyle),
    )..layout();
    painter.paint(canvas, at - Offset(painter.width / 2, 0));
  }

  @override
  bool shouldRepaint(_RoutePainter oldDelegate) =>
      oldDelegate.driver?.latitude != driver?.latitude ||
      oldDelegate.driver?.longitude != driver?.longitude ||
      oldDelegate.isStale != isStale ||
      oldDelegate.passengerOnboard != passengerOnboard;
}
