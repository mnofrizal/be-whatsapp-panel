import dotenv from "dotenv";
dotenv.config();

const config = {
  // Server Configuration
  port: parseInt(process.env.PORT) || 3000,
  nodeEnv: process.env.NODE_ENV || "development",

  // Database Configuration
  database: {
    url: process.env.DATABASE_URL || "file:./dev.db",
  },

  // JWT Configuration
  jwt: {
    secret:
      process.env.JWT_SECRET ||
      "your-super-secret-jwt-key-change-this-in-production",
    expiresIn: process.env.JWT_EXPIRES_IN || "7d",
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || "30d",
  },

  // Rate Limiting Configuration
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 3600000, // 1 hour
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 1000,
  },

  // Baileys Configuration
  baileys: {
    sessionPath: process.env.BAILEYS_SESSION_PATH || "./sessions",
    autoReconnect: process.env.BAILEYS_AUTO_RECONNECT === "true",
  },

  // Webhook Configuration
  webhook: {
    secret: process.env.WEBHOOK_SECRET || "your-webhook-secret-key",
  },

  // Logging Configuration
  logging: {
    level: process.env.LOG_LEVEL || "info",
    file: process.env.LOG_FILE || "./logs/app.log",
  },

  // CORS Configuration
  cors: {
    origin: process.env.CORS_ORIGIN || "*",
    credentials: process.env.CORS_CREDENTIALS === "true",
  },

  // Security Configuration
  security: {
    bcryptRounds: 12,
    apiKeyLength: 32,
    maxLoginAttempts: 5,
    lockoutTime: 15 * 60 * 1000, // 15 minutes
  },

  // Subscription Limits
  subscriptionLimits: {
    BASIC: {
      maxInstances: 5,
      monthlyMessages: 10000,
      rateLimit: 1000,
    },
    PRO: {
      maxInstances: 20,
      monthlyMessages: 50000,
      rateLimit: 5000,
    },
    MAX: {
      maxInstances: 40,
      monthlyMessages: 100000,
      rateLimit: 10000,
    },
  },

  // Default Settings
  defaults: {
    subscriptionTier: "BASIC",
    userRole: "USER",
    instanceStatus: "DISCONNECTED",
    apiKeyRateLimit: 1000,
  },
};

// Validation
function validateConfig() {
  const required = ["JWT_SECRET", "DATABASE_URL"];

  const missing = required.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}`
    );
  }

  // Warn about default values in production
  if (config.nodeEnv === "production") {
    if (
      config.jwt.secret ===
      "your-super-secret-jwt-key-change-this-in-production"
    ) {
      throw new Error("JWT_SECRET must be changed in production");
    }

    if (config.webhook.secret === "your-webhook-secret-key") {
      console.warn("WARNING: Using default webhook secret in production");
    }
  }
}

// Validate configuration on load
validateConfig();

export default config;
