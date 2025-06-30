import instanceService from "../services/instance.service.js";
import logger from "../utils/logger.js";
import Helpers from "../utils/helpers.js";
import { HTTP_STATUS, ERROR_CODES, AUDIT_ACTIONS } from "../utils/constants.js";
import databaseConfig from "../config/database.js";

class InstanceController {
  /**
   * Create new instance
   * @route POST /api/instances
   */
  static async createInstance(req, res) {
    try {
      const { name, settings = {} } = req.body;

      logger.info("Creating instance", {
        userId: req.user.id,
        subscriptionId: req.user.subscriptionId,
        instanceName: name,
      });

      const instance = await instanceService.createInstance(
        req.user.id,
        req.user.subscriptionId,
        { name, settings }
      );

      // Log audit event
      await InstanceController.logAuditEvent(
        AUDIT_ACTIONS.INSTANCE_CREATED,
        "instance",
        instance.id,
        req
      );

      logger.info("Instance created successfully", {
        instanceId: instance.id,
        instanceName: instance.name,
        userId: req.user.id,
        ip: Helpers.getClientIP(req),
      });

      res.status(HTTP_STATUS.CREATED).json(
        Helpers.createResponse(
          true,
          {
            instance: {
              id: instance.id,
              name: instance.name,
              status: instance.status,
              createdAt: instance.createdAt,
              subscription: instance.subscription,
              createdBy: instance.createdBy,
            },
          },
          {
            request_id: req.requestId,
          }
        )
      );
    } catch (error) {
      logger.error("Create instance error:", {
        error: error.message,
        userId: req.user?.id,
        body: req.body,
      });

      const statusCode = error.message.includes("limit reached")
        ? HTTP_STATUS.FORBIDDEN
        : error.message.includes("already exists")
        ? HTTP_STATUS.CONFLICT
        : HTTP_STATUS.INTERNAL_SERVER_ERROR;

      const errorCode = error.message.includes("limit reached")
        ? ERROR_CODES.INSTANCE_LIMIT_REACHED
        : error.message.includes("already exists")
        ? ERROR_CODES.INSTANCE_ALREADY_EXISTS
        : ERROR_CODES.INTERNAL_ERROR;

      res
        .status(statusCode)
        .json(Helpers.createErrorResponse(errorCode, error.message));
    }
  }

