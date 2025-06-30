# WhatsApp API Backend - System Architecture

## 🏗️ Overall Architecture

### System Overview

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   Dashboard     │    │   Developer      │    │   WhatsApp      │
│   Users (JWT)   │    │   Apps (API Key) │    │   Business API  │
└─────────┬───────┘    └─────────┬────────┘    └─────────┬───────┘
          │                      │                       │
          ▼                      ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                WhatsApp API Backend                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │ Management  │  │ Integration │  │    Baileys Service      │ │
│  │ APIs (JWT)  │  │ APIs (Keys) │  │  (WhatsApp Connection)  │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
          │                      │                       │
          ▼                      ▼                       ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Database Layer (Prisma)                     │
│     Subscriptions → Users → Instances → API Keys               │
└─────────────────────────────────────────────────────────────────┘
```

## 📁 Source Code Architecture

### Directory Structure

```
src/
├── app.js                      # Main Express application
├── config/
│   ├── database.js            # Prisma database configuration
│   └── environment.js         # Environment variables & validation
├── controllers/
│   ├── auth.controller.js     # Authentication logic
│   ├── instance.controller.js # Instance management (Phase 2)
│   ├── message.controller.js  # Message handling (Phase 3)
│   └── webhook.controller.js  # Webhook management (Phase 5)
├── middleware/
│   ├── auth.middleware.js     # Unified Bearer authentication
│   ├── validation.middleware.js # Joi input validation
│   └── rateLimit.middleware.js  # Rate limiting strategies
├── services/
│   ├── baileys.service.js     # WhatsApp connection management
│   ├── instance.service.js    # Instance lifecycle management
│   ├── message.service.js     # Message processing
│   ├── webhook.service.js     # Webhook delivery
│   └── stats.service.js       # Statistics and analytics
├── routes/
│   ├── auth.routes.js         # Authentication endpoints
│   ├── instance.routes.js     # Instance management endpoints
│   ├── message.routes.js      # Messaging endpoints
│   └── webhook.routes.js      # Webhook endpoints
└── utils/
    ├── constants.js           # Application constants
    ├── helpers.js             # Utility functions
    └── logger.js              # Winston logging configuration
```

## 🗄️ Database Architecture

### Multi-Tenant Data Model

```
Subscription (Tenant Root)
├── id: String (CUID)
├── tier: BASIC|PRO|MAX
├── maxInstances: Int
├── currentInstances: Int
└── monthlyMessages: Int

User (Subscription Members)
├── id: String (CUID)
├── email: String (unique)
├── role: ADMINISTRATOR|USER
├── subscriptionId: String (FK)
└── password: String (bcrypt)

Instance (WhatsApp Connections)
├── id: String (CUID)
├── name: String
├── status: CONNECTED|DISCONNECTED|CONNECTING
├── subscriptionId: String (FK)
├── createdById: String (FK)
├── phone: String?
├── qrCode: String?
└── qrCodeExpiry: DateTime?

ApiKey (Integration Access)
├── id: String (CUID)
├── instanceId: String (FK)
├── keyHash: String (SHA-256)
├── permissions: Json
├── rateLimit: Int
└── isActive: Boolean
```

### Key Relationships

- **Subscription** → **Users** (1:N) - Multi-user per subscription
- **Subscription** → **Instances** (1:N) - Instance ownership
- **User** → **Instances** (1:N) - Instance creation tracking
- **Instance** → **ApiKeys** (1:N) - Multiple keys per instance
- **Instance** → **SessionData** (1:1) - Baileys session persistence

## 🔐 Authentication Architecture

### Unified Bearer Token System

```javascript
// Single middleware handles both token types
Authorization: Bearer jjwt...  // JWT
Authorization: Bearer apikey         // API Key
```

### Authentication Flow

```
Request → Bearer Token Detection → Token Type Resolution → Context Setting
    │            │                        │                      │
    │            ▼                        ▼                      ▼
    │     Extract Bearer Token      JWT or API Key?        Set req.user
    │            │                        │               or req.instance
    │            ▼                        ▼                      │
    │     Validate Format          Validate & Decode             ▼
    │            │                        │               Continue to Route
    │            ▼                        ▼
    │     Return 401 if Invalid    Return 401 if Invalid
```

### Context Resolution

- **JWT Tokens**: Set `req.user` with subscription context
- **API Keys**: Set `req.instance` with auto-resolved instance context
- **Unified Access**: Both provide subscription-level data isolation

## 🚀 Service Layer Architecture

### Baileys Service (WhatsApp Integration)

```javascript
class BaileysService {
  // Instance management
  async createInstance(instanceId, config)
  async connectInstance(instanceId)
  async disconnectInstance(instanceId)
  async forceDisconnect(instanceId) // Prevents infinite QR loops

  // Session management
  async saveSession(instanceId, sessionData)
  async loadSession(instanceId)

  // QR Code management with 3-attempt limit
  async generateQR(instanceId)
  async refreshQR(instanceId)
  maxQRAttempts = 3 // Limit QR generation per session

  // Message handling
  async sendTextMessage(instanceId, to, message)
  async sendMediaMessage(instanceId, to, media)
  async sendImageMessage(instanceId, to, media)
  async sendDocumentMessage(instanceId, to, media)
  async sendAudioMessage(instanceId, to, media)
  async sendLocationMessage(instanceId, to, location)

