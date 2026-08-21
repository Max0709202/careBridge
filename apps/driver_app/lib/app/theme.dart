import 'package:flutter/material.dart';

/// Design tokens for the driver app.
///
/// A third audience, and a third set of trade-offs. This is a phone in a
/// windscreen cradle, glanced at for **under a second** by somebody who is
/// driving or about to be. That moves three decisions away from both the
/// family app and the console:
///
/// * **One decision per screen, enormous.** The primary action is a 64px-tall
///   button across the full width. A driver choosing between two similar
///   buttons at a junction is a driver looking at a phone for two seconds
///   instead of half of one.
/// * **Denser than the family app is wrong here; bigger is right.** 17px base
///   and high contrast, because the glance is short and often in sunlight.
/// * **Nothing destructive next to anything routine.** "Nobody came out" ends
///   a ride and tells a family their relative did not appear. It sits apart
///   from the sequence button, styled differently, and behind a confirmation.
class DriverSpacing {
  const DriverSpacing._();

  static const double xs = 4;
  static const double sm = 8;
  static const double md = 16;
  static const double lg = 24;
  static const double xl = 32;

  /// Well past WCAG 2.5.5's 44px. A mis-hit here records the wrong thing about
  /// somebody's journey, and the hand doing the hitting is in a moving car.
  static const double primaryAction = 64;
}

class DriverRadius {
  const DriverRadius._();

  static const BorderRadius cardAll = BorderRadius.all(Radius.circular(14));
  static const BorderRadius controlAll = BorderRadius.all(Radius.circular(10));
}

ThemeData driverTheme(Brightness brightness) {
  final scheme = ColorScheme.fromSeed(
    seedColor: const Color(0xFF00695C),
    brightness: brightness,
  );

  final base = ThemeData(colorScheme: scheme, useMaterial3: true);

  return base.copyWith(
    scaffoldBackgroundColor: scheme.surface,
    textTheme: base.textTheme.apply(fontSizeFactor: 1.06),
    appBarTheme: AppBarTheme(
      backgroundColor: scheme.surface,
      foregroundColor: scheme.onSurface,
      centerTitle: false,
      elevation: 0,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size.fromHeight(DriverSpacing.primaryAction),
        textStyle: const TextStyle(fontSize: 19, fontWeight: FontWeight.w600),
        shape: const RoundedRectangleBorder(
          borderRadius: DriverRadius.controlAll,
        ),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size.fromHeight(52),
        shape: const RoundedRectangleBorder(
          borderRadius: DriverRadius.controlAll,
        ),
      ),
    ),
    cardTheme: CardThemeData(
      elevation: 0,
      color: scheme.surfaceContainerHighest,
      shape: const RoundedRectangleBorder(borderRadius: DriverRadius.cardAll),
      margin: EdgeInsets.zero,
    ),
  );
}
