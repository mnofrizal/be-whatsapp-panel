import Joi from "joi";
import Helpers from "../utils/helpers.js";
import { HTTP_STATUS, ERROR_CODES } from "../utils/constants.js";
import logger from "../utils/logger.js";

class ValidationMiddleware {
  /**
   * Generic validation middleware factory
   * @param {object} schema - Joi validation schema
   * @param {string} source - Source of data to validate ('body', 'query', 'params')
   * @returns {function} - Express middleware function
   */
  static validate(schema, source = "body") {
    return (req, res, next) => {
      const data = req[source];

      const { error, value } = schema.validate(data, {
        abortEarly: false,
        stripUnknown: true,
        convert: true,
      });

      if (error) {
        const details = error.details.map((detail) => ({
          field: detail.path.join("."),
          message: detail.message,
          value: detail.context?.value,
        }));

        logger.api("Validation failed", {
          source,
          errors: details,
          originalData: data,
          ip: Helpers.getClientIP(req),
        });

        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.VALIDATION_ERROR,
              "Validation failed",
              { errors: details }
            )
          );
      }

      // Replace original data with validated and sanitized data
      req[source] = value;
      next();
    };
  }

  /**
   * Validate pagination parameters
   */
  static validatePagination() {
    const schema = Joi.object({
      page: Joi.number().integer().min(1).default(1),
      per_page: Joi.number().integer().min(1).max(100).default(20),
      sort: Joi.string().valid("asc", "desc").default("desc"),
      sort_by: Joi.string().default("createdAt"),
    });

    return ValidationMiddleware.validate(schema, "query");
  }

  /**
   * Validate phone number
   */
  static validatePhoneNumber(field = "to") {
    return (req, res, next) => {
      const phoneNumber = req.body[field];

      if (!phoneNumber) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.MISSING_REQUIRED_FIELD,
              `${field} is required`
            )
          );
      }

      if (!Helpers.isValidPhoneNumber(phoneNumber)) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.INVALID_PHONE_NUMBER,
              "Invalid phone number format. Use international format without + sign"
            )
          );
      }

      // Normalize phone number
      req.body[field] = phoneNumber.replace(/\D/g, "");
      next();
    };
  }
}

