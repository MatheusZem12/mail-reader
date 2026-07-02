class EmailAccount {
  final String host;
  final int? port;
  final String username;
  final String password;
  final String protocol;
  final String folder;

  EmailAccount({
    required this.host,
    this.port,
    required this.username,
    required this.password,
    this.protocol = 'imaps',
    this.folder = 'INBOX',
  });

  Map<String, String> toQueryParams() {
    final params = <String, String>{
      'host': host,
      'username': username,
      'password': password,
      'protocol': protocol,
      'folder': folder,
    };
    if (port != null) {
      params['port'] = port.toString();
    }
    return params;
  }
}
