import jwt from "jsonwebtoken";
import crypto from "crypto";
import databaseConfig from "../config/database.js";
import config from "../config/environment.js";
import logger from "../utils/logger.js";
import Helpers from "../utils/helpers.js";
import { HTTP_STATUS, ERROR_CODES } from "../utils/constants.js";

class AuthMiddleware {
  /**
   * Unified authentication middleware - handles both JWT and API keys
   * Uses Bearer token format for both authentication methods
   */
  static async authenticateRequest(req, res, next) {
    try {
      const authHeader = req.headers.authorization;

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res
          .status(HTTP_STATUS.UNAUTHORIZED)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.AUTHENTICATION_ERROR,
              "Authorization required. Format: Bearer <token>"
            )
          );
      }

      const token = authHeader.substring(7); // Remove "Bearer "

      // Auto-detect token type and authenticate accordingly
      if (Helpers.isJWTToken(token)) {
        return await AuthMiddleware.authenticateJWT(token, req, res, next);
      } else {
        return await AuthMiddleware.authenticateApiKey(token, req, res, next);
      }
    } catch (error) {
      logger.error("Authentication middleware error:", error);
      return res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Authentication failed"
          )
        );
    }
  }

  /**
   * Authenticate JWT token for management APIs
   */
  static async authenticateJWT(token, req, res, next) {
    try {
      // Verify JWT token
      const decoded = Helpers.verifyJWT(token);

      const prisma = databaseConfig.getClient();

      // Get user with subscription info
      const user = await prisma.user.findUnique({
        where: {
          id: decoded.userId,
          isActive: true,
        },
        include: {
          subscription: true,
        },
      });

      if (!user) {
        logger.security("JWT authentication failed - user not found", {
          userId: decoded.userId,
          ip: Helpers.getClientIP(req),
        });

        return res
          .status(HTTP_STATUS.UNAUTHORIZED)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.AUTHENTICATION_ERROR,
              "Invalid token - user not found"
            )
          );
      }

      if (!user.subscription.isActive) {
        logger.security("JWT authentication failed - subscription inactive", {
          userId: user.id,
          subscriptionId: user.subscriptionId,
          ip: Helpers.getClientIP(req),
        });

        return res
          .status(HTTP_STATUS.FORBIDDEN)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.SUBSCRIPTION_INACTIVE,
              "Subscription is inactive"
            )
          );
      }

      // Update last login time
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      // Attach user and subscription to request
      req.user = user;
      req.subscription = user.subscription;
      req.authType = "jwt";

      // logger.auth("JWT authentication successful", {
      //   userId: user.id,
      //   email: user.email,
      //   role: user.role,
      //   ip: Helpers.getClientIP(req),
      // });

      next();
    } catch (error) {
      if (error.name === "TokenExpiredError") {
        logger.security("JWT token expired", {
          ip: Helpers.getClientIP(req),
        });

        return res
          .status(HTTP_STATUS.UNAUTHORIZED)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.TOKEN_EXPIRED,
              "Token has expired"
            )
          );
      }

      if (error.name === "JsonWebTokenError") {
        logger.security("Invalid JWT token", {
          ip: Helpers.getClientIP(req),
        });

        return res
          .status(HTTP_STATUS.UNAUTHORIZED)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.TOKEN_INVALID,
              "Invalid token"
            )
          );
      }

      logger.error("JWT authentication error:", error);
      return res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Authentication failed"
          )
        );
    }
  }

  /**
   * Authenticate API key for integration APIs
   */
  static async authenticateApiKey(apiKey, req, res, next) {
    try {
      const keyHash = Helpers.hashApiKey(apiKey);
      const prisma = databaseConfig.getClient();

      // Find API key with instance and subscription info
      const keyRecord = await prisma.apiKey.findUnique({
        where: {
          keyHash,
          isActive: true,
        },
        include: {
          instance: {
            include: {
              subscription: true,
              createdBy: true,
            },
          },
        },
      });

      if (!keyRecord) {
        logger.security("API key authentication failed - key not found", {
          keyHash: keyHash.substring(0, 8) + "...",
          ip: Helpers.getClientIP(req),
        });

        return res
          .status(HTTP_STATUS.UNAUTHORIZED)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.API_KEY_INVALID,
              "Invalid API key"
            )
          );
      }

      // Check if API key has expired
      if (keyRecord.expiresAt && keyRecord.expiresAt < new Date()) {
        logger.security("API key authentication failed - key expired", {
          keyId: keyRecord.id,
          expiresAt: keyRecord.expiresAt,
          ip: Helpers.getClientIP(req),
        });

        return res
          .status(HTTP_STATUS.UNAUTHORIZED)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.API_KEY_EXPIRED,
              "API key has expired"
            )
          );
      }

      // Check if instance is active
      if (!keyRecord.instance.isActive) {
        return res
          .status(HTTP_STATUS.FORBIDDEN)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.INSTANCE_NOT_FOUND,
              "Instance is not active"
            )
          );
      }

      // Check if subscription is active
      if (!keyRecord.instance.subscription.isActive) {
        return res
          .status(HTTP_STATUS.FORBIDDEN)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.SUBSCRIPTION_INACTIVE,
              "Subscription is inactive"
            )
          );
      }

      // Update API key usage
      await prisma.apiKey.update({
        where: { id: keyRecord.id },
        data: {
          lastUsedAt: new Date(),
          usageCount: { increment: 1 },
        },
      });

      // Attach context to request - this is the key feature!
      req.apiKey = keyRecord;
      req.instance = keyRecord.instance; // Auto-available instance context
      req.subscription = keyRecord.instance.subscription;
      req.user = keyRecord.instance.createdBy;
      req.authType = "api_key";

      logger.auth("API key authentication successful", {
        keyId: keyRecord.id,
        keyName: keyRecord.name,
        instanceId: keyRecord.instance.id,
        instanceName: keyRecord.instance.name,
        ip: Helpers.getClientIP(req),
      });

      next();
    } catch (error) {
      logger.error("API key authentication error:", error);
      return res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Authentication failed"
          )
        );
    }
  }

  /**
   * Require specific user role
   */
  static requireRole(roles) {
    return (req, res, next) => {
      if (!req.user) {
        return res
          .status(HTTP_STATUS.UNAUTHORIZED)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.AUTHENTICATION_ERROR,
              "Authentication required"
            )
          );
      }

      const userRoles = Array.isArray(roles) ? roles : [roles];

      if (!userRoles.includes(req.user.role)) {
        logger.security("Role authorization failed", {
          userId: req.user.id,
          userRole: req.user.role,
          requiredRoles: userRoles,
          ip: Helpers.getClientIP(req),
        });

        return res
          .status(HTTP_STATUS.FORBIDDEN)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.PERMISSION_DENIED,
              "Insufficient permissions"
            )
          );
      }

      next();
    };
  }

  /**
   * Require specific API permissions
   */
  static requirePermission(permission) {
    return (req, res, next) => {
      if (!req.apiKey) {
        return res
          .status(HTTP_STATUS.UNAUTHORIZED)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.AUTHENTICATION_ERROR,
              "API key authentication required"
            )
          );
      }

      const permissions = Helpers.safeJSONParse(req.apiKey.permissions, []);

      if (!permissions.includes(permission)) {
        logger.security("Permission denied", {
          keyId: req.apiKey.id,
          requiredPermission: permission,
          availablePermissions: permissions,
          ip: Helpers.getClientIP(req),
        });

        return res
          .status(HTTP_STATUS.FORBIDDEN)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.PERMISSION_DENIED,
              `Permission required: ${permission}`
            )
          );
      }

      next();
    };
  }

  /**
   * Optional authentication - doesn't fail if no token provided
   */
  static async optionalAuth(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return next();
    }

    // If auth header is present, authenticate normally
    return AuthMiddleware.authenticateRequest(req, res, next);
  }
}

export default AuthMiddleware;
