import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import http from "http";

// Import configurations
import config from "./config/environment.js";
import databaseConfig from "./config/database.js";
import instanceService from "./services/instance.service.js";
import socketService from "./services/socket.service.js";
import logger from "./utils/logger.js";
import Helpers from "./utils/helpers.js";
import { HTTP_STATUS, ERROR_CODES } from "./utils/constants.js";

// Import middleware
import RateLimitMiddleware from "./middleware/rateLimit.middleware.js";

// Import routes
import authRoutes from "./routes/auth.routes.js";
import userRoutes from "./routes/user.routes.js";
import instanceRoutes from "./routes/instance.routes.js";

class WhatsAppAPIServer {
  constructor() {
    this.app = express();
    this.server = http.createServer(this.app);
  }

  /**
   * Initialize the application
   */
  async initialize() {
    try {
      // Connect to database
      await databaseConfig.connect();

      // Initialize Socket.IO
      socketService.initialize(this.server);
      logger.info("Socket.IO initialized");

      // Initialize instance service
      await instanceService.initializeInstances();
      logger.info("Instance service initialized successfully");

      // Setup middleware
      this.setupMiddleware();

      // Setup routes
      this.setupRoutes();

      // Setup error handling
      this.setupErrorHandling();

      logger.info("WhatsApp API Server initialized successfully");
    } catch (error) {
      logger.error("Failed to initialize server:", error);
      throw error;
    }
  }

  /**
   * Setup middleware
   */
  setupMiddleware() {
    // Security middleware
    this.app.use(
      helmet({
        contentSecurityPolicy: false, // Disable CSP for API
        crossOriginEmbedderPolicy: false,
      })
    );

    // CORS configuration
    this.app.use(
      cors({
        origin: config.cors.origin,
        credentials: config.cors.credentials,
        methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
        allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
      })
    );

    // Request logging
    if (config.nodeEnv === "development") {
      this.app.use(morgan("dev"));
    } else {
      this.app.use(
        morgan("combined", {
          stream: {
            write: (message) => logger.info(message.trim()),
          },
        })
      );
    }

    // Body parsing middleware
    this.app.use(express.json({ limit: "10mb" }));
    this.app.use(express.urlencoded({ extended: true, limit: "10mb" }));

    // Trust proxy for accurate IP addresses
    this.app.set("trust proxy", 1);

    // Basic rate limiting for all routes
    this.app.use(RateLimitMiddleware.createBasicLimiter());

    // Request ID and timing middleware
    this.app.use((req, res, next) => {
      req.requestId = Helpers.generateRequestId();
      req.startTime = Date.now();

      // Add request ID to response headers
      res.set("X-Request-ID", req.requestId);

      next();
    });

    // Response time logging
    this.app.use((req, res, next) => {
      const originalSend = res.send;

      res.send = function (data) {
        const responseTime = Date.now() - req.startTime;
        logger.request(req, res, responseTime);
        return originalSend.call(this, data);
      };

      next();
    });
  }

