import bcrypt from "bcryptjs";
import databaseConfig from "../config/database.js";
import config from "../config/environment.js";
import logger from "../utils/logger.js";
import Helpers from "../utils/helpers.js";
import { HTTP_STATUS, ERROR_CODES, AUDIT_ACTIONS } from "../utils/constants.js";

class UserController {
  /**
   * Create new user (Admin only)
   * @route POST /api/users
   */
  static async createUser(req, res) {
    try {
      const { email, password, name, role = "USER" } = req.body;
      const prisma = databaseConfig.getClient();

      // Check if user already exists
      const existingUser = await prisma.user.findUnique({
        where: { email },
      });

      if (existingUser) {
        return res
          .status(HTTP_STATUS.CONFLICT)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.USER_ALREADY_EXISTS,
              "User with this email already exists"
            )
          );
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(
        password,
        config.security.bcryptRounds
      );

      // Create user with the same subscription as the admin
      const newUser = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          name,
          role,
          subscriptionId: req.user.subscriptionId, // Same subscription as admin
        },
        include: {
          subscription: true,
        },
      });

      // Log audit event
      await UserController.logAuditEvent(
        AUDIT_ACTIONS.USER_CREATED,
        "user",
        newUser.id,
        req
      );

      logger.info("User created by admin", {
        adminId: req.user.id,
        adminEmail: req.user.email,
        newUserId: newUser.id,
        newUserEmail: newUser.email,
        newUserRole: newUser.role,
        ip: Helpers.getClientIP(req),
      });

      // Remove password from response
      const { password: _, ...userResponse } = newUser;

      res.status(HTTP_STATUS.CREATED).json(
        Helpers.createResponse(
          true,
          {
            user: userResponse,
          },
          {
            request_id: req.requestId,
          }
        )
      );
    } catch (error) {
      logger.error("Create user error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to create user"
          )
        );
    }
  }

  /**
   * Get all users in subscription (Admin only)
   * @route GET /api/users
   */
  static async getUsers(req, res) {
    try {
      const {
        page = 1,
        per_page = 20,
        sort = "desc",
        sort_by = "createdAt",
      } = req.query;
      const prisma = databaseConfig.getClient();

      const skip = (page - 1) * per_page;

      // Get users in the same subscription
      const [users, totalCount] = await Promise.all([
        prisma.user.findMany({
          where: {
            subscriptionId: req.user.subscriptionId,
          },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
            isActive: true,
            createdAt: true,
            lastLoginAt: true,
            _count: {
              select: {
                instances: true,
              },
            },
          },
          orderBy: {
            [sort_by]: sort,
          },
          skip,
          take: parseInt(per_page),
        }),
        prisma.user.count({
          where: {
            subscriptionId: req.user.subscriptionId,
          },
        }),
      ]);

      const totalPages = Math.ceil(totalCount / per_page);

      res.status(HTTP_STATUS.OK).json(
        Helpers.createResponse(
          true,
          {
            users,
            pagination: {
              page: parseInt(page),
              per_page: parseInt(per_page),
              total: totalCount,
              total_pages: totalPages,
              has_next: page < totalPages,
              has_prev: page > 1,
            },
          },
          {
            request_id: req.requestId,
          }
        )
      );
    } catch (error) {
      logger.error("Get users error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to retrieve users"
          )
        );
    }
  }

  /**
   * Get user by ID (Admin only)
   * @route GET /api/users/:id
   */
  static async getUserById(req, res) {
    try {
      const { id } = req.params;
      const prisma = databaseConfig.getClient();

      const user = await prisma.user.findFirst({
        where: {
          id,
          subscriptionId: req.user.subscriptionId, // Only users in same subscription
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
          lastLoginAt: true,
          subscription: {
            select: {
              id: true,
              name: true,
              tier: true,
            },
          },
          instances: {
            select: {
              id: true,
              name: true,
              status: true,
              createdAt: true,
            },
          },
          _count: {
            select: {
              instances: true,
            },
          },
        },
      });

      if (!user) {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.USER_NOT_FOUND,
              "User not found"
            )
          );
      }

      res.status(HTTP_STATUS.OK).json(
        Helpers.createResponse(
          true,
          {
            user,
          },
          {
            request_id: req.requestId,
          }
        )
      );
    } catch (error) {
      logger.error("Get user by ID error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to retrieve user"
          )
        );
    }
  }

  /**
   * Update user (Admin only)
   * @route PUT /api/users/:id
   */
  static async updateUser(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;
      const prisma = databaseConfig.getClient();

      // Check if user exists and belongs to same subscription
      const existingUser = await prisma.user.findFirst({
        where: {
          id,
          subscriptionId: req.user.subscriptionId,
        },
      });

      if (!existingUser) {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.USER_NOT_FOUND,
              "User not found"
            )
          );
      }

      // Prevent admin from demoting themselves
      if (
        id === req.user.id &&
        updateData.role &&
        updateData.role !== "ADMINISTRATOR"
      ) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.INVALID_OPERATION,
              "Cannot change your own role"
            )
          );
      }

      // Prevent admin from deactivating themselves
      if (id === req.user.id && updateData.isActive === false) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.INVALID_OPERATION,
              "Cannot deactivate your own account"
            )
          );
      }

      // Check if email is being changed and if it's already taken
      if (updateData.email && updateData.email !== existingUser.email) {
        const emailExists = await prisma.user.findUnique({
          where: { email: updateData.email },
        });

        if (emailExists) {
          return res
            .status(HTTP_STATUS.CONFLICT)
            .json(
              Helpers.createErrorResponse(
                ERROR_CODES.USER_ALREADY_EXISTS,
                "Email is already taken"
              )
            );
        }
      }

      // Update user
      const updatedUser = await prisma.user.update({
        where: { id },
        data: updateData,
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          isActive: true,
          createdAt: true,
          lastLoginAt: true,
          subscription: {
            select: {
              id: true,
              name: true,
              tier: true,
            },
          },
        },
      });

      // Log audit event
      await UserController.logAuditEvent(
        AUDIT_ACTIONS.USER_UPDATED,
        "user",
        updatedUser.id,
        req
      );

      logger.info("User updated by admin", {
        adminId: req.user.id,
        adminEmail: req.user.email,
        updatedUserId: updatedUser.id,
        updatedUserEmail: updatedUser.email,
        changes: updateData,
        ip: Helpers.getClientIP(req),
      });

      res.status(HTTP_STATUS.OK).json(
        Helpers.createResponse(
          true,
          {
            user: updatedUser,
          },
          {
            request_id: req.requestId,
          }
        )
      );
    } catch (error) {
      logger.error("Update user error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to update user"
          )
        );
    }
  }

  /**
   * Delete user (Admin only)
   * @route DELETE /api/users/:id
   */
  static async deleteUser(req, res) {
    try {
      const { id } = req.params;
      const prisma = databaseConfig.getClient();

      // Check if user exists and belongs to same subscription
      const existingUser = await prisma.user.findFirst({
        where: {
          id,
          subscriptionId: req.user.subscriptionId,
        },
        include: {
          instances: true,
        },
      });

      if (!existingUser) {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.USER_NOT_FOUND,
              "User not found"
            )
          );
      }

      // Prevent admin from deleting themselves
      if (id === req.user.id) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.INVALID_OPERATION,
              "Cannot delete your own account"
            )
          );
      }

      // Check if user has active instances
      if (existingUser.instances.length > 0) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.USER_HAS_DEPENDENCIES,
              `Cannot delete user with ${existingUser.instances.length} active instances. Please delete instances first.`
            )
          );
      }

      // Delete user
      await prisma.user.delete({
        where: { id },
      });

      // Log audit event
      await UserController.logAuditEvent(
        AUDIT_ACTIONS.USER_DELETED,
        "user",
        id,
        req
      );

      logger.info("User deleted by admin", {
        adminId: req.user.id,
        adminEmail: req.user.email,
        deletedUserId: id,
        deletedUserEmail: existingUser.email,
        ip: Helpers.getClientIP(req),
      });

      res.status(HTTP_STATUS.OK).json(
        Helpers.createResponse(
          true,
          {
            message: "User deleted successfully",
          },
          {
            request_id: req.requestId,
          }
        )
      );
    } catch (error) {
      logger.error("Delete user error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to delete user"
          )
        );
    }
  }

  /**
   * Get subscription usage statistics (Admin only)
   * @route GET /api/users/subscription/usage
   */
  static async getSubscriptionUsage(req, res) {
    try {
      const prisma = databaseConfig.getClient();

      const subscription = await prisma.subscription.findUnique({
        where: { id: req.user.subscriptionId },
        include: {
          users: {
            select: {
              id: true,
              email: true,
              name: true,
              role: true,
              isActive: true,
              _count: {
                select: {
                  instances: true,
                },
              },
            },
          },
          instances: {
            select: {
              id: true,
              name: true,
              status: true,
              createdBy: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
          _count: {
            select: {
              users: true,
              instances: true,
            },
          },
        },
      });

      if (!subscription) {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.SUBSCRIPTION_NOT_FOUND,
              "Subscription not found"
            )
          );
      }

      // Get usage statistics
      const currentMonth = new Date();
      currentMonth.setDate(1);
      currentMonth.setHours(0, 0, 0, 0);

      const monthlyUsage = await prisma.usageRecord.aggregate({
        where: {
          subscriptionId: subscription.id,
          recordType: "MESSAGES_SENT",
          recordDate: {
            gte: currentMonth,
          },
        },
        _sum: {
          count: true,
        },
      });

      const limits = config.subscriptionLimits[subscription.tier];

      res.status(HTTP_STATUS.OK).json(
        Helpers.createResponse(
          true,
          {
            subscription: {
              id: subscription.id,
              name: subscription.name,
              tier: subscription.tier,
              isActive: subscription.isActive,
              limits: {
                maxInstances: limits?.maxInstances || subscription.maxInstances,
                monthlyMessages: limits?.monthlyMessages || 0,
              },
              usage: {
                currentInstances: subscription._count.instances,
                currentUsers: subscription._count.users,
                monthlyMessages: monthlyUsage._sum.count || 0,
              },
              users: subscription.users,
              instances: subscription.instances,
            },
          },
          {
            request_id: req.requestId,
          }
        )
      );
    } catch (error) {
      logger.error("Get subscription usage error:", error);
      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to retrieve subscription usage"
          )
        );
    }
  }

  /**
   * Log audit event for user management actions
   * @param {string} action - The action performed
   * @param {string} resource - Type of resource
   * @param {string} resourceId - ID of the resource
   * @param {Object} req - Express request object
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
      logger.error("Failed to log audit event:", {
        error: error.message,
        action,
        resource,
        resourceId,
        userId: req.user?.id,
      });
    }
  }
}

export default UserController;
