import express from "express";
import InstanceController from "../controllers/instance.controller.js";
import authMiddleware from "../middleware/auth.middleware.js";
import validationMiddleware from "../middleware/validation.middleware.js";
import rateLimitMiddleware from "../middleware/rateLimit.middleware.js";
import Joi from "joi";

const router = express.Router();

// Validation schemas
const createInstanceSchema = Joi.object({
  name: Joi.string()
    .min(3)
    .max(50)
    .pattern(/^[a-zA-Z0-9-_]+$/)
    .required()
    .messages({
      "string.pattern.base":
        "Instance name can only contain letters, numbers, hyphens, and underscores",
      "string.min": "Instance name must be at least 3 characters long",
      "string.max": "Instance name must not exceed 50 characters",
    }),
  settings: Joi.object({
    autoReconnect: Joi.boolean().default(true),
    markOnlineOnConnect: Joi.boolean().default(true),
    syncFullHistory: Joi.boolean().default(false),
    defaultQueryTimeoutMs: Joi.number().min(10000).max(120000).default(60000),
    connectTimeoutMs: Joi.number().min(10000).max(120000).default(60000),
    keepAliveIntervalMs: Joi.number().min(10000).max(60000).default(30000),
  }).default({}),
});

const updateInstanceSchema = Joi.object({
  name: Joi.string()
    .min(3)
    .max(50)
    .pattern(/^[a-zA-Z0-9-_]+$/)
    .messages({
      "string.pattern.base":
        "Instance name can only contain letters, numbers, hyphens, and underscores",
      "string.min": "Instance name must be at least 3 characters long",
      "string.max": "Instance name must not exceed 50 characters",
    }),
  settings: Joi.object({
    autoReconnect: Joi.boolean(),
    markOnlineOnConnect: Joi.boolean(),
    syncFullHistory: Joi.boolean(),
    defaultQueryTimeoutMs: Joi.number().min(10000).max(120000),
    connectTimeoutMs: Joi.number().min(10000).max(120000),
    keepAliveIntervalMs: Joi.number().min(10000).max(60000),
  }),
  isActive: Joi.boolean(),
}).min(1);

const querySchema = Joi.object({
  page: Joi.number().integer().min(1).default(1),
  per_page: Joi.number().integer().min(1).max(100).default(20),
  sort: Joi.string().valid("asc", "desc").default("desc"),
  sort_by: Joi.string()
    .valid("createdAt", "updatedAt", "name", "status", "lastConnectedAt")
    .default("createdAt"),
  status: Joi.string().valid(
    "DISCONNECTED",
    "CONNECTING",
    "CONNECTED",
    "ERROR",
    "PAUSED"
  ),
  search: Joi.string().min(1).max(100),
});

const instanceIdSchema = Joi.object({
  id: Joi.string()
    .pattern(/^[a-zA-Z0-9]{25}$/)
    .required()
    .messages({
      "string.pattern.base": "Invalid instance ID format",
    }),
});

// Apply authentication to all routes
router.use(authMiddleware.authenticateRequest);

// Apply rate limiting
router.use(rateLimitMiddleware.instanceManagement);

/**
 * @route POST /api/instances
 * @desc Create new instance
 * @access Private (JWT required)
 */
router.post(
  "/",
  validationMiddleware.validate(createInstanceSchema, "body"),
  InstanceController.createInstance
);

/**
 * @route GET /api/instances
 * @desc Get all instances for user's subscription
 * @access Private (JWT required)
 */
router.get(
  "/",
  validationMiddleware.validate(querySchema, "query"),
  InstanceController.getInstances
);

/**
 * @route GET /api/instances/subscription/usage
 * @desc Get subscription usage statistics
 * @access Private (JWT required)
 */
router.get("/subscription/usage", InstanceController.getSubscriptionUsage);

/**
 * @route GET /api/instances/:id
 * @desc Get instance by ID
 * @access Private (JWT required)
 */
router.get(
  "/:id",
  validationMiddleware.validate(instanceIdSchema, "params"),
  InstanceController.getInstanceById
);

/**
 * @route PUT /api/instances/:id
 * @desc Update instance
 * @access Private (JWT required)
 */
router.put(
  "/:id",
  validationMiddleware.validate(instanceIdSchema, "params"),
  validationMiddleware.validate(updateInstanceSchema, "body"),
  InstanceController.updateInstance
);

/**
 * @route DELETE /api/instances/:id
 * @desc Delete instance
 * @access Private (JWT required)
 */
router.delete(
  "/:id",
  validationMiddleware.validate(instanceIdSchema, "params"),
  InstanceController.deleteInstance
);

/**
 * @route GET /api/instances/:id/status
 * @desc Get instance status
 * @access Private (JWT required)
 */
router.get(
  "/:id/status",
  validationMiddleware.validate(instanceIdSchema, "params"),
  InstanceController.getInstanceStatus
);

/**
 * @route POST /api/instances/:id/connect
 * @desc Connect instance to WhatsApp
 * @access Private (JWT required)
 */
router.post(
  "/:id/connect",
  validationMiddleware.validate(instanceIdSchema, "params"),
  rateLimitMiddleware.instanceActions,
  InstanceController.connectInstance
);

/**
 * @route POST /api/instances/:id/disconnect
 * @desc Disconnect instance from WhatsApp
 * @access Private (JWT required)
 */
router.post(
  "/:id/disconnect",
  validationMiddleware.validate(instanceIdSchema, "params"),
  rateLimitMiddleware.instanceActions,
  InstanceController.disconnectInstance
);

/**
 * @route POST /api/instances/:id/logout
 * @desc Logout instance (sign out and delete session)
 * @access Private (JWT required)
 */
router.post(
  "/:id/logout",
  validationMiddleware.validate(instanceIdSchema, "params"),
  rateLimitMiddleware.instanceActions,
  InstanceController.logoutInstance
);

/**
 * @route POST /api/instances/:id/restart
 * @desc Restart instance connection
 * @access Private (JWT required)
 */
router.post(
  "/:id/restart",
  validationMiddleware.validate(instanceIdSchema, "params"),
  rateLimitMiddleware.instanceActions,
  InstanceController.restartInstance
);

/**
 * @route GET /api/instances/:id/qr
 * @desc Get instance QR code for WhatsApp pairing
 * @access Private (JWT required)
 */
router.get(
  "/:id/qr",
  validationMiddleware.validate(instanceIdSchema, "params"),
  InstanceController.getInstanceQR
);

export default router;
