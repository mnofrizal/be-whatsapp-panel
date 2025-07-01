import express from "express";
import MessageController from "../controllers/message.controller.js";
import AuthMiddleware from "../middleware/auth.middleware.js";
import ValidationMiddleware from "../middleware/validation.middleware.js";
import RateLimitMiddleware from "../middleware/rateLimit.middleware.js";
import Joi from "joi";

const router = express.Router();

// Validation schemas
const textMessageSchema = Joi.object({
  to: Joi.string()
    .pattern(/^\+?[1-9]\d{1,14}$/)
    .required()
    .messages({
      "string.empty": "Recipient phone number is required",
      "string.pattern.base": "Invalid phone number format",
    }),
  message: Joi.string().min(1).max(4096).required().messages({
    "string.empty": "Message text is required",
    "string.max": "Message text cannot exceed 4096 characters",
  }),
});

const mediaMessageSchema = Joi.object({
  to: Joi.string()
    .pattern(/^\+?[1-9]\d{1,14}$/)
    .required()
    .messages({
      "string.empty": "Recipient phone number is required",
      "string.pattern.base": "Invalid phone number format",
    }),
  caption: Joi.string().max(1024).optional().messages({
    "string.max": "Caption cannot exceed 1024 characters",
  }),
});

const locationMessageSchema = Joi.object({
  to: Joi.string()
    .pattern(/^\+?[1-9]\d{1,14}$/)
    .required()
    .messages({
      "string.empty": "Recipient phone number is required",
      "string.pattern.base": "Invalid phone number format",
    }),
  latitude: Joi.number().min(-90).max(90).required().messages({
    "number.base": "Latitude must be a number",
    "number.min": "Latitude must be between -90 and 90",
    "number.max": "Latitude must be between -90 and 90",
  }),
  longitude: Joi.number().min(-180).max(180).required().messages({
    "number.base": "Longitude must be a number",
    "number.min": "Longitude must be between -180 and 180",
    "number.max": "Longitude must be between -180 and 180",
  }),
  name: Joi.string().max(100).optional().messages({
    "string.max": "Location name cannot exceed 100 characters",
  }),
  address: Joi.string().max(200).optional().messages({
    "string.max": "Address cannot exceed 200 characters",
  }),
});

const contactCheckSchema = Joi.object({
  phoneNumbers: Joi.array()
    .items(
      Joi.string()
        .pattern(/^\+?[1-9]\d{1,14}$/)
        .messages({
          "string.pattern.base": "Invalid phone number format",
        })
    )
    .min(1)
    .max(50)
    .required()
    .messages({
      "array.min": "At least one phone number is required",
      "array.max": "Maximum 50 phone numbers allowed per request",
    }),
});

const statsQuerySchema = Joi.object({
  period: Joi.number().integer().min(1).max(365).default(7).messages({
    "number.min": "Period must be at least 1 day",
    "number.max": "Period cannot exceed 365 days",
  }),
});

// Apply rate limiting to all message routes
router.use(RateLimitMiddleware.message);

// All routes require API key authentication
router.use(AuthMiddleware.authenticateRequest);

/**
 * @route POST /api/messages/text
 * @desc Send text message
 * @access Private (API Key required)
 */
router.post(
  "/messages/text",
  AuthMiddleware.requirePermission("messages.send"),
  ValidationMiddleware.validate(textMessageSchema),
  MessageController.sendTextMessage
);

/**
 * @route POST /api/messages/image
 * @desc Send image message
 * @access Private (API Key required)
 */
router.post(
  "/messages/image",
  AuthMiddleware.requirePermission("messages.send"),
  MessageController.sendImageMessage
);

/**
 * @route POST /api/messages/document
 * @desc Send document message
 * @access Private (API Key required)
 */
router.post(
  "/messages/document",
  AuthMiddleware.requirePermission("messages.send"),
  MessageController.sendDocumentMessage
);

/**
 * @route POST /api/messages/audio
 * @desc Send audio message
 * @access Private (API Key required)
 */
router.post(
  "/messages/audio",
  AuthMiddleware.requirePermission("messages.send"),
  MessageController.sendAudioMessage
);

/**
 * @route POST /api/messages/location
 * @desc Send location message
 * @access Private (API Key required)
 */
router.post(
  "/messages/location",
  AuthMiddleware.requirePermission("messages.send"),
  ValidationMiddleware.validate(locationMessageSchema),
  MessageController.sendLocationMessage
);

/**
 * @route POST /api/contacts/check
 * @desc Check if phone numbers are registered on WhatsApp
 * @access Private (API Key required)
 */
router.post(
  "/contacts/check",
  AuthMiddleware.requirePermission("contacts.check"),
  ValidationMiddleware.validate(contactCheckSchema),
  MessageController.checkContacts
);

/**
 * @route GET /api/instance/info
 * @desc Get instance information
 * @access Private (API Key required)
 */
router.get(
  "/instance/info",
  AuthMiddleware.requirePermission("instance.info"),
  MessageController.getInstanceInfo
);

/**
 * @route GET /api/stats
 * @desc Get message statistics
 * @access Private (API Key required)
 */
router.get(
  "/stats",
  AuthMiddleware.requirePermission("instance.stats"),
  ValidationMiddleware.validate(statsQuerySchema, "query"),
  MessageController.getStats
);

export default router;
