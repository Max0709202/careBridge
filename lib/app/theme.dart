import 'package:flutter/material.dart';

/// Design tokens and theme.
///
/// The people who read these screens are adult children coordinating care under
/// stress — often one-handed, on a phone, between meetings — and older adults
/// with reduced vision, tremor, or hearing loss. That pushes four decisions that
/// differ from a stock Material theme:
///
/// * **44px minimum touch target** (WCAG 2.5.5), not the 32–36px Material
///   default. Small controls are a failure mode here, not a style preference.
/// * **17px base body text**, not 14px, and every size scales with the system
///   font setting rather than being locked.
/// * **Status is never colour alone** (WCAG 1.4.1) — every state carries an icon
///   and a word. See `StatusPill`.
/// * **Generous spacing**, because dense layouts are hard to hit accurately.
class AppSpacing {
  const AppSpacing._();

  static const double xs = 4;
  static const double sm = 8;
  static const double md = 16;
  static const double lg = 24;
  static const double xl = 32;
  static const double xxl = 48;

  /// WCAG 2.5.5 target size.
  static const double minTarget = 44;
}

class AppRadius {
  const AppRadius._();

  static const Radius card = Radius.circular(16);
  static const Radius control = Radius.circular(12);
  static const BorderRadius cardAll = BorderRadius.all(card);
  static const BorderRadius controlAll = BorderRadius.all(control);
}

/// Semantic colours for state. Chosen for contrast against their own containers
/// at 4.5:1 or better, and always paired with an icon and a label.
class AppStatusColors {
  const AppStatusColors._();

  static const Color positive = Color(0xFF14532D);
  static const Color positiveContainer = Color(0xFFDCFCE7);
  static const Color caution = Color(0xFF7C4A03);
  static const Color cautionContainer = Color(0xFFFEF3C7);
  static const Color critical = Color(0xFF8C1D18);
  static const Color criticalContainer = Color(0xFFFCE8E6);
  static const Color info = Color(0xFF0B4A6F);
  static const Color infoContainer = Color(0xFFE0F2FE);
  static const Color neutral = Color(0xFF3F4A54);
  static const Color neutralContainer = Color(0xFFEEF1F4);

  static const Color positiveDark = Color(0xFF86EFAC);
  static const Color cautionDark = Color(0xFFFCD34D);
  static const Color criticalDark = Color(0xFFFFB4AB);
  static const Color infoDark = Color(0xFF7DD3FC);
  static const Color neutralDark = Color(0xFFCBD5E1);
}

class AppTheme {
  const AppTheme._();

  static const Color _seed = Color(0xFF126E63);

  static ThemeData light() => _build(Brightness.light);

  static ThemeData dark() => _build(Brightness.dark);

