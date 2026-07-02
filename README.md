# Mail Reader

Leitor de e-mail com backend em Java (Spring Boot) e frontend em Flutter.

Permite visualizar a caixa de entrada, ler o corpo dos e-mails e removê-los do servidor.

## Estrutura

```
mail-reader/
├── backend/    # API REST em Java + Spring Boot
└── frontend/   # App Flutter
```

## Funcionalidades

- Conexão com servidores IMAP/IMAP SSL/POP3/POP3 SSL
- Listagem de e-mails com paginação (scroll infinito)
- Leitura do corpo do e-mail (texto e HTML simplificado)
- Marcação automática como lido ao abrir
- Exclusão de e-mails (swipe ou botão)

## Requisitos

- Java 21
- Maven 3.9
- Flutter 3.22.3+

## Como executar

### 1. Backend

```bash
cd backend
mvn spring-boot:run
```

O backend ficará disponível em `http://localhost:8080`.

### 2. Frontend

#### Web

```bash
cd frontend
flutter run -d chrome
```

#### Desktop Linux

```bash
cd frontend
flutter run -d linux
```

#### Android

Certifique-se de que o emulador/dispositivo está na mesma rede do backend e que o `baseUrl` em `lib/services/email_service.dart` aponte para o IP da máquina (não `localhost`).

```bash
cd frontend
flutter run
```

## Configuração de exemplo (Gmail)

1. Ative o IMAP nas configurações do Gmail.
2. Gere uma **Senha de app** em sua conta Google.
3. No app, use:
   - **Protocolo:** `imaps`
   - **Host:** `imap.gmail.com`
   - **Porta:** `993`
   - **Usuário:** seu e-mail
   - **Senha:** a senha de app gerada

## Endpoints da API

| Método | Endpoint | Descrição |
|--------|----------|-----------|
| GET | `/api/emails` | Lista e-mails da pasta informada |
| GET | `/api/emails/{messageNumber}` | Retorna detalhes de um e-mail |
| DELETE | `/api/emails/{messageNumber}` | Remove o e-mail do servidor |

Todos os endpoints recebem as credenciais por query string:

- `host`
- `port` (opcional)
- `username`
- `password`
- `protocol` (padrão: `imaps`)
- `folder` (padrão: `INBOX`)

Parâmetros de paginação em `/api/emails`:
- `page` (padrão: `0`)
- `size` (padrão: `20`)

## Aviso de segurança

As credenciais são enviadas via query string apenas para simplificar o projeto local. **Não use em produção** sem adicionar autenticação, HTTPS e um mecanismo seguro de armazenamento de senhas.
