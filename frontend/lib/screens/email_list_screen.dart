import 'package:flutter/material.dart';
import 'package:intl/intl.dart';
import '../models/email_account.dart';
import '../models/email_summary.dart';
import '../services/email_service.dart';
import 'email_detail_screen.dart';

class EmailListScreen extends StatefulWidget {
  final EmailAccount account;

  const EmailListScreen({super.key, required this.account});

  @override
  State<EmailListScreen> createState() => _EmailListScreenState();
}

class _EmailListScreenState extends State<EmailListScreen> {
  final EmailService _service = EmailService();
  final List<EmailSummary> _emails = [];
  bool _loading = true;
  bool _loadingMore = false;
  String? _error;
  int _page = 0;
  static const int _pageSize = 20;

  @override
  void initState() {
    super.initState();
    _loadEmails();
  }

  Future<void> _loadEmails({bool append = false}) async {
    if (append) {
      setState(() => _loadingMore = true);
    } else {
      setState(() {
        _loading = true;
        _error = null;
      });
    }

    try {
      final emails = await _service.listEmails(widget.account,
          page: _page, size: _pageSize);
      setState(() {
        if (append) {
          _emails.addAll(emails);
        } else {
          _emails.clear();
          _emails.addAll(emails);
        }
        _loading = false;
        _loadingMore = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _loading = false;
        _loadingMore = false;
      });
    }
  }

  Future<void> _deleteEmail(EmailSummary email) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (_) => AlertDialog(
        title: const Text('Excluir e-mail'),
        content: Text('Deseja remover "${email.subject}"?'),
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
      await _service.deleteEmail(widget.account, email.messageNumber);
      setState(() => _emails.removeWhere((e) => e.messageNumber == email.messageNumber));
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('E-mail excluído')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro ao excluir: $e')),
        );
      }
    }
  }

  void _openEmail(EmailSummary email) {
    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => EmailDetailScreen(
          account: widget.account,
          messageNumber: email.messageNumber,
        ),
      ),
    ).then((deleted) {
      if (deleted == true) {
        _loadEmails();
      }
    });
  }

  String _formatDate(DateTime? date) {
    if (date == null) return '';
    return DateFormat('dd/MM/yyyy HH:mm').format(date.toLocal());
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text('Caixa de entrada - ${widget.account.username}'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: () {
              _page = 0;
              _loadEmails();
            },
          ),
        ],
      ),
      body: _buildBody(),
    );
  }

  Widget _buildBody() {
    if (_loading && _emails.isEmpty) {
      return const Center(child: CircularProgressIndicator());
    }

    if (_error != null && _emails.isEmpty) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text('Erro ao carregar e-mails:\n$_error',
                  textAlign: TextAlign.center),
              const SizedBox(height: 16),
              FilledButton(
                onPressed: () {
                  _page = 0;
                  _loadEmails();
                },
                child: const Text('Tentar novamente'),
              ),
            ],
          ),
        ),
      );
    }

    return RefreshIndicator(
      onRefresh: () async {
        _page = 0;
        await _loadEmails();
      },
      child: ListView.builder(
        itemCount: _emails.length + 1,
        itemBuilder: (context, index) {
          if (index == _emails.length) {
            return _buildLoadMore();
          }
          final email = _emails[index];
          return Dismissible(
            key: ValueKey(email.messageNumber),
            direction: DismissDirection.endToStart,
            background: Container(
              color: Colors.red,
              alignment: Alignment.centerRight,
              padding: const EdgeInsets.only(right: 16),
              child: const Icon(Icons.delete, color: Colors.white),
            ),
            onDismissed: (_) => _deleteEmail(email),
            child: ListTile(
              leading: CircleAvatar(
                backgroundColor: email.seen ? Colors.grey : Colors.blue,
                child: Icon(
                  email.seen ? Icons.mail_outline : Icons.mail,
                  color: Colors.white,
                ),
              ),
              title: Text(
                email.subject,
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(
                  fontWeight: email.seen ? FontWeight.normal : FontWeight.bold,
                ),
              ),
              subtitle: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(email.from, maxLines: 1, overflow: TextOverflow.ellipsis),
                  Text(_formatDate(email.receivedDate),
                      style: const TextStyle(fontSize: 12)),
                ],
              ),
              isThreeLine: false,
              onTap: () => _openEmail(email),
              trailing: IconButton(
                icon: const Icon(Icons.delete_outline),
                onPressed: () => _deleteEmail(email),
              ),
            ),
          );
        },
      ),
    );
  }

  Widget _buildLoadMore() {
    if (_loadingMore) {
      return const Padding(
        padding: EdgeInsets.all(16),
        child: Center(child: CircularProgressIndicator()),
      );
    }
    return Padding(
      padding: const EdgeInsets.all(8),
      child: TextButton(
        onPressed: () {
          _page++;
          _loadEmails(append: true);
        },
        child: const Text('Carregar mais'),
      ),
    );
  }
}
