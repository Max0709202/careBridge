import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/router.dart';
import 'app/theme.dart';

void main() {
  runApp(const ProviderScope(child: OpsConsoleApp()));
}

/// The dispatch console.
///
/// Flutter Web rather than a second mobile app: a dispatcher works at a desk
/// with a keyboard, several trips in view at once, and a phone in the other
/// hand. FOUNDATION §4 flags this surface as risk R1 — the one place the
/// Flutter choice was least obviously right — and the mitigation is that it
/// shares the domain mirrors, the generated client and the failure taxonomy
/// with the family app rather than being a parallel implementation of them.
class OpsConsoleApp extends ConsumerWidget {
  const OpsConsoleApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) => MaterialApp.router(
    title: 'CareBridge ops',
    debugShowCheckedModeBanner: false,
    theme: opsTheme(Brightness.light),
    darkTheme: opsTheme(Brightness.dark),
    routerConfig: ref.watch(routerProvider),
  );
}
