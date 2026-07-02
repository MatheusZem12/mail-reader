import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/email_account.dart';
import '../models/email_detail.dart';
import '../services/email_service.dart';

class EmailDetailScreen extends StatefulWidget {
  final EmailAccount account;
  final int messageNumber;

  const EmailDetailScreen({
    super.key,
    required this.account,
    required this.messageNumber,
  });

  @override
  State<EmailDetailScreen> createState() => _EmailDetailScreenState();
}

class _EmailDetailScreenState extends State<EmailDetailScreen> {
  final EmailService _service = EmailService();
  EmailDetail? _email;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadEmail();
  }

  Future<void> _loadEmail() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final email = await _service.getEmail(widget.account, widget.messageNumber);
      setState(() {
        _email = email;
        _loading = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  Future<void> _delete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Excluir e-mail'),
        content: const Text('Deseja remover este e-mail da caixa de entrada?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(context, false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.pop(context, true),
            child: const Text('Excluir'),
          ),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      await _service.deleteEmail(widget.account, widget.messageNumber);
      if (mounted) {
        Navigator.pop(context, true);
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro ao excluir: $e')),
        );
      }
    }
  }

  String _formatDate(DateTime? date) {
    if (date == null) return '';
    return DateFormat('dd/MM/yyyy HH:mm').format(date.toLocal());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('E-mail'),
        actions: [
          IconButton(
            icon: const Icon(Icons.delete),
            onPressed: _email != null ? _delete : null,
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Erro ao carregar e-mail:\n$_error',
                  textAlign: TextAlign.center),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: _loadEmail,
                child: const Text('Tentar novamente'),
              ),
            ],
          ),
        ),
      );
    }

    final email = _email!;
    return SingleChildScrollView(
      padding: const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            email.subject,
            style: Theme.of(context).textTheme.headlineSmall,
          ),
          const SizedBox(height: 12),
          _buildInfoRow('De:', email.from),
          _buildInfoRow('Para:', email.to.join(', ')),
          _buildInfoRow('Data:', _formatDate(email.receivedDate)),
          if (email.attachmentNames.isNotEmpty)
            _buildInfoRow('Anexos:', email.attachmentNames.join(', ')),
          const Divider(height: 32),
          SelectableText(email.body),
        ],
      ),
    );
  }

  Widget _buildInfoRow(String label, String value) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 4),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(label, style: const TextStyle(fontWeight: FontWeight.bold)),
          const SizedBox(width: 8),
          Expanded(child: Text(value)),
        ],
      ),
    );
  }
}
