import databaseConfig from "../config/database.js";
import logger from "../utils/logger.js";
import Helpers from "../utils/helpers.js";
import { HTTP_STATUS, ERROR_CODES } from "../utils/constants.js";
import crypto from "crypto";

class WebhookController {
  /**
   * Configure webhook for an instance (Management API)
   * POST /api/instances/:id/webhook
   */
  static async configureWebhook(req, res) {
    try {
      const { id: instanceId } = req.params;
      const { url, events = [], secret } = req.body;

      // Validate input
      if (!url) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.VALIDATION_ERROR,
              "Webhook URL is required"
            )
          );
      }

      // Validate URL format
      try {
        new URL(url);
      } catch (error) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.VALIDATION_ERROR,
              "Invalid webhook URL format"
            )
          );
      }

      const prisma = databaseConfig.getClient();

      // Verify instance exists and user has access
      const instance = await prisma.instance.findFirst({
        where: {
          id: instanceId,
          subscriptionId: req.subscription.id,
        },
      });

      if (!instance) {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.INSTANCE_NOT_FOUND,
              "Instance not found"
            )
          );
      }

      // Validate events
      const validEvents = [
        "message.received",
        "message.sent",
        "instance.connected",
        "instance.disconnected",
        "instance.qr",
        "contact.updated",
      ];

      const invalidEvents = events.filter(
        (event) => !validEvents.includes(event)
      );
      if (invalidEvents.length > 0) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.VALIDATION_ERROR,
              `Invalid events: ${invalidEvents.join(
                ", "
              )}. Valid events: ${validEvents.join(", ")}`
            )
          );
      }

      // Create or update webhook configuration
      const webhookConfig = await prisma.webhookConfig.upsert({
        where: {
          instanceId,
        },
        update: {
          url,
          events: JSON.stringify(events),
          secret,
          isActive: true,
          updatedAt: new Date(),
        },
        create: {
          instanceId,
          url,
          events: JSON.stringify(events),
          secret,
          isActive: true,
        },
      });

      logger.info("Webhook configured", {
        instanceId,
        instanceName: instance.name,
        url,
        events,
        userId: req.user.id,
      });

      res.json(
        Helpers.createSuccessResponse({
          id: webhookConfig.id,
          url: webhookConfig.url,
          events: JSON.parse(webhookConfig.events),
          isActive: webhookConfig.isActive,
          createdAt: webhookConfig.createdAt,
          updatedAt: webhookConfig.updatedAt,
        })
      );
    } catch (error) {
      logger.error("Failed to configure webhook", {
        instanceId: req.params.id,
        error: error.message,
        userId: req.user?.id,
      });

      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to configure webhook"
          )
        );
    }
  }

  /**
   * Get webhook configuration for an instance (Management API)
   * GET /api/instances/:id/webhook
   */
  static async getWebhookConfig(req, res) {
    try {
      const { id: instanceId } = req.params;
      const prisma = databaseConfig.getClient();

      // Verify instance exists and user has access
      const instance = await prisma.instance.findFirst({
        where: {
          id: instanceId,
          subscriptionId: req.subscription.id,
        },
        include: {
          webhookConfig: true,
        },
      });

      if (!instance) {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.INSTANCE_NOT_FOUND,
              "Instance not found"
            )
          );
      }

      if (!instance.webhookConfig) {
        return res.json(
          Helpers.createSuccessResponse({
            configured: false,
            message: "No webhook configured for this instance",
          })
        );
      }

      const config = instance.webhookConfig;
      res.json(
        Helpers.createSuccessResponse({
          configured: true,
          id: config.id,
          url: config.url,
          events: JSON.parse(config.events),
          isActive: config.isActive,
          totalSent: config.totalSent,
          totalFailed: config.totalFailed,
          lastSentAt: config.lastSentAt,
          lastFailedAt: config.lastFailedAt,
          lastError: config.lastError,
          createdAt: config.createdAt,
          updatedAt: config.updatedAt,
        })
      );
    } catch (error) {
      logger.error("Failed to get webhook configuration", {
        instanceId: req.params.id,
        error: error.message,
        userId: req.user?.id,
      });

      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to get webhook configuration"
          )
        );
    }
  }

  /**
   * Update webhook configuration (Management API)
   * PUT /api/instances/:id/webhook
   */
  static async updateWebhookConfig(req, res) {
    try {
      const { id: instanceId } = req.params;
      const { url, events, secret, isActive } = req.body;

      const prisma = databaseConfig.getClient();

      // Verify instance exists and user has access
      const instance = await prisma.instance.findFirst({
        where: {
          id: instanceId,
          subscriptionId: req.subscription.id,
        },
        include: {
          webhookConfig: true,
        },
      });

      if (!instance) {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.INSTANCE_NOT_FOUND,
              "Instance not found"
            )
          );
      }

      if (!instance.webhookConfig) {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.WEBHOOK_NOT_FOUND,
              "No webhook configuration found for this instance"
            )
          );
      }

      // Validate URL if provided
      if (url) {
        try {
          new URL(url);
        } catch (error) {
          return res
            .status(HTTP_STATUS.BAD_REQUEST)
            .json(
              Helpers.createErrorResponse(
                ERROR_CODES.VALIDATION_ERROR,
                "Invalid webhook URL format"
              )
            );
        }
      }

      // Validate events if provided
      if (events) {
        const validEvents = [
          "message.received",
          "message.sent",
          "instance.connected",
          "instance.disconnected",
          "instance.qr",
          "contact.updated",
        ];

        const invalidEvents = events.filter(
          (event) => !validEvents.includes(event)
        );
        if (invalidEvents.length > 0) {
          return res
            .status(HTTP_STATUS.BAD_REQUEST)
            .json(
              Helpers.createErrorResponse(
                ERROR_CODES.VALIDATION_ERROR,
                `Invalid events: ${invalidEvents.join(", ")}`
              )
            );
        }
      }

      // Update webhook configuration
      const updateData = {};
      if (url !== undefined) updateData.url = url;
      if (events !== undefined) updateData.events = JSON.stringify(events);
      if (secret !== undefined) updateData.secret = secret;
      if (isActive !== undefined) updateData.isActive = isActive;

      const updatedConfig = await prisma.webhookConfig.update({
        where: {
          instanceId,
        },
        data: updateData,
      });

      logger.info("Webhook configuration updated", {
        instanceId,
        instanceName: instance.name,
        changes: Object.keys(updateData),
        userId: req.user.id,
      });

      res.json(
        Helpers.createSuccessResponse({
          id: updatedConfig.id,
          url: updatedConfig.url,
          events: JSON.parse(updatedConfig.events),
          isActive: updatedConfig.isActive,
          updatedAt: updatedConfig.updatedAt,
        })
      );
    } catch (error) {
      logger.error("Failed to update webhook configuration", {
        instanceId: req.params.id,
        error: error.message,
        userId: req.user?.id,
      });

      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to update webhook configuration"
          )
        );
    }
  }

  /**
   * Delete webhook configuration (Management API)
   * DELETE /api/instances/:id/webhook
   */
  static async deleteWebhookConfig(req, res) {
    try {
      const { id: instanceId } = req.params;
      const prisma = databaseConfig.getClient();

      // Verify instance exists and user has access
      const instance = await prisma.instance.findFirst({
        where: {
          id: instanceId,
          subscriptionId: req.subscription.id,
        },
        include: {
          webhookConfig: true,
        },
      });

      if (!instance) {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.INSTANCE_NOT_FOUND,
              "Instance not found"
            )
          );
      }

      if (!instance.webhookConfig) {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.WEBHOOK_NOT_FOUND,
              "No webhook configuration found for this instance"
            )
          );
      }

      // Delete webhook configuration
      await prisma.webhookConfig.delete({
        where: {
          instanceId,
        },
      });

      logger.info("Webhook configuration deleted", {
        instanceId,
        instanceName: instance.name,
        userId: req.user.id,
      });

      res.json(
        Helpers.createSuccessResponse({
          message: "Webhook configuration deleted successfully",
        })
      );
    } catch (error) {
      logger.error("Failed to delete webhook configuration", {
        instanceId: req.params.id,
        error: error.message,
        userId: req.user?.id,
      });

      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to delete webhook configuration"
          )
        );
    }
  }

  /**
   * Configure webhook via Integration API (API Key required)
   * POST /api/webhook
   */
  static async configureWebhookViaAPI(req, res) {
    try {
      const { url, events = [], secret } = req.body;
      const instanceId = req.instance.id;

      // Validate input
      if (!url) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.VALIDATION_ERROR,
              "Webhook URL is required"
            )
          );
      }

      // Validate URL format
      try {
        new URL(url);
      } catch (error) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.VALIDATION_ERROR,
              "Invalid webhook URL format"
            )
          );
      }

      // Validate events
      const validEvents = [
        "message.received",
        "message.sent",
        "instance.connected",
        "instance.disconnected",
        "instance.qr",
        "contact.updated",
      ];

      const invalidEvents = events.filter(
        (event) => !validEvents.includes(event)
      );
      if (invalidEvents.length > 0) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.VALIDATION_ERROR,
              `Invalid events: ${invalidEvents.join(
                ", "
              )}. Valid events: ${validEvents.join(", ")}`
            )
          );
      }

      const prisma = databaseConfig.getClient();

      // Create or update webhook configuration
      const webhookConfig = await prisma.webhookConfig.upsert({
        where: {
          instanceId,
        },
        update: {
          url,
          events: JSON.stringify(events),
          secret,
          isActive: true,
          updatedAt: new Date(),
        },
        create: {
          instanceId,
          url,
          events: JSON.stringify(events),
          secret,
          isActive: true,
        },
      });

      logger.info("Webhook configured via API", {
        instanceId,
        instanceName: req.instance.name,
        url,
        events,
        apiKeyId: req.apiKey.id,
      });

      res.json(
        Helpers.createSuccessResponse(
          {
            id: webhookConfig.id,
            url: webhookConfig.url,
            events: JSON.parse(webhookConfig.events),
            isActive: webhookConfig.isActive,
            createdAt: webhookConfig.createdAt,
            updatedAt: webhookConfig.updatedAt,
          },
          {
            instanceName: req.instance.name,
          }
        )
      );
    } catch (error) {
      logger.error("Failed to configure webhook via API", {
        instanceId: req.instance?.id,
        error: error.message,
        apiKeyId: req.apiKey?.id,
      });

      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to configure webhook"
          )
        );
    }
  }

  /**
   * Test webhook endpoint
   * POST /api/instances/:id/webhook/test
   */
  static async testWebhook(req, res) {
    try {
      const { id: instanceId } = req.params;
      const prisma = databaseConfig.getClient();

      // Verify instance exists and user has access
      const instance = await prisma.instance.findFirst({
        where: {
          id: instanceId,
          subscriptionId: req.subscription.id,
        },
        include: {
          webhookConfig: true,
        },
      });

      if (!instance) {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.INSTANCE_NOT_FOUND,
              "Instance not found"
            )
          );
      }

      if (!instance.webhookConfig) {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.WEBHOOK_NOT_FOUND,
              "No webhook configuration found for this instance"
            )
          );
      }

      // Send test webhook
      const testPayload = {
        event: "webhook.test",
        instanceId: instance.id,
        instanceName: instance.name,
        timestamp: new Date().toISOString(),
        data: {
          message: "This is a test webhook from WhatsApp API Backend",
          testId: crypto.randomUUID(),
        },
      };

      const success = await WebhookController.sendWebhook(
        instance.webhookConfig,
        testPayload
      );

      if (success) {
        logger.info("Test webhook sent successfully", {
          instanceId,
          instanceName: instance.name,
          url: instance.webhookConfig.url,
          userId: req.user.id,
        });

        res.json(
          Helpers.createSuccessResponse({
            message: "Test webhook sent successfully",
            url: instance.webhookConfig.url,
            timestamp: testPayload.timestamp,
          })
        );
      } else {
        res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.WEBHOOK_DELIVERY_FAILED,
              "Failed to deliver test webhook"
            )
          );
      }
    } catch (error) {
      logger.error("Failed to test webhook", {
        instanceId: req.params.id,
        error: error.message,
        userId: req.user?.id,
      });

      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to test webhook"
          )
        );
    }
  }

  /**
   * Send webhook to configured URL
   * @param {Object} webhookConfig - Webhook configuration
   * @param {Object} payload - Webhook payload
   * @returns {boolean} - Success status
   */
  static async sendWebhook(webhookConfig, payload) {
    try {
      if (!webhookConfig.isActive) {
        return false;
      }

      // Create signature if secret is configured
      let signature = null;
      if (webhookConfig.secret) {
        const hmac = crypto.createHmac("sha256", webhookConfig.secret);
        hmac.update(JSON.stringify(payload));
        signature = `sha256=${hmac.digest("hex")}`;
      }

      // Prepare headers
      const headers = {
        "Content-Type": "application/json",
        "User-Agent": "WhatsApp-API-Backend/1.0",
      };

      if (signature) {
        headers["X-Webhook-Signature"] = signature;
      }

      // Send webhook with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const response = await fetch(webhookConfig.url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const prisma = databaseConfig.getClient();

      if (response.ok) {
        // Update success statistics
        await prisma.webhookConfig.update({
          where: { id: webhookConfig.id },
          data: {
            totalSent: { increment: 1 },
            lastSentAt: new Date(),
          },
        });

        logger.info("Webhook delivered successfully", {
          instanceId: webhookConfig.instanceId,
          url: webhookConfig.url,
          status: response.status,
          event: payload.event,
        });

        return true;
      } else {
        // Update failure statistics
        await prisma.webhookConfig.update({
          where: { id: webhookConfig.id },
          data: {
            totalFailed: { increment: 1 },
            lastFailedAt: new Date(),
            lastError: `HTTP ${response.status}: ${response.statusText}`,
          },
        });

        logger.warn("Webhook delivery failed", {
          instanceId: webhookConfig.instanceId,
          url: webhookConfig.url,
          status: response.status,
          statusText: response.statusText,
          event: payload.event,
        });

        return false;
      }
    } catch (error) {
      // Update failure statistics
      try {
        const prisma = databaseConfig.getClient();
        await prisma.webhookConfig.update({
          where: { id: webhookConfig.id },
          data: {
            totalFailed: { increment: 1 },
            lastFailedAt: new Date(),
            lastError: error.message,
          },
        });
      } catch (dbError) {
        logger.error("Failed to update webhook failure stats", {
          error: dbError.message,
        });
      }

      logger.error("Webhook delivery error", {
        instanceId: webhookConfig.instanceId,
        url: webhookConfig.url,
        error: error.message,
        event: payload?.event,
      });

      return false;
    }
  }
}

export default WebhookController;
