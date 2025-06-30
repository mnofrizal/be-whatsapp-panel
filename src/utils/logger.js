import winston from "winston";
import path from "path";
import fs from "fs";
import config from "../config/environment.js";

// Ensure logs directory exists
const logsDir = path.dirname(config.logging.file);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack }) => {
    return `${timestamp} [${level}]: ${stack || message}`;
  })
);

// Custom format for file output
const fileFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.errors({ stack: true }),
  winston.format.json()
);

// Create logger instance
const logger = winston.createLogger({
  level: config.logging.level,
  defaultMeta: { service: "whatsapp-api" },
  transports: [
    // File transport for all logs
    new winston.transports.File({
      filename: config.logging.file,
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),

    // Separate file for errors
    new winston.transports.File({
      filename: path.join(logsDir, "error.log"),
      level: "error",
      format: fileFormat,
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
  ],
});

// Add console transport in development
if (config.nodeEnv !== "production") {
  logger.add(
    new winston.transports.Console({
      format: consoleFormat,
    })
  );
}

// Custom logging methods for different contexts
logger.auth = (message, meta = {}) => {
  logger.info(message, { context: "AUTH", ...meta });
};

logger.api = (message, meta = {}) => {
  logger.info(message, { context: "API", ...meta });
};

logger.baileys = (message, meta = {}) => {
  logger.info(message, { context: "BAILEYS", ...meta });
};

logger.webhook = (message, meta = {}) => {
  logger.info(message, { context: "WEBHOOK", ...meta });
};

logger.database = (message, meta = {}) => {
  logger.info(message, { context: "DATABASE", ...meta });
};

// Request logging helper
logger.request = (req, res, responseTime) => {
  const { method, url, ip, headers } = req;
  const { statusCode } = res;

  logger.api(`${method} ${url}`, {
    ip,
    statusCode,
    responseTime: `${responseTime}ms`,
    userAgent: headers["user-agent"],
    userId: req.user?.id,
    instanceId: req.instance?.id,
  });
};

// Enhanced error logging helper (keeping original logger.error intact)
logger.logErrorDetails = (message, error = {}) => {
  if (error instanceof Error) {
    logger.error(message, {
      error: {
        message: error.message,
        stack: error.stack,
        name: error.name,
      },
    });
  } else {
    logger.error(message, error);
  }
};

// Security event logging
logger.security = (event, details = {}) => {
  logger.warn(`SECURITY: ${event}`, {
    context: "SECURITY",
    event,
    timestamp: new Date().toISOString(),
    ...details,
  });
};

// Audit logging
logger.audit = (action, resource, details = {}) => {
  logger.info(`AUDIT: ${action} ${resource}`, {
    context: "AUDIT",
    action,
    resource,
    timestamp: new Date().toISOString(),
    ...details,
  });
};

export default logger;