  static ThemeData _build(Brightness brightness) {
    final scheme = ColorScheme.fromSeed(
      seedColor: _seed,
      brightness: brightness,
    );
    final isLight = brightness == Brightness.light;

    final base = ThemeData(
      colorScheme: scheme,
      useMaterial3: true,
      visualDensity: VisualDensity.standard,
      // The bundled family, not the engine's default of the same name — see
      // the note in pubspec.yaml. Naming it here is what makes every text
      // style resolve to an asset rather than to a font the web engine
      // downloads from a third party.
      fontFamily: 'Roboto',
    );

    final text = base.textTheme.copyWith(
      displaySmall: base.textTheme.displaySmall?.copyWith(
        fontSize: 32,
        fontWeight: FontWeight.w600,
        height: 1.2,
      ),
      headlineMedium: base.textTheme.headlineMedium?.copyWith(
        fontSize: 26,
        fontWeight: FontWeight.w600,
        height: 1.25,
      ),
      headlineSmall: base.textTheme.headlineSmall?.copyWith(
        fontSize: 22,
        fontWeight: FontWeight.w600,
        height: 1.3,
      ),
      titleLarge: base.textTheme.titleLarge?.copyWith(
        fontSize: 20,
        fontWeight: FontWeight.w600,
      ),
      titleMedium: base.textTheme.titleMedium?.copyWith(
        fontSize: 18,
        fontWeight: FontWeight.w600,
      ),
      bodyLarge: base.textTheme.bodyLarge?.copyWith(fontSize: 17, height: 1.45),
      bodyMedium: base.textTheme.bodyMedium?.copyWith(fontSize: 16, height: 1.45),
      bodySmall: base.textTheme.bodySmall?.copyWith(fontSize: 14, height: 1.4),
      labelLarge: base.textTheme.labelLarge?.copyWith(
        fontSize: 17,
        fontWeight: FontWeight.w600,
      ),
    );

    const buttonPadding = EdgeInsets.symmetric(
      horizontal: AppSpacing.lg,
      vertical: AppSpacing.md,
    );
    const minimumSize = Size(64, AppSpacing.minTarget);
    final buttonShape = RoundedRectangleBorder(
      borderRadius: AppRadius.controlAll,
    );

    return base.copyWith(
      textTheme: text,
      scaffoldBackgroundColor:
          isLight ? const Color(0xFFF7F9F9) : scheme.surface,
      appBarTheme: AppBarTheme(
        centerTitle: false,
        elevation: 0,
        scrolledUnderElevation: 1,
        backgroundColor: isLight ? const Color(0xFFF7F9F9) : scheme.surface,
        foregroundColor: scheme.onSurface,
        titleTextStyle: text.titleLarge?.copyWith(color: scheme.onSurface),
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        margin: EdgeInsets.zero,
        color: scheme.surface,
        shape: RoundedRectangleBorder(
          borderRadius: AppRadius.cardAll,
          side: BorderSide(color: scheme.outlineVariant),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: minimumSize,
          padding: buttonPadding,
          shape: buttonShape,
          textStyle: text.labelLarge,
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: minimumSize,
          padding: buttonPadding,
          shape: buttonShape,
          textStyle: text.labelLarge,
          side: BorderSide(color: scheme.outline, width: 1.5),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          minimumSize: minimumSize,
          padding: const EdgeInsets.symmetric(
            horizontal: AppSpacing.md,
            vertical: AppSpacing.sm,
          ),
          shape: buttonShape,
          textStyle: text.labelLarge,
        ),
      ),
      iconButtonTheme: IconButtonThemeData(
        style: IconButton.styleFrom(
          minimumSize: const Size(AppSpacing.minTarget, AppSpacing.minTarget),
        ),
      ),
      listTileTheme: ListTileThemeData(
        minVerticalPadding: AppSpacing.md,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.xs,
        ),
        shape: RoundedRectangleBorder(borderRadius: AppRadius.controlAll),
        titleTextStyle: text.bodyLarge?.copyWith(fontWeight: FontWeight.w600),
        subtitleTextStyle: text.bodyMedium?.copyWith(
          color: scheme.onSurfaceVariant,
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: isLight ? Colors.white : scheme.surfaceContainerHighest,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.md,
          vertical: AppSpacing.md,
        ),
        border: OutlineInputBorder(
          borderRadius: AppRadius.controlAll,
          borderSide: BorderSide(color: scheme.outline),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: AppRadius.controlAll,
          borderSide: BorderSide(color: scheme.outline),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: AppRadius.controlAll,
          borderSide: BorderSide(color: scheme.primary, width: 2.5),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: AppRadius.controlAll,
          borderSide: BorderSide(color: scheme.error, width: 2),
        ),
        labelStyle: text.bodyLarge,
        helperMaxLines: 3,
        errorMaxLines: 3,
      ),
      chipTheme: ChipThemeData(
        padding: const EdgeInsets.symmetric(
          horizontal: AppSpacing.sm,
          vertical: AppSpacing.sm,
        ),
        labelStyle: text.bodyMedium,
        shape: RoundedRectangleBorder(borderRadius: AppRadius.controlAll),
      ),
      dividerTheme: DividerThemeData(
        color: scheme.outlineVariant,
        space: 1,
        thickness: 1,
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        contentTextStyle: text.bodyLarge?.copyWith(color: scheme.onInverseSurface),
        shape: RoundedRectangleBorder(borderRadius: AppRadius.controlAll),
      ),
      navigationBarTheme: NavigationBarThemeData(
        height: 72,
        labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => text.bodySmall?.copyWith(
            fontSize: 13,
            fontWeight: states.contains(WidgetState.selected)
                ? FontWeight.w700
                : FontWeight.w500,
          ),
        ),
      ),
    );
  }
}

/// Palette lookups that respect the current brightness, so status colours stay
/// legible in dark mode instead of turning into low-contrast mud.
extension StatusPalette on BuildContext {
  bool get isDark => Theme.of(this).brightness == Brightness.dark;

  Color get positiveInk =>
      isDark ? AppStatusColors.positiveDark : AppStatusColors.positive;

  Color get cautionInk =>
      isDark ? AppStatusColors.cautionDark : AppStatusColors.caution;

  Color get criticalInk =>
      isDark ? AppStatusColors.criticalDark : AppStatusColors.critical;

  Color get infoInk => isDark ? AppStatusColors.infoDark : AppStatusColors.info;

  Color get neutralInk =>
      isDark ? AppStatusColors.neutralDark : AppStatusColors.neutral;

  Color containerFor(Color ink) =>
      isDark ? ink.withValues(alpha: 0.18) : _lightContainerFor(ink);

  Color _lightContainerFor(Color ink) => switch (ink) {
        AppStatusColors.positive => AppStatusColors.positiveContainer,
        AppStatusColors.caution => AppStatusColors.cautionContainer,
        AppStatusColors.critical => AppStatusColors.criticalContainer,
        AppStatusColors.info => AppStatusColors.infoContainer,
        _ => AppStatusColors.neutralContainer,
      };
}
