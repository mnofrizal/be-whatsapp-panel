import { PrismaClient } from "@prisma/client";
import logger from "../utils/logger.js";

class DatabaseConfig {
  constructor() {
    this.prisma = null;
  }

  async connect() {
    if (this.prisma && this.isConnected) {
      logger.info("Database already connected, skipping.");
      return this.prisma;
    }

    try {
      this.prisma = new PrismaClient({
        log: [
          {
            emit: "event",
            level: "query",
          },
          {
            emit: "event",
            level: "error",
          },
          {
            emit: "event",
            level: "info",
          },
          {
            emit: "event",
            level: "warn",
          },
        ],
      });

      // Log database queries in development
      if (process.env.NODE_ENV === "development") {
        this.prisma.$on("query", (e) => {
          logger.debug("Query: " + e.query);
          logger.debug("Params: " + e.params);
          logger.debug("Duration: " + e.duration + "ms");
        });
      }

      // Log database errors
      this.prisma.$on("error", (e) => {
        logger.error("Database error:", e);
      });

      // Test connection
      await this.prisma.$connect();
      this.isConnected = true; // Set flag after successful connection
      logger.info("Database connected successfully");

      return this.prisma;
    } catch (error) {
      logger.error("Database connection failed:", error);
      this.isConnected = false;
      throw error;
    }
  }

  async disconnect() {
    if (this.prisma) {
      await this.prisma.$disconnect();
      logger.info("Database disconnected");
    }
  }

  getClient() {
    if (!this.prisma) {
      throw new Error("Database not connected. Call connect() first.");
    }
    return this.prisma;
  }

  // Health check
  async healthCheck() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: "healthy", timestamp: new Date().toISOString() };
    } catch (error) {
      logger.error("Database health check failed:", error);
      return {
        status: "unhealthy",
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

// Singleton instance
const databaseConfig = new DatabaseConfig();

export default databaseConfig;