  /**
   * Get all instances for user's subscription
   * @route GET /api/instances
   */
  static async getInstances(req, res) {
    try {
      const {
        page = 1,
        per_page = 20,
        sort = "desc",
        sort_by = "createdAt",
        status,
        search,
      } = req.query;

      const result = await instanceService.getInstances(
        req.user.subscriptionId,
        { page, per_page, sort, sort_by, status, search }
      );

      res.status(HTTP_STATUS.OK).json(
        Helpers.createResponse(true, result, {
          request_id: req.requestId,
        })
      );
    } catch (error) {
      logger.error("Get instances error:", {
        error: error.message,
        userId: req.user?.id,
        query: req.query,
      });

      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to retrieve instances"
          )
        );
    }
  }

  /**
   * Get instance by name
   * @route GET /api/instances/:name
   */
  static async getInstanceByName(req, res) {
    try {
      const { name } = req.params;

      const instance = await instanceService.getInstanceByName(
        name,
        req.user.subscriptionId
      );

      res.status(HTTP_STATUS.OK).json(
        Helpers.createResponse(
          true,
          {
            instance,
          },
          {
            request_id: req.requestId,
          }
        )
      );
    } catch (error) {
      logger.error("Get instance by name error:", {
        error: error.message,
        instanceName: req.params.name,
        userId: req.user?.id,
      });

      const statusCode = error.message.includes("not found")
        ? HTTP_STATUS.NOT_FOUND
        : HTTP_STATUS.INTERNAL_SERVER_ERROR;

      const errorCode = error.message.includes("not found")
        ? ERROR_CODES.INSTANCE_NOT_FOUND
        : ERROR_CODES.INTERNAL_ERROR;

      res
        .status(statusCode)
        .json(Helpers.createErrorResponse(errorCode, error.message));
    }
  }

  /**
   * Get instance by ID
   * @route GET /api/instances/:id
   */
  static async getInstanceById(req, res) {
    try {
      const { id } = req.params;

      const instance = await instanceService.getInstanceById(
        id,
        req.user.subscriptionId
      );

      res.status(HTTP_STATUS.OK).json(
        Helpers.createResponse(
          true,
          {
            instance,
          },
          {
            request_id: req.requestId,
          }
        )
      );
    } catch (error) {
      logger.error("Get instance by ID error:", {
        error: error.message,
        instanceId: req.params.id,
        userId: req.user?.id,
      });

      const statusCode = error.message.includes("not found")
        ? HTTP_STATUS.NOT_FOUND
        : HTTP_STATUS.INTERNAL_SERVER_ERROR;

      const errorCode = error.message.includes("not found")
        ? ERROR_CODES.INSTANCE_NOT_FOUND
        : ERROR_CODES.INTERNAL_ERROR;

      res
        .status(statusCode)
        .json(Helpers.createErrorResponse(errorCode, error.message));
    }
  }

  /**
   * Update instance
   * @route PUT /api/instances/:id
   */
  static async updateInstance(req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      const updatedInstance = await instanceService.updateInstance(
        id,
        req.user.subscriptionId,
        updateData
      );

      // Log audit event
      await InstanceController.logAuditEvent(
        AUDIT_ACTIONS.INSTANCE_UPDATED,
        "instance",
        updatedInstance.id,
        req
      );

      logger.info("Instance updated", {
        instanceId: updatedInstance.id,
        instanceName: updatedInstance.name,
        userId: req.user.id,
        changes: updateData,
        ip: Helpers.getClientIP(req),
      });

      res.status(HTTP_STATUS.OK).json(
        Helpers.createResponse(
          true,
          {
            instance: updatedInstance,
          },
          {
            request_id: req.requestId,
          }
        )
      );
    } catch (error) {
      logger.error("Update instance error:", {
        error: error.message,
        instanceId: req.params.id,
        userId: req.user?.id,
        body: req.body,
      });

      const statusCode = error.message.includes("not found")
        ? HTTP_STATUS.NOT_FOUND
        : error.message.includes("already exists")
        ? HTTP_STATUS.CONFLICT
        : HTTP_STATUS.INTERNAL_SERVER_ERROR;

      const errorCode = error.message.includes("not found")
        ? ERROR_CODES.INSTANCE_NOT_FOUND
        : error.message.includes("already exists")
        ? ERROR_CODES.INSTANCE_ALREADY_EXISTS
        : ERROR_CODES.INTERNAL_ERROR;

      res
        .status(statusCode)
        .json(Helpers.createErrorResponse(errorCode, error.message));
    }
  }

  /**
   * Delete instance
   * @route DELETE /api/instances/:id
   */
  static async deleteInstance(req, res) {
    try {
      const { id } = req.params;

      const result = await instanceService.deleteInstance(
        id,
        req.user.subscriptionId
      );

      // Log audit event
      await InstanceController.logAuditEvent(
        AUDIT_ACTIONS.INSTANCE_DELETED,
        "instance",
        id,
        req
      );

      logger.info("Instance deleted", {
        instanceId: id,
        userId: req.user.id,
        ip: Helpers.getClientIP(req),
      });

      res.status(HTTP_STATUS.OK).json(
        Helpers.createResponse(true, result, {
          request_id: req.requestId,
        })
      );
    } catch (error) {
      logger.error("Delete instance error:", {
        error: error.message,
        instanceId: req.params.id,
        userId: req.user?.id,
      });

      const statusCode = error.message.includes("not found")
        ? HTTP_STATUS.NOT_FOUND
        : HTTP_STATUS.INTERNAL_SERVER_ERROR;

      const errorCode = error.message.includes("not found")
        ? ERROR_CODES.INSTANCE_NOT_FOUND
        : ERROR_CODES.INTERNAL_ERROR;

      res
        .status(statusCode)
        .json(Helpers.createErrorResponse(errorCode, error.message));
    }
  }

  /**
   * Get instance status
   * @route GET /api/instances/:id/status
   */
  static async getInstanceStatus(req, res) {
    try {
      const { id } = req.params;

      const status = await instanceService.getInstanceStatus(
        id,
        req.user.subscriptionId
      );

      res.status(HTTP_STATUS.OK).json(
        Helpers.createResponse(
          true,
          {
            status,
          },
          {
            request_id: req.requestId,
          }
        )
      );
    } catch (error) {
      logger.error("Get instance status error:", {
        error: error.message,
        instanceId: req.params.id,
        userId: req.user?.id,
      });

      const statusCode = error.message.includes("not found")
        ? HTTP_STATUS.NOT_FOUND
        : HTTP_STATUS.INTERNAL_SERVER_ERROR;

      const errorCode = error.message.includes("not found")
        ? ERROR_CODES.INSTANCE_NOT_FOUND
        : ERROR_CODES.INTERNAL_ERROR;

      res
        .status(statusCode)
        .json(Helpers.createErrorResponse(errorCode, error.message));
    }
  }

  /**
   * Connect instance
   * @route POST /api/instances/:id/connect
   */
  static async connectInstance(req, res) {
    try {
      const { id } = req.params;

      const result = await instanceService.connectInstance(
        id,
        req.user.subscriptionId
      );

      // Log audit event
      await InstanceController.logAuditEvent(
        AUDIT_ACTIONS.INSTANCE_CONNECTED,
        "instance",
        id,
        req
      );

      logger.info("Instance connection initiated", {
        instanceId: id,
        userId: req.user.id,
        ip: Helpers.getClientIP(req),
      });

      res.status(HTTP_STATUS.OK).json(
        Helpers.createResponse(true, result, {
          request_id: req.requestId,
        })
      );
    } catch (error) {
      logger.error("Connect instance error:", {
        error: error.message,
        instanceId: req.params.id,
        userId: req.user?.id,
      });

      const statusCode = error.message.includes("not found")
        ? HTTP_STATUS.NOT_FOUND
        : HTTP_STATUS.INTERNAL_SERVER_ERROR;

      const errorCode = error.message.includes("not found")
        ? ERROR_CODES.INSTANCE_NOT_FOUND
        : ERROR_CODES.INTERNAL_ERROR;

      res
        .status(statusCode)
        .json(Helpers.createErrorResponse(errorCode, error.message));
    }
  }

  /**
   * Disconnect instance
   * @route POST /api/instances/:id/disconnect
   */
  static async disconnectInstance(req, res) {
    try {
      const { id } = req.params;

      const result = await instanceService.disconnectInstance(
        id,
        req.user.subscriptionId
      );

      // Log audit event
      await InstanceController.logAuditEvent(
        AUDIT_ACTIONS.INSTANCE_DISCONNECTED,
        "instance",
        id,
        req
      );

      logger.info("Instance disconnected", {
        instanceId: id,
        userId: req.user.id,
        ip: Helpers.getClientIP(req),
      });

      res.status(HTTP_STATUS.OK).json(
        Helpers.createResponse(true, result, {
          request_id: req.requestId,
        })
      );
    } catch (error) {
      logger.error("Disconnect instance error:", {
        error: error.message,
        instanceId: req.params.id,
        userId: req.user?.id,
      });

      const statusCode = error.message.includes("not found")
        ? HTTP_STATUS.NOT_FOUND
        : HTTP_STATUS.INTERNAL_SERVER_ERROR;

      const errorCode = error.message.includes("not found")
        ? ERROR_CODES.INSTANCE_NOT_FOUND
        : ERROR_CODES.INTERNAL_ERROR;

      res
        .status(statusCode)
        .json(Helpers.createErrorResponse(errorCode, error.message));
    }
  }

  /**
   * Restart instance
   * @route POST /api/instances/:id/restart
   */
  static async restartInstance(req, res) {
    try {
      const { id } = req.params;

      const result = await instanceService.restartInstance(
        id,
        req.user.subscriptionId
      );

      // Log audit event
      await InstanceController.logAuditEvent(
        AUDIT_ACTIONS.INSTANCE_RESTARTED,
        "instance",
        id,
        req
      );

      logger.info("Instance restarted", {
        instanceId: id,
        userId: req.user.id,
        ip: Helpers.getClientIP(req),
      });

      res.status(HTTP_STATUS.OK).json(
        Helpers.createResponse(true, result, {
          request_id: req.requestId,
        })
      );
    } catch (error) {
      logger.error("Restart instance error:", {
        error: error.message,
        instanceId: req.params.id,
        userId: req.user?.id,
      });

      const statusCode = error.message.includes("not found")
        ? HTTP_STATUS.NOT_FOUND
        : HTTP_STATUS.INTERNAL_SERVER_ERROR;

      const errorCode = error.message.includes("not found")
        ? ERROR_CODES.INSTANCE_NOT_FOUND
        : ERROR_CODES.INTERNAL_ERROR;

      res
        .status(statusCode)
        .json(Helpers.createErrorResponse(errorCode, error.message));
    }
  }

  /**
   * Get instance QR code
   * @route GET /api/instances/:id/qr
   */
  static async getInstanceQR(req, res) {
    try {
      const { id } = req.params;

      const result = await instanceService.getInstanceQR(
        id,
        req.user.subscriptionId
      );

      res.status(HTTP_STATUS.OK).json(
        Helpers.createResponse(true, result, {
          request_id: req.requestId,
        })
      );
    } catch (error) {
      logger.error("Get instance QR error:", {
        error: error.message,
        instanceId: req.params.id,
        userId: req.user?.id,
      });

      const statusCode = error.message.includes("not found")
        ? HTTP_STATUS.NOT_FOUND
        : HTTP_STATUS.INTERNAL_SERVER_ERROR;

      const errorCode = error.message.includes("not found")
        ? ERROR_CODES.INSTANCE_NOT_FOUND
        : ERROR_CODES.INTERNAL_ERROR;

      res
        .status(statusCode)
        .json(Helpers.createErrorResponse(errorCode, error.message));
    }
  }

  /**
   * Get subscription usage
   * @route GET /api/instances/subscription/usage
   */
  static async getSubscriptionUsage(req, res) {
    try {
      const usage = await instanceService.getSubscriptionUsage(
        req.user.subscriptionId
      );

      res.status(HTTP_STATUS.OK).json(
        Helpers.createResponse(
          true,
          {
            usage,
          },
          {
            request_id: req.requestId,
          }
        )
      );
    } catch (error) {
      logger.error("Get subscription usage error:", {
        error: error.message,
        userId: req.user?.id,
        subscriptionId: req.user?.subscriptionId,
      });

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
   * Log audit event for instance management actions
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

export default InstanceController;
