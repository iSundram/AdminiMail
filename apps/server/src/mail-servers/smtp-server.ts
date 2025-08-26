import { createServer, Socket } from 'net';
import { createSecureContext, TLSSocket } from 'tls';
import { EventEmitter } from 'events';
import { DB } from '../db';
import { logger } from '../lib/logger';
import { verifyDKIM, signDKIM } from '../lib/dkim';
import { verifySPF } from '../lib/spf';
import { verifyDMARC } from '../lib/dmarc';
import { processIncomingMail } from '../lib/mail-processor';
import { queueOutgoingMail } from '../lib/mail-queue';

export interface SMTPServerConfig {
  port: number;
  hostname: string;
  secure: boolean;
  certPath?: string;
  keyPath?: string;
  maxMessageSize: number;
  maxRecipients: number;
  requireAuth: boolean;
}

export interface SMTPSession {
  id: string;
  remoteAddress: string;
  secure: boolean;
  authenticated: boolean;
  user?: string;
  helo?: string;
  mailFrom?: string;
  rcptTo: string[];
  data?: Buffer;
  startTime: Date;
}

export class SMTPServer extends EventEmitter {
  private server: any;
  private sessions = new Map<string, SMTPSession>();
  private config: SMTPServerConfig;
  private db: DB;

  constructor(config: SMTPServerConfig, db: DB) {
    super();
    this.config = config;
    this.db = db;
    
    if (config.secure && config.certPath && config.keyPath) {
      const secureContext = createSecureContext({
        cert: config.certPath,
        key: config.keyPath,
      });
      this.server = createServer({ secureContext }, this.handleConnection.bind(this));
    } else {
      this.server = createServer(this.handleConnection.bind(this));
    }
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.config.port, this.config.hostname, (error: any) => {
        if (error) {
          reject(error);
        } else {
          logger.info(`SMTP Server listening on ${this.config.hostname}:${this.config.port}`);
          resolve();
        }
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        logger.info('SMTP Server stopped');
        resolve();
      });
    });
  }

  private handleConnection(socket: Socket | TLSSocket): void {
    const sessionId = `smtp_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const session: SMTPSession = {
      id: sessionId,
      remoteAddress: socket.remoteAddress || 'unknown',
      secure: socket instanceof TLSSocket,
      authenticated: false,
      rcptTo: [],
      startTime: new Date(),
    };

    this.sessions.set(sessionId, session);
    logger.info(`SMTP connection from ${session.remoteAddress} (${sessionId})`);

    // Send greeting
    this.sendResponse(socket, 220, `${this.config.hostname} AdminiMail SMTP Server ready`);

    let buffer = '';
    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\r\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        this.processCommand(socket, session, line.trim());
      }
    });

    socket.on('close', () => {
      logger.info(`SMTP connection closed (${sessionId})`);
      this.sessions.delete(sessionId);
    });

    socket.on('error', (error) => {
      logger.error(`SMTP connection error (${sessionId}):`, error);
      this.sessions.delete(sessionId);
    });

    // Timeout handling
    socket.setTimeout(300000); // 5 minutes
    socket.on('timeout', () => {
      this.sendResponse(socket, 421, 'Timeout - closing connection');
      socket.end();
    });
  }

  private async processCommand(socket: Socket | TLSSocket, session: SMTPSession, command: string): Promise<void> {
    const [cmd, ...args] = command.split(' ');
    const cmdUpper = cmd.toUpperCase();

    try {
      switch (cmdUpper) {
        case 'HELO':
        case 'EHLO':
          await this.handleHelo(socket, session, args.join(' '), cmdUpper === 'EHLO');
          break;
        case 'MAIL':
          await this.handleMail(socket, session, command);
          break;
        case 'RCPT':
          await this.handleRcpt(socket, session, command);
          break;
        case 'DATA':
          await this.handleData(socket, session);
          break;
        case 'RSET':
          await this.handleRset(socket, session);
          break;
        case 'QUIT':
          await this.handleQuit(socket, session);
          break;
        case 'AUTH':
          await this.handleAuth(socket, session, args);
          break;
        case 'STARTTLS':
          await this.handleStartTLS(socket, session);
          break;
        case 'NOOP':
          this.sendResponse(socket, 250, 'OK');
          break;
        default:
          this.sendResponse(socket, 502, 'Command not implemented');
      }
    } catch (error) {
      logger.error(`SMTP command error (${session.id}):`, error);
      this.sendResponse(socket, 451, 'Internal server error');
    }
  }

  private async handleHelo(socket: Socket | TLSSocket, session: SMTPSession, hostname: string, extended: boolean): Promise<void> {
    session.helo = hostname;
    
    if (extended) {
      const extensions = [
        `250-${this.config.hostname} Hello ${session.remoteAddress}`,
        '250-SIZE 52428800', // 50MB max message size
        '250-8BITMIME',
        '250-PIPELINING',
      ];
      
      if (!session.secure && this.config.certPath) {
        extensions.push('250-STARTTLS');
      }
      
      if (this.config.requireAuth) {
        extensions.push('250-AUTH PLAIN LOGIN');
      }
      
      extensions.push('250 HELP');
      
      for (let i = 0; i < extensions.length; i++) {
        socket.write(extensions[i] + '\r\n');
      }
    } else {
      this.sendResponse(socket, 250, `${this.config.hostname} Hello ${session.remoteAddress}`);
    }
  }

  private async handleMail(socket: Socket | TLSSocket, session: SMTPSession, command: string): Promise<void> {
    const match = command.match(/FROM:\s*<(.*)>/i);
    if (!match) {
      this.sendResponse(socket, 501, 'Syntax error in MAIL command');
      return;
    }

    const fromAddress = match[1];
    
    // Validate sender
    if (this.config.requireAuth && !session.authenticated) {
      this.sendResponse(socket, 530, 'Authentication required');
      return;
    }

    session.mailFrom = fromAddress;
    session.rcptTo = [];
    this.sendResponse(socket, 250, 'Sender OK');
  }

  private async handleRcpt(socket: Socket | TLSSocket, session: SMTPSession, command: string): Promise<void> {
    if (!session.mailFrom) {
      this.sendResponse(socket, 503, 'Need MAIL command');
      return;
    }

    const match = command.match(/TO:\s*<(.*)>/i);
    if (!match) {
      this.sendResponse(socket, 501, 'Syntax error in RCPT command');
      return;
    }

    const toAddress = match[1];
    
    if (session.rcptTo.length >= this.config.maxRecipients) {
      this.sendResponse(socket, 452, 'Too many recipients');
      return;
    }

    // Check if recipient domain is local
    const domain = toAddress.split('@')[1];
    const isLocalDomain = await this.isLocalDomain(domain);
    
    if (!isLocalDomain) {
      // For relay, require authentication
      if (!session.authenticated) {
        this.sendResponse(socket, 550, 'Relay not permitted');
        return;
      }
    }

    session.rcptTo.push(toAddress);
    this.sendResponse(socket, 250, 'Recipient OK');
  }

  private async handleData(socket: Socket | TLSSocket, session: SMTPSession): Promise<void> {
    if (!session.mailFrom || session.rcptTo.length === 0) {
      this.sendResponse(socket, 503, 'Need MAIL and RCPT commands');
      return;
    }

    this.sendResponse(socket, 354, 'Start mail input; end with <CRLF>.<CRLF>');

    let dataBuffer = '';
    let dataMode = true;

    const originalDataHandler = socket.listeners('data')[0];
    socket.removeAllListeners('data');

    socket.on('data', (chunk) => {
      if (dataMode) {
        dataBuffer += chunk.toString();
        
        // Check for end of data marker
        if (dataBuffer.includes('\r\n.\r\n')) {
          const endIndex = dataBuffer.indexOf('\r\n.\r\n');
          const messageData = dataBuffer.substring(0, endIndex);
          
          // Process the message
          this.processMessage(socket, session, Buffer.from(messageData));
          
          dataMode = false;
          socket.removeAllListeners('data');
          socket.on('data', originalDataHandler);
        }
        
        // Check message size limit
        if (dataBuffer.length > this.config.maxMessageSize) {
          this.sendResponse(socket, 552, 'Message too large');
          dataMode = false;
          socket.removeAllListeners('data');
          socket.on('data', originalDataHandler);
        }
      }
    });
  }

  private async processMessage(socket: Socket | TLSSocket, session: SMTPSession, data: Buffer): Promise<void> {
    try {
      const message = {
        from: session.mailFrom!,
        to: session.rcptTo,
        data: data,
        remoteAddress: session.remoteAddress,
        receivedAt: new Date(),
      };

      // SPF verification for incoming mail
      const spfResult = await verifySPF(session.remoteAddress, session.mailFrom!, session.helo!);
      
      // DKIM verification
      const dkimResult = await verifyDKIM(data);
      
      // DMARC verification
      const dmarcResult = await verifyDMARC(session.mailFrom!, spfResult, dkimResult);

      // Process based on whether it's local delivery or relay
      const localRecipients = [];
      const relayRecipients = [];

      for (const recipient of session.rcptTo) {
        const domain = recipient.split('@')[1];
        if (await this.isLocalDomain(domain)) {
          localRecipients.push(recipient);
        } else {
          relayRecipients.push(recipient);
        }
      }

      // Handle local delivery
      if (localRecipients.length > 0) {
        await processIncomingMail({
          ...message,
          to: localRecipients,
          spfResult,
          dkimResult,
          dmarcResult,
        }, this.db);
      }

      // Handle relay
      if (relayRecipients.length > 0) {
        await queueOutgoingMail({
          ...message,
          to: relayRecipients,
        }, this.db);
      }

      this.sendResponse(socket, 250, 'Message accepted for delivery');
      
      // Reset session
      session.mailFrom = undefined;
      session.rcptTo = [];
      
    } catch (error) {
      logger.error(`Message processing error (${session.id}):`, error);
      this.sendResponse(socket, 451, 'Message processing failed');
    }
  }

  private async handleAuth(socket: Socket | TLSSocket, session: SMTPSession, args: string[]): Promise<void> {
    if (!this.config.requireAuth) {
      this.sendResponse(socket, 502, 'Authentication not enabled');
      return;
    }

    const mechanism = args[0]?.toUpperCase();
    
    switch (mechanism) {
      case 'PLAIN':
        if (args[1]) {
          // AUTH PLAIN with initial response
          await this.handleAuthPlain(socket, session, args[1]);
        } else {
          // AUTH PLAIN without initial response
          this.sendResponse(socket, 334, '');
          // Wait for credentials in next data chunk
        }
        break;
      case 'LOGIN':
        this.sendResponse(socket, 334, 'VXNlcm5hbWU6'); // Base64 "Username:"
        break;
      default:
        this.sendResponse(socket, 504, 'Authentication mechanism not supported');
    }
  }

  private async handleAuthPlain(socket: Socket | TLSSocket, session: SMTPSession, credentials: string): Promise<void> {
    try {
      const decoded = Buffer.from(credentials, 'base64').toString();
      const [, username, password] = decoded.split('\0');
      
      // Verify credentials against database
      const user = await this.verifyCredentials(username, password);
      if (user) {
        session.authenticated = true;
        session.user = username;
        this.sendResponse(socket, 235, 'Authentication successful');
      } else {
        this.sendResponse(socket, 535, 'Authentication failed');
      }
    } catch (error) {
      logger.error(`Authentication error (${session.id}):`, error);
      this.sendResponse(socket, 535, 'Authentication failed');
    }
  }

  private async handleStartTLS(socket: Socket | TLSSocket, session: SMTPSession): Promise<void> {
    if (session.secure) {
      this.sendResponse(socket, 503, 'Already using TLS');
      return;
    }

    if (!this.config.certPath || !this.config.keyPath) {
      this.sendResponse(socket, 454, 'TLS not available');
      return;
    }

    this.sendResponse(socket, 220, 'Ready to start TLS');
    // TLS upgrade would be implemented here
  }

  private async handleRset(socket: Socket | TLSSocket, session: SMTPSession): Promise<void> {
    session.mailFrom = undefined;
    session.rcptTo = [];
    this.sendResponse(socket, 250, 'Reset OK');
  }

  private async handleQuit(socket: Socket | TLSSocket, session: SMTPSession): Promise<void> {
    this.sendResponse(socket, 221, `${this.config.hostname} closing connection`);
    socket.end();
  }

  private sendResponse(socket: Socket | TLSSocket, code: number, message: string): void {
    socket.write(`${code} ${message}\r\n`);
  }

  private async isLocalDomain(domain: string): Promise<boolean> {
    try {
      const result = await this.db.query.domain.findFirst({
        where: (domain_table, { eq }) => eq(domain_table.name, domain)
      });
      return !!result;
    } catch (error) {
      logger.error('Error checking local domain:', error);
      return false;
    }
  }

  private async verifyCredentials(username: string, password: string): Promise<any> {
    try {
      // This would integrate with the authentication system
      // For now, return null - will be implemented with Argon2
      return null;
    } catch (error) {
      logger.error('Error verifying credentials:', error);
      return null;
    }
  }
}