import { createServer, Socket } from 'net';
import { createSecureContext, TLSSocket } from 'tls';
import { EventEmitter } from 'events';
import { DB } from '../db';
import { logger } from '../lib/logger';

export interface POP3ServerConfig {
  port: number;
  hostname: string;
  secure: boolean;
  certPath?: string;
  keyPath?: string;
  maxConnections: number;
  sessionTimeout: number;
}

export interface POP3Session {
  id: string;
  remoteAddress: string;
  secure: boolean;
  authenticated: boolean;
  user?: string;
  state: 'AUTHORIZATION' | 'TRANSACTION' | 'UPDATE';
  messages: POP3Message[];
  deletedMessages: Set<number>;
  startTime: Date;
}

export interface POP3Message {
  id: number;
  uid: string;
  size: number;
  deleted: boolean;
  content?: Buffer;
}

export class POP3Server extends EventEmitter {
  private server: any;
  private sessions = new Map<string, POP3Session>();
  private config: POP3ServerConfig;
  private db: DB;

  constructor(config: POP3ServerConfig, db: DB) {
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
          logger.info(`AdminiMail POP3 Server listening on ${this.config.hostname}:${this.config.port}`);
          resolve();
        }
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        logger.info('AdminiMail POP3 Server stopped');
        resolve();
      });
    });
  }

  private handleConnection(socket: Socket | TLSSocket): void {
    const sessionId = `pop3_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const session: POP3Session = {
      id: sessionId,
      remoteAddress: socket.remoteAddress || 'unknown',
      secure: socket instanceof TLSSocket,
      authenticated: false,
      state: 'AUTHORIZATION',
      messages: [],
      deletedMessages: new Set(),
      startTime: new Date(),
    };

    this.sessions.set(sessionId, session);
    logger.info(`AdminiMail POP3 connection from ${session.remoteAddress} (${sessionId})`);

    // Send greeting
    this.sendResponse(socket, '+OK AdminiMail POP3 Server ready');

    let buffer = '';
    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\r\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim()) {
          this.processCommand(socket, session, line.trim());
        }
      }
    });

    socket.on('close', () => {
      logger.info(`AdminiMail POP3 connection closed (${sessionId})`);
      this.sessions.delete(sessionId);
    });

    socket.on('error', (error) => {
      logger.error(`AdminiMail POP3 connection error (${sessionId}):`, error);
      this.sessions.delete(sessionId);
    });

    // Timeout handling
    socket.setTimeout(this.config.sessionTimeout);
    socket.on('timeout', () => {
      this.sendResponse(socket, '-ERR Timeout - closing connection');
      socket.end();
    });
  }

  private async processCommand(socket: Socket | TLSSocket, session: POP3Session, line: string): Promise<void> {
    const parts = line.split(' ');
    const command = parts[0].toUpperCase();
    const args = parts.slice(1);

    logger.debug(`AdminiMail POP3 Command (${session.id}): ${command} ${args.join(' ')}`);

    try {
      switch (command) {
        case 'USER':
          await this.handleUser(socket, session, args);
          break;
        case 'PASS':
          await this.handlePass(socket, session, args);
          break;
        case 'APOP':
          await this.handleApop(socket, session, args);
          break;
        case 'STAT':
          await this.handleStat(socket, session);
          break;
        case 'LIST':
          await this.handleList(socket, session, args);
          break;
        case 'RETR':
          await this.handleRetr(socket, session, args);
          break;
        case 'DELE':
          await this.handleDele(socket, session, args);
          break;
        case 'NOOP':
          await this.handleNoop(socket, session);
          break;
        case 'RSET':
          await this.handleRset(socket, session);
          break;
        case 'TOP':
          await this.handleTop(socket, session, args);
          break;
        case 'UIDL':
          await this.handleUidl(socket, session, args);
          break;
        case 'QUIT':
          await this.handleQuit(socket, session);
          break;
        case 'CAPA':
          await this.handleCapa(socket, session);
          break;
        case 'STLS':
          await this.handleStls(socket, session);
          break;
        default:
          this.sendResponse(socket, '-ERR Command not recognized');
      }
    } catch (error) {
      logger.error(`AdminiMail POP3 command error (${session.id}):`, error);
      this.sendResponse(socket, '-ERR Internal server error');
    }
  }

  private async handleUser(socket: Socket | TLSSocket, session: POP3Session, args: string[]): Promise<void> {
    if (session.state !== 'AUTHORIZATION') {
      this.sendResponse(socket, '-ERR Wrong state');
      return;
    }

    if (args.length < 1) {
      this.sendResponse(socket, '-ERR USER requires username');
      return;
    }

    session.user = args[0];
    this.sendResponse(socket, '+OK User name accepted');
  }

  private async handlePass(socket: Socket | TLSSocket, session: POP3Session, args: string[]): Promise<void> {
    if (session.state !== 'AUTHORIZATION') {
      this.sendResponse(socket, '-ERR Wrong state');
      return;
    }

    if (!session.user) {
      this.sendResponse(socket, '-ERR USER command must precede PASS');
      return;
    }

    if (args.length < 1) {
      this.sendResponse(socket, '-ERR PASS requires password');
      return;
    }

    const password = args[0];

    try {
      const user = await this.verifyCredentials(session.user, password);
      if (user) {
        session.authenticated = true;
        session.state = 'TRANSACTION';
        
        // Load user's messages
        session.messages = await this.loadUserMessages(session.user);
        
        this.sendResponse(socket, `+OK Mailbox locked and ready, ${session.messages.length} messages`);
        logger.info(`AdminiMail POP3 user ${session.user} authenticated (${session.id})`);
      } else {
        this.sendResponse(socket, '-ERR Authentication failed');
        logger.warn(`AdminiMail POP3 failed login attempt for ${session.user} (${session.id})`);
      }
    } catch (error) {
      logger.error(`AdminiMail POP3 authentication error (${session.id}):`, error);
      this.sendResponse(socket, '-ERR Authentication failed');
    }
  }

  private async handleApop(socket: Socket | TLSSocket, session: POP3Session, args: string[]): Promise<void> {
    if (session.state !== 'AUTHORIZATION') {
      this.sendResponse(socket, '-ERR Wrong state');
      return;
    }

    if (args.length < 2) {
      this.sendResponse(socket, '-ERR APOP requires username and digest');
      return;
    }

    // APOP authentication with MD5 digest
    // For now, not implemented
    this.sendResponse(socket, '-ERR APOP not implemented');
  }

  private async handleStat(socket: Socket | TLSSocket, session: POP3Session): Promise<void> {
    if (session.state !== 'TRANSACTION') {
      this.sendResponse(socket, '-ERR Wrong state');
      return;
    }

    const activeMessages = session.messages.filter(msg => !session.deletedMessages.has(msg.id));
    const totalSize = activeMessages.reduce((sum, msg) => sum + msg.size, 0);
    
    this.sendResponse(socket, `+OK ${activeMessages.length} ${totalSize}`);
  }

  private async handleList(socket: Socket | TLSSocket, session: POP3Session, args: string[]): Promise<void> {
    if (session.state !== 'TRANSACTION') {
      this.sendResponse(socket, '-ERR Wrong state');
      return;
    }

    const activeMessages = session.messages.filter(msg => !session.deletedMessages.has(msg.id));

    if (args.length > 0) {
      // LIST specific message
      const msgNum = parseInt(args[0]);
      const message = activeMessages.find(msg => msg.id === msgNum);
      
      if (message) {
        this.sendResponse(socket, `+OK ${message.id} ${message.size}`);
      } else {
        this.sendResponse(socket, '-ERR No such message');
      }
    } else {
      // LIST all messages
      const totalSize = activeMessages.reduce((sum, msg) => sum + msg.size, 0);
      this.sendResponse(socket, `+OK ${activeMessages.length} messages (${totalSize} octets)`);
      
      for (const message of activeMessages) {
        socket.write(`${message.id} ${message.size}\r\n`);
      }
      socket.write('.\r\n');
    }
  }

  private async handleRetr(socket: Socket | TLSSocket, session: POP3Session, args: string[]): Promise<void> {
    if (session.state !== 'TRANSACTION') {
      this.sendResponse(socket, '-ERR Wrong state');
      return;
    }

    if (args.length < 1) {
      this.sendResponse(socket, '-ERR RETR requires message number');
      return;
    }

    const msgNum = parseInt(args[0]);
    const message = session.messages.find(msg => msg.id === msgNum);

    if (!message || session.deletedMessages.has(msgNum)) {
      this.sendResponse(socket, '-ERR No such message');
      return;
    }

    try {
      const content = await this.getMessageContent(session.user!, message.uid);
      if (content) {
        this.sendResponse(socket, `+OK ${content.length} octets`);
        socket.write(content);
        socket.write('\r\n.\r\n');
      } else {
        this.sendResponse(socket, '-ERR Message not found');
      }
    } catch (error) {
      logger.error(`AdminiMail POP3 RETR error (${session.id}):`, error);
      this.sendResponse(socket, '-ERR Failed to retrieve message');
    }
  }

  private async handleDele(socket: Socket | TLSSocket, session: POP3Session, args: string[]): Promise<void> {
    if (session.state !== 'TRANSACTION') {
      this.sendResponse(socket, '-ERR Wrong state');
      return;
    }

    if (args.length < 1) {
      this.sendResponse(socket, '-ERR DELE requires message number');
      return;
    }

    const msgNum = parseInt(args[0]);
    const message = session.messages.find(msg => msg.id === msgNum);

    if (!message || session.deletedMessages.has(msgNum)) {
      this.sendResponse(socket, '-ERR No such message');
      return;
    }

    session.deletedMessages.add(msgNum);
    this.sendResponse(socket, '+OK Message deleted');
  }

  private async handleNoop(socket: Socket | TLSSocket, session: POP3Session): Promise<void> {
    if (session.state !== 'TRANSACTION') {
      this.sendResponse(socket, '-ERR Wrong state');
      return;
    }

    this.sendResponse(socket, '+OK');
  }

  private async handleRset(socket: Socket | TLSSocket, session: POP3Session): Promise<void> {
    if (session.state !== 'TRANSACTION') {
      this.sendResponse(socket, '-ERR Wrong state');
      return;
    }

    session.deletedMessages.clear();
    this.sendResponse(socket, '+OK');
  }

  private async handleTop(socket: Socket | TLSSocket, session: POP3Session, args: string[]): Promise<void> {
    if (session.state !== 'TRANSACTION') {
      this.sendResponse(socket, '-ERR Wrong state');
      return;
    }

    if (args.length < 2) {
      this.sendResponse(socket, '-ERR TOP requires message number and line count');
      return;
    }

    const msgNum = parseInt(args[0]);
    const lines = parseInt(args[1]);
    const message = session.messages.find(msg => msg.id === msgNum);

    if (!message || session.deletedMessages.has(msgNum)) {
      this.sendResponse(socket, '-ERR No such message');
      return;
    }

    try {
      const content = await this.getMessageTop(session.user!, message.uid, lines);
      if (content) {
        this.sendResponse(socket, `+OK Top of message follows`);
        socket.write(content);
        socket.write('\r\n.\r\n');
      } else {
        this.sendResponse(socket, '-ERR Message not found');
      }
    } catch (error) {
      logger.error(`AdminiMail POP3 TOP error (${session.id}):`, error);
      this.sendResponse(socket, '-ERR Failed to retrieve message top');
    }
  }

  private async handleUidl(socket: Socket | TLSSocket, session: POP3Session, args: string[]): Promise<void> {
    if (session.state !== 'TRANSACTION') {
      this.sendResponse(socket, '-ERR Wrong state');
      return;
    }

    const activeMessages = session.messages.filter(msg => !session.deletedMessages.has(msg.id));

    if (args.length > 0) {
      // UIDL specific message
      const msgNum = parseInt(args[0]);
      const message = activeMessages.find(msg => msg.id === msgNum);
      
      if (message) {
        this.sendResponse(socket, `+OK ${message.id} ${message.uid}`);
      } else {
        this.sendResponse(socket, '-ERR No such message');
      }
    } else {
      // UIDL all messages
      this.sendResponse(socket, '+OK Unique-ID listing follows');
      
      for (const message of activeMessages) {
        socket.write(`${message.id} ${message.uid}\r\n`);
      }
      socket.write('.\r\n');
    }
  }

  private async handleQuit(socket: Socket | TLSSocket, session: POP3Session): Promise<void> {
    if (session.state === 'TRANSACTION') {
      // Apply deletions
      try {
        if (session.deletedMessages.size > 0) {
          await this.applyDeletions(session.user!, Array.from(session.deletedMessages));
        }
        this.sendResponse(socket, '+OK AdminiMail POP3 Server signing off');
      } catch (error) {
        logger.error(`AdminiMail POP3 QUIT error (${session.id}):`, error);
        this.sendResponse(socket, '-ERR Some deleted messages not removed');
      }
    } else {
      this.sendResponse(socket, '+OK AdminiMail POP3 Server signing off');
    }
    
    session.state = 'UPDATE';
    socket.end();
  }

  private async handleCapa(socket: Socket | TLSSocket, session: POP3Session): Promise<void> {
    const capabilities = [
      'TOP',
      'UIDL',
      'RESP-CODES',
      'PIPELINING',
      'USER',
    ];

    if (!session.secure && this.config.certPath) {
      capabilities.push('STLS');
    }

    this.sendResponse(socket, '+OK Capability list follows');
    for (const cap of capabilities) {
      socket.write(`${cap}\r\n`);
    }
    socket.write('.\r\n');
  }

  private async handleStls(socket: Socket | TLSSocket, session: POP3Session): Promise<void> {
    if (session.secure) {
      this.sendResponse(socket, '-ERR Already using TLS');
      return;
    }

    if (!this.config.certPath || !this.config.keyPath) {
      this.sendResponse(socket, '-ERR TLS not available');
      return;
    }

    this.sendResponse(socket, '+OK Ready to start TLS');
    // TLS upgrade would be implemented here
  }

  private sendResponse(socket: Socket | TLSSocket, response: string): void {
    socket.write(response + '\r\n');
  }

  private async verifyCredentials(username: string, password: string): Promise<any> {
    try {
      // This would integrate with the authentication system using Argon2
      // For now, return null - will be implemented later
      return null;
    } catch (error) {
      logger.error('AdminiMail POP3 error verifying credentials:', error);
      return null;
    }
  }

  private async loadUserMessages(username: string): Promise<POP3Message[]> {
    try {
      // This would load messages from the database
      // For now, return empty array
      return [];
    } catch (error) {
      logger.error('AdminiMail POP3 error loading user messages:', error);
      return [];
    }
  }

  private async getMessageContent(username: string, uid: string): Promise<Buffer | null> {
    try {
      // This would fetch message content from the database
      return null;
    } catch (error) {
      logger.error('AdminiMail POP3 error getting message content:', error);
      return null;
    }
  }

  private async getMessageTop(username: string, uid: string, lines: number): Promise<Buffer | null> {
    try {
      // This would fetch message headers + specified body lines
      return null;
    } catch (error) {
      logger.error('AdminiMail POP3 error getting message top:', error);
      return null;
    }
  }

  private async applyDeletions(username: string, messageIds: number[]): Promise<void> {
    try {
      // This would mark messages as deleted in the database
    } catch (error) {
      logger.error('AdminiMail POP3 error applying deletions:', error);
      throw error;
    }
  }
}