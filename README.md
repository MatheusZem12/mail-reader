# Mail Reader

Leitor de e-mail local com **Electron + Node.js**. Não há backend remoto: a conexão com Gmail e Outlook acontece diretamente na máquina do usuário, via OAuth, e tudo (credenciais, tokens, cache de e-mails) fica salvo localmente e criptografado.

> ⚖️ **Antes de usar, leia os [Termos de Uso](TERMOS-DE-USO.md).** O aceite é solicitado no primeiro acesso ao app. Em resumo: uso pessoal é livre e gratuito; **qualquer monetização em cima do projeto obriga o repasse de 50% do lucro ao autor** (detalhes no documento).

## Como funciona

1. **Primeiro acesso:** o app mostra os Termos de Uso (aceitar para continuar) e depois a tela **"Configurar OAuth"**, com tutorial passo a passo.
2. **Você cria suas próprias credenciais** OAuth no Google/Microsoft (uma única vez, gratuito), cola os códigos nos campos e o app salva tudo **no `.env` local da sua máquina** — nada vem embutido, nada é enviado para fora.
3. Daí em diante é só clicar em **"Entrar com Google"** ou **"Entrar com Outlook"**: o navegador abre na tela oficial do provedor, você autoriza, e pronto.
4. A caixa de entrada unificada mostra os e-mails de todas as contas, com painel de leitura lateral, busca e seleção múltipla, além de uma nav lateral com **Spam**, **Lixeira**, **Automatizador** (regras de limpeza em massa) e **Domínios** (de quais sites/serviços você recebe e-mail).

## Requisitos

- Node.js 18+
- npm 9+

## Estrutura do projeto

- `source/` — todo o código do app (Electron + Node.js)
- `README.md`, `TERMOS-DE-USO.md`, `start.sh`, `install-desktop.sh` — documentação e scripts, na raiz

## Como executar

```bash
cd source
npm install
npm start        # ou ./start.sh (na raiz do projeto)
```

### Instalar como app do desktop (Linux)

Para criar um atalho no menu de aplicativos, com ícone:

```bash
./install-desktop.sh              # instala/atualiza o atalho
./install-desktop.sh --uninstall  # remove
```

## Configuração OAuth (feita por você, uma única vez)

O app te guia com links e tutorial na própria tela de configuração. Resumo:

### Google (Gmail)

1. Acesse [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) e crie um projeto (qualquer nome).
2. Ative a [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com).
3. Configure a **OAuth consent screen** (tipo **External**).
4. Em [Audience → Test users](https://console.cloud.google.com/auth/audience), **adicione seu Gmail** (sem isso o login dá erro 403).
5. Em **Credentials → Create Credentials → OAuth client ID**, tipo **Desktop app**.
6. Copie o **Client ID** (`...apps.googleusercontent.com`) e o **Client Secret** (`GOCSPX-...`) e cole na tela de configuração do app.

### Microsoft (Outlook)

1. Acesse [Azure → App registrations](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) → **New registration** (contas pessoais + organizacionais).
2. Em **Authentication → Add a platform → Mobile and desktop applications**, adicione o redirect URI `http://localhost:42814/oauth2callback`.
3. Copie o **Application (client) ID** e cole no app.

### Onde isso fica salvo?

No arquivo **`.env` dentro de `source/`, criado pelo próprio app** — local da sua máquina e ignorado pelo git (nunca commite). Redirect URIs usados: Google `http://localhost:42813/oauth2callback` (liberado automaticamente para apps Desktop), Microsoft `http://localhost:42814/oauth2callback`.

### Outro computador?

A configuração no Google/Azure é feita **uma vez só**. No novo computador, copie o seu `.env` para lá — ou simplesmente cole os mesmos códigos de novo na tela de configuração.

## Funcionalidades

- Login OAuth com Google (Gmail) e Microsoft (Outlook)
- Caixa de entrada unificada com painel de leitura lateral
- Navegação de pastas em coluna vertical à esquerda da lista (Entrada, Spam, Lixeira, Automatizador, Domínios)
- Lixeira: excluir move para a lixeira (sem diálogo de confirmação); lá é possível restaurar ou excluir de vez
- **Spam:** lista o que Gmail/Outlook marcaram como spam, com busca e filtros iguais aos da caixa de entrada; dá para marcar "não é spam" (volta para a entrada) ou mandar para a lixeira
- Busca por remetente, assunto e conteúdo, com filtro por período e ordenação
- Seleção múltipla, exclusão e restauração em lote
- **Domínios:** agrupa os remetentes por domínio, mostrando de quais sites/serviços você recebe e-mail (e quantos) — com um clique você filtra a caixa por aquele domínio
- **Automatizador:** regras de limpeza salvas — cada regra guarda um ou mais **remetentes** separados por `;` (ex.: `btgpactual;santander;kabum`) e, ao ser executada, move para a lixeira todos os e-mails **recebidos de** cada um deles. Citar o nome no assunto ou no corpo não conta: o endereço de quem enviou é quebrado em todo caractere especial (`@ . _ - +`) e algum pedaço tem que ser **igual** ao termo — `btgpactual` casa com `x@e.btgpactual.com.br`, `btgpactual@gmail.com` e `no-reply_btgpactual@mkt.com`, enquanto `btg` não casa nada e `bb` não pega `@abbott.com`. O que você digita é normalizado para minúsculo e sem espaço (`BTG PACTUAL` → `btgpactual`); termo com separador (`kabum.com.br`, `btg-pactual`) exige os pedaços na mesma ordem, colados
- Zoom ajustável do corpo do e-mail
- Cache local criptografado (abertura instantânea, menos requests)
- Armazenamento 100% local: tokens e cache criptografados com o `safeStorage` do Electron

## Atalhos

- **`Delete`**: exclui o e-mail aberto e já seleciona o próximo da lista
- **`↑` / `↓`**: navega entre os e-mails da lista (sobe/desce e abre o próximo)

## Segurança e privacidade

- **100% local:** não existe servidor do autor. A comunicação vai direto do seu computador para as APIs do Google/Microsoft.
- **Suas credenciais, sua máquina:** os Client IDs/Secrets são criados por você e ficam só no seu `.env` local.
- **Tokens e cache criptografados** com o `safeStorage` do Electron (chaveiro do sistema operacional).

## Licença e Termos de Uso

Este projeto é de código aberto com condições: veja [TERMOS-DE-USO.md](TERMOS-DE-USO.md).

- ✅ **Uso pessoal:** livre e gratuito (ler, estudar, modificar, executar).
- 💰 **Uso comercial/monetização** (venda, assinatura, publicidade, SaaS, distribuição paga, derivados): exige **comunicação prévia ao autor e repasse de 50% do lucro**.
- 🔁 **Redistribuição:** permitida mantendo os Termos, a atribuição de autoria e a tela de aceite no primeiro acesso.

Contato para licenciamento comercial: **matheuslajazem@gmail.com**
