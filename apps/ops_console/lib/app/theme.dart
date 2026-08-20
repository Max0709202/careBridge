import 'package:flutter/material.dart';

/// Design tokens for the console.
///
/// A different audience from the family app, and the differences are the
/// point. This is a **desk tool used all day by one person under time
/// pressure**, on a wide screen, usually with a mouse — not a phone held
/// one-handed between meetings. That moves three decisions:
///
/// * **Denser than the family app.** 15px base rather than 17px, and tighter
///   spacing, because a dispatcher needs a dozen rides visible at once. The
///   family app's generosity exists for reduced vision and tremor; a queue that
///   shows four rows forces scrolling during exactly the minute nobody has.
/// * **44px targets are kept anyway.** Density is about text and padding, not
///   about hit areas — WCAG 2.5.5 does not stop applying because the user is
///   at a desk, and a mis-hit here assigns the wrong driver.
/// * **Urgency is never colour alone.** Same rule as the family app's status
///   pills (WCAG 1.4.1), and it matters more here: red-green is the obvious
///   encoding for "overdue" versus "fine", and it is the one 8% of men cannot
///   read. Every band carries an icon and a word.
class AppSpacing {
  const AppSpacing._();

  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 20;
  static const double xl = 28;

  /// WCAG 2.5.5 target size. Unchanged from the family app, deliberately.
  static const double minTarget = 44;

  /// Beyond this the queue and the detail panel sit side by side. Below it
  /// they stack — a dispatcher on a laptop in a car park is a real situation.
  static const double wideBreakpoint = 900;
}

class AppRadius {
  const AppRadius._();

  static const BorderRadius cardAll = BorderRadius.all(Radius.circular(12));
  static const BorderRadius controlAll = BorderRadius.all(Radius.circular(8));
}

/// Semantic colours for the urgency bands and driver states.
///
/// Contrast checked at 4.5:1 or better against their own containers, and every
/// use is paired with an icon and a word.
class OpsColors {
  const OpsColors._();

  static const Color overdue = Color(0xFF8C1D18);
  static const Color overdueContainer = Color(0xFFFCE8E6);
  static const Color imminent = Color(0xFF7C4A03);
  static const Color imminentContainer = Color(0xFFFEF3C7);
  static const Color soon = Color(0xFF0B4A6F);
  static const Color soonContainer = Color(0xFFE0F2FE);
  static const Color later = Color(0xFF3F4A54);
  static const Color laterContainer = Color(0xFFEEF1F4);
  static const Color positive = Color(0xFF14532D);
  static const Color positiveContainer = Color(0xFFDCFCE7);
}

/// A deliberately different seed from the family app.
///
/// The two are used by different people for different jobs, and somebody who
/// administers both should be able to tell at a glance which one is on screen
/// — a dispatcher's actions move other people's cars.
const _seed = Color(0xFF1F4E79);

ThemeData opsTheme(Brightness brightness) {
  final scheme = ColorScheme.fromSeed(seedColor: _seed, brightness: brightness);

  return ThemeData(
    useMaterial3: true,
    colorScheme: scheme,
    fontFamily: 'Roboto',
    visualDensity: VisualDensity.standard,
    scaffoldBackgroundColor: brightness == Brightness.light
        ? const Color(0xFFF7F9FB)
        : scheme.surface,
    textTheme: _textTheme(brightness),
    cardTheme: CardThemeData(
      elevation: 0,
      margin: EdgeInsets.zero,
      shape: RoundedRectangleBorder(
        borderRadius: AppRadius.cardAll,
        side: BorderSide(color: scheme.outlineVariant),
      ),
      color: scheme.surface,
    ),
    filledButtonTheme: FilledButtonThemeData(
      style: FilledButton.styleFrom(
        minimumSize: const Size(0, AppSpacing.minTarget),
        shape: const RoundedRectangleBorder(borderRadius: AppRadius.controlAll),
      ),
    ),
    outlinedButtonTheme: OutlinedButtonThemeData(
      style: OutlinedButton.styleFrom(
        minimumSize: const Size(0, AppSpacing.minTarget),
        shape: const RoundedRectangleBorder(borderRadius: AppRadius.controlAll),
      ),
    ),
    textButtonTheme: TextButtonThemeData(
      style: TextButton.styleFrom(
        minimumSize: const Size(0, AppSpacing.minTarget),
      ),
    ),
    inputDecorationTheme: InputDecorationTheme(
      filled: true,
      fillColor: scheme.surfaceContainerHighest.withValues(alpha: 0.4),
      border: const OutlineInputBorder(borderRadius: AppRadius.controlAll),
    ),
    dividerTheme: DividerThemeData(space: 1, color: scheme.outlineVariant),
  );
}

TextTheme _textTheme(Brightness brightness) {
  // Scales with the system font setting rather than being locked: a
  // dispatcher who has set their display to 125% has done so for a reason.
  const base = Typography.englishLike2021;
  final theme = brightness == Brightness.light
      ? base.merge(Typography.blackMountainView)
      : base.merge(Typography.whiteMountainView);

  return theme.copyWith(
    bodyLarge: theme.bodyLarge?.copyWith(fontSize: 15),
    bodyMedium: theme.bodyMedium?.copyWith(fontSize: 14),
    bodySmall: theme.bodySmall?.copyWith(fontSize: 12.5),
    titleMedium: theme.titleMedium?.copyWith(
      fontSize: 16,
      fontWeight: FontWeight.w500,
    ),
    titleLarge: theme.titleLarge?.copyWith(
      fontSize: 20,
      fontWeight: FontWeight.w500,
    ),
  );
}
