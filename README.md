# Mail Reader

A local e-mail reader built with **Electron + Node.js**. There is no remote backend: the connection to Gmail and Outlook happens directly on the user's machine, through OAuth, and everything (credentials, tokens, e-mail cache) is stored locally and encrypted.

> ⚖️ **Before using it, read the [Terms of Use](TERMS-OF-USE.md).** Acceptance is requested on the first use of the app. In short: personal use is free of charge; **any monetization built on the project requires sharing 50% of the profit with the author** (details in the document).

## How it works

1. **First use:** the app shows the Terms of Use (accept to continue) and then the **"Set up OAuth"** screen, with a step-by-step tutorial.
2. **You create your own OAuth credentials** on Google/Microsoft (only once, free of charge), paste the codes into the fields and the app saves everything **in your machine's local `.env`** — nothing comes embedded, nothing is sent out.
3. From then on just click **"Sign in with Google"** or **"Sign in with Outlook"**: the browser opens the provider's official screen, you authorize it, and you're done.
4. The unified inbox shows the e-mails of every account, with a side reading pane, search and multi-selection, plus a side nav with **Spam**, **Trash**, **Automator** (bulk cleanup rules) and **Domains** (which sites/services you get e-mail from).

## Requirements

- Node.js 18+
- npm 9+

## Project layout

- `source/` — all of the app code (Electron + Node.js)
- `README.md`, `TERMS-OF-USE.md`, `start.sh`, `install-desktop.sh` — docs and scripts, at the root

## Running

```bash
cd source
npm install
npm start        # or ./start.sh (at the project root)
```

### Install as a desktop app (Linux)

To create a launcher in the applications menu, with an icon:

```bash
./install-desktop.sh              # installs/updates the launcher
./install-desktop.sh --uninstall  # removes it
```

## OAuth setup (done by you, only once)

The app guides you with links and a tutorial on the setup screen itself. In short:

### Google (Gmail)

1. Open [Google Cloud Console → Credentials](https://console.cloud.google.com/apis/credentials) and create a project (any name).
2. Enable the [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com).
3. Set up the **OAuth consent screen** (type **External**).
4. Under [Audience → Test users](https://console.cloud.google.com/auth/audience), **add your Gmail** (without it the sign-in fails with error 403).
5. Still under [Audience](https://console.cloud.google.com/auth/audience), click **Publish app** (status **In production**). ⚠️ While the project stays in **Testing**, Google **expires the refresh token every 7 days** and you have to sign in again every week. Once published, the session doesn't expire on its own. Since the Gmail scope is sensitive, the sign-in then shows an "unverified app" warning — go to **Advanced → Go to (unsafe)**; Google's verification is only needed to distribute the app to other people.
6. Under **Credentials → Create Credentials → OAuth client ID**, type **Desktop app**.
7. Copy the **Client ID** (`...apps.googleusercontent.com`) and the **Client Secret** (`GOCSPX-...`) and paste them on the app's setup screen.

### Microsoft (Outlook)

1. Open [Azure → App registrations](https://portal.azure.com/#blade/Microsoft_AAD_RegisteredApps/ApplicationsListBlade) → **New registration** (personal + organizational accounts).
2. Under **Authentication → Add a platform → Mobile and desktop applications**, add the redirect URI `http://localhost:42814/oauth2callback`.
3. Copy the **Application (client) ID** and paste it into the app.

### Where is it saved?

In the **`.env` file inside `source/`, created by the app itself** — local to your machine and ignored by git (never commit it). Redirect URIs used: Google `http://localhost:42813/oauth2callback` (allowed automatically for Desktop apps), Microsoft `http://localhost:42814/oauth2callback`.

### Another computer?

The Google/Azure setup is done **only once**. On the new computer, copy your `.env` there — or simply paste the same codes again on the setup screen.

## Features

- OAuth sign-in with Google (Gmail) and Microsoft (Outlook)
- A unified inbox with a side reading pane
- Folder navigation in a vertical column left of the list (Inbox, Spam, Trash, Automator, Domains)
- Trash: deleting moves to the trash (with no confirmation dialog); from there you can restore or delete forever
- **Spam:** lists what Gmail/Outlook marked as spam, with the same search and filters as the inbox; you can mark "not spam" (back to the inbox) or send it to the trash
- Search by sender, subject and content, with a period filter and sorting
- Multi-selection, bulk deletion and restore
- **Domains:** groups senders by domain, showing which sites/services you get e-mail from (and how many) — one click filters the mailbox by that domain
- **Automator:** saved cleanup rules — each rule holds one or more **senders** separated by `;` (e.g. `acmebank;shopco;newsletter`) and, when run, moves to the trash every e-mail **received from** each of them. Mentioning the name in the subject or body doesn't count: the sender's address is split on every special character (`@ . _ - +`) and some piece has to **equal** the term — `acmebank` matches `x@e.acmebank.com`, `acmebank@gmail.com` and `no-reply_acmebank@mkt.com`, while `acme` matches nothing and `bb` doesn't catch `@abbott.com`. What you type is normalized to lowercase without spaces (`ACME BANK` → `acmebank`); a term with a separator (`shopco.com`, `acme-bank`) requires the pieces in the same order, right next to each other
- Adjustable e-mail body zoom
- An encrypted local cache (instant opening, fewer requests)
- 100% local storage: tokens and cache encrypted with Electron's `safeStorage`

## Shortcuts

- **`Delete`**: deletes the open e-mail and selects the next one in the list
- **`↑` / `↓`**: moves between the e-mails in the list (up/down and opens the next one)
- **`Shift` + `↑` / `↓`**: selects several e-mails in a row

## Security and privacy

- **100% local:** there is no author server. Communication goes straight from your computer to the Google/Microsoft APIs.
- **Your credentials, your machine:** the Client IDs/Secrets are created by you and stay only in your local `.env`.
- **Encrypted tokens and cache** with Electron's `safeStorage` (the operating system keychain).

## License and Terms of Use

This project is open source with conditions: see [TERMS-OF-USE.md](TERMS-OF-USE.md).

- ✅ **Personal use:** free of charge (read, study, modify, run).
- 💰 **Commercial use/monetization** (sale, subscription, advertising, SaaS, paid distribution, derivatives): requires **notifying the author in advance and sharing 50% of the profit**.
- 🔁 **Redistribution:** allowed as long as the Terms, the attribution of authorship and the acceptance screen on first use are kept.

Contact for commercial licensing: **matheuslajazem@gmail.com**
