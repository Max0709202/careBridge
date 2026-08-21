import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'app/router.dart';
import 'app/theme.dart';
import 'state/providers.dart';

void main() {
  runApp(const ProviderScope(child: DriverApp()));
}

/// The driver's app.
///
/// A phone application rather than a third web surface, and for once the
/// reason is not preference: the whole point of it is a background location
/// service that keeps reporting with the screen off, and no browser will do
/// that. That single requirement is what makes this the one surface in the
/// product that has to be native.
class DriverApp extends ConsumerStatefulWidget {
  const DriverApp({super.key});

  @override
  ConsumerState<DriverApp> createState() => _DriverAppState();
}

class _DriverAppState extends ConsumerState<DriverApp> {
  Timer? _poll;

  @override
  void initState() {
    super.initState();
    // The work list re-reads itself here rather than on a screen, because a
    // driver who has navigated away is still driving and the family's map must
    // not stop because a widget was disposed.
    _poll = Timer.periodic(jobsPollInterval, (_) {
      if (ref.read(sessionProvider)) ref.invalidate(jobsProvider);
    });
  }

  @override
  void dispose() {
    _poll?.cancel();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => MaterialApp.router(
    title: 'CareBridge driver',
    debugShowCheckedModeBanner: false,
    theme: driverTheme(Brightness.light),
    darkTheme: driverTheme(Brightness.dark),
    routerConfig: ref.watch(routerProvider),
  );
}
