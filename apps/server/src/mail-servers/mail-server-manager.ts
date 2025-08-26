import { EventEmitter } from 'events';
import { SMTPServer, SMTPServerConfig } from './smtp-server';
import { IMAPServer, IMAPServerConfig } from './imap-server';
import { POP3Server, POP3ServerConfig } from './pop3-server';
import { DB } from '../db';
import { logger } from '../lib/logger';

export interface AdminiMailServerConfig {
  hostname: string;
  certPath?: string;
  keyPath?: string;
  smtp: {
    port: number;
    securePort?: number;
    maxMessageSize: number;
    maxRecipients: number;
    requireAuth: boolean;
  };
  imap: {
    port: number;
    securePort?: number;
    maxConnections: number;
    idleTimeout: number;
  };
  pop3: {
    port: number;
    securePort?: number;
    maxConnections: number;
    sessionTimeout: number;
  };
  webmail: {
    port: number;
    secure: boolean;
  };
}

export class AdminiMailServerManager extends EventEmitter {
  private smtpServer?: SMTPServer;
  private smtpSecureServer?: SMTPServer;
  private imapServer?: IMAPServer;
  private imapSecureServer?: IMAPServer;
  private pop3Server?: POP3Server;
  private pop3SecureServer?: POP3Server;
  
  private config: AdminiMailServerConfig;
  private db: DB;
  private isRunning = false;

  constructor(config: AdminiMailServerConfig, db: DB) {
    super();
    this.config = config;
    this.db = db;
  }

