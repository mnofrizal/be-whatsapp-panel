# WhatsApp API Backend - Technology Stack

## 🛠️ Core Technologies

### Backend Framework

- **Node.js**: v18+ (LTS) - JavaScript runtime environment
- **Express.js**: v5.1.0 - Web application framework
- **JavaScript**: ES6+ (no TypeScript) - Programming language

### Database & ORM

- **Prisma ORM**: v6.10.1 - Database toolkit and ORM
- **SQLite**: Development database (file-based)
- **PostgreSQL**: Production database (planned)
- **Database Client**: @prisma/client for type-safe queries

### Authentication & Security

- **JWT**: jsonwebtoken v9.0.2 - JSON Web Tokens for user authentication
- **bcryptjs**: v3.0.2 - Password hashing
- **Helmet**: v8.1.0 - Security headers middleware
- **CORS**: v2.8.5 - Cross-Origin Resource Sharing
- **Joi**: v17.13.3 - Input validation and schema validation

### WhatsApp Integration

- **@whiskeysockets/baileys**: v6.7.18 - WhatsApp Web API library
- **QRCode**: v1.5.4 - QR code generation for WhatsApp pairing
- **Socket.IO**: v4.8.1 - Real-time bidirectional communication

### Middleware & Utilities

- **express-rate-limit**: v7.5.1 - Rate limiting middleware
- **Morgan**: v1.10.0 - HTTP request logger
- **Multer**: v2.0.1 - File upload handling
- **dotenv**: v17.0.0 - Environment variable management

### Logging & Monitoring

- **Winston**: v3.17.0 - Logging library with multiple transports
- **Morgan**: HTTP request logging integration with Winston

## 🏗️ Development Setup

### Prerequisites

```bash
Node.js >= 18.0.0
npm >= 8.0.0
Git
```

### Environment Configuration

```bash
# Development
NODE_ENV=development
PORT=3000
DATABASE_URL="file:./dev.db"
JWT_SECRET="your-super-secret-jwt-key"
JWT_EXPIRES_IN="24h"
BCRYPT_ROUNDS=12

# CORS Settings
CORS_ORIGIN="http://localhost:3000"
CORS_CREDENTIALS=true

# Rate Limiting
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
AUTH_RATE_LIMIT_MAX=5
```

### Package Scripts

```json
{
  "start": "node src/app.js",
  "dev": "nodemon src/app.js",
  "db:generate": "prisma generate",
  "db:push": "prisma db push",
  "db:migrate": "prisma migrate dev",
  "db:studio": "prisma studio",
  "db:seed": "node prisma/seed.js"
}
```

## 🔧 Technical Architecture

### Application Structure

```
WhatsAppAPIServer (Class-based)
├── initialize() - Setup database, middleware, routes
├── setupMiddleware() - Security, CORS, parsing, rate limiting
├── setupRoutes() - API endpoints and error handling
├── setupErrorHandling() - Global error handling and graceful shutdown
├── start() - Server startup
└── gracefulShutdown() - Clean shutdown process
```

### Middleware Stack (Order Matters)

1. **Helmet** - Security headers
2. **CORS** - Cross-origin resource sharing
3. **Morgan** - Request logging
4. **Express.json/urlencoded** - Body parsing
5. **Trust Proxy** - Proxy configuration
6. **Rate Limiting** - Basic rate limiting
7. **Request ID & Timing** - Request tracking
8. **Response Time Logging** - Performance monitoring

### Database Configuration

```javascript
// Prisma Client Setup
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({
  log: ["query", "info", "warn", "error"],
  errorFormat: "pretty",
});

// Connection Management
async function connect() {
  await prisma.$connect();
}

async function disconnect() {
  await prisma.$disconnect();
}

async function healthCheck() {
  const result = await prisma.$queryRaw`SELECT 1`;
  return { status: "connected", result };
}
```

## 🔐 Security Implementation

### Authentication Flow

```javascript
// Unified Bearer Token Authentication
const authHeader = req.headers.authorization;
const token = authHeader.substring(7); // Remove "Bearer "

// Auto-detect token type
if (token.startsWith("jwt_") || isJWT(token)) {
  // JWT validation for user management
  const decoded = jwt.verify(token, JWT_SECRET);
  req.user = await User.findUnique({ where: { id: decoded.userId } });
} else {
  // API Key validation for integration
  const keyHash = crypto.createHash("sha256").update(token).digest("hex");
  const apiKey = await ApiKey.findUnique({ where: { keyHash } });
  req.instance = apiKey.instance;
}
```

### Password Security

```javascript
// Registration
const hashedPassword = await bcrypt.hash(password, BCRYPT_ROUNDS);

// Login
const isValid = await bcrypt.compare(password, user.password);
```

### Rate Limiting Strategy

```javascript
// Basic rate limiting (all routes)
const basicLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // requests per window
  message: "Too many requests",
});

// Authentication rate limiting
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // stricter for auth endpoints
  skipSuccessfulRequests: true,
});
```

## 📊 Logging Configuration

### Winston Logger Setup

```javascript
const winston = require("winston");

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: "logs/error.log", level: "error" }),
    new winston.transports.File({ filename: "logs/combined.log" }),
  ],
});

// Development console logging
if (process.env.NODE_ENV === "development") {
  logger.add(
    new winston.transports.Console({
      format: winston.format.simple(),
    })
  );
}
```

### Log
