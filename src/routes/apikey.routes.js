import express from "express";
import ApiKeyController from "../controllers/apikey.controller.js";
import AuthMiddleware from "../middleware/auth.middleware.js";
import ValidationMiddleware from "../middleware/validation.middleware.js";
import RateLimitMiddleware from "../middleware/rateLimit.middleware.js";
import Joi from "joi";

const router = express.Router();

// Validation schemas
const createApiKeySchema = Joi.object({
  name: Joi.string().min(1).max(100).required().messages({
    "string.empty": "API key name is required",
    "string.max": "API key name must be less than 100 characters",
  }),
  permissions: Joi.object({
    messages: Joi.object({
      send: Joi.boolean().default(false),
      receive: Joi.boolean().default(false),
    }).default({}),
    contacts: Joi.object({
      check: Joi.boolean().default(false),
    }).default({}),
    instance: Joi.object({
      info: Joi.boolean().default(false),
      stats: Joi.boolean().default(false),
    }).default({}),
    webhook: Joi.object({
      configure: Joi.boolean().default(false),
    }).default({}),
  }).default({}),
  rateLimit: Joi.number().integer().min(1).max(10000).default(1000).messages({
    "number.min": "Rate limit must be at least 1",
    "number.max": "Rate limit cannot exceed 10,000",
  }),
  expiresAt: Joi.date().iso().greater("now").optional().messages({
    "date.greater": "Expiry date must be in the future",
  }),
});

const updateApiKeySchema = Joi.object({
  name: Joi.string().min(1).max(100).optional().messages({
    "string.empty": "API key name cannot be empty",
    "string.max": "API key name must be less than 100 characters",
  }),
  permissions: Joi.object({
    messages: Joi.object({
      send: Joi.boolean(),
      receive: Joi.boolean(),
    }).optional(),
    contacts: Joi.object({
      check: Joi.boolean(),
    }).optional(),
    instance: Joi.object({
      info: Joi.boolean(),
      stats: Joi.boolean(),
    }).optional(),
    webhook: Joi.object({
      configure: Joi.boolean(),
    }).optional(),
  }).optional(),
  rateLimit: Joi.number().integer().min(1).max(10000).optional().messages({
    "number.min": "Rate limit must be at least 1",
    "number.max": "Rate limit cannot exceed 10,000",
  }),
  isActive: Joi.boolean().optional(),
  expiresAt: Joi.date().iso().greater("now").allow(null).optional().messages({
    "date.greater": "Expiry date must be in the future",
  }),
});

// Apply rate limiting to all API key routes
router.use(RateLimitMiddleware.instanceManagement);

// All routes require JWT authentication
router.use(AuthMiddleware.authenticateRequest);

/**
 * @route POST /api/instances/:id/keys
 * @desc Create a new API key for an instance
 * @access Private (JWT required)
 */
router.post(
  "/:id/keys",
  ValidationMiddleware.validate(createApiKeySchema),
  ApiKeyController.createApiKey
);

/**
 * @route GET /api/instances/:id/keys
 * @desc List all API keys for an instance
 * @access Private (JWT required)
 */
router.get("/:id/keys", ApiKeyController.listApiKeys);

/**
 * @route GET /api/instances/:id/keys/:keyId
 * @desc Get a specific API key
 * @access Private (JWT required)
 */
router.get("/:id/keys/:keyId", ApiKeyController.getApiKey);

/**
 * @route PUT /api/instances/:id/keys/:keyId
 * @desc Update an API key
 * @access Private (JWT required)
 */
router.put(
  "/:id/keys/:keyId",
  ValidationMiddleware.validate(updateApiKeySchema),
  ApiKeyController.updateApiKey
);

/**
 * @route DELETE /api/instances/:id/keys/:keyId
 * @desc Delete an API key
 * @access Private (JWT required)
 */
router.delete("/:id/keys/:keyId", ApiKeyController.deleteApiKey);

/**
 * @route GET /api/instances/:id/keys/:keyId/stats
 * @desc Get API key usage statistics
 * @access Private (JWT required)
 */
router.get("/:id/keys/:keyId/stats", ApiKeyController.getApiKeyStats);

/**
 * @route GET /api/instances/:id/keys/:keyId/usage
 * @desc Get API key usage statistics (alias for stats)
 * @access Private (JWT required)
 */
router.get("/:id/keys/:keyId/usage", ApiKeyController.getApiKeyStats);

/**
 * @route POST /api/instances/:id/keys/:keyId/regenerate
 * @desc Regenerate an API key
 * @access Private (JWT required)
 */
router.post("/:id/keys/:keyId/regenerate", ApiKeyController.regenerateApiKey);

export default router;
