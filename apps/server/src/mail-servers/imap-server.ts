import { createServer, Socket } from 'net';
import { createSecureContext, TLSSocket } from 'tls';
import { EventEmitter } from 'events';
import { DB } from '../db';
import { logger } from '../lib/logger';
import { parseIMAPCommand, formatIMAPResponse } from '../lib/imap-parser';
import { IMAPMailbox, IMAPMessage } from '../lib/imap-types';

export interface IMAPServerConfig {
  port: number;
  hostname: string;
  secure: boolean;
  certPath?: string;
  keyPath?: string;
  maxConnections: number;
  idleTimeout: number;
}

export interface IMAPSession {
  id: string;
  remoteAddress: string;
  secure: boolean;
  authenticated: boolean;
  user?: string;
  selectedMailbox?: string;
  state: 'NONAUTH' | 'AUTH' | 'SELECTED' | 'LOGOUT';
  capabilities: string[];
  idling: boolean;
  startTime: Date;
}

export class IMAPServer extends EventEmitter {
  private server: any;
  private sessions = new Map<string, IMAPSession>();
  private config: IMAPServerConfig;
  private db: DB;
  private idleClients = new Set<string>();

  constructor(config: IMAPServerConfig, db: DB) {
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

    // Setup IDLE notification system
    this.setupIdleNotifications();
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server.listen(this.config.port, this.config.hostname, (error: any) => {
        if (error) {
          reject(error);
        } else {
          logger.info(`AdminiMail IMAP Server listening on ${this.config.hostname}:${this.config.port}`);
          resolve();
        }
      });
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => {
        logger.info('AdminiMail IMAP Server stopped');
        resolve();
      });
    });
  }

  private handleConnection(socket: Socket | TLSSocket): void {
    const sessionId = `imap_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const session: IMAPSession = {
      id: sessionId,
      remoteAddress: socket.remoteAddress || 'unknown',
      secure: socket instanceof TLSSocket,
      authenticated: false,
      state: 'NONAUTH',
      capabilities: this.getCapabilities(),
      idling: false,
      startTime: new Date(),
    };

    this.sessions.set(sessionId, session);
    logger.info(`AdminiMail IMAP connection from ${session.remoteAddress} (${sessionId})`);

    // Send greeting
    this.sendResponse(socket, '* OK [CAPABILITY ' + session.capabilities.join(' ') + '] AdminiMail IMAP Server ready');

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
      logger.info(`AdminiMail IMAP connection closed (${sessionId})`);
      this.idleClients.delete(sessionId);
      this.sessions.delete(sessionId);
    });

    socket.on('error', (error) => {
      logger.error(`AdminiMail IMAP connection error (${sessionId}):`, error);
      this.idleClients.delete(sessionId);
      this.sessions.delete(sessionId);
    });

    // Timeout handling
    socket.setTimeout(1800000); // 30 minutes
    socket.on('timeout', () => {
      this.sendResponse(socket, '* BYE Timeout - closing connection');
      socket.end();
    });
  }

  private async processCommand(socket: Socket | TLSSocket, session: IMAPSession, line: string): Promise<void> {
    try {
      const command = parseIMAPCommand(line);
      const { tag, cmd, args } = command;

      logger.debug(`AdminiMail IMAP Command (${session.id}): ${cmd} ${args.join(' ')}`);

      switch (cmd.toUpperCase()) {
        case 'CAPABILITY':
          await this.handleCapability(socket, session, tag);
          break;
        case 'NOOP':
          await this.handleNoop(socket, session, tag);
          break;
        case 'LOGOUT':
          await this.handleLogout(socket, session, tag);
          break;
        case 'STARTTLS':
          await this.handleStartTLS(socket, session, tag);
          break;
        case 'AUTHENTICATE':
          await this.handleAuthenticate(socket, session, tag, args);
          break;
        case 'LOGIN':
          await this.handleLogin(socket, session, tag, args);
          break;
        case 'SELECT':
          await this.handleSelect(socket, session, tag, args);
          break;
        case 'EXAMINE':
          await this.handleExamine(socket, session, tag, args);
          break;
        case 'CREATE':
          await this.handleCreate(socket, session, tag, args);
          break;
        case 'DELETE':
          await this.handleDelete(socket, session, tag, args);
          break;
        case 'RENAME':
          await this.handleRename(socket, session, tag, args);
          break;
        case 'SUBSCRIBE':
          await this.handleSubscribe(socket, session, tag, args);
          break;
        case 'UNSUBSCRIBE':
          await this.handleUnsubscribe(socket, session, tag, args);
          break;
        case 'LIST':
          await this.handleList(socket, session, tag, args);
          break;
        case 'LSUB':
          await this.handleLsub(socket, session, tag, args);
          break;
        case 'STATUS':
          await this.handleStatus(socket, session, tag, args);
          break;
        case 'APPEND':
          await this.handleAppend(socket, session, tag, args);
          break;
        case 'CHECK':
          await this.handleCheck(socket, session, tag);
          break;
        case 'CLOSE':
          await this.handleClose(socket, session, tag);
          break;
        case 'EXPUNGE':
          await this.handleExpunge(socket, session, tag);
          break;
        case 'SEARCH':
          await this.handleSearch(socket, session, tag, args);
          break;
        case 'FETCH':
          await this.handleFetch(socket, session, tag, args);
          break;
        case 'STORE':
          await this.handleStore(socket, session, tag, args);
          break;
        case 'COPY':
          await this.handleCopy(socket, session, tag, args);
          break;
        case 'IDLE':
          await this.handleIdle(socket, session, tag);
          break;
        case 'DONE':
          await this.handleDone(socket, session);
          break;
        default:
          this.sendResponse(socket, `${tag} BAD Command not recognized`);
      }
    } catch (error) {
      logger.error(`AdminiMail IMAP command error (${session.id}):`, error);
      const tag = line.split(' ')[0] || '*';
      this.sendResponse(socket, `${tag} BAD Internal server error`);
    }
  }

  private getCapabilities(): string[] {
    const caps = [
      'IMAP4rev1',
      'LITERAL+',
      'SASL-IR',
      'LOGIN-REFERRALS',
      'ID',
      'ENABLE',
      'IDLE',
      'SORT',
      'SORT=DISPLAY',
      'THREAD=REFERENCES',
      'THREAD=REFS',
      'MULTIAPPEND',
      'URL-PARTIAL',
      'CATENATE',
      'UNSELECT',
      'CHILDREN',
      'NAMESPACE',
      'UIDPLUS',
      'LIST-EXTENDED',
      'I18NLEVEL=1',
      'CONDSTORE',
      'QRESYNC',
      'ESEARCH',
      'ESORT',
      'SEARCHRES',
      'WITHIN',
      'CONTEXT=SEARCH',
      'LIST-STATUS',
      'BINARY',
      'MOVE'
    ];

    if (!this.config.secure) {
      caps.push('STARTTLS');
    }

    caps.push('AUTH=PLAIN', 'AUTH=LOGIN');

    return caps;
  }

  private async handleCapability(socket: Socket | TLSSocket, session: IMAPSession, tag: string): Promise<void> {
    this.sendResponse(socket, '* CAPABILITY ' + session.capabilities.join(' '));
    this.sendResponse(socket, `${tag} OK CAPABILITY completed`);
  }

  private async handleNoop(socket: Socket | TLSSocket, session: IMAPSession, tag: string): Promise<void> {
    if (session.selectedMailbox) {
      // Send any pending updates for the selected mailbox
      await this.sendMailboxUpdates(socket, session);
    }
    this.sendResponse(socket, `${tag} OK NOOP completed`);
  }

  private async handleLogout(socket: Socket | TLSSocket, session: IMAPSession, tag: string): Promise<void> {
    session.state = 'LOGOUT';
    this.sendResponse(socket, '* BYE AdminiMail IMAP Server logging out');
    this.sendResponse(socket, `${tag} OK LOGOUT completed`);
    socket.end();
  }

  private async handleLogin(socket: Socket | TLSSocket, session: IMAPSession, tag: string, args: string[]): Promise<void> {
    if (session.state !== 'NONAUTH') {
      this.sendResponse(socket, `${tag} BAD Already authenticated`);
      return;
    }

    if (args.length < 2) {
      this.sendResponse(socket, `${tag} BAD LOGIN requires username and password`);
      return;
    }

    const username = this.unquoteString(args[0]);
    const password = this.unquoteString(args[1]);

    try {
      const user = await this.verifyCredentials(username, password);
      if (user) {
        session.authenticated = true;
        session.user = username;
        session.state = 'AUTH';
        this.sendResponse(socket, `${tag} OK [CAPABILITY ${session.capabilities.join(' ')}] LOGIN completed`);
        logger.info(`AdminiMail IMAP user ${username} authenticated (${session.id})`);
      } else {
        this.sendResponse(socket, `${tag} NO LOGIN failed`);
        logger.warn(`AdminiMail IMAP failed login attempt for ${username} (${session.id})`);
      }
    } catch (error) {
      logger.error(`AdminiMail IMAP login error (${session.id}):`, error);
      this.sendResponse(socket, `${tag} NO LOGIN failed`);
    }
  }

  private async handleSelect(socket: Socket | TLSSocket, session: IMAPSession, tag: string, args: string[]): Promise<void> {
    if (session.state !== 'AUTH' && session.state !== 'SELECTED') {
      this.sendResponse(socket, `${tag} NO Not authenticated`);
      return;
    }

    if (args.length < 1) {
      this.sendResponse(socket, `${tag} BAD SELECT requires mailbox name`);
      return;
    }

    const mailboxName = this.unquoteString(args[0]);

    try {
      const mailbox = await this.getMailbox(session.user!, mailboxName);
      if (!mailbox) {
        this.sendResponse(socket, `${tag} NO Mailbox does not exist`);
        return;
      }

      session.selectedMailbox = mailboxName;
      session.state = 'SELECTED';

      // Send mailbox info
      this.sendResponse(socket, `* ${mailbox.messageCount} EXISTS`);
      this.sendResponse(socket, `* ${mailbox.recentCount} RECENT`);
      this.sendResponse(socket, `* OK [UNSEEN ${mailbox.unseenCount}] First unseen`);
      this.sendResponse(socket, `* OK [PERMANENTFLAGS (\\Answered \\Flagged \\Deleted \\Seen \\Draft \\*)] Permanent flags`);
      this.sendResponse(socket, `* OK [UIDNEXT ${mailbox.uidNext}] Predicted next UID`);
      this.sendResponse(socket, `* OK [UIDVALIDITY ${mailbox.uidValidity}] UIDs valid`);
      this.sendResponse(socket, `${tag} OK [READ-WRITE] SELECT completed`);

    } catch (error) {
      logger.error(`AdminiMail IMAP SELECT error (${session.id}):`, error);
      this.sendResponse(socket, `${tag} NO SELECT failed`);
    }
  }

  private async handleIdle(socket: Socket | TLSSocket, session: IMAPSession, tag: string): Promise<void> {
    if (session.state !== 'SELECTED') {
      this.sendResponse(socket, `${tag} NO Must be in SELECTED state`);
      return;
    }

    session.idling = true;
    this.idleClients.add(session.id);
    this.sendResponse(socket, '+ idling');

    // Set idle timeout
    const idleTimeout = setTimeout(() => {
      if (session.idling) {
        session.idling = false;
        this.idleClients.delete(session.id);
        this.sendResponse(socket, `${tag} OK IDLE terminated (timeout)`);
      }
    }, this.config.idleTimeout);

    // Store timeout reference for cleanup
    (session as any).idleTimeout = idleTimeout;
  }

  private async handleDone(socket: Socket | TLSSocket, session: IMAPSession): Promise<void> {
    if (session.idling) {
      session.idling = false;
      this.idleClients.delete(session.id);
      
      // Clear timeout
      if ((session as any).idleTimeout) {
        clearTimeout((session as any).idleTimeout);
        delete (session as any).idleTimeout;
      }
      
      this.sendResponse(socket, 'A001 OK IDLE terminated');
    }
  }

  private async handleFetch(socket: Socket | TLSSocket, session: IMAPSession, tag: string, args: string[]): Promise<void> {
    if (session.state !== 'SELECTED') {
      this.sendResponse(socket, `${tag} NO Must be in SELECTED state`);
      return;
    }

    if (args.length < 2) {
      this.sendResponse(socket, `${tag} BAD FETCH requires sequence set and data items`);
      return;
    }

    const sequenceSet = args[0];
    const dataItems = args.slice(1).join(' ');

    try {
      const messages = await this.fetchMessages(session.user!, session.selectedMailbox!, sequenceSet, dataItems);
      
      for (const message of messages) {
        const response = formatIMAPResponse('FETCH', message);
        this.sendResponse(socket, response);
      }
      
      this.sendResponse(socket, `${tag} OK FETCH completed`);
      
    } catch (error) {
      logger.error(`AdminiMail IMAP FETCH error (${session.id}):`, error);
      this.sendResponse(socket, `${tag} NO FETCH failed`);
    }
  }

  private async handleSearch(socket: Socket | TLSSocket, session: IMAPSession, tag: string, args: string[]): Promise<void> {
    if (session.state !== 'SELECTED') {
      this.sendResponse(socket, `${tag} NO Must be in SELECTED state`);
      return;
    }

    try {
      const searchResults = await this.searchMessages(session.user!, session.selectedMailbox!, args);
      this.sendResponse(socket, `* SEARCH ${searchResults.join(' ')}`);
      this.sendResponse(socket, `${tag} OK SEARCH completed`);
      
    } catch (error) {
      logger.error(`AdminiMail IMAP SEARCH error (${session.id}):`, error);
      this.sendResponse(socket, `${tag} NO SEARCH failed`);
    }
  }

  private async handleList(socket: Socket | TLSSocket, session: IMAPSession, tag: string, args: string[]): Promise<void> {
    if (session.state !== 'AUTH' && session.state !== 'SELECTED') {
      this.sendResponse(socket, `${tag} NO Not authenticated`);
      return;
    }

    try {
      const mailboxes = await this.listMailboxes(session.user!, args[0] || '', args[1] || '*');
      
      for (const mailbox of mailboxes) {
        this.sendResponse(socket, `* LIST (${mailbox.flags.join(' ')}) "${mailbox.delimiter}" "${mailbox.name}"`);
      }
      
      this.sendResponse(socket, `${tag} OK LIST completed`);
      
    } catch (error) {
      logger.error(`AdminiMail IMAP LIST error (${session.id}):`, error);
      this.sendResponse(socket, `${tag} NO LIST failed`);
    }
  }

  private setupIdleNotifications(): void {
    // This would integrate with the mail processing system to notify IDLE clients
    // when new messages arrive or mailbox changes occur
    setInterval(() => {
      this.notifyIdleClients();
    }, 30000); // Check every 30 seconds
  }

  private async notifyIdleClients(): Promise<void> {
    for (const sessionId of this.idleClients) {
      const session = this.sessions.get(sessionId);
      if (session && session.idling && session.selectedMailbox) {
        // Check for new messages and send notifications
        try {
          // This would check for new messages and send appropriate responses
          // For now, just a placeholder
        } catch (error) {
          logger.error(`AdminiMail IMAP idle notification error (${sessionId}):`, error);
        }
      }
    }
  }

  private sendResponse(socket: Socket | TLSSocket, response: string): void {
    socket.write(response + '\r\n');
  }

  private unquoteString(str: string): string {
    if (str.startsWith('"') && str.endsWith('"')) {
      return str.slice(1, -1).replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    }
    return str;
  }

  private async verifyCredentials(username: string, password: string): Promise<any> {
    try {
      // This would integrate with the authentication system using Argon2
      // For now, return null - will be implemented later
      return null;
    } catch (error) {
      logger.error('AdminiMail IMAP error verifying credentials:', error);
      return null;
    }
  }

  private async getMailbox(user: string, name: string): Promise<IMAPMailbox | null> {
    try {
      // This would fetch mailbox info from the database
      return null;
    } catch (error) {
      logger.error('AdminiMail IMAP error getting mailbox:', error);
      return null;
    }
  }

  private async fetchMessages(user: string, mailbox: string, sequenceSet: string, dataItems: string): Promise<IMAPMessage[]> {
    try {
      // This would fetch messages from the database
      return [];
    } catch (error) {
      logger.error('AdminiMail IMAP error fetching messages:', error);
      return [];
    }
  }

  private async searchMessages(user: string, mailbox: string, criteria: string[]): Promise<number[]> {
    try {
      // This would search messages in the database
      return [];
    } catch (error) {
      logger.error('AdminiMail IMAP error searching messages:', error);
      return [];
    }
  }

  private async listMailboxes(user: string, reference: string, pattern: string): Promise<any[]> {
    try {
      // This would list user mailboxes from the database
      return [];
    } catch (error) {
      logger.error('AdminiMail IMAP error listing mailboxes:', error);
      return [];
    }
  }

  private async sendMailboxUpdates(socket: Socket | TLSSocket, session: IMAPSession): Promise<void> {
    try {
      // This would send any pending mailbox updates
    } catch (error) {
      logger.error(`AdminiMail IMAP error sending mailbox updates (${session.id}):`, error);
    }
  }

  // Placeholder methods for other IMAP commands
  private async handleStartTLS(socket: Socket | TLSSocket, session: IMAPSession, tag: string): Promise<void> {
    // TLS implementation would go here
    this.sendResponse(socket, `${tag} NO STARTTLS not implemented`);
  }

  private async handleAuthenticate(socket: Socket | TLSSocket, session: IMAPSession, tag: string, args: string[]): Promise<void> {
    // SASL authentication would go here
    this.sendResponse(socket, `${tag} NO AUTHENTICATE not implemented`);
  }

  private async handleExamine(socket: Socket | TLSSocket, session: IMAPSession, tag: string, args: string[]): Promise<void> {
    // Similar to SELECT but read-only
    this.sendResponse(socket, `${tag} NO EXAMINE not implemented`);
  }

  private async handleCreate(socket: Socket | TLSSocket, session: IMAPSession, tag: string, args: string[]): Promise<void> {
    this.sendResponse(socket, `${tag} NO CREATE not implemented`);
  }

  private async handleDelete(socket: Socket | TLSSocket, session: IMAPSession, tag: string, args: string[]): Promise<void> {
    this.sendResponse(socket, `${tag} NO DELETE not implemented`);
  }

  private async handleRename(socket: Socket | TLSSocket, session: IMAPSession, tag: string, args: string[]): Promise<void> {
    this.sendResponse(socket, `${tag} NO RENAME not implemented`);
  }

  private async handleSubscribe(socket: Socket | TLSSocket, session: IMAPSession, tag: string, args: string[]): Promise<void> {
    this.sendResponse(socket, `${tag} OK SUBSCRIBE completed`);
  }

  private async handleUnsubscribe(socket: Socket | TLSSocket, session: IMAPSession, tag: string, args: string[]): Promise<void> {
    this.sendResponse(socket, `${tag} OK UNSUBSCRIBE completed`);
  }

  private async handleLsub(socket: Socket | TLSSocket, session: IMAPSession, tag: string, args: string[]): Promise<void> {
    this.sendResponse(socket, `${tag} OK LSUB completed`);
  }

  private async handleStatus(socket: Socket | TLSSocket, session: IMAPSession, tag: string, args: string[]): Promise<void> {
    this.sendResponse(socket, `${tag} NO STATUS not implemented`);
  }

  private async handleAppend(socket: Socket | TLSSocket, session: IMAPSession, tag: string, args: string[]): Promise<void> {
    this.sendResponse(socket, `${tag} NO APPEND not implemented`);
  }

  private async handleCheck(socket: Socket | TLSSocket, session: IMAPSession, tag: string): Promise<void> {
    this.sendResponse(socket, `${tag} OK CHECK completed`);
  }

  private async handleClose(socket: Socket | TLSSocket, session: IMAPSession, tag: string): Promise<void> {
    session.selectedMailbox = undefined;
    session.state = 'AUTH';
    this.sendResponse(socket, `${tag} OK CLOSE completed`);
  }

  private async handleExpunge(socket: Socket | TLSSocket, session: IMAPSession, tag: string): Promise<void> {
    this.sendResponse(socket, `${tag} OK EXPUNGE completed`);
  }

  private async handleStore(socket: Socket | TLSSocket, session: IMAPSession, tag: string, args: string[]): Promise<void> {
    this.sendResponse(socket, `${tag} NO STORE not implemented`);
  }

  private async handleCopy(socket: Socket | TLSSocket, session: IMAPSession, tag: string, args: string[]): Promise<void> {
    this.sendResponse(socket, `${tag} NO COPY not implemented`);
  }
}