  /**
   * Setup routes
   */
  setupRoutes() {
    // Health check endpoint
    this.app.get("/health", async (req, res) => {
      try {
        const dbHealth = await databaseConfig.healthCheck();

        res.status(HTTP_STATUS.OK).json(
          Helpers.createResponse(
            true,
            {
              status: "OK",
              timestamp: new Date().toISOString(),
              version: "1.0.0",
              uptime: process.uptime(),
              database: dbHealth,
              environment: config.nodeEnv,
            },
            {
              request_id: req.requestId,
            }
          )
        );
      } catch (error) {
        logger.error("Health check failed:", error);
        res
          .status(HTTP_STATUS.SERVICE_UNAVAILABLE)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.SERVICE_UNAVAILABLE,
              "Service health check failed"
            )
          );
      }
    });

    // API version info
    this.app.get("/api/version", (req, res) => {
      res.status(HTTP_STATUS.OK).json(
        Helpers.createResponse(
          true,
          {
            version: "1.0.0",
            apiVersion: "v1",
            name: "WhatsApp API Backend",
            description: "Production-ready WhatsApp API management system",
            documentation: "/docs",
          },
          {
            request_id: req.requestId,
          }
        )
      );
    });

    // Mount API routes
    this.app.use("/api/auth", authRoutes);
    this.app.use("/api/users", userRoutes);
    this.app.use("/api/instances", instanceRoutes);

    // API root endpoint
    this.app.get("/api", (req, res) => {
      res.status(HTTP_STATUS.OK).json(
        Helpers.createResponse(
          true,
          {
            message: "WhatsApp API Backend",
            version: "1.0.0",
            endpoints: {
              auth: "/api/auth",
              users: "/api/users",
              instances: "/api/instances",
              health: "/health",
              version: "/api/version",
            },
          },
          {
            request_id: req.requestId,
          }
        )
      );
    });

    // Catch-all for undefined routes
    this.app.all("*", (req, res) => {
      logger.api("Route not found", {
        method: req.method,
        url: req.url,
        ip: Helpers.getClientIP(req),
      });

      res
        .status(HTTP_STATUS.NOT_FOUND)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.RESOURCE_NOT_FOUND,
            `Route ${req.method} ${req.url} not found`
          )
        );
    });
  }

  /**
   * Setup error handling
   */
  setupErrorHandling() {
    // Global error handler
    this.app.use((error, req, res, next) => {
      logger.error("Unhandled error:", error);

      // Don't leak error details in production
      const isDevelopment = config.nodeEnv === "development";

      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Internal server error",
            isDevelopment ? { stack: error.stack } : {}
          )
        );
    });

    // Handle uncaught exceptions
    process.on("uncaughtException", (error) => {
      logger.error("Uncaught Exception:", error);
      this.gracefulShutdown("UNCAUGHT_EXCEPTION");
    });

    // Handle unhandled promise rejections
    process.on("unhandledRejection", (reason, promise) => {
      logger.error("Unhandled Rejection at:", promise, "reason:", reason);
      this.gracefulShutdown("UNHANDLED_REJECTION");
    });

    // Handle SIGTERM
    process.on("SIGTERM", () => {
      logger.info("SIGTERM received");
      this.gracefulShutdown("SIGTERM");
    });

    // Handle SIGINT
    process.on("SIGINT", () => {
      logger.info("SIGINT received");
      this.gracefulShutdown("SIGINT");
    });
  }

  /**
   * Start the server
   */
  async start() {
    try {
      await this.initialize();

      this.server.listen(config.port, () => {
        logger.info(`🚀 WhatsApp API Server started successfully`);
        logger.info(`📡 Server running on port ${config.port}`);
        logger.info(`🌍 Environment: ${config.nodeEnv}`);
        logger.info(`📊 Health check: http://localhost:${config.port}/health`);
        logger.info(`🔗 API endpoint: http://localhost:${config.port}/api`);
      });

      return this.server;
    } catch (error) {
      logger.error("Failed to start server:", error);
      throw error;
    }
  }

  /**
   * Graceful shutdown
   */
  async gracefulShutdown(signal) {
    logger.info(`Graceful shutdown initiated by ${signal}`);

    if (this.server) {
      this.server.close(async () => {
        logger.info("HTTP server closed");

        try {
          // Cleanup instance service
          await instanceService.cleanup();
          logger.info("Instance service cleaned up");

          // Close database connection
          await databaseConfig.disconnect();
          logger.info("Database disconnected");

          logger.info("Graceful shutdown completed");
          process.exit(0);
        } catch (error) {
          logger.error("Error during graceful shutdown:", error);
          process.exit(1);
        }
      });

      // Force close after 10 seconds
      setTimeout(() => {
        logger.error(
          "Could not close connections in time, forcefully shutting down"
        );
        process.exit(1);
      }, 10000);
    } else {
      process.exit(0);
    }
  }

  /**
   * Get Express app instance
   */
  getApp() {
    return this.app;
  }
}

// Create and export server instance
const server = new WhatsAppAPIServer();

// Start server if this file is run directly
server.start().catch((error) => {
  logger.error("Failed to start server:", error);
  process.exit(1);
});

export default server;
