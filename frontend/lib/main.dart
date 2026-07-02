import 'package:flutter/material.dart';
import 'screens/login_screen.dart';

void main() {
  runApp(const MailReaderApp());
}

class MailReaderApp extends StatelessWidget {
  const MailReaderApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Mail Reader',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: Colors.blue),
        useMaterial3: true,
      ),
      home: const LoginScreen(),
    );
  }
}
