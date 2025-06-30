import databaseConfig from "../config/database.js";
import config from "../config/environment.js";
import logger from "../utils/logger.js";
import Helpers from "../utils/helpers.js";
import {
  HTTP_STATUS,
  ERROR_CODES,
  USER_ROLES,
  AUDIT_ACTIONS,
} from "../utils/constants.js";

class AuthController {
  /**
   * User registration
   * Creates new user with Basic subscription
   */
  static async register(req, res) {
    try {
      const { email, password, name } = req.body;
      const prisma = databaseConfig.getClient();

      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email: email.toLowerCase() },
      });

      if (existingUser) {
        return res
          .status(HTTP_STATUS.CONFLICT)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.RESOURCE_ALREADY_EXISTS,
              "User with this email already exists"
            )
          );
      }

      // Hash password
      const hashedPassword = await Helpers.hashPassword(password);

      // Create subscription and user in a transaction
      const result = await prisma.$transaction(async (tx) => {
        // Create subscription
        const subscription = await tx.subscription.create({
          data: {
            name: Helpers.generateSubscriptionName(name),
            tier: config.defaults.subscriptionTier,
            maxInstances:
              config.subscriptionLimits[config.defaults.subscriptionTier]
                .maxInstances,
          },
        });

        // Create user as administrator of their subscription
        const user = await tx.user.create({
          data: {
            email: email.toLowerCase(),
            password: hashedPassword,
            name: Helpers.sanitizeInput(name),
            role: USER_ROLES.ADMINISTRATOR, // First user is admin
            subscriptionId: subscription.id,
          },
          include: {
            subscription: true,
          },
        });

        return { user, subscription };
      });

      // Generate JWT token
      const token = Helpers.generateJWT({
        userId: result.user.id,
        email: result.user.email,
        role: result.user.role,
        subscriptionId: result.user.subscriptionId,
      });

      // Log successful registration
      logger.auth("User registered successfully", {
        userId: result.user.id,
        email: result.user.email,
        subscriptionId: result.subscription.id,
        ip: Helpers.getClientIP(req),
      });

      // Log audit event
      await AuthController.logAuditEvent(
        AUDIT_ACTIONS.USER_CREATED,
        "user",
        result.user.id,
        req,
        result.user.id
      );

      // Return user data without password
      const { password: _, ...userWithoutPassword } = result.user;

      res.status(HTTP_STATUS.CREATED).json(
        Helpers.createResponse(
          true,
          {
            user: userWithoutPassword,
            subscription: result.subscription,
            token,
          },
          {
            request_id: Helpers.generateRequestId(),
          }
        )
      );
    } catch (error) {
      logger.error("Registration error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Registration failed"
          )
        );
    }
  }

  /**
   * User login
   */
  static async login(req, res) {
    try {
      const { email, password } = req.body;
      const prisma = databaseConfig.getClient();

      // Find user with subscription
      const user = await prisma.user.findUnique({
        where: {
          email: email.toLowerCase(),
          isActive: true,
        },
        include: {
          subscription: true,
        },
      });

      if (!user) {
        logger.security("Login attempt with non-existent email", {
          email: email.toLowerCase(),
          ip: Helpers.getClientIP(req),
        });

        return res
          .status(HTTP_STATUS.UNAUTHORIZED)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.INVALID_CREDENTIALS,
              "Invalid email or password"
            )
          );
      }

      // Check password
      const isPasswordValid = await Helpers.comparePassword(
        password,
        user.password
      );

      if (!isPasswordValid) {
        logger.security("Login attempt with invalid password", {
          userId: user.id,
          email: user.email,
          ip: Helpers.getClientIP(req),
        });

        return res
          .status(HTTP_STATUS.UNAUTHORIZED)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.INVALID_CREDENTIALS,
              "Invalid email or password"
            )
          );
      }

      // Check if subscription is active
      if (!user.subscription.isActive) {
        logger.security("Login attempt with inactive subscription", {
          userId: user.id,
          subscriptionId: user.subscriptionId,
          ip: Helpers.getClientIP(req),
        });

        return res
          .status(HTTP_STATUS.FORBIDDEN)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.SUBSCRIPTION_INACTIVE,
              "Your subscription is inactive. Please contact support."
            )
          );
      }

      // Update last login time
      await prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });

      // Generate JWT token
      const token = Helpers.generateJWT({
        userId: user.id,
        email: user.email,
        role: user.role,
        subscriptionId: user.subscriptionId,
      });

      // Log successful login
      logger.auth("User logged in successfully", {
        userId: user.id,
        email: user.email,
        role: user.role,
        ip: Helpers.getClientIP(req),
      });

      // Log audit event
      await AuthController.logAuditEvent(
        AUDIT_ACTIONS.USER_LOGIN,
        "user",
        user.id,
        req,
        user.id
      );

      // Return user data without password
      const { password: _, ...userWithoutPassword } = user;

      res.status(HTTP_STATUS.OK).json(
        Helpers.createResponse(
          true,
          {
            user: userWithoutPassword,
            subscription: user.subscription,
            token,
          },
          {
            request_id: Helpers.generateRequestId(),
          }
        )
      );
    } catch (error) {
      logger.error("Login error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Login failed"
          )
        );
    }
  }

  /**
   * Get current user info
   */
  static async me(req, res) {
    try {
      const user = req.user;
      const { password: _, ...userWithoutPassword } = user;

      res.status(HTTP_STATUS.OK).json(
        Helpers.createResponse(
          true,
          {
            user: userWithoutPassword,
            subscription: user.subscription,
          },
          {
            request_id: Helpers.generateRequestId(),
          }
        )
      );
    } catch (error) {
      logger.error("Get user info error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to get user information"
          )
        );
    }
  }

  /**
   * Change password
   */
  static async changePassword(req, res) {
    try {
      const { currentPassword, newPassword } = req.body;
      const user = req.user;
      const prisma = databaseConfig.getClient();

      // Verify current password
      const isCurrentPasswordValid = await Helpers.comparePassword(
        currentPassword,
        user.password
      );

      if (!isCurrentPasswordValid) {
        logger.security(
          "Password change attempt with invalid current password",
          {
            userId: user.id,
            ip: Helpers.getClientIP(req),
          }
        );

        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.INVALID_CREDENTIALS,
              "Current password is incorrect"
            )
          );
      }

      // Hash new password
      const hashedNewPassword = await Helpers.hashPassword(newPassword);

      // Update password
      await prisma.user.update({
        where: { id: user.id },
        data: { password: hashedNewPassword },
      });

      // Log password change
      logger.auth("Password changed successfully", {
        userId: user.id,
        ip: Helpers.getClientIP(req),
      });

      // Log audit event
      await AuthController.logAuditEvent(
        AUDIT_ACTIONS.PASSWORD_CHANGED,
        "user",
        user.id,
        req,
        user.id
      );

      res.status(HTTP_STATUS.OK).json(
        Helpers.createResponse(
          true,
          {
            message: "Password changed successfully",
          },
          {
            request_id: Helpers.generateRequestId(),
          }
        )
      );
    } catch (error) {
      logger.error("Change password error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to change password"
          )
        );
    }
  }

  /**
   * Refresh JWT token
   */
  static async refresh(req, res) {
    try {
      const user = req.user;

      // Generate new JWT token
      const token = Helpers.generateJWT({
        userId: user.id,
        email: user.email,
        role: user.role,
        subscriptionId: user.subscriptionId,
      });

      logger.auth("Token refreshed successfully", {
        userId: user.id,
        ip: Helpers.getClientIP(req),
      });

      res.status(HTTP_STATUS.OK).json(
        Helpers.createResponse(
          true,
          {
            token,
          },
          {
            request_id: Helpers.generateRequestId(),
          }
        )
      );
    } catch (error) {
      logger.error("Token refresh error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to refresh token"
          )
        );
    }
  }

  /**
   * Logout (optional - mainly for audit logging)
   */
  static async logout(req, res) {
    try {
      const user = req.user;

      // Log logout
      logger.auth("User logged out", {
        userId: user.id,
        ip: Helpers.getClientIP(req),
      });

      // Log audit event
      await AuthController.logAuditEvent(
        AUDIT_ACTIONS.USER_LOGOUT,
        "user",
        user.id,
        req,
        user.id
      );

      res.status(HTTP_STATUS.OK).json(
        Helpers.createResponse(
          true,
          {
            message: "Logged out successfully",
          },
          {
            request_id: Helpers.generateRequestId(),
          }
        )
      );
    } catch (error) {
      logger.error("Logout error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Logout failed"
          )
        );
    }
  }

  /**
   * Log audit event helper
   */
  static async logAuditEvent(action, resource, resourceId, req, userId = null) {
    try {
      const prisma = databaseConfig.getClient();

      await prisma.auditLog.create({
        data: {
          action,
          resource,
          resourceId,
          userId: userId || req.user?.id,
          ipAddress: Helpers.getClientIP(req),
        },
      });
    } catch (error) {
      logger.error("Failed to log audit event:", error);
    }
  }
}

export default AuthController;
