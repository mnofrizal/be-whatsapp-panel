import crypto from "crypto";
import axios from "axios";
import { PrismaClient } from "@prisma/client";
import logger from "../utils/logger.js";
import { HTTP_STATUS } from "../utils/constants.js";

const prisma = new PrismaClient();

class WebhookService {
  /**
   * Create webhook signature
   */
  createSignature(payload, secret) {
    return crypto
      .createHmac("sha256", secret)
      .update(JSON.stringify(payload))
      .digest("hex");
  }

  /**
   * Verify webhook signature
   */
  verifySignature(payload, signature, secret) {
    const expectedSignature = this.createSignature(payload, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature, "hex"),
      Buffer.from(expectedSignature, "hex")
    );
  }

  /**
   * Deliver webhook with retry logic
   */
  async deliverWebhook(instanceId, eventType, payload, retryCount = 0) {
    const maxRetries = 3;
    const retryDelays = [1000, 5000, 15000]; // 1s, 5s, 15s

    try {
      // Get webhook configuration
      const webhookConfig = await prisma.webhookConfig.findUnique({
        where: { instanceId },
        include: { instance: true },
      });

      if (!webhookConfig || !webhookConfig.isActive) {
        logger.debug(`No active webhook config for instance ${instanceId}`);
        return;
      }

      // Check if event type is enabled
      const events = webhookConfig.events || {};
      if (!events[eventType]) {
        logger.debug(
          `Event ${eventType} not enabled for instance ${instanceId}`
        );
        return;
      }

      // Prepare webhook payload
      const webhookPayload = {
        event: eventType,
        instance: {
          id: webhookConfig.instance.id,
          name: webhookConfig.instance.name,
        },
        data: payload,
        timestamp: new Date().toISOString(),
      };

      // Create signature
      const signature = this.createSignature(
        webhookPayload,
        webhookConfig.secret
      );

      // Prepare headers
      const headers = {
        "Content-Type": "application/json",
        "User-Agent": "WhatsApp-API-Webhook/1.0",
        "X-Webhook-Signature": signature,
        "X-Webhook-Event": eventType,
        "X-Webhook-Instance": webhookConfig.instance.id,
      };

      // Add custom headers if configured
      if (webhookConfig.headers) {
        Object.assign(headers, webhookConfig.headers);
      }

      // Make HTTP request
      const response = await axios.post(webhookConfig.url, webhookPayload, {
        headers,
        timeout: 30000, // 30 second timeout
        validateStatus: (status) => status >= 200 && status < 300,
      });

      // Log successful delivery
      logger.info(`Webhook delivered successfully`, {
        instanceId,
        eventType,
        url: webhookConfig.url,
        statusCode: response.status,
        retryCount,
      });

      // Update delivery statistics
      await this.updateDeliveryStats(instanceId, true);

      return {
        success: true,
        statusCode: response.status,
        retryCount,
      };
    } catch (error) {
      logger.error(`Webhook delivery failed`, {
        instanceId,
        eventType,
        retryCount,
        error: error.message,
      });

      // Retry logic
      if (retryCount < maxRetries) {
        const delay = retryDelays[retryCount];
        logger.info(`Retrying webhook delivery in ${delay}ms`, {
          instanceId,
          eventType,
          retryCount: retryCount + 1,
        });

        setTimeout(() => {
          this.deliverWebhook(instanceId, eventType, payload, retryCount + 1);
        }, delay);

        return {
          success: false,
          error: error.message,
          retrying: true,
          retryCount: retryCount + 1,
        };
      }

      // Update delivery statistics
      await this.updateDeliveryStats(instanceId, false);

      return {
        success: false,
        error: error.message,
        retryCount,
        maxRetriesReached: true,
      };
    }
  }

  /**
   * Update webhook delivery statistics
   */
  async updateDeliveryStats(instanceId, success) {
    try {
      const webhookConfig = await prisma.webhookConfig.findUnique({
        where: { instanceId },
      });

      if (!webhookConfig) return;

      const updateData = {
        lastDeliveryAt: new Date(),
      };

      if (success) {
        updateData.successfulDeliveries = {
          increment: 1,
        };
        updateData.lastSuccessAt = new Date();
      } else {
        updateData.failedDeliveries = {
          increment: 1,
        };
        updateData.lastFailureAt = new Date();
      }

      await prisma.webhookConfig.update({
        where: { instanceId },
        data: updateData,
      });
    } catch (error) {
      logger.error(`Failed to update webhook delivery stats`, {
        instanceId,
        error: error.message,
      });
    }
  }

  /**
   * Test webhook endpoint
   */
  async testWebhook(instanceId) {
    try {
      const testPayload = {
        message: "This is a test webhook from WhatsApp API Backend",
        timestamp: new Date().toISOString(),
      };

      const result = await this.deliverWebhook(instanceId, "test", testPayload);

      return {
        success: result.success,
        message: result.success
          ? "Webhook test delivered successfully"
          : `Webhook test failed: ${result.error}`,
        details: result,
      };
    } catch (error) {
      logger.error(`Webhook test failed`, {
        instanceId,
        error: error.message,
      });

      return {
        success: false,
        message: "Webhook test failed",
        error: error.message,
      };
    }
  }

  /**
   * Handle message received event
   */
  async handleMessageReceived(instanceId, messageData) {
    const payload = {
      from: messageData.from,
      to: messageData.to,
      messageType: messageData.messageType,
      timestamp: messageData.timestamp,
      messageId: messageData.messageId,
      // Note: We don't include message content for privacy
    };

    await this.deliverWebhook(instanceId, "message.received", payload);
  }

  /**
   * Handle message sent event
   */
  async handleMessageSent(instanceId, messageData) {
    const payload = {
      to: messageData.to,
      messageType: messageData.messageType,
      timestamp: messageData.timestamp,
      messageId: messageData.messageId,
      status: "sent",
    };

    await this.deliverWebhook(instanceId, "message.sent", payload);
  }

  /**
   * Handle instance status change event
   */
  async handleInstanceStatusChange(instanceId, statusData) {
    const payload = {
      status: statusData.status,
      previousStatus: statusData.previousStatus,
      timestamp: statusData.timestamp,
      phone: statusData.phone,
      displayName: statusData.displayName,
    };

    await this.deliverWebhook(instanceId, "instance.status", payload);
  }

  /**
   * Handle connection event
   */
  async handleConnectionEvent(instanceId, connectionData) {
    const payload = {
      event: connectionData.event,
      timestamp: connectionData.timestamp,
      data: connectionData.data,
    };

    await this.deliverWebhook(instanceId, "connection.update", payload);
  }

  /**
   * Get webhook delivery statistics
   */
  async getDeliveryStats(instanceId) {
    try {
      const webhookConfig = await prisma.webhookConfig.findUnique({
        where: { instanceId },
        select: {
          successfulDeliveries: true,
          failedDeliveries: true,
          lastDeliveryAt: true,
          lastSuccessAt: true,
          lastFailureAt: true,
        },
      });

      if (!webhookConfig) {
        return {
          successfulDeliveries: 0,
          failedDeliveries: 0,
          totalDeliveries: 0,
          successRate: 0,
          lastDeliveryAt: null,
          lastSuccessAt: null,
          lastFailureAt: null,
        };
      }

      const totalDeliveries =
        webhookConfig.successfulDeliveries + webhookConfig.failedDeliveries;
      const successRate =
        totalDeliveries > 0
          ? (webhookConfig.successfulDeliveries / totalDeliveries) * 100
          : 0;

      return {
        ...webhookConfig,
        totalDeliveries,
        successRate: Math.round(successRate * 100) / 100, // Round to 2 decimal places
      };
    } catch (error) {
      logger.error(`Failed to get webhook delivery stats`, {
        instanceId,
        error: error.message,
      });

      throw error;
    }
  }

  /**
   * Cleanup webhook service
   */
  async cleanup() {
    // Any cleanup logic if needed
    logger.info("Webhook service cleanup completed");
  }
}

// Create and export singleton instance
const webhookService = new WebhookService();
export default webhookService;
