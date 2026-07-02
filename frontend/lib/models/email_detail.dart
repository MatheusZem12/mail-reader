class EmailDetail {
  final int messageNumber;
  final String subject;
  final String from;
  final List<String> to;
  final DateTime? receivedDate;
  final bool seen;
  final String contentType;
  final String body;
  final List<String> attachmentNames;

  EmailDetail({
    required this.messageNumber,
    required this.subject,
    required this.from,
    required this.to,
    this.receivedDate,
    required this.seen,
    required this.contentType,
    required this.body,
    required this.attachmentNames,
  });

  factory EmailDetail.fromJson(Map<String, dynamic> json) {
    return EmailDetail(
      messageNumber: json['messageNumber'] ?? 0,
      subject: json['subject'] ?? '(sem assunto)',
      from: json['from'] ?? '',
      to: (json['to'] as List<dynamic>?)?.cast<String>() ?? [],
      receivedDate:
          json['receivedDate'] != null ? DateTime.parse(json['receivedDate']) : null,
      seen: json['seen'] ?? false,
      contentType: json['contentType'] ?? '',
      body: json['body'] ?? '',
      attachmentNames:
          (json['attachmentNames'] as List<dynamic>?)?.cast<String>() ?? [],
    );
  }
}
