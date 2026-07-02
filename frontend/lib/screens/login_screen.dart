import 'package:flutter/material.dart';
import '../models/email_account.dart';
import 'email_list_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _hostController = TextEditingController(text: 'imap.gmail.com');
  final _portController = TextEditingController(text: '993');
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();
  String _protocol = 'imaps';
  bool _obscurePassword = true;

  void _connect() {
    if (!_formKey.currentState!.validate()) return;

    final account = EmailAccount(
      host: _hostController.text.trim(),
      port: int.tryParse(_portController.text.trim()),
      username: _usernameController.text.trim(),
      password: _passwordController.text,
      protocol: _protocol,
    );

    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => EmailListScreen(account: account),
      ),
    );
  }

  @override
  void dispose() {
    _hostController.dispose();
    _portController.dispose();
    _usernameController.dispose();
    _passwordController.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Mail Reader')),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(16),
        child: Form(
          key: _formKey,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Text(
                'Configuração da conta de e-mail',
                style: TextStyle(fontSize: 18, fontWeight: FontWeight.bold),
              ),
              const SizedBox(height: 16),
              DropdownButtonFormField<String>(
                value: _protocol,
                decoration: const InputDecoration(
                  labelText: 'Protocolo',
                  border: OutlineInputBorder(),
                ),
                items: const [
                  DropdownMenuItem(value: 'imaps', child: Text('IMAP SSL (imaps)')),
                  DropdownMenuItem(value: 'imap', child: Text('IMAP (imap)')),
                  DropdownMenuItem(value: 'pop3s', child: Text('POP3 SSL (pop3s)')),
                  DropdownMenuItem(value: 'pop3', child: Text('POP3 (pop3)')),
                ],
                onChanged: (value) {
                  if (value != null) {
                    setState(() => _protocol = value);
                  }
                },
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _hostController,
                decoration: const InputDecoration(
                  labelText: 'Servidor (host)',
                  border: OutlineInputBorder(),
                  hintText: 'imap.gmail.com',
                ),
                validator: (value) =>
                    value == null || value.isEmpty ? 'Informe o host' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _portController,
                decoration: const InputDecoration(
                  labelText: 'Porta',
                  border: OutlineInputBorder(),
                  hintText: '993',
                ),
                keyboardType: TextInputType.number,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _usernameController,
                decoration: const InputDecoration(
                  labelText: 'Usuário / E-mail',
                  border: OutlineInputBorder(),
                ),
                validator: (value) =>
                    value == null || value.isEmpty ? 'Informe o usuário' : null,
              ),
              const SizedBox(height: 12),
              TextFormField(
                controller: _passwordController,
                decoration: InputDecoration(
                  labelText: 'Senha / App password',
                  border: const OutlineInputBorder(),
                  suffixIcon: IconButton(
                    icon: Icon(_obscurePassword
                        ? Icons.visibility_off
                        : Icons.visibility),
                    onPressed: () => setState(
                        () => _obscurePassword = !_obscurePassword),
                  ),
                ),
                obscureText: _obscurePassword,
                validator: (value) =>
                    value == null || value.isEmpty ? 'Informe a senha' : null,
              ),
              const SizedBox(height: 24),
              FilledButton(
                onPressed: _connect,
                child: const Text('Conectar'),
              ),
              const SizedBox(height: 12),
              const Text(
                'Dica: para Gmail use uma "Senha de app" e ative IMAP nas configurações.',
                style: TextStyle(fontSize: 12, color: Colors.grey),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
