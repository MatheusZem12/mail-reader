class EmailSummary {
  final int messageNumber;
  final String subject;
  final String from;
  final DateTime? receivedDate;
  final bool seen;

  EmailSummary({
    required this.messageNumber,
    required this.subject,
    required this.from,
    this.receivedDate,
    required this.seen,
  });

  factory EmailSummary.fromJson(Map<String, dynamic> json) {
    return EmailSummary(
      messageNumber: json['messageNumber'] ?? 0,
      subject: json['subject'] ?? '(sem assunto)',
      from: json['from'] ?? '',
      receivedDate:
          json['receivedDate'] != null ? DateTime.parse(json['receivedDate']) : null,
      seen: json['seen'] ?? false,
    );
  }
}
