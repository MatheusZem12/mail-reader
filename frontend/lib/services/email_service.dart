import 'dart:convert';
import 'package:http/http.dart' as http;
import '../models/email_account.dart';
import '../models/email_detail.dart';
import '../models/email_summary.dart';

class EmailService {
  final String baseUrl;

  EmailService({this.baseUrl = 'http://localhost:8080'});

  Uri _buildUri(String path, EmailAccount account,
      {Map<String, String>? extra}) {
    final params = account.toQueryParams();
    if (extra != null) {
      params.addAll(extra);
    }
    return Uri.parse('$baseUrl$path').replace(queryParameters: params);
  }

  Future<List<EmailSummary>> listEmails(EmailAccount account,
      {int page = 0, int size = 20}) async {
    final uri = _buildUri('/api/emails', account, extra: {
      'page': page.toString(),
      'size': size.toString(),
    });
    final response = await http.get(uri);
    if (response.statusCode == 200) {
      final List<dynamic> data = jsonDecode(response.body);
      return data.map((e) => EmailSummary.fromJson(e)).toList();
    }
    throw Exception(_parseError(response));
  }

  Future<EmailDetail> getEmail(EmailAccount account, int messageNumber) async {
    final uri = _buildUri('/api/emails/$messageNumber', account);
    final response = await http.get(uri);
    if (response.statusCode == 200) {
      return EmailDetail.fromJson(jsonDecode(response.body));
    }
    throw Exception(_parseError(response));
  }

  Future<void> deleteEmail(EmailAccount account, int messageNumber) async {
    final uri = _buildUri('/api/emails/$messageNumber', account);
    final response = await http.delete(uri);
    if (response.statusCode != 204 && response.statusCode != 200) {
      throw Exception(_parseError(response));
    }
  }

  String _parseError(http.Response response) {
    try {
      return utf8.decode(response.bodyBytes);
    } catch (_) {
      return 'Erro ${response.statusCode}';
    }
  }
}
