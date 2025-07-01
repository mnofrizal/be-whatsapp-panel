import express from "express";
import WebhookController from "../controllers/webhook.controller.js";
import AuthMiddleware from "../middleware/auth.middleware.js";
import ValidationMiddleware from "../middleware/validation.middleware.js";
import RateLimitMiddleware from "../middleware/rateLimit.middleware.js";
import Joi from "joi";

const router = express.Router();

// Validation schemas
const webhookConfigSchema = Joi.object({
  url: Joi.string().uri().required().messages({
    "string.empty": "Webhook URL is required",
    "string.uri": "Invalid webhook URL format",
  }),
  events: Joi.array()
    .items(
      Joi.string().valid(
        "message.received",
        "message.sent",
        "instance.connected",
        "instance.disconnected",
        "instance.qr",
        "contact.updated"
      )
    )
    .default([])
    .messages({
      "array.includes": "Invalid event type specified",
    }),
  secret: Joi.string().min(8).max(100).optional().messages({
    "string.min": "Webhook secret must be at least 8 characters",
    "string.max": "Webhook secret cannot exceed 100 characters",
  }),
});

const webhookUpdateSchema = Joi.object({
  url: Joi.string().uri().optional().messages({
    "string.uri": "Invalid webhook URL format",
  }),
  events: Joi.array()
    .items(
      Joi.string().valid(
        "message.received",
        "message.sent",
        "instance.connected",
        "instance.disconnected",
        "instance.qr",
        "contact.updated"
      )
    )
    .optional()
    .messages({
      "array.includes": "Invalid event type specified",
    }),
  secret: Joi.string().min(8).max(100).allow(null).optional().messages({
    "string.min": "Webhook secret must be at least 8 characters",
    "string.max": "Webhook secret cannot exceed 100 characters",
  }),
  isActive: Joi.boolean().optional(),
});

// Apply rate limiting to webhook routes
router.use(RateLimitMiddleware.basic);

// Management API routes (JWT required)
const managementRouter = express.Router();
managementRouter.use(AuthMiddleware.authenticateRequest);

/**
 * @route POST /api/instances/:id/webhook
 * @desc Configure webhook for an instance (Management API)
 * @access Private (JWT required)
 */
managementRouter.post(
  "/:id/webhook",
  ValidationMiddleware.validate(webhookConfigSchema),
  WebhookController.configureWebhook
);

/**
 * @route GET /api/instances/:id/webhook
 * @desc Get webhook configuration for an instance (Management API)
 * @access Private (JWT required)
 */
managementRouter.get("/:id/webhook", WebhookController.getWebhookConfig);

/**
 * @route PUT /api/instances/:id/webhook
 * @desc Update webhook configuration (Management API)
 * @access Private (JWT required)
 */
managementRouter.put(
  "/:id/webhook",
  ValidationMiddleware.validate(webhookUpdateSchema),
  WebhookController.updateWebhookConfig
);

/**
 * @route DELETE /api/instances/:id/webhook
 * @desc Delete webhook configuration (Management API)
 * @access Private (JWT required)
 */
managementRouter.delete("/:id/webhook", WebhookController.deleteWebhookConfig);

/**
 * @route POST /api/instances/:id/webhook/test
 * @desc Test webhook endpoint (Management API)
 * @access Private (JWT required)
 */
managementRouter.post("/:id/webhook/test", WebhookController.testWebhook);

// Integration API routes (API Key required)
const integrationRouter = express.Router();
integrationRouter.use(AuthMiddleware.authenticateRequest);

/**
 * @route POST /api/webhook
 * @desc Configure webhook via Integration API (API Key required)
 * @access Private (API Key required)
 */
integrationRouter.post(
  "/",
  AuthMiddleware.requirePermission("webhook.configure"),
  ValidationMiddleware.validate(webhookConfigSchema),
  WebhookController.configureWebhookViaAPI
);

// Export both routers
export {
  managementRouter as webhookManagementRoutes,
  integrationRouter as webhookIntegrationRoutes,
};
export default router;
