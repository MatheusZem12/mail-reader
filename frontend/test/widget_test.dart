import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mail_reader_frontend/main.dart';

void main() {
  testWidgets('App renderiza tela inicial', (WidgetTester tester) async {
    await tester.pumpWidget(const MailReaderApp());
    expect(find.text('Mail Reader'), findsOneWidget);
    expect(find.text('Conectar'), findsOneWidget);
  });
}
