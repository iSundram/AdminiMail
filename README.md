<p align="center">
  <picture>
    <source srcset="apps/mail/public/white-icon.svg" media="(prefers-color-scheme: dark)">
    <img src="apps/mail/public/black-icon.svg" alt="AdminiMail Logo" width="64" style="background-color: #000; padding: 10px;"/>
  </picture>
</p>

# AdminiMail

An Open-Source Gmail Alternative for the Future of Email

## What is AdminiMail?

AdminiMail is a **complete, self-hosted email platform** that provides everything you need to run your own mail server with modern AI-powered features. Unlike traditional email services, AdminiMail gives you full control over your email infrastructure while providing enterprise-grade features and intelligent email management.

## Why AdminiMail?

Most email services today are either **closed-source**, **data-hungry**, or **require complex manual configuration**.
AdminiMail is different:

- ✅ **Complete Self-Hosted Solution** – Native SMTP, IMAP, POP3 servers built in TypeScript
- 🦾 **AI-Powered Intelligence** – Smart categorization, spam detection, and email insights
- 🔒 **Total Privacy Control** – Your emails, your server, your data. No external dependencies
- 🚀 **One-Click Installation** – Complete setup with a single script (`./install.sh`)
- 🛡️ **Enterprise Security** – Argon2 authentication, 2FA, fail2ban, and comprehensive logging
- 📱 **Modern Web Interface** – Beautiful, responsive webmail client built with React/Next.js
- 🔧 **Full Admin Control** – Manage domains, users, aliases, and quotas through web interface
- 📊 **Built-in Analytics** – Email statistics, delivery reports, and security monitoring
## Core Features

### 📧 **Complete Mail Server**
- **Native SMTP Server** – Send and receive emails with full RFC compliance
- **IMAP Server with IDLE** – Real-time email synchronization and folder management
- **POP3 Support** – Legacy client compatibility
- **SPF, DKIM, DMARC** – Automatic email authentication and security
- **TLS/SSL Encryption** – Secure connections with Let's Encrypt integration

### 🤖 **AI-Powered Features**
- **Smart Categorization** – Automatically sort emails (Primary, Promotions, Updates, Spam)
- **Spam & Phishing Detection** – Advanced ML-based filtering with Bayesian learning
- **Email Summaries** – AI-generated summaries for long emails
- **Reply Suggestions** – Intelligent response recommendations
- **Link Safety Analysis** – Real-time phishing and malware link detection

### 👨‍💼 **Administration & Management**
- **Domain Management** – Add and verify multiple domains
- **User Administration** – Create users, set quotas, manage permissions
- **Alias Management** – Email forwarding and catch-all addresses
- **DNS Record Generation** – Automatic SPF, DKIM, and DMARC record creation
- **Security Monitoring** – Failed login tracking and IP blocking
- **Backup & Migration** – Built-in backup tools and data export

### 🌐 **Modern Web Interface**
- **Responsive Design** – Works perfectly on desktop and mobile
- **Real-time Updates** – WebSocket-based live email notifications
- **Drag & Drop** – Easy file attachments and email organization
- **Calendar Integration** – CalDAV support for scheduling
- **Contact Management** – CardDAV-compatible address book
- **Dark/Light Themes** – Customizable appearance
## Quick Installation

Get AdminiMail running on your server in minutes:

```bash
# Download and run the installer
curl -fsSL https://install.admini.tech | sudo bash

# Or clone and install manually
git clone https://github.com/Admini-Tech/AdminiMail.git
cd AdminiMail
sudo ./install.sh
```

The installer will:
- ✅ Install all dependencies (Node.js, PostgreSQL, Nginx)
- ✅ Create database and system user
- ✅ Configure mail servers (SMTP, IMAP, POP3)
- ✅ Set up SSL certificates with Let's Encrypt
- ✅ Configure firewall and security (fail2ban)
- ✅ Generate DKIM keys and DNS records
- ✅ Start all services and create admin account

**System Requirements:**
- Ubuntu 20.04+ or CentOS 8+ (64-bit)
- 2GB+ RAM (4GB recommended)
- 20GB+ storage
- Root access
- Domain name pointing to your server

## Tech Stack

AdminiMail is built with modern, enterprise-grade technologies:

- **Frontend**: Next.js 14, React 18, TypeScript, TailwindCSS v4, Shadcn UI
- **Backend**: Node.js 20+, Native TypeScript mail servers
- **Database**: PostgreSQL 15+ with Drizzle ORM
- **Mail Servers**: Custom SMTP, IMAP, POP3 implementations
- **Security**: Argon2 password hashing, 2FA (TOTP/WebAuthn)
- **AI**: OpenAI GPT-4, Anthropic Claude integration
- **Protocols**: CalDAV (calendar), CardDAV (contacts)
- **Monitoring**: Built-in logging, metrics, and alerting
- **Deployment**: Single-script installation, systemd services

## Getting Started

### Production Installation (Recommended)

For production use, run the automated installer on your server:

```bash
# Quick install with default settings
curl -fsSL https://install.admini.tech | sudo bash

# Or download and customize before running
wget https://raw.githubusercontent.com/Admini-Tech/AdminiMail/main/install.sh
chmod +x install.sh
sudo ./install.sh
```

After installation:
1. Access your AdminiMail server at `https://your-domain.com`
2. Log in with the admin credentials shown during installation
3. Configure your first domain and create email users
4. Add DNS records for proper email delivery

### Development Setup

For development or testing, you can set up AdminiMail locally.

**Prerequisites:**
- [Node.js](https://nodejs.org/en/download) (v20 or higher)
- [pnpm](https://pnpm.io) (v8 or higher)
- [PostgreSQL](https://www.postgresql.org/) (v15 or higher)

### Setup Options

You can set up AdminiMail development environment in two ways:

<details open>
<summary><b>Standard Setup (Recommended)</b></summary>

#### Quick Start Guide

1. **Clone and Install**

   ```bash
   # Clone the repository
   git clone https://github.com/Admini-Tech/AdminiMail.git
   cd AdminiMail

   # Install dependencies
   pnpm install

   # Start database locally
   pnpm docker:db:up
   ```

2. **Set Up Environment**

   - Run `pnpm nizzy env` to setup your environment variables
   - Run `pnpm nizzy sync` to sync your environment variables and types
   - Start the database with the provided docker compose setup: `pnpm docker:db:up`
   - Initialize the database: `pnpm db:push`

3. **Start the App**

   ```bash
   pnpm dev
   ```

4. **Open in Browser**

   Visit [http://localhost:3000](http://localhost:3000)
   </details>

<details open>
<summary><b>Devcontainer Setup</b></summary>

#### Quick Start guide

1. **Clone and Install**

   ```bash
   # Clone the repository
   git clone https://github.com/Admini-Tech/AdminiMail.git
   cd AdminiMail
   ```

   Then open the code in devcontainer and install the dependencies:

   ```
   pnpm install

   # Start the database locally
   pnpm docker:db:up
   ```

2. **Set Up Environment**

   - Run `pnpm nizzy env` to setup your environment variables
   - Run `pnpm nizzy sync` to sync your environment variables and types
   - Start the database with the provided docker compose setup: `pnpm docker:db:up`
   - Initialize the database: `pnpm db:push`

3. **Start The App**
   ```bash
   pnpm dev
   ```
   Visit [http://localhost:3000](http://localhost:3000)
     </details>

### Environment Setup

1. **Better Auth Setup**

   - Open the `.env` file and change the BETTER_AUTH_SECRET to a random string. (Use `openssl rand -hex 32` to generate a 32 character string)

     ```env
     BETTER_AUTH_SECRET=your_secret_key
     ```

2. **Google OAuth Setup** (Required for Gmail integration)

   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create a new project
   - Add the following APIs in your Google Cloud Project: [People API](https://console.cloud.google.com/apis/library/people.googleapis.com), [Gmail API](https://console.cloud.google.com/apis/library/gmail.googleapis.com)
     - Use the links above and click 'Enable' or
     - Go to 'APIs and Services' > 'Enable APIs and Services' > Search for 'Google People API' and click 'Enable'
     - Go to 'APIs and Services' > 'Enable APIs and Services' > Search for 'Gmail API' and click 'Enable'
   - Enable the Google OAuth2 API
   - Create OAuth 2.0 credentials (Web application type)
   - Add authorized redirect URIs:
     - Development:
       - `http://localhost:8787/api/auth/callback/google`
     - Production:
       - `https://your-production-url/api/auth/callback/google`
   - Add to `.env`:

     ```env
     GOOGLE_CLIENT_ID=your_client_id
     GOOGLE_CLIENT_SECRET=your_client_secret
     ```

   - Add yourself as a test user:

     - Go to [`Audience`](https://console.cloud.google.com/auth/audience)
     - Under 'Test users' click 'Add Users'
     - Add your email and click 'Save'

> [!WARNING]
> The authorized redirect URIs in Google Cloud Console must match **exactly** what you configure in the `.env`, including the protocol (http/https), domain, and path - these are provided above.

3. **Autumn Setup** (Required for some encryption)

   - Go to [Autumn](https://useautumn.com/)
   - For Local Use, click [onboarding](https://app.useautumn.com/sandbox/onboarding) button and generate an Autumn Secret Key
   - For production, select the production mode from upper left corner and generate and fill the other fields. After that, generate an Autumn Secret Key

   - Add to `.env`:

   ```env
   AUTUMN_SECRET_KEY=your_autumn_secret
   ```

4. **Twilio Setup** (Required for SMS Integration)

   - Go to the [Twilio](https://www.twilio.com/)
   - Create a Twilio account if you don’t already have one
   - From the dashboard, locate your:

     - Account SID
     - Auth Token
     - Phone Number

   - Add to your `.env` file:

   ```env
   TWILIO_ACCOUNT_SID=your_account_sid
   TWILIO_AUTH_TOKEN=your_auth_token
   TWILIO_PHONE_NUMBER=your_twilio_phone_number
   ```

### Environment Variables

Run `pnpm nizzy env` to setup your environment variables. It will copy the `.env.example` file to `.env` and fill in the variables for you.
For local development a connection string example is provided in the `.env.example` file located in the same folder as the database.

### Database Setup

AdminiMail uses PostgreSQL for storing data. Here's how to set it up:

1. **Start the Database**

   Run this command to start a local PostgreSQL instance:

   ```bash
   pnpm docker:db:up
   ```

   This creates a database with:

   - Name: `adminimail`
   - Username: `postgres`
   - Password: `postgres`
   - Port: `5432`

2. **Set Up Database Connection**

   Make sure your database connection string is in `.env` file. And you have ran `pnpm nizzy sync` to sync the latest env.

   For local development use:

   ```
   DATABASE_URL="postgresql://postgres:postgres@localhost:5432/adminimail"
   ```

3. **Database Commands**

   - **Set up database tables**:

     ```bash
     pnpm db:push
     ```

   - **Create migration files** (after schema changes):

     ```bash
     pnpm db:generate
     ```

   - **Apply migrations**:

     ```bash
     pnpm db:migrate
     ```

   - **View database content**:
     ```bash
     pnpm db:studio
     ```
     > If you run `pnpm dev` in your terminal, the studio command should be automatically running with the app.

### Sync

Background: https://x.com/cmdhaus/status/1940886269950902362
We're now storing the user's emails in their Durable Object & an R2 bucket. This allow us to speed things up, a lot.
This also introduces 3 environment variables, `DROP_AGENT_TABLES`,`THREAD_SYNC_MAX_COUNT`, `THREAD_SYNC_LOOP`.
`DROP_AGENT_TABLES`: should the durable object drop the threads table before starting a sync
`THREAD_SYNC_MAX_COUNT`: how many threads should we sync? max `500` because it's using the same number for the maxResults number from the driver. i.e 500 results per page.
`THREAD_SYNC_LOOP`: should make sure to sync all of the items inside a folder? i.e if THREAD_SYNC_MAX_COUNT=500 it will sync 500 threads per request until the folder is fully synced. (should be true in production)

## Contribute

Please refer to the [contributing guide](.github/CONTRIBUTING.md).

If you'd like to help with translating AdminiMail to other languages, check out our [translation guide](.github/TRANSLATION.md).

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=Admini-Tech/AdminiMail&type=Timeline)](https://www.star-history.com/#Admini-Tech/AdminiMail&Timeline)

## This project wouldn't be possible without these awesome companies

<div style="display: flex; justify-content: center;">
  <a href="https://vercel.com" style="text-decoration: none;">
    <img src="public/vercel.png" alt="Vercel" width="96"/>
  </a>
  <a href="https://better-auth.com" style="text-decoration: none;">
    <img src="public/better-auth.png" alt="Better Auth" width="96"/>
  </a>
  <a href="https://orm.drizzle.team" style="text-decoration: none;">
    <img src="public/drizzle-orm.png" alt="Drizzle ORM" width="96"/>
  </a>
  <a href="https://coderabbit.com" style="text-decoration: none;">
    <img src="public/coderabbit.png" alt="Coderabbit AI" width="96"/>
  </a>
</div>

## 🤍 The team

Curious who makes AdminiMail? Here are our [contributors and maintainers](https://admini.tech/contributors)