// Validation Schemas
const ValidationSchemas = {
  // User Registration
  userRegistration: Joi.object({
    email: Joi.string().email().required().messages({
      "string.email": "Please provide a valid email address",
      "any.required": "Email is required",
    }),
    password: Joi.string().min(6).max(128).required().messages({
      "string.min": "Password must be at least 6 characters long",
      "string.max": "Password must not exceed 128 characters",
      "any.required": "Password is required",
    }),
    name: Joi.string().min(2).max(100).required().messages({
      "string.min": "Name must be at least 2 characters long",
      "string.max": "Name must not exceed 100 characters",
      "any.required": "Name is required",
    }),
  }),

  // User Login
  userLogin: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
  }),

  // Change Password
  changePassword: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string().min(8).max(128).required(),
  }),

  // Create User (Admin)
  createUser: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(8).max(128).required(),
    name: Joi.string().min(2).max(100).required(),
    role: Joi.string().valid("ADMINISTRATOR", "USER").default("USER"),
  }),

  // Update User
  updateUser: Joi.object({
    email: Joi.string().email(),
    name: Joi.string().min(2).max(100),
    role: Joi.string().valid("ADMINISTRATOR", "USER"),
    isActive: Joi.boolean(),
  }).min(1),

  // Create Instance
  createInstance: Joi.object({
    name: Joi.string()
      .min(2)
      .max(50)
      .pattern(/^[a-zA-Z0-9-_]+$/)
      .required()
      .messages({
        "string.pattern.base":
          "Instance name can only contain letters, numbers, hyphens, and underscores",
        "any.required": "Instance name is required",
      }),
    settings: Joi.object({
      autoReconnect: Joi.boolean().default(true),
      messageDelay: Joi.number().integer().min(0).max(10000).default(1000),
      maxRetries: Joi.number().integer().min(0).max(10).default(3),
    }).default({}),
  }),

  // Update Instance
  updateInstance: Joi.object({
    settings: Joi.object({
      autoReconnect: Joi.boolean(),
      messageDelay: Joi.number().integer().min(0).max(10000),
      maxRetries: Joi.number().integer().min(0).max(10),
    }),
  }),

  // Create API Key
  createApiKey: Joi.object({
    name: Joi.string().min(2).max(100).required(),
    permissions: Joi.array()
      .items(
        Joi.string().valid(
          "message:send",
          "message:read",
          "contact:check",
          "contact:manage",
          "instance:info",
          "stats:read",
          "webhook:manage"
        )
      )
      .min(1)
      .required(),
    rateLimit: Joi.number().integer().min(100).max(100000).default(1000),
    expiresAt: Joi.date().greater("now"),
  }),

  // Update API Key
  updateApiKey: Joi.object({
    name: Joi.string().min(2).max(100),
    permissions: Joi.array()
      .items(
        Joi.string().valid(
          "message:send",
          "message:read",
          "contact:check",
          "contact:manage",
          "instance:info",
          "stats:read",
          "webhook:manage"
        )
      )
      .min(1),
    rateLimit: Joi.number().integer().min(100).max(100000),
    expiresAt: Joi.date().greater("now"),
    isActive: Joi.boolean(),
  }).min(1),

  // Send Text Message
  sendTextMessage: Joi.object({
    to: Joi.string().required(),
    text: Joi.string().min(1).max(4096).required(),
  }),

  // Send Image Message
  sendImageMessage: Joi.object({
    to: Joi.string().required(),
    image: Joi.string().uri().required(),
    caption: Joi.string().max(1024),
  }),

  // Send Document Message
  sendDocumentMessage: Joi.object({
    to: Joi.string().required(),
    document: Joi.string().uri().required(),
    filename: Joi.string().max(255).required(),
  }),

  // Send Audio Message
  sendAudioMessage: Joi.object({
    to: Joi.string().required(),
    audio: Joi.string().uri().required(),
  }),

  // Send Video Message
  sendVideoMessage: Joi.object({
    to: Joi.string().required(),
    video: Joi.string().uri().required(),
    caption: Joi.string().max(1024),
  }),

  // Send Location Message
  sendLocationMessage: Joi.object({
    to: Joi.string().required(),
    latitude: Joi.number().min(-90).max(90).required(),
    longitude: Joi.number().min(-180).max(180).required(),
    name: Joi.string().max(100),
    address: Joi.string().max(255),
  }),

  // Send Contact Message
  sendContactMessage: Joi.object({
    to: Joi.string().required(),
    contact: Joi.object({
      name: Joi.string().required(),
      phone: Joi.string().required(),
    }).required(),
  }),

  // Check Contacts
  checkContacts: Joi.object({
    numbers: Joi.array().items(Joi.string()).min(1).max(50).required(),
  }),

  // Configure Webhook
  configureWebhook: Joi.object({
    url: Joi.string().uri().required(),
    events: Joi.array()
      .items(
        Joi.string().valid(
          "message",
          "message_status",
          "connection_status",
          "qr_code",
          "instance_status"
        )
      )
      .min(1)
      .required(),
    secret: Joi.string().min(8).max(128),
  }),

  // Update Webhook
  updateWebhook: Joi.object({
    url: Joi.string().uri(),
    events: Joi.array()
      .items(
        Joi.string().valid(
          "message",
          "message_status",
          "connection_status",
          "qr_code",
          "instance_status"
        )
      )
      .min(1),
    secret: Joi.string().min(8).max(128),
    isActive: Joi.boolean(),
  }).min(1),

  // Stats Query
  statsQuery: Joi.object({
    period: Joi.string()
      .valid("1day", "7days", "30days", "90days")
      .default("7days"),
    type: Joi.string().valid("summary", "daily", "hourly").default("summary"),
  }),
};

export { ValidationMiddleware, ValidationSchemas };
export default ValidationMiddleware;
