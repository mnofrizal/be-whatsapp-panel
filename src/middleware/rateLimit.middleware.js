import rateLimit from "express-rate-limit";
import databaseConfig from "../config/database.js";
import config from "../config/environment.js";
import logger from "../utils/logger.js";
import Helpers from "../utils/helpers.js";
import { HTTP_STATUS, ERROR_CODES, AUDIT_ACTIONS } from "../utils/constants.js";

class RateLimitMiddleware {
  /**
   * Create basic rate limiter for general API endpoints
   */
  static createBasicLimiter(
    windowMs = config.rateLimit.windowMs,
    max = config.rateLimit.maxRequests
  ) {
    return rateLimit({
      windowMs,
      max,
      message: Helpers.createErrorResponse(
        ERROR_CODES.RATE_LIMIT_EXCEEDED,
        "Too many requests, please try again later"
      ),
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => {
        // Use user ID if authenticated, otherwise IP
        return req.user?.id || req.apiKey?.id || Helpers.getClientIP(req);
      },
      handler: (req, res) => {
        logger.security("Rate limit exceeded", {
          ip: Helpers.getClientIP(req),
          userId: req.user?.id,
          apiKeyId: req.apiKey?.id,
          endpoint: req.path,
          method: req.method,
        });

        res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json(
          Helpers.createErrorResponse(
            ERROR_CODES.RATE_LIMIT_EXCEEDED,
            "Too many requests, please try again later",
            {
              retryAfter: Math.ceil(windowMs / 1000),
              limit: max,
              windowMs,
            }
          )
        );
      },
    });
  }