  // Contact management
  async checkContacts(instanceId, phoneNumbers)

  // Event handling
  onConnectionUpdate(instanceId, callback)
  onMessageReceived(instanceId, callback)
  onQRGenerated(instanceId, callback)
}
```

### QR Code Limiting System

- **3-Attempt Limit**: Each connection session allows exactly 3 QR code attempts
- **Force Disconnection**: After 3 failed attempts, instance is force disconnected
- **Auto-reconnection Prevention**: FORCE_DISCONNECTED state prevents automatic reconnection
- **Enhanced Logging**: QR attempts are logged with counters (#1, #2, #3)
- **Manual Reconnection**: Users must manually reconnect after QR limit reached

### Instance Service (Lifecycle Management)

```javascript
class InstanceService {
  // CRUD operations
  async createInstance(userId, subscriptionId, config)
  async getInstance(instanceId, subscriptionId)
  async getInstanceById(instanceId, subscriptionId) // ID-based access
  async getInstanceByName(name, subscriptionId) // Name-based (legacy)
  async updateInstance(instanceId, updates)
  async deleteInstance(instanceId)

  // Status management
  async getInstanceStatus(instanceId)
  async restartInstance(instanceId)
  async connectInstance(instanceId)
  async disconnectInstance(instanceId)
  async getInstanceQR(instanceId)

  // Subscription enforcement
  async validateInstanceLimit(subscriptionId)
  async incrementInstanceCount(subscriptionId)
  async decrementInstanceCount(subscriptionId)
}
```

## 🔄 API Design Patterns

### Management APIs (JWT Required)

```
Pattern: /api/{resource}/{:identifier}/{action}
Examples:
  POST /api/instances                    # Create instance
  GET  /api/instances                    # List instances
  GET  /api/instances/:id/status         # Get instance status (ID-based)
  POST /api/instances/:id/restart        # Restart instance (ID-based)
  GET  /api/instances/:id/qr             # Get QR code (ID-based)
  GET  /api/instances/:id                # Get instance by ID
  PUT  /api/instances/:id                # Update instance
  DELETE /api/instances/:id              # Delete instance
```

### ID-Based URL Benefits

- **Stable URLs**: Instance IDs never change (unlike names)
- **Case-Insensitive**: No case sensitivity issues
- **Performance**: Direct database lookups without name → ID conversion
- **RESTful Standards**: Follows industry best practices
- **Developer-Friendly**: Consistent with major API providers (Stripe, Twilio)

### Integration APIs (API Key Required)

```
Pattern: /api/{action} (clean URLs, no instance names)
Examples:
  POST /api/messages/text               # Send text message
  POST /api/messages/image              # Send image message
  GET  /api/instance/info               # Get instance info
  GET  /api/stats                       # Get statistics
```

## 🛡️ Security Architecture

### Multi-Layer Security

```
Request → Rate Limiting → Authentication → Authorization → Validation → Business Logic
    │           │              │               │              │              │
    ▼           ▼              ▼               ▼              ▼              ▼
Basic Rate   Auth Rate     JWT/API Key    Subscription    Input Schema   Controller
Limiting     Limiting      Validation     Permissions     Validation     Logic
```

### Security Implementations

- **Password Security**: bcrypt with 12 rounds
- **JWT Security**: HS256 with configurable expiry
- **API Key Security**: SHA-256 hashing, prefix-based identification
- **Rate Limiting**: Express-rate-limit with Redis backing (production)
- **Input Validation**: Joi schemas for all endpoints
- **Audit Logging**: Winston with structured security event logging

## 📊 Monitoring & Observability

### Logging Architecture

```
Application Events → Winston Logger → Multiple Transports
                          │
                          ├── Console (Development)
                          ├── File (Production)
                          └── External Service (Future)
```

### Log Categories

- **Request Logs**: HTTP requests with timing and response codes
- **Security Logs**: Authentication events, failed attempts, privilege escalation
- **Business Logs**: Instance creation, message sending, subscription changes
- **Error Logs**: Application errors, Baileys connection issues, database errors
- **Audit Logs**: User actions, configuration changes, administrative actions

## 🔄 Real-time Architecture (Phase 5)

### Socket.IO Integration

```
Client Dashboard → Socket.IO → Event Emitter → Baileys Events
                      │              │              │
                      ▼              ▼              ▼
              Connection Status   Instance Events   Message Events
              Broadcasting       Broadcasting      Broadcasting
```

### Event Types

- **Connection Events**: Instance connect/disconnect, QR code updates
- **Message Events**: Message sent/received statistics (no content)
- **System Events**: Health status, error notifications
- **User Events**: Instance creation, subscription changes

## 🚀 Deployment Architecture

### Development Environment

- **Database**: SQLite with file persistence
- **Caching**: In-memory caching
- **Logging**: Console + file output
- **Sessions**: File-based session storage

### Production Environment

- **Database**: PostgreSQL with connection pooling
- **Caching**: Redis for session storage and rate limiting
- **Logging**: Structured JSON logs with external aggregation
- **Sessions**: Redis-backed session storage
- **Load Balancing**: Multiple Node.js instances behind reverse proxy

This architecture provides a solid foundation for a scalable, secure, and maintainable WhatsApp API management system that can grow from development to enterprise-scale deployment.
