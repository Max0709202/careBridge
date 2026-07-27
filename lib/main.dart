import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/router.dart';
import 'app/theme.dart';
import 'state/providers.dart';

void main() {
  runApp(const ProviderScope(child: CareBridgeApp()));
}

class CareBridgeApp extends ConsumerWidget {
  const CareBridgeApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final router = ref.watch(routerProvider);
    final simplified = ref.watch(simplifiedModeProvider);

    return MaterialApp.router(
      title: 'CareBridge',
      debugShowCheckedModeBanner: false,
      routerConfig: router,
      theme: AppTheme.light(),
      darkTheme: AppTheme.dark(),
      themeMode: ThemeMode.system,
      builder: (context, child) {
        final media = MediaQuery.of(context);

        // Two rules about text size, both deliberate:
        //
        // 1. The device's own accessibility setting is respected — never
        //    overridden, never clamped downwards. Someone who has set large text
        //    has told us something important about how they read.
        // 2. Simplified mode raises the *floor*, so it enlarges text for a user
        //    on the default setting without shrinking it for one who has already
        //    scaled up.
        final deviceScale = media.textScaler.scale(1);
        final effective = simplified
            ? (deviceScale < 1.3 ? 1.3 : deviceScale)
            : deviceScale;

        return MediaQuery(
          data: media.copyWith(
            textScaler: TextScaler.linear(effective.clamp(1.0, 2.0)),
          ),
          child: child ?? const SizedBox.shrink(),
        );
      },
    );
  }
}