  async start(): Promise<void> {
    if (this.isRunning) {
      throw new Error('AdminiMail servers are already running');
    }

    logger.info('Starting AdminiMail Server Manager...');

    try {
      // Start SMTP servers
      await this.startSMTPServers();
      
      // Start IMAP servers
      await this.startIMAPServers();
      
      // Start POP3 servers
      await this.startPOP3Servers();

      this.isRunning = true;
      logger.info('AdminiMail Server Manager started successfully');
      this.emit('started');

    } catch (error) {
      logger.error('Failed to start AdminiMail Server Manager:', error);
      await this.stop();
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (!this.isRunning) {
      return;
    }

    logger.info('Stopping AdminiMail Server Manager...');

    const stopPromises: Promise<void>[] = [];

    // Stop SMTP servers
    if (this.smtpServer) {
      stopPromises.push(this.smtpServer.stop());
    }
    if (this.smtpSecureServer) {
      stopPromises.push(this.smtpSecureServer.stop());
    }

    // Stop IMAP servers
    if (this.imapServer) {
      stopPromises.push(this.imapServer.stop());
    }
    if (this.imapSecureServer) {
      stopPromises.push(this.imapSecureServer.stop());
    }

    // Stop POP3 servers
    if (this.pop3Server) {
      stopPromises.push(this.pop3Server.stop());
    }
    if (this.pop3SecureServer) {
      stopPromises.push(this.pop3SecureServer.stop());
    }

    await Promise.all(stopPromises);

    this.isRunning = false;
    logger.info('AdminiMail Server Manager stopped');
    this.emit('stopped');
  }

  async restart(): Promise<void> {
    await this.stop();
    await this.start();
  }

  getStatus(): {
    running: boolean;
    services: {
      smtp: { running: boolean; port: number; secure?: number };
      imap: { running: boolean; port: number; secure?: number };
      pop3: { running: boolean; port: number; secure?: number };
    };
  } {
    return {
      running: this.isRunning,
      services: {
        smtp: {
          running: !!this.smtpServer,
          port: this.config.smtp.port,
          secure: this.config.smtp.securePort,
        },
        imap: {
          running: !!this.imapServer,
          port: this.config.imap.port,
          secure: this.config.imap.securePort,
        },
        pop3: {
          running: !!this.pop3Server,
          port: this.config.pop3.port,
          secure: this.config.pop3.securePort,
        },
      },
    };
  }

  private async startSMTPServers(): Promise<void> {
    // Standard SMTP server
    const smtpConfig: SMTPServerConfig = {
      port: this.config.smtp.port,
      hostname: this.config.hostname,
      secure: false,
      maxMessageSize: this.config.smtp.maxMessageSize,
      maxRecipients: this.config.smtp.maxRecipients,
      requireAuth: this.config.smtp.requireAuth,
    };

    this.smtpServer = new SMTPServer(smtpConfig, this.db);
    await this.smtpServer.start();

    // Secure SMTP server (SMTPS)
    if (this.config.smtp.securePort && this.config.certPath && this.config.keyPath) {
      const smtpSecureConfig: SMTPServerConfig = {
        port: this.config.smtp.securePort,
        hostname: this.config.hostname,
        secure: true,
        certPath: this.config.certPath,
        keyPath: this.config.keyPath,
        maxMessageSize: this.config.smtp.maxMessageSize,
        maxRecipients: this.config.smtp.maxRecipients,
        requireAuth: this.config.smtp.requireAuth,
      };

      this.smtpSecureServer = new SMTPServer(smtpSecureConfig, this.db);
      await this.smtpSecureServer.start();
    }

    logger.info(`AdminiMail SMTP servers started on ports ${this.config.smtp.port}${this.config.smtp.securePort ? ` and ${this.config.smtp.securePort} (secure)` : ''}`);
  }

  private async startIMAPServers(): Promise<void> {
    // Standard IMAP server
    const imapConfig: IMAPServerConfig = {
      port: this.config.imap.port,
      hostname: this.config.hostname,
      secure: false,
      maxConnections: this.config.imap.maxConnections,
      idleTimeout: this.config.imap.idleTimeout,
    };

    this.imapServer = new IMAPServer(imapConfig, this.db);
    await this.imapServer.start();

    // Secure IMAP server (IMAPS)
    if (this.config.imap.securePort && this.config.certPath && this.config.keyPath) {
      const imapSecureConfig: IMAPServerConfig = {
        port: this.config.imap.securePort,
        hostname: this.config.hostname,
        secure: true,
        certPath: this.config.certPath,
        keyPath: this.config.keyPath,
        maxConnections: this.config.imap.maxConnections,
        idleTimeout: this.config.imap.idleTimeout,
      };

      this.imapSecureServer = new IMAPServer(imapSecureConfig, this.db);
      await this.imapSecureServer.start();
    }

    logger.info(`AdminiMail IMAP servers started on ports ${this.config.imap.port}${this.config.imap.securePort ? ` and ${this.config.imap.securePort} (secure)` : ''}`);
  }

  private async startPOP3Servers(): Promise<void> {
    // Standard POP3 server
    const pop3Config: POP3ServerConfig = {
      port: this.config.pop3.port,
      hostname: this.config.hostname,
      secure: false,
      maxConnections: this.config.pop3.maxConnections,
      sessionTimeout: this.config.pop3.sessionTimeout,
    };

    this.pop3Server = new POP3Server(pop3Config, this.db);
    await this.pop3Server.start();

    // Secure POP3 server (POP3S)
    if (this.config.pop3.securePort && this.config.certPath && this.config.keyPath) {
      const pop3SecureConfig: POP3ServerConfig = {
        port: this.config.pop3.securePort,
        hostname: this.config.hostname,
        secure: true,
        certPath: this.config.certPath,
        keyPath: this.config.keyPath,
        maxConnections: this.config.pop3.maxConnections,
        sessionTimeout: this.config.pop3.sessionTimeout,
      };

      this.pop3SecureServer = new POP3Server(pop3SecureConfig, this.db);
      await this.pop3SecureServer.start();
    }

    logger.info(`AdminiMail POP3 servers started on ports ${this.config.pop3.port}${this.config.pop3.securePort ? ` and ${this.config.pop3.securePort} (secure)` : ''}`);
  }

  // Event forwarding from individual servers
  private setupEventForwarding(): void {
    const servers = [
      this.smtpServer,
      this.smtpSecureServer,
      this.imapServer,
      this.imapSecureServer,
      this.pop3Server,
      this.pop3SecureServer,
    ].filter(Boolean);

    for (const server of servers) {
      server?.on('error', (error) => {
        this.emit('server-error', error);
      });

      server?.on('connection', (info) => {
        this.emit('connection', info);
      });

      server?.on('disconnection', (info) => {
        this.emit('disconnection', info);
      });
    }
  }

  // Health check for all services
  async healthCheck(): Promise<{
    healthy: boolean;
    services: {
      smtp: boolean;
      imap: boolean;
      pop3: boolean;
    };
    details: any;
  }> {
    const services = {
      smtp: !!this.smtpServer,
      imap: !!this.imapServer,
      pop3: !!this.pop3Server,
    };

    const healthy = Object.values(services).every(Boolean);

    return {
      healthy,
      services,
      details: {
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        config: {
          hostname: this.config.hostname,
          ports: {
            smtp: this.config.smtp.port,
            imap: this.config.imap.port,
            pop3: this.config.pop3.port,
            webmail: this.config.webmail.port,
          },
        },
      },
    };
  }

  // Get server statistics
  getStatistics(): {
    connections: {
      smtp: number;
      imap: number;
      pop3: number;
    };
    messages: {
      processed: number;
      queued: number;
      failed: number;
    };
  } {
    // This would be implemented to return actual statistics
    return {
      connections: {
        smtp: 0,
        imap: 0,
        pop3: 0,
      },
      messages: {
        processed: 0,
        queued: 0,
        failed: 0,
      },
    };
  }

  // Graceful shutdown handler
  async gracefulShutdown(signal: string): Promise<void> {
    logger.info(`AdminiMail Server Manager received ${signal}, shutting down gracefully...`);
    
    try {
      await this.stop();
      logger.info('AdminiMail Server Manager shutdown completed');
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  }
}

// Default configuration factory
export function createDefaultAdminiMailConfig(hostname: string): AdminiMailServerConfig {
  return {
    hostname,
    smtp: {
      port: 25,
      securePort: 465,
      maxMessageSize: 52428800, // 50MB
      maxRecipients: 100,
      requireAuth: true,
    },
    imap: {
      port: 143,
      securePort: 993,
      maxConnections: 100,
      idleTimeout: 1800000, // 30 minutes
    },
    pop3: {
      port: 110,
      securePort: 995,
      maxConnections: 50,
      sessionTimeout: 600000, // 10 minutes
    },
    webmail: {
      port: 2089,
      secure: true,
    },
  };
}

// Environment-based configuration loader
export function loadAdminiMailConfigFromEnv(): AdminiMailServerConfig {
  const hostname = process.env.ADMINI_HOSTNAME || 'localhost';
  const config = createDefaultAdminiMailConfig(hostname);

  // Override with environment variables
  if (process.env.ADMINI_SMTP_PORT) {
    config.smtp.port = parseInt(process.env.ADMINI_SMTP_PORT);
  }
  if (process.env.ADMINI_IMAP_PORT) {
    config.imap.port = parseInt(process.env.ADMINI_IMAP_PORT);
  }
  if (process.env.ADMINI_POP3_PORT) {
    config.pop3.port = parseInt(process.env.ADMINI_POP3_PORT);
  }
  if (process.env.ADMINI_WEBMAIL_PORT) {
    config.webmail.port = parseInt(process.env.ADMINI_WEBMAIL_PORT);
  }

  // TLS configuration
  if (process.env.ADMINI_TLS_CERT) {
    config.certPath = process.env.ADMINI_TLS_CERT;
  }
  if (process.env.ADMINI_TLS_KEY) {
    config.keyPath = process.env.ADMINI_TLS_KEY;
  }

  return config;
}