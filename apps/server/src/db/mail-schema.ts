import {
  pgTableCreator,
  text,
  timestamp,
  boolean,
  integer,
  jsonb,
  primaryKey,
  unique,
  index,
  bigint,
  varchar,
  bytea,
} from 'drizzle-orm/pg-core';

export const createTable = pgTableCreator((name) => `admini_${name}`);

// Domain management for self-hosted email
export const domain = createTable('domain', {
  id: text('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull().unique(),
  isActive: boolean('is_active').notNull().default(true),
  isVerified: boolean('is_verified').notNull().default(false),
  verificationToken: text('verification_token'),
  dkimPrivateKey: text('dkim_private_key'),
  dkimPublicKey: text('dkim_public_key'),
  dkimSelector: varchar('dkim_selector', { length: 64 }).notNull().default('admini'),
  spfRecord: text('spf_record'),
  dmarcRecord: text('dmarc_record'),
  maxUsers: integer('max_users').default(100),
  maxStorageMB: integer('max_storage_mb').default(10240), // 10GB default
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('domain_name_idx').on(t.name),
  index('domain_active_idx').on(t.isActive),
]);

// Email addresses/users for each domain
export const mailUser = createTable('mail_user', {
  id: text('id').primaryKey(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  localPart: varchar('local_part', { length: 64 }).notNull(),
  domainId: text('domain_id').notNull().references(() => domain.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(), // Argon2 hash
  displayName: varchar('display_name', { length: 255 }),
  isActive: boolean('is_active').notNull().default(true),
  isAdmin: boolean('is_admin').notNull().default(false),
  quotaMB: integer('quota_mb').notNull().default(1024), // 1GB default
  usedStorageMB: integer('used_storage_mb').notNull().default(0),
  lastLoginAt: timestamp('last_login_at'),
  twoFactorSecret: text('two_factor_secret'),
  twoFactorEnabled: boolean('two_factor_enabled').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('mail_user_email_idx').on(t.email),
  index('mail_user_domain_idx').on(t.domainId),
  index('mail_user_active_idx').on(t.isActive),
]);

// Email aliases
export const mailAlias = createTable('mail_alias', {
  id: text('id').primaryKey(),
  alias: varchar('alias', { length: 255 }).notNull(),
  domainId: text('domain_id').notNull().references(() => domain.id, { onDelete: 'cascade' }),
  targetUserId: text('target_user_id').notNull().references(() => mailUser.id, { onDelete: 'cascade' }),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('mail_alias_alias_idx').on(t.alias),
  index('mail_alias_domain_idx').on(t.domainId),
  unique('unique_alias_domain').on(t.alias, t.domainId),
]);

// Mailboxes (folders) for each user
export const mailbox = createTable('mailbox', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => mailUser.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  path: text('path').notNull(), // Full path like INBOX, INBOX/Sent, etc.
  parentId: text('parent_id').references(() => mailbox.id, { onDelete: 'cascade' }),
  uidValidity: bigint('uid_validity', { mode: 'number' }).notNull(),
  uidNext: bigint('uid_next', { mode: 'number' }).notNull().default(1),
  messageCount: integer('message_count').notNull().default(0),
  unseenCount: integer('unseen_count').notNull().default(0),
  recentCount: integer('recent_count').notNull().default(0),
  flags: jsonb('flags').$type<string[]>().notNull().default([]),
  isSubscribed: boolean('is_subscribed').notNull().default(true),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('mailbox_user_idx').on(t.userId),
  index('mailbox_path_idx').on(t.path),
  unique('unique_user_path').on(t.userId, t.path),
]);

// Email messages
export const message = createTable('message', {
  id: text('id').primaryKey(),
  uid: bigint('uid', { mode: 'number' }).notNull(),
  mailboxId: text('mailbox_id').notNull().references(() => mailbox.id, { onDelete: 'cascade' }),
  messageId: text('message_id').notNull(), // RFC 2822 Message-ID
  threadId: text('thread_id'), // For conversation threading
  inReplyTo: text('in_reply_to'),
  references: text('references'),
  subject: text('subject'),
  fromAddress: text('from_address').notNull(),
  toAddresses: jsonb('to_addresses').$type<string[]>().notNull(),
  ccAddresses: jsonb('cc_addresses').$type<string[]>().default([]),
  bccAddresses: jsonb('bcc_addresses').$type<string[]>().default([]),
  replyToAddress: text('reply_to_address'),
  date: timestamp('date').notNull(),
  size: integer('size').notNull(),
  flags: jsonb('flags').$type<string[]>().notNull().default([]), // \Seen, \Answered, etc.
  labels: jsonb('labels').$type<string[]>().default([]),
  headers: jsonb('headers').$type<Record<string, string>>().notNull(),
  bodyText: text('body_text'),
  bodyHtml: text('body_html'),
  rawMessage: bytea('raw_message'), // Full RFC 2822 message
  spfResult: varchar('spf_result', { length: 20 }),
  dkimResult: varchar('dkim_result', { length: 20 }),
  dmarcResult: varchar('dmarc_result', { length: 20 }),
  spamScore: integer('spam_score').default(0),
  isSpam: boolean('is_spam').notNull().default(false),
  isPhishing: boolean('is_phishing').notNull().default(false),
  aiCategory: varchar('ai_category', { length: 50 }), // Primary, Promotions, Updates, etc.
  aiSummary: text('ai_summary'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('message_mailbox_idx').on(t.mailboxId),
  index('message_uid_idx').on(t.uid),
  index('message_message_id_idx').on(t.messageId),
  index('message_thread_idx').on(t.threadId),
  index('message_date_idx').on(t.date),
  index('message_from_idx').on(t.fromAddress),
  index('message_subject_idx').on(t.subject),
  index('message_spam_idx').on(t.isSpam),
  unique('unique_mailbox_uid').on(t.mailboxId, t.uid),
]);

// Message attachments
export const attachment = createTable('attachment', {
  id: text('id').primaryKey(),
  messageId: text('message_id').notNull().references(() => message.id, { onDelete: 'cascade' }),
  filename: varchar('filename', { length: 255 }),
  contentType: varchar('content_type', { length: 100 }).notNull(),
  contentId: text('content_id'),
  size: integer('size').notNull(),
  data: bytea('data'), // For small attachments, larger ones should use file storage
  isInline: boolean('is_inline').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('attachment_message_idx').on(t.messageId),
  index('attachment_content_type_idx').on(t.contentType),
]);

// Mail queue for outgoing messages
export const mailQueue = createTable('mail_queue', {
  id: text('id').primaryKey(),
  fromAddress: text('from_address').notNull(),
  toAddresses: jsonb('to_addresses').$type<string[]>().notNull(),
  subject: text('subject'),
  rawMessage: bytea('raw_message').notNull(),
  priority: integer('priority').notNull().default(5), // 1-10, lower is higher priority
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(3),
  nextRetry: timestamp('next_retry'),
  status: varchar('status', { length: 20 }).notNull().default('pending'), // pending, sending, sent, failed
  error: text('error'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('mail_queue_status_idx').on(t.status),
  index('mail_queue_next_retry_idx').on(t.nextRetry),
  index('mail_queue_priority_idx').on(t.priority),
]);

// Spam/phishing training data
export const spamTraining = createTable('spam_training', {
  id: text('id').primaryKey(),
  messageId: text('message_id').references(() => message.id, { onDelete: 'cascade' }),
  isSpam: boolean('is_spam').notNull(),
  features: jsonb('features').$type<Record<string, number>>().notNull(),
  trainedBy: text('trained_by'), // user who marked as spam/ham
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('spam_training_spam_idx').on(t.isSpam),
  index('spam_training_message_idx').on(t.messageId),
]);

// Admin system settings
export const systemSettings = createTable('system_settings', {
  id: text('id').primaryKey(),
  key: varchar('key', { length: 100 }).notNull().unique(),
  value: jsonb('value').notNull(),
  description: text('description'),
  isPublic: boolean('is_public').notNull().default(false), // Can non-admin users see this?
  updatedBy: text('updated_by').references(() => mailUser.id),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('system_settings_key_idx').on(t.key),
]);

// Mail server logs
export const mailLog = createTable('mail_log', {
  id: text('id').primaryKey(),
  timestamp: timestamp('timestamp').notNull().defaultNow(),
  level: varchar('level', { length: 10 }).notNull(), // info, warn, error
  service: varchar('service', { length: 20 }).notNull(), // smtp, imap, pop3, web
  sessionId: text('session_id'),
  userId: text('user_id').references(() => mailUser.id),
  remoteAddress: varchar('remote_address', { length: 45 }), // IPv4 or IPv6
  action: varchar('action', { length: 50 }),
  message: text('message').notNull(),
  metadata: jsonb('metadata'),
}, (t) => [
  index('mail_log_timestamp_idx').on(t.timestamp),
  index('mail_log_level_idx').on(t.level),
  index('mail_log_service_idx').on(t.service),
  index('mail_log_user_idx').on(t.userId),
]);

// Rate limiting and security
export const rateLimits = createTable('rate_limits', {
  id: text('id').primaryKey(),
  identifier: varchar('identifier', { length: 100 }).notNull(), // IP, user, etc.
  action: varchar('action', { length: 50 }).notNull(), // login, send_mail, etc.
  count: integer('count').notNull().default(1),
  windowStart: timestamp('window_start').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
}, (t) => [
  index('rate_limits_identifier_idx').on(t.identifier),
  index('rate_limits_action_idx').on(t.action),
  index('rate_limits_expires_idx').on(t.expiresAt),
  unique('unique_identifier_action_window').on(t.identifier, t.action, t.windowStart),
]);

// Failed login attempts and security events
export const securityEvents = createTable('security_events', {
  id: text('id').primaryKey(),
  type: varchar('type', { length: 50 }).notNull(), // failed_login, suspicious_activity, etc.
  remoteAddress: varchar('remote_address', { length: 45 }).notNull(),
  userAgent: text('user_agent'),
  userId: text('user_id').references(() => mailUser.id),
  email: varchar('email', { length: 255 }),
  details: jsonb('details'),
  severity: varchar('severity', { length: 10 }).notNull().default('low'), // low, medium, high, critical
  isResolved: boolean('is_resolved').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('security_events_type_idx').on(t.type),
  index('security_events_ip_idx').on(t.remoteAddress),
  index('security_events_user_idx').on(t.userId),
  index('security_events_severity_idx').on(t.severity),
  index('security_events_created_idx').on(t.createdAt),
]);

// Calendar events (CalDAV support)
export const calendarEvent = createTable('calendar_event', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => mailUser.id, { onDelete: 'cascade' }),
  uid: text('uid').notNull(), // iCalendar UID
  summary: text('summary').notNull(),
  description: text('description'),
  location: text('location'),
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time').notNull(),
  isAllDay: boolean('is_all_day').notNull().default(false),
  recurrenceRule: text('recurrence_rule'), // RRULE
  timezone: varchar('timezone', { length: 50 }),
  status: varchar('status', { length: 20 }).default('confirmed'), // tentative, confirmed, cancelled
  attendees: jsonb('attendees').$type<Array<{email: string, name?: string, status: string}>>(),
  reminders: jsonb('reminders').$type<Array<{minutes: number, type: string}>>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('calendar_event_user_idx').on(t.userId),
  index('calendar_event_uid_idx').on(t.uid),
  index('calendar_event_start_idx').on(t.startTime),
  index('calendar_event_end_idx').on(t.endTime),
]);

// Contacts (CardDAV support)
export const contact = createTable('contact', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull().references(() => mailUser.id, { onDelete: 'cascade' }),
  uid: text('uid').notNull(), // vCard UID
  displayName: varchar('display_name', { length: 255 }).notNull(),
  givenName: varchar('given_name', { length: 100 }),
  familyName: varchar('family_name', { length: 100 }),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 50 }),
  organization: varchar('organization', { length: 255 }),
  title: varchar('title', { length: 100 }),
  address: jsonb('address').$type<{street?: string, city?: string, state?: string, zip?: string, country?: string}>(),
  birthday: timestamp('birthday'),
  notes: text('notes'),
  photo: bytea('photo'), // Small avatar image
  vcard: text('vcard'), // Full vCard data
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('contact_user_idx').on(t.userId),
  index('contact_uid_idx').on(t.uid),
  index('contact_email_idx').on(t.email),
  index('contact_name_idx').on(t.displayName),
]);