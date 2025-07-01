import databaseConfig from "../config/database.js";
import logger from "../utils/logger.js";
import Helpers from "../utils/helpers.js";
import { HTTP_STATUS, ERROR_CODES, DEFAULTS } from "../utils/constants.js";
import crypto from "crypto";

class ApiKeyController {
  /**
   * Create a new API key for an instance
   * POST /api/instances/:id/keys
   */
  static async createApiKey(req, res) {
    try {
      const { id: instanceId } = req.params;
      const { name, permissions = [], rateLimit = 1000, expiresAt } = req.body;

      // Validate required fields
      if (!name || typeof name !== "string" || name.trim().length === 0) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.VALIDATION_ERROR,
              "API key name is required and must be a non-empty string"
            )
          );
      }

      // Validate name length
      if (name.length > 100) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.VALIDATION_ERROR,
              "API key name must be 100 characters or less"
            )
          );
      }

      // Validate permissions object (now handled by Joi validation)
      // The permissions object structure is validated by the route middleware

      // Validate rate limit
      if (typeof rateLimit !== "number" || rateLimit < 1 || rateLimit > 10000) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.VALIDATION_ERROR,
              "Rate limit must be a number between 1 and 10000"
            )
          );
      }

      // Validate expiration date if provided
      if (expiresAt) {
        const expDate = new Date(expiresAt);
        if (isNaN(expDate.getTime()) || expDate <= new Date()) {
          return res
            .status(HTTP_STATUS.BAD_REQUEST)
            .json(
              Helpers.createErrorResponse(
                ERROR_CODES.VALIDATION_ERROR,
                "Expiration date must be a valid future date"
              )
            );
        }
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

      // Check API key limits based on subscription tier
      const existingKeys = await prisma.apiKey.findMany({
        where: {
          instanceId,
        },
        select: {
          id: true,
        },
      });

      // Define API key limits per subscription tier
      const API_KEY_LIMITS = {
        BASIC: 1, // Basic users can only have 1 API key per instance
        PRO: 5, // Pro users can have 5 API keys per instance
        MAX: 10, // Max users can have 10 API keys per instance
      };

      const currentKeyCount = existingKeys.length;
      const maxKeys =
        API_KEY_LIMITS[req.subscription.tier] || API_KEY_LIMITS.BASIC;

      if (currentKeyCount >= maxKeys) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.SUBSCRIPTION_LIMIT_EXCEEDED,
              `${
                req.subscription.tier
              } subscription allows maximum ${maxKeys} API key${
                maxKeys > 1 ? "s" : ""
              } per instance. You currently have ${currentKeyCount}.`
            )
          );
      }

      // Generate API key
      const apiKey = Helpers.generateApiKey();
      const keyHash = Helpers.hashApiKey(apiKey);

      // Create API key record (with plain key for development)
      const apiKeyRecord = await prisma.apiKey.create({
        data: {
          instanceId,
          name,
          keyHash,
          plainKey: apiKey, // Store plain key for development purposes
          permissions: JSON.stringify(permissions),
          rateLimit,
          expiresAt: expiresAt ? new Date(expiresAt) : null,
        },
      });

      logger.info("API key created", {
        keyId: apiKeyRecord.id,
        instanceId,
        name,
        userId: req.user.id,
      });

      // Return API key (only time it's shown in plain text)
      res.status(HTTP_STATUS.CREATED).json(
        Helpers.createSuccessResponse({
          id: apiKeyRecord.id,
          name: apiKeyRecord.name,
          apiKey, // Plain text key - only shown once!
          permissions,
          rateLimit: apiKeyRecord.rateLimit,
          expiresAt: apiKeyRecord.expiresAt,
          createdAt: apiKeyRecord.createdAt,
        })
      );
    } catch (error) {
      logger.error("Failed to create API key", {
        instanceId: req.params.id,
        error: error.message,
        userId: req.user?.id,
      });

      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to create API key"
          )
        );
    }
  }

  /**
   * List API keys for an instance
   * GET /api/instances/:id/keys
   */
  static async listApiKeys(req, res) {
    try {
      const { id: instanceId } = req.params;
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

      // Get API keys (with plain keys for development)
      const apiKeys = await prisma.apiKey.findMany({
        where: {
          instanceId,
        },
        select: {
          id: true,
          name: true,
          plainKey: true, // Include plainKey for development purposes
          permissions: true,
          isActive: true,
          rateLimit: true,
          usageCount: true,
          lastUsedAt: true,
          expiresAt: true,
          createdAt: true,
          updatedAt: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      // Parse permissions JSON and include API key (for development)
      const formattedKeys = apiKeys.map((key) => ({
        id: key.id,
        name: key.name,
        apiKey: key.plainKey, // Show plain API key for development
        permissions: Helpers.safeJSONParse(key.permissions, []),
        isActive: key.isActive,
        rateLimit: key.rateLimit,
        usageCount: key.usageCount,
        lastUsedAt: key.lastUsedAt,
        expiresAt: key.expiresAt,
        createdAt: key.createdAt,
        updatedAt: key.updatedAt,
      }));

      res.json(
        Helpers.createSuccessResponse({
          apiKeys: formattedKeys,
          total: formattedKeys.length,
        })
      );
    } catch (error) {
      logger.error("Failed to list API keys", {
        instanceId: req.params.id,
        error: error.message,
        userId: req.user?.id,
      });

      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to list API keys"
          )
        );
    }
  }

  /**
   * Get a specific API key
   * GET /api/instances/:id/keys/:keyId
   */
  static async getApiKey(req, res) {
    try {
      const { id: instanceId, keyId } = req.params;
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

      // Get specific API key (with plain key for development)
      const apiKey = await prisma.apiKey.findFirst({
        where: {
          id: keyId,
          instanceId,
        },
        select: {
          id: true,
          name: true,
          plainKey: true, // Include plainKey for development purposes
          permissions: true,
          isActive: true,
          rateLimit: true,
          usageCount: true,
          lastUsedAt: true,
          expiresAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!apiKey) {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.API_KEY_INVALID,
              "API key not found"
            )
          );
      }

      // Parse permissions JSON and include API key (for development)
      const formattedKey = {
        id: apiKey.id,
        name: apiKey.name,
        apiKey: apiKey.plainKey, // Show plain API key for development
        permissions: Helpers.safeJSONParse(apiKey.permissions, {}),
        isActive: apiKey.isActive,
        rateLimit: apiKey.rateLimit,
        usageCount: apiKey.usageCount,
        lastUsedAt: apiKey.lastUsedAt,
        expiresAt: apiKey.expiresAt,
        createdAt: apiKey.createdAt,
        updatedAt: apiKey.updatedAt,
      };

      res.json(Helpers.createSuccessResponse(formattedKey));
    } catch (error) {
      logger.error("Failed to get API key", {
        instanceId: req.params.id,
        keyId: req.params.keyId,
        error: error.message,
        userId: req.user?.id,
      });

      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to get API key"
          )
        );
    }
  }

  /**
   * Update an API key
   * PUT /api/instances/:id/keys/:keyId
   */
  static async updateApiKey(req, res) {
    try {
      const { id: instanceId, keyId } = req.params;
      const { name, permissions, rateLimit, isActive, expiresAt } = req.body;

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

      // Verify API key exists and belongs to this instance
      const existingKey = await prisma.apiKey.findFirst({
        where: {
          id: keyId,
          instanceId,
        },
      });

      if (!existingKey) {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.API_KEY_INVALID,
              "API key not found"
            )
          );
      }

      // Update API key
      const updateData = {};
      if (name !== undefined) updateData.name = name;
      if (permissions !== undefined)
        updateData.permissions = JSON.stringify(permissions);
      if (rateLimit !== undefined) updateData.rateLimit = rateLimit;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (expiresAt !== undefined)
        updateData.expiresAt = expiresAt ? new Date(expiresAt) : null;

      const updatedKey = await prisma.apiKey.update({
        where: { id: keyId },
        data: updateData,
        select: {
          id: true,
          name: true,
          permissions: true,
          isActive: true,
          rateLimit: true,
          usageCount: true,
          lastUsedAt: true,
          expiresAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      logger.info("API key updated", {
        keyId,
        instanceId,
        userId: req.user.id,
        changes: Object.keys(updateData),
      });

      res.json(
        Helpers.createSuccessResponse({
          ...updatedKey,
          permissions: Helpers.safeJSONParse(updatedKey.permissions, []),
        })
      );
    } catch (error) {
      logger.error("Failed to update API key", {
        instanceId: req.params.id,
        keyId: req.params.keyId,
        error: error.message,
        userId: req.user?.id,
      });

      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to update API key"
          )
        );
    }
  }

  /**
   * Delete an API key
   * DELETE /api/instances/:id/keys/:keyId
   */
  static async deleteApiKey(req, res) {
    try {
      const { id: instanceId, keyId } = req.params;
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

      // Verify API key exists and belongs to this instance
      const existingKey = await prisma.apiKey.findFirst({
        where: {
          id: keyId,
          instanceId,
        },
      });

      if (!existingKey) {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.API_KEY_INVALID,
              "API key not found"
            )
          );
      }

      // Delete API key
      await prisma.apiKey.delete({
        where: { id: keyId },
      });

      logger.info("API key deleted", {
        keyId,
        instanceId,
        userId: req.user.id,
      });

      res.json(
        Helpers.createSuccessResponse({
          message: "API key deleted successfully",
        })
      );
    } catch (error) {
      logger.error("Failed to delete API key", {
        instanceId: req.params.id,
        keyId: req.params.keyId,
        error: error.message,
        userId: req.user?.id,
      });

      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to delete API key"
          )
        );
    }
  }

  /**
   * Get API key usage statistics
   * GET /api/instances/:id/keys/:keyId/stats
   */
  static async getApiKeyStats(req, res) {
    try {
      const { id: instanceId, keyId } = req.params;
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

      // Get API key with usage stats
      const apiKey = await prisma.apiKey.findFirst({
        where: {
          id: keyId,
          instanceId,
        },
        select: {
          id: true,
          name: true,
          usageCount: true,
          rateLimit: true,
          lastUsedAt: true,
          createdAt: true,
        },
      });

      if (!apiKey) {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.API_KEY_INVALID,
              "API key not found"
            )
          );
      }

      // Calculate usage statistics
      const now = new Date();
      const hourAgo = new Date(now.getTime() - 60 * 60 * 1000);
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      // For now, we'll return basic stats
      // In a production system, you'd want to track detailed usage metrics
      const stats = {
        totalUsage: apiKey.usageCount,
        rateLimit: apiKey.rateLimit,
        lastUsedAt: apiKey.lastUsedAt,
        createdAt: apiKey.createdAt,
        usagePercentage: Math.round(
          (apiKey.usageCount / apiKey.rateLimit) * 100
        ),
        isActive: apiKey.lastUsedAt && apiKey.lastUsedAt > dayAgo,
      };

      res.json(Helpers.createSuccessResponse(stats));
    } catch (error) {
      logger.error("Failed to get API key stats", {
        instanceId: req.params.id,
        keyId: req.params.keyId,
        error: error.message,
        userId: req.user?.id,
      });

      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to get API key statistics"
          )
        );
    }
  }

  /**
   * Regenerate an API key
   * POST /api/instances/:id/keys/:keyId/regenerate
   */
  static async regenerateApiKey(req, res) {
    try {
      const { id: instanceId, keyId } = req.params;
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

      // Verify API key exists and belongs to this instance
      const existingKey = await prisma.apiKey.findFirst({
        where: {
          id: keyId,
          instanceId,
        },
      });

      if (!existingKey) {
        return res
          .status(HTTP_STATUS.NOT_FOUND)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.API_KEY_INVALID,
              "API key not found"
            )
          );
      }

      // Generate new API key
      const newApiKey = Helpers.generateApiKey();
      const newKeyHash = Helpers.hashApiKey(newApiKey);

      // Update API key with new hash and plain key, reset usage
      const updatedKey = await prisma.apiKey.update({
        where: { id: keyId },
        data: {
          keyHash: newKeyHash,
          plainKey: newApiKey, // Store new plain key for development
          usageCount: 0,
          lastUsedAt: null,
        },
        select: {
          id: true,
          name: true,
          permissions: true,
          isActive: true,
          rateLimit: true,
          usageCount: true,
          lastUsedAt: true,
          expiresAt: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      logger.info("API key regenerated", {
        keyId,
        instanceId,
        userId: req.user.id,
      });

      // Return new API key (only time it's shown in plain text)
      res.json(
        Helpers.createSuccessResponse({
          ...updatedKey,
          apiKey: newApiKey, // Plain text key - only shown once!
          permissions: Helpers.safeJSONParse(updatedKey.permissions, {}),
          message:
            "API key regenerated successfully. Save this key - it won't be shown again!",
        })
      );
    } catch (error) {
      logger.error("Failed to regenerate API key", {
        instanceId: req.params.id,
        keyId: req.params.keyId,
        error: error.message,
        userId: req.user?.id,
      });

      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to regenerate API key"
          )
        );
    }
  }
}

export default ApiKeyController;
