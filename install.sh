#!/bin/bash
set -Eeuo pipefail
IFS=$'\n\t'

# AdminiMail Installation Script
# Self-hosted email platform with AI-powered features
# Version: 1.0.0

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ADMINI_USER="admini"
ADMINI_HOME="/usr/local/adminimail"
ADMINI_SERVICE="adminimail"
ADMINI_VERSION="1.0.0"
NODE_VERSION="20"
POSTGRES_VERSION="15"
ADMINI_NONINTERACTIVE="${ADMINI_NONINTERACTIVE:-1}"
ADMINI_FORCE_OVERRIDE="${ADMINI_FORCE_OVERRIDE:-0}"

# Default ports
SMTP_PORT=25
SMTP_SECURE_PORT=465
IMAP_PORT=143
IMAP_SECURE_PORT=993
POP3_PORT=110
POP3_SECURE_PORT=995
WEBMAIL_PORT=2089

print_header() {
    echo -e "${BLUE}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                      AdminiMail Installer                    ║"
    echo "║              Self-hosted AI Email Platform                   ║"
    echo "║                     Version $ADMINI_VERSION                        ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

print_step() {
    echo -e "${GREEN}[STEP]${NC} $1"
}

print_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

check_root() {
    if [[ $EUID -ne 0 ]]; then
        print_error "This script must be run as root"
        exit 1
    fi
}

check_system() {
    print_step "Checking system requirements"
    
    # Check OS
    if [[ ! -f /etc/os-release ]]; then
        print_error "Cannot determine OS version"
        exit 1
    fi
    
    . /etc/os-release
    print_info "Detected OS: $NAME $VERSION"
    
    # Check architecture
    ARCH=$(uname -m)
    print_info "Architecture: $ARCH"
    
    if [[ "$ARCH" != "x86_64" && "$ARCH" != "aarch64" ]]; then
        print_error "Unsupported architecture: $ARCH"
        exit 1
    fi
    
    # Check memory (minimum 2GB)
    MEMORY_KB=$(grep MemTotal /proc/meminfo | awk '{print $2}')
    MEMORY_GB=$((MEMORY_KB / 1024 / 1024))
    
    if [[ $MEMORY_GB -lt 2 ]]; then
        print_warning "Low memory detected: ${MEMORY_GB}GB. AdminiMail requires at least 2GB RAM"
        if [[ "$ADMINI_NONINTERACTIVE" == "1" ]]; then
            print_warning "Continuing due to non-interactive mode (set ADMINI_NONINTERACTIVE=0 to prompt)."
        else
            read -p "Continue anyway? (y/N): " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                exit 1
            fi
        fi
    fi
    
    print_info "Memory: ${MEMORY_GB}GB"
}

install_dependencies() {
    print_step "Installing system dependencies"
    
    # Update package lists
    if command -v apt-get >/dev/null 2>&1; then
        apt-get update
        apt-get install -y curl wget gnupg2 software-properties-common \
                          build-essential python3 python3-pip \
                          nginx certbot python3-certbot-nginx \
                          fail2ban ufw logrotate git rsync ca-certificates
    elif command -v yum >/dev/null 2>&1; then
        yum update -y
        yum install -y curl wget gnupg2 \
                      gcc gcc-c++ make python3 python3-pip \
                      nginx certbot python3-certbot-nginx \
                      fail2ban firewalld logrotate git rsync ca-certificates
    else
        print_error "Unsupported package manager. Please install dependencies manually."
        exit 1
    fi
}

install_nodejs() {
    print_step "Installing Node.js $NODE_VERSION"
    
    if command -v apt-get >/dev/null 2>&1; then
        curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
        apt-get install -y nodejs
    elif command -v yum >/dev/null 2>&1; then
        curl -fsSL https://rpm.nodesource.com/setup_${NODE_VERSION}.x | bash -
        yum install -y nodejs
    else
        print_error "Unsupported package manager for Node.js installation"
        exit 1
    fi
    
    # Install pnpm
    npm install -g pnpm
    
    print_info "Node.js version: $(node --version)"
    print_info "npm version: $(npm --version)"
    print_info "pnpm version: $(pnpm --version)"
}

install_postgresql() {
    print_step "Installing PostgreSQL $POSTGRES_VERSION"
    
    if command -v apt-get >/dev/null 2>&1; then
        # Add PostgreSQL official repository using keyring (apt-key deprecated)
        install -d -m 0755 /usr/share/keyrings
        curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /usr/share/keyrings/postgresql.gpg
        . /etc/os-release
        CODENAME=${VERSION_CODENAME:-$(lsb_release -cs 2>/dev/null || echo "bookworm")}
        echo "deb [signed-by=/usr/share/keyrings/postgresql.gpg] http://apt.postgresql.org/pub/repos/apt/ ${CODENAME}-pgdg main" > /etc/apt/sources.list.d/pgdg.list
        apt-get update
        apt-get install -y postgresql-${POSTGRES_VERSION} postgresql-contrib-${POSTGRES_VERSION}
        POSTGRES_SERVICE="postgresql"
    elif command -v yum >/dev/null 2>&1; then
        yum install -y postgresql${POSTGRES_VERSION}-server postgresql${POSTGRES_VERSION}-contrib
        if command -v postgresql-${POSTGRES_VERSION}-setup >/dev/null 2>&1; then
            postgresql-${POSTGRES_VERSION}-setup initdb || true
        fi
        POSTGRES_SERVICE="postgresql-${POSTGRES_VERSION}"
    else
        print_error "Unsupported package manager. Please install PostgreSQL manually."
        exit 1
    fi
    
    # Start and enable PostgreSQL
    systemctl enable --now "$POSTGRES_SERVICE"
    
    print_info "PostgreSQL installed and started (service: $POSTGRES_SERVICE)"
}

create_user() {
    print_step "Creating AdminiMail system user"
    
    # Create user if it doesn't exist
    if ! id "$ADMINI_USER" &>/dev/null; then
        useradd -r -m -d "$ADMINI_HOME" -s /bin/bash "$ADMINI_USER"
        print_info "Created user: $ADMINI_USER"
    else
        print_info "User $ADMINI_USER already exists"
    fi
    
    # Create directories
    mkdir -p "$ADMINI_HOME"/{data,logs,certs,backups}
    chown -R "$ADMINI_USER:$ADMINI_USER" "$ADMINI_HOME"
}

setup_database() {
    print_step "Setting up AdminiMail database"
    
    # Generate random password if not already set
    DB_PASSWORD=${DB_PASSWORD:-$(openssl rand -base64 32)}
    
    # Create database and user idempotently
    if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='adminimail'" | grep -q 1; then
        sudo -u postgres psql -c "CREATE DATABASE adminimail;"
        print_info "Database created: adminimail"
    else
        print_info "Database already exists: adminimail"
    fi
    
    if ! sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='admini'" | grep -q 1; then
        sudo -u postgres psql -c "CREATE USER admini WITH ENCRYPTED PASSWORD '$DB_PASSWORD';"
        print_info "Database user created: admini"
    else
        print_info "Database user already exists: admini"
        # Optionally update password if DB_PASSWORD provided
        if [[ -n "${DB_PASSWORD}" ]]; then
            sudo -u postgres psql -c "ALTER USER admini WITH ENCRYPTED PASSWORD '$DB_PASSWORD';" || true
        fi
    fi
    
    sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE adminimail TO admini;" || true
    sudo -u postgres psql -c "ALTER USER admini CREATEDB;" || true
    
    # Save database configuration (do not overwrite existing .env)
    if [[ ! -f "$ADMINI_HOME/.env" ]]; then
        cat > "$ADMINI_HOME/.env" <<EOF
# AdminiMail Configuration
DATABASE_URL="postgresql://admini:$DB_PASSWORD@localhost:5432/adminimail"
ADMINI_HOSTNAME="$(hostname -f)"
ADMINI_SMTP_PORT=$SMTP_PORT
ADMINI_IMAP_PORT=$IMAP_PORT
ADMINI_POP3_PORT=$POP3_PORT
ADMINI_WEBMAIL_PORT=$WEBMAIL_PORT

# Security
JWT_SECRET="$(openssl rand -base64 64)"
ENCRYPTION_KEY="$(openssl rand -base64 32)"

# Email settings
DKIM_SELECTOR="admini"
SPF_RECORD="v=spf1 mx ~all"
DMARC_POLICY="v=DMARC1; p=quarantine; rua=mailto:dmarc@$(hostname -f)"

# AI Features (configure with your API keys)
OPENAI_API_KEY=""
ANTHROPIC_API_KEY=""

# Admin settings
ADMIN_EMAIL="admin@$(hostname -f)"
ADMIN_PASSWORD="$(openssl rand -base64 16)"
EOF
        chown "$ADMINI_USER:$ADMINI_USER" "$ADMINI_HOME/.env"
        chmod 600 "$ADMINI_HOME/.env"
        print_info "Configuration saved to: $ADMINI_HOME/.env"
    else
        print_warning "Config file exists at $ADMINI_HOME/.env. Skipping creation."
    fi
}

install_adminimail() {
    print_step "Installing AdminiMail application"
    
    # Ensure installation directory exists and is owned by the service user
    mkdir -p "$ADMINI_HOME"
    chown -R "$ADMINI_USER:$ADMINI_USER" "$ADMINI_HOME"
    
    BACKUP_DIR=""
    
    # Development installation: copy from workspace if present
    if [[ -d "/workspace" && -n "$(ls -A /workspace 2>/dev/null)" ]]; then
        print_info "Detected /workspace. Copying project files to $ADMINI_HOME"
        rsync -a --delete --exclude node_modules --exclude .git /workspace/ "$ADMINI_HOME/"
    else
        # Production installation
        if [[ -d "$ADMINI_HOME/.git" ]]; then
            print_info "Existing git repository found. Pulling latest changes."
            sudo -u "$ADMINI_USER" git -C "$ADMINI_HOME" pull --ff-only || print_warning "Git pull failed; continuing with existing files."
        else
            if [[ -z "$(ls -A "$ADMINI_HOME" 2>/dev/null)" ]]; then
                print_info "Cloning AdminiMail repository into empty directory."
                sudo -u "$ADMINI_USER" git clone https://github.com/iSundram/AdminiMail.git "$ADMINI_HOME"
            else
                if [[ "$ADMINI_NONINTERACTIVE" == "1" && "$ADMINI_FORCE_OVERRIDE" != "1" ]]; then
                    print_warning "$ADMINI_HOME is not empty and not a git repo. Skipping clone. Set ADMINI_FORCE_OVERRIDE=1 to override in non-interactive mode."
                else
                    echo -n "Directory $ADMINI_HOME is not empty and not a git repo. Override with a fresh clone? (y/N): "
                    if [[ "$ADMINI_NONINTERACTIVE" == "1" ]]; then
                        REPLY_YN="${ADMINI_FORCE_OVERRIDE}"
                    else
                        read -r REPLY
                        REPLY_YN="$REPLY"
                    fi
                    if [[ "$REPLY_YN" == "1" || "$REPLY_YN" =~ ^[Yy]$ ]]; then
                        TS=$(date +%Y%m%d%H%M%S)
                        BACKUP_DIR="${ADMINI_HOME}.bak-${TS}"
                        print_info "Backing up existing directory to ${BACKUP_DIR}"
                        mv "$ADMINI_HOME" "$BACKUP_DIR"
                        mkdir -p "$ADMINI_HOME"
                        chown -R "$ADMINI_USER:$ADMINI_USER" "$ADMINI_HOME"
                        print_info "Cloning AdminiMail repository."
                        sudo -u "$ADMINI_USER" git clone https://github.com/iSundram/AdminiMail.git "$ADMINI_HOME"
                    else
                        print_info "Keeping existing directory; continuing without clone."
                    fi
                fi
            fi
        fi
    fi

    # Ensure .env exists after possible clone/override
    if [[ ! -f "$ADMINI_HOME/.env" ]]; then
        if [[ -n "$BACKUP_DIR" && -f "$BACKUP_DIR/.env" ]]; then
            print_info "Restoring .env from backup"
            cp -f "$BACKUP_DIR/.env" "$ADMINI_HOME/.env"
            chown "$ADMINI_USER:$ADMINI_USER" "$ADMINI_HOME/.env"
            chmod 600 "$ADMINI_HOME/.env"
        else
            print_warning ".env not found; creating configuration"
            setup_database
        fi
    fi
    
    # Install dependencies
    cd "$ADMINI_HOME"
    sudo -u "$ADMINI_USER" pnpm install --frozen-lockfile || sudo -u "$ADMINI_USER" pnpm install
    
    # Build application
    sudo -u "$ADMINI_USER" pnpm build
    
    # Run database migrations
    sudo -u "$ADMINI_USER" pnpm db:migrate
    
    # Generate DKIM keys if absent
    if [[ ! -f "$ADMINI_HOME/certs/dkim-private.pem" || ! -f "$ADMINI_HOME/certs/dkim-public.pem" ]]; then
        sudo -u "$ADMINI_USER" node -e "
            const crypto = require('crypto');
            const { generateKeyPairSync } = crypto;
            const { privateKey, publicKey } = generateKeyPairSync('rsa', {
                modulusLength: 2048,
                publicKeyEncoding: { type: 'spki', format: 'pem' },
                privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
            });
            require('fs').writeFileSync('$ADMINI_HOME/certs/dkim-private.pem', privateKey);
            require('fs').writeFileSync('$ADMINI_HOME/certs/dkim-public.pem', publicKey);
            console.log('DKIM keys generated');
        "
    else
        print_info "DKIM keys already exist; skipping generation."
    fi
    
    chown -R "$ADMINI_USER:$ADMINI_USER" "$ADMINI_HOME"
    
    print_info "AdminiMail application installed"
}

setup_systemd_service() {
    print_step "Creating systemd service"
    
    cat > "/etc/systemd/system/${ADMINI_SERVICE}.service" <<EOF
[Unit]
Description=AdminiMail - Self-hosted AI Email Platform
Documentation=https://admini.tech/docs
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=$ADMINI_USER
Group=$ADMINI_USER
WorkingDirectory=$ADMINI_HOME
Environment=NODE_ENV=production
EnvironmentFile=$ADMINI_HOME/.env
ExecStart=/usr/bin/node apps/server/dist/main.js
ExecReload=/bin/kill -s HUP \$MAINPID
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=adminimail

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$ADMINI_HOME

# Resource limits
LimitNOFILE=65536
LimitNPROC=4096

[Install]
WantedBy=multi-user.target
EOF
    
    # Reload systemd and enable service
    systemctl daemon-reload
    systemctl enable "$ADMINI_SERVICE"
    
    print_info "Systemd service created: $ADMINI_SERVICE"
}

setup_nginx() {
    print_step "Configuring Nginx reverse proxy"
    
    # Determine config path (Debian-style sites-available or conf.d)
    if [[ -d "/etc/nginx/sites-available" ]]; then
        local NGINX_CONF_PATH="/etc/nginx/sites-available/adminimail"
        local NGINX_ENABLE_LINK="/etc/nginx/sites-enabled/adminimail"
        cat > "$NGINX_CONF_PATH" <<'EOF'
server {
    listen 80;
    server_name $(hostname -f);
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $(hostname -f);

    # SSL configuration (will be updated by certbot)
    ssl_certificate /etc/ssl/certs/ssl-cert-snakeoil.pem;
    ssl_certificate_key /etc/ssl/private/ssl-cert-snakeoil.key;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    
    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # AdminiMail webmail
    location / {
        proxy_pass http://127.0.0.1:__WEBMAIL_PORT__;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # API endpoints
    location /api/ {
        proxy_pass http://127.0.0.1:__WEBMAIL_PORT__;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health check
    location /health {
        proxy_pass http://127.0.0.1:__WEBMAIL_PORT__/health;
        access_log off;
    }
}
EOF
        # Substitute port placeholder safely
        sed -i "s/__WEBMAIL_PORT__/$WEBMAIL_PORT/g" "$NGINX_CONF_PATH"
        ln -sf "$NGINX_CONF_PATH" "$NGINX_ENABLE_LINK"
        rm -f /etc/nginx/sites-enabled/default || true
    else
        local NGINX_CONF_PATH="/etc/nginx/conf.d/adminimail.conf"
        cat > "$NGINX_CONF_PATH" <<'EOF'
server {
    listen 80;
    server_name $(hostname -f);
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    server_name $(hostname -f);

    # SSL configuration (will be updated by certbot)
    ssl_certificate /etc/ssl/certs/ssl-cert-snakeoil.pem;
    ssl_certificate_key /etc/ssl/private/ssl-cert-snakeoil.key;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:ECDHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    
    # Security headers
    add_header X-Frame-Options DENY;
    add_header X-Content-Type-Options nosniff;
    add_header X-XSS-Protection "1; mode=block";
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # AdminiMail webmail
    location / {
        proxy_pass http://127.0.0.1:__WEBMAIL_PORT__;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }

    # API endpoints
    location /api/ {
        proxy_pass http://127.0.0.1:__WEBMAIL_PORT__;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    # Health check
    location /health {
        proxy_pass http://127.0.0.1:__WEBMAIL_PORT__/health;
        access_log off;
    }
}
EOF
        sed -i "s/__WEBMAIL_PORT__/$WEBMAIL_PORT/g" "$NGINX_CONF_PATH"
    fi
    
    # Test configuration
    nginx -t
    
    # Start/enable Nginx
    systemctl start nginx
    systemctl enable nginx
    
    print_info "Nginx configured for AdminiMail (config: $NGINX_CONF_PATH)"
}

setup_ssl() {
    print_step "Setting up SSL certificate"
    
    # Request Let's Encrypt certificate
    if certbot --nginx -d "$(hostname -f)" --non-interactive --agree-tos --email "admin@$(hostname -f)" --redirect; then
        print_info "SSL certificate obtained successfully"
    else
        print_warning "Failed to obtain SSL certificate. Using self-signed certificate."
    fi
}

setup_firewall() {
    print_step "Configuring firewall"
    
    if command -v ufw >/dev/null 2>&1; then
        # Ubuntu/Debian
        ufw --force reset
        ufw default deny incoming
        ufw default allow outgoing
        
        # SSH
        ufw allow ssh
        
        # Web
        ufw allow 80/tcp
        ufw allow 443/tcp
        
        # Email ports
        ufw allow $SMTP_PORT/tcp
        ufw allow $SMTP_SECURE_PORT/tcp
        ufw allow $IMAP_PORT/tcp
        ufw allow $IMAP_SECURE_PORT/tcp
        ufw allow $POP3_PORT/tcp
        ufw allow $POP3_SECURE_PORT/tcp
        
        ufw --force enable
        
    elif command -v firewall-cmd >/dev/null 2>&1; then
        # CentOS/RHEL
        systemctl start firewalld
        systemctl enable firewalld
        
        firewall-cmd --permanent --add-service=ssh
        firewall-cmd --permanent --add-service=http
        firewall-cmd --permanent --add-service=https
        firewall-cmd --permanent --add-service=smtp
        firewall-cmd --permanent --add-service=smtps
        firewall-cmd --permanent --add-service=imap
        firewall-cmd --permanent --add-service=imaps
        firewall-cmd --permanent --add-service=pop3
        firewall-cmd --permanent --add-service=pop3s
        
        firewall-cmd --reload
    fi
    
    print_info "Firewall configured"
}

setup_fail2ban() {
    print_step "Configuring Fail2ban"
    
    # AdminiMail jail configuration
    cat > "/etc/fail2ban/jail.d/adminimail.conf" <<EOF
[adminimail-auth]
enabled = true
port = $SMTP_PORT,$SMTP_SECURE_PORT,$IMAP_PORT,$IMAP_SECURE_PORT,$POP3_PORT,$POP3_SECURE_PORT
protocol = tcp
filter = adminimail-auth
logpath = $ADMINI_HOME/logs/auth.log
maxretry = 5
bantime = 3600
findtime = 600

[adminimail-web]
enabled = true
port = 80,443
protocol = tcp
filter = adminimail-web
logpath = $ADMINI_HOME/logs/web.log
maxretry = 10
bantime = 1800
findtime = 600
EOF
    
    # Create filters
    cat > "/etc/fail2ban/filter.d/adminimail-auth.conf" <<EOF
[Definition]
failregex = ^.*AdminiMail.*failed login attempt.*<HOST>.*$
ignoreregex =
EOF
    
    cat > "/etc/fail2ban/filter.d/adminimail-web.conf" <<EOF
[Definition]
failregex = ^.*AdminiMail.*suspicious activity.*<HOST>.*$
ignoreregex =
EOF
    
    # Restart fail2ban
    systemctl restart fail2ban
    systemctl enable fail2ban
    
    print_info "Fail2ban configured for AdminiMail"
}

setup_logrotate() {
    print_step "Setting up log rotation"
    
    cat > "/etc/logrotate.d/adminimail" <<EOF
$ADMINI_HOME/logs/*.log {
    daily
    rotate 30
    compress
    delaycompress
    missingok
    notifempty
    create 644 $ADMINI_USER $ADMINI_USER
    postrotate
        systemctl reload $ADMINI_SERVICE
    endscript
}
EOF
    
    print_info "Log rotation configured"
}

start_services() {
    print_step "Starting AdminiMail services"
    
    # Start AdminiMail
    systemctl start "$ADMINI_SERVICE"
    
    # Wait for service to be ready
    print_info "Waiting for AdminiMail to start..."
    sleep 10
    
    # Check if service is running
    if systemctl is-active --quiet "$ADMINI_SERVICE"; then
        print_info "AdminiMail service started successfully"
    else
        print_error "Failed to start AdminiMail service"
        print_info "Check logs: journalctl -u $ADMINI_SERVICE"
        exit 1
    fi
}

print_completion() {
    print_step "Installation completed!"
    
    echo -e "${GREEN}"
    echo "╔══════════════════════════════════════════════════════════════╗"
    echo "║                 AdminiMail Installation Complete             ║"
    echo "╚══════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    
    echo "📧 AdminiMail is now running on your server!"
    echo ""
    echo "🌐 Web Interface: https://$(hostname -f)"
    echo "📱 Port: $WEBMAIL_PORT (behind Nginx proxy)"
    echo ""
    echo "📮 Mail Server Ports:"
    echo "   SMTP: $SMTP_PORT (STARTTLS), $SMTP_SECURE_PORT (SSL/TLS)"
    echo "   IMAP: $IMAP_PORT (STARTTLS), $IMAP_SECURE_PORT (SSL/TLS)"
    echo "   POP3: $POP3_PORT (STARTTLS), $POP3_SECURE_PORT (SSL/TLS)"
    echo ""
    echo "🔑 Admin Credentials (saved in $ADMINI_HOME/.env):"
    echo "   Email: $(grep ADMIN_EMAIL "$ADMINI_HOME/.env" | cut -d'=' -f2 | tr -d '\"')"
    echo "   Password: $(grep ADMIN_PASSWORD "$ADMINI_HOME/.env" | cut -d'=' -f2 | tr -d '\"')"
    echo ""
    echo "📋 Next Steps:"
    echo "1. Configure DNS records for your domain"
    echo "2. Add DKIM, SPF, and DMARC records"
    echo "3. Configure AI API keys in $ADMINI_HOME/.env"
    echo "4. Create your first email users via web interface"
    echo ""
    echo "🔧 Service Management:"
    echo "   Start:   systemctl start $ADMINI_SERVICE"
    echo "   Stop:    systemctl stop $ADMINI_SERVICE"
    echo "   Restart: systemctl restart $ADMINI_SERVICE"
    echo "   Status:  systemctl status $ADMINI_SERVICE"
    echo "   Logs:    journalctl -u $ADMINI_SERVICE -f"
    echo ""
    echo "📚 Documentation: https://admini.tech/docs"
    echo "🐛 Support: https://github.com/Admini-Tech/AdminiMail/issues"
    echo ""
    print_info "Installation directory: $ADMINI_HOME"
    print_info "Configuration file: $ADMINI_HOME/.env"
    print_info "DKIM keys: $ADMINI_HOME/certs/"
}

# Main installation flow
main() {
    print_header
    
    # Pre-installation checks
    check_root
    check_system
    
    # Install system components
    install_dependencies
    install_nodejs
    install_postgresql
    
    # Setup AdminiMail
    create_user
    setup_database
    install_adminimail
    
    # Configure services
    setup_systemd_service
    setup_nginx
    setup_ssl
    
    # Security configuration
    setup_firewall
    setup_fail2ban
    setup_logrotate
    
    # Start services
    start_services
    
    # Show completion message
    print_completion
}

# Handle script interruption
trap 'print_error "Installation interrupted"; exit 1' INT TERM

# Run main installation
main "$@"
