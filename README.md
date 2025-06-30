# WhatsApp API Backend

A production-ready WhatsApp API Backend system built with Node.js, Express, and Baileys. This is a multi-tenant API management platform that allows developers to integrate WhatsApp messaging into their applications.

## 🎯 Features

- **Multi-tenant Architecture**: Subscription-based system with user isolation
- **Clean API Design**: Industry-standard REST APIs with Bearer authentication
- **Unified Authentication**: JWT for management, API Keys for integration
- **Rate Limiting**: Per-user and per-API-key rate limiting
- **Real-time Monitoring**: Connection status and message statistics
- **Webhook Support**: Event-driven notifications
- **Production Ready**: Comprehensive logging, error handling, and security

## 🏗️ Architecture

### Technology Stack

- **Backend**: Node.js + Express.js
- **Database**: Prisma ORM + SQLite (dev) / PostgreSQL (prod)
- **Authentication**: JWT + API Keys with Bearer tokens
- **WhatsApp**: @whiskeysockets/baileys
- **Real-time**: Socket.IO
- **Security**: Helmet, CORS, Rate limiting

### Subscription Tiers

- **Basic**: 5 instances, 10K messages/month
- **Pro**: 20 instances, 50K messages/month
- **Max**: 40 instances, 100K messages/month

## 🚀 Quick Start

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn

### Installation

1. **Clone the repository**

   ```bash
   git clone <repository-url>
   cd whatsapp-api-backend
   ```

2. **Install dependencies**

   ```bash
   npm install
   ```

3. **Setup environment**

   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

4. **Setup database**

   ```bash
   npm run db:generate
   npm run db:push
   ```

5. **Start development server**
   ```bash
   npm run dev
   ```

The server will start on `http://localhost:3000`

## 📡 API Endpoints

### Health Check

```bash
GET /health
GET /api/version
```

### Authentication (JWT Required)

```bash
POST /api/auth/register     # Register new user
POST /api/auth/login        # User login
GET  /api/auth/me          # Get current user
POST /api/auth/change-password
POST /api/auth/refresh     # Refresh token
POST /api/auth/logout      # Logout
```

## 🔧 Phase 1 Implementation Status

✅ **Completed Features:**

### Core Infrastructure

- [x] Project structure and configuration
- [x] Environment configuration with validation
- [x] Database configuration with Prisma
- [x] Comprehensive logging system
- [x] Helper utilities and constants

### Security & Middleware

- [x] Unified authentication middleware (JWT + API Keys)
- [x] Input validation with Joi schemas
- [x] Rate limiting (basic, auth, API key specific)
- [x] Security headers with Helmet
- [x] CORS configuration

### Authentication System

- [x] User registration with automatic subscription creation
- [x] User login with JWT token generation
- [x] Password change functionality
- [x] Token refresh mechanism
- [x] Logout with audit logging
- [x] Role-based access control

### Database Schema

- [x] Complete Prisma schema implementation
- [x] Multi-tenant data structure
- [x] Audit logging system
- [x] Usage tracking models

### API Foundation

- [x] Express server setup with middleware
- [x] Error handling and graceful shutdown
- [x] Request logging and monitoring
- [x] Health check endpoints
- [x] Standardized API responses

## 🧪 Testing the Implementation

### 1. Start the Server

```bash
npm run dev
```

### 2. Test Health Check

```bash
curl http://localhost:3000/health
```

### 3. Register a New User

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "securePassword123",
    "name": "Admin User"
  }'
```

### 4. Login

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@example.com",
    "password": "securePassword123"
  }'
```

### 5. Get User Info (use token from login)

```bash
curl -X GET http://localhost:3000/api/auth/me \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## 📁 Project Structure

```
src/
├── config/
│   ├── database.js         # Database configuration
│   └── environment.js      # Environment variables
├── controllers/
│   └── auth.controller.js  # Authentication logic
├── middleware/
│   ├── auth.middleware.js  # Unified authentication
│   ├── validation.middleware.js # Input validation
│   └── rateLimit.middleware.js  # Rate limiting
├── routes/
│   └── auth.routes.js      # Authentication routes
├── utils/
│   ├── constants.js        # Application constants
│   ├── helpers.js          # Utility functions
│   └── logger.js           # Logging system
└── app.js                  # Main application
```

## 🔒 Security Features

- **Password Hashing**: bcrypt with configurable rounds
- **JWT Security**: Secure token generation and validation
- **API Key Hashing**: SHA-256 hashing for API key storage
- **Rate Limiting**: Multiple layers of rate limiting
- **Input Validation**: Comprehensive Joi validation schemas
- **Audit Logging**: Security events and user actions
- **CORS Protection**: Configurable CORS policies
- **Security Headers**: Helmet.js security headers

## 📊 Logging & Monitoring

- **Structured Logging**: Winston with JSON format
- **Request Logging**: Morgan with custom format
- **Error Tracking**: Comprehensive error logging
- **Audit Trail**: User actions and security events
- **Performance Monitoring**: Request timing and metrics

## 🚧 Next Steps (Phase 2)

The foundation is now complete! Next phases will include:

- **Phase 2**: Instance management and Baileys integration
- **Phase 3**: Messaging system with all message types
- **Phase 4**: API key management and permissions
- **Phase 5**: Real-time monitoring and webhooks
- **Phase 6**: Production deployment and optimization

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🆘 Support

For support and questions:

- Create an issue in the repository
- Check the documentation in the `/summary` folder
- Review the API examples in `/summary/1. Flow example.md`