  /**
   * Create strict rate limiter for authentication endpoints
   */
  static createAuthLimiter() {
    return rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 5, // 5 attempts per window
      message: Helpers.createErrorResponse(
        ERROR_CODES.RATE_LIMIT_EXCEEDED,
        "Too many authentication attempts, please try again later"
      ),
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => Helpers.getClientIP(req),
      handler: (req, res) => {
        logger.security("Authentication rate limit exceeded", {
          ip: Helpers.getClientIP(req),
          endpoint: req.path,
          method: req.method,
        });

        res
          .status(HTTP_STATUS.TOO_MANY_REQUESTS)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.RATE_LIMIT_EXCEEDED,
              "Too many authentication attempts, please try again in 15 minutes"
            )
          );
      },
    });
  }

  /**
   * API Key specific rate limiting based on key's rate limit setting
   */
  static async apiKeyRateLimit(req, res, next) {
    try {
      if (!req.apiKey) {
        return next();
      }

      const apiKey = req.apiKey;
      const currentTime = new Date();
      const windowStart = new Date(currentTime.getTime() - 60 * 60 * 1000); // 1 hour window

      const prisma = databaseConfig.getClient();

      // Count API calls in the current window
      const callCount = await prisma.usageRecord.count({
        where: {
          instanceId: apiKey.instanceId,
          recordType: "API_CALLS",
          recordDate: {
            gte: windowStart,
          },
        },
      });

      if (callCount >= apiKey.rateLimit) {
        logger.security("API key rate limit exceeded", {
          apiKeyId: apiKey.id,
          instanceId: apiKey.instanceId,
          currentCalls: callCount,
          limit: apiKey.rateLimit,
          ip: Helpers.getClientIP(req),
        });

        // Log audit event
        await RateLimitMiddleware.logAuditEvent(
          AUDIT_ACTIONS.RATE_LIMIT_EXCEEDED,
          "api_key",
          apiKey.id,
          req
        );

        return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json(
          Helpers.createErrorResponse(
            ERROR_CODES.RATE_LIMIT_EXCEEDED,
            "API key rate limit exceeded",
            {
              limit: apiKey.rateLimit,
              used: callCount,
              resetAt: new Date(
                currentTime.getTime() + 60 * 60 * 1000
              ).toISOString(),
              retryAfter: 3600, // 1 hour in seconds
            }
          )
        );
      }

      // Record this API call
      await RateLimitMiddleware.recordApiCall(apiKey, req);

      // Add rate limit headers
      res.set({
        "X-RateLimit-Limit": apiKey.rateLimit.toString(),
        "X-RateLimit-Remaining": Math.max(
          0,
          apiKey.rateLimit - callCount - 1
        ).toString(),
        "X-RateLimit-Reset": Math.ceil(
          (currentTime.getTime() + 60 * 60 * 1000) / 1000
        ).toString(),
      });

      next();
    } catch (error) {
      logger.error("API key rate limiting error:", error);
      // Don't block the request on rate limiting errors
      next();
    }
  }

  /**
   * Subscription-based rate limiting
   */
  static async subscriptionRateLimit(req, res, next) {
    try {
      if (!req.subscription) {
        return next();
      }

      const subscription = req.subscription;
      const limits = config.subscriptionLimits[subscription.tier];

      if (!limits) {
        return next();
      }

      const currentTime = new Date();
      const monthStart = new Date(
        currentTime.getFullYear(),
        currentTime.getMonth(),
        1
      );

      const prisma = databaseConfig.getClient();

      // Count messages sent this month
      const messageCount = await prisma.usageRecord.aggregate({
        where: {
          subscriptionId: subscription.id,
          recordType: "MESSAGES_SENT",
          recordDate: {
            gte: monthStart,
          },
        },
        _sum: {
          count: true,
        },
      });

      const totalMessages = messageCount._sum.count || 0;

      if (totalMessages >= limits.monthlyMessages) {
        logger.security("Subscription message limit exceeded", {
          subscriptionId: subscription.id,
          tier: subscription.tier,
          currentMessages: totalMessages,
          limit: limits.monthlyMessages,
          ip: Helpers.getClientIP(req),
        });

        return res.status(HTTP_STATUS.TOO_MANY_REQUESTS).json(
          Helpers.createErrorResponse(
            ERROR_CODES.SUBSCRIPTION_LIMIT_EXCEEDED,
            "Monthly message limit exceeded for your subscription",
            {
              tier: subscription.tier,
              limit: limits.monthlyMessages,
              used: totalMessages,
              resetAt: new Date(
                currentTime.getFullYear(),
                currentTime.getMonth() + 1,
                1
              ).toISOString(),
            }
          )
        );
      }

      // Add subscription limit headers
      res.set({
        "X-Subscription-Limit": limits.monthlyMessages.toString(),
        "X-Subscription-Used": totalMessages.toString(),
        "X-Subscription-Remaining": Math.max(
          0,
          limits.monthlyMessages - totalMessages
        ).toString(),
      });

      next();
    } catch (error) {
      logger.error("Subscription rate limiting error:", error);
      // Don't block the request on rate limiting errors
      next();
    }
  }

  /**
   * Record API call for rate limiting
   */
  static async recordApiCall(apiKey, req) {
    try {
      const prisma = databaseConfig.getClient();
      const today = new Date().toISOString().split("T")[0];

      // Update or create usage record
      await prisma.usageRecord.upsert({
        where: {
          subscriptionId_instanceId_recordType_period: {
            subscriptionId: apiKey.instance.subscriptionId,
            instanceId: apiKey.instanceId,
            recordType: "API_CALLS",
            period: today,
          },
        },
        update: {
          count: { increment: 1 },
        },
        create: {
          subscriptionId: apiKey.instance.subscriptionId,
          instanceId: apiKey.instanceId,
          recordType: "API_CALLS",
          count: 1,
          period: today,
        },
      });

      // Update message stats for the instance
      await prisma.messageStat.upsert({
        where: {
          instanceId_date: {
            instanceId: apiKey.instanceId,
            date: today,
          },
        },
        update: {
          apiCalls: { increment: 1 },
        },
        create: {
          instanceId: apiKey.instanceId,
          date: today,
          apiCalls: 1,
        },
      });
    } catch (error) {
      logger.error("Failed to record API call:", error);
      // Don't throw error to avoid blocking the request
    }
  }

  /**
   * Log audit event
   */
  static async logAuditEvent(action, resource, resourceId, req) {
    try {
      const prisma = databaseConfig.getClient();

      await prisma.auditLog.create({
        data: {
          action,
          resource,
          resourceId,
          userId: req.user?.id,
          ipAddress: Helpers.getClientIP(req),
        },
      });
    } catch (error) {
      logger.error("Failed to log audit event:", error);
    }
  }

  /**
   * Create message sending rate limiter
   */
  static createMessageLimiter() {
    return rateLimit({
      windowMs: 60 * 1000, // 1 minute
      max: 60, // 60 messages per minute
      message: Helpers.createErrorResponse(
        ERROR_CODES.RATE_LIMIT_EXCEEDED,
        "Message sending rate limit exceeded"
      ),
      keyGenerator: (req) => {
        return req.apiKey?.id || req.user?.id || Helpers.getClientIP(req);
      },
      handler: (req, res) => {
        logger.security("Message sending rate limit exceeded", {
          ip: Helpers.getClientIP(req),
          userId: req.user?.id,
          apiKeyId: req.apiKey?.id,
          instanceId: req.instance?.id,
        });

        res
          .status(HTTP_STATUS.TOO_MANY_REQUESTS)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.RATE_LIMIT_EXCEEDED,
              "Message sending rate limit exceeded. Maximum 60 messages per minute."
            )
          );
      },
    });
  }

  /**
   * Create instance management rate limiter
   */
  static createInstanceManagementLimiter() {
    return rateLimit({
      windowMs: 15 * 60 * 1000, // 15 minutes
      max: 50, // 50 requests per window
      message: Helpers.createErrorResponse(
        ERROR_CODES.RATE_LIMIT_EXCEEDED,
        "Too many instance management requests, please try again later"
      ),
      keyGenerator: (req) => {
        return req.user?.id || Helpers.getClientIP(req);
      },
      handler: (req, res) => {
        logger.security("Instance management rate limit exceeded", {
          ip: Helpers.getClientIP(req),
          userId: req.user?.id,
          endpoint: req.path,
          method: req.method,
        });

        res
          .status(HTTP_STATUS.TOO_MANY_REQUESTS)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.RATE_LIMIT_EXCEEDED,
              "Too many instance management requests. Please try again later."
            )
          );
      },
    });
  }

  /**
   * Create instance actions rate limiter (connect/disconnect/restart)
   */
  static createInstanceActionsLimiter() {
    return rateLimit({
      windowMs: 5 * 60 * 1000, // 5 minutes
      max: 10, // 10 actions per window
      message: Helpers.createErrorResponse(
        ERROR_CODES.RATE_LIMIT_EXCEEDED,
        "Too many instance actions, please wait before trying again"
      ),
      keyGenerator: (req) => {
        return req.user?.id || Helpers.getClientIP(req);
      },
      handler: (req, res) => {
        logger.security("Instance actions rate limit exceeded", {
          ip: Helpers.getClientIP(req),
          userId: req.user?.id,
          instanceName: req.params?.name,
          action: req.path.split("/").pop(),
          endpoint: req.path,
          method: req.method,
        });

        res
          .status(HTTP_STATUS.TOO_MANY_REQUESTS)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.RATE_LIMIT_EXCEEDED,
              "Too many instance actions. Please wait before trying again."
            )
          );
      },
    });
  }

  // Static instances for easy access
  static basic = RateLimitMiddleware.createBasicLimiter();
  static auth = RateLimitMiddleware.createAuthLimiter();
  static message = RateLimitMiddleware.createMessageLimiter();
  static instanceManagement =
    RateLimitMiddleware.createInstanceManagementLimiter();
  static instanceActions = RateLimitMiddleware.createInstanceActionsLimiter();
}

export default RateLimitMiddleware;
