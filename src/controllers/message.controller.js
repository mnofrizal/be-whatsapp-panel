import databaseConfig from "../config/database.js";
import logger from "../utils/logger.js";
import Helpers from "../utils/helpers.js";
import { HTTP_STATUS, ERROR_CODES } from "../utils/constants.js";
import baileysService from "../services/baileys.service.js";
import multer from "multer";
import path from "path";
import fs from "fs/promises";

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit (reduced for security)
  },
  fileFilter: (req, file, cb) => {
    // Allow common file types
    const allowedTypes = [
      "image/jpeg",
      "image/png",
      "image/gif",
      "image/webp",
      "video/mp4",
      "video/avi",
      "video/mov",
      "audio/mp3",
      "audio/wav",
      "audio/ogg",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "text/plain",
    ];

    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`File type ${file.mimetype} not allowed`), false);
    }
  },
});

class MessageController {
  /**
   * Send text message
   * POST /api/messages/text
   */
  static async sendTextMessage(req, res) {
    try {
      const { to, message } = req.body;
      const instanceId = req.instance.id;

      // Validate input
      if (!to || !message) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.VALIDATION_ERROR,
              "Both 'to' and 'message' fields are required"
            )
          );
      }

      // Check if instance is connected
      const instanceStatus = baileysService.getInstanceStatus(instanceId);
      if (!instanceStatus.isConnected) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.INSTANCE_NOT_CONNECTED,
              "Instance is not connected to WhatsApp"
            )
          );
      }

      // Send message via Baileys (statistics handled in service)
      const result = await baileysService.sendTextMessage(
        instanceId,
        to,
        message
      );

      // Update API call statistics only
      await MessageController.updateApiCallStats(instanceId);

      logger.info("Text message sent via API", {
        instanceId,
        instanceName: req.instance.name,
        to,
        messageId: result.key.id,
        apiKeyId: req.apiKey.id,
      });

      res.json(
        Helpers.createSuccessResponse(
          {
            messageId: result.key.id,
            status: "sent",
            to,
            timestamp: new Date().toISOString(),
          },
          {
            instanceName: req.instance.name,
          }
        )
      );
    } catch (error) {
      logger.error("Failed to send text message", {
        instanceId: req.instance?.id,
        error: error.message,
        apiKeyId: req.apiKey?.id,
      });

      // Failed message statistics handled in service layer

      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.MESSAGE_SEND_FAILED,
            "Failed to send message"
          )
        );
    }
  }

  /**
   * Send image message
   * POST /api/messages/image
   */
  static sendImageMessage = [
    upload.single("image"),
    async (req, res) => {
      try {
        const { to, caption } = req.body;
        const instanceId = req.instance.id;

        // Validate input
        if (!to) {
          return res
            .status(HTTP_STATUS.BAD_REQUEST)
            .json(
              Helpers.createErrorResponse(
                ERROR_CODES.VALIDATION_ERROR,
                "Field 'to' is required"
              )
            );
        }

        // Validate phone number format
        if (!Helpers.isValidPhoneNumber(to)) {
          return res
            .status(HTTP_STATUS.BAD_REQUEST)
            .json(
              Helpers.createErrorResponse(
                ERROR_CODES.VALIDATION_ERROR,
                "Invalid phone number format"
              )
            );
        }

        if (!req.file) {
          return res
            .status(HTTP_STATUS.BAD_REQUEST)
            .json(
              Helpers.createErrorResponse(
                ERROR_CODES.VALIDATION_ERROR,
                "Image file is required"
              )
            );
        }

        // Validate caption length if provided
        if (caption && caption.length > 1024) {
          return res
            .status(HTTP_STATUS.BAD_REQUEST)
            .json(
              Helpers.createErrorResponse(
                ERROR_CODES.VALIDATION_ERROR,
                "Caption cannot exceed 1024 characters"
              )
            );
        }

        // Check if instance is connected
        const instanceStatus = baileysService.getInstanceStatus(instanceId);
        if (!instanceStatus.isConnected) {
          return res
            .status(HTTP_STATUS.BAD_REQUEST)
            .json(
              Helpers.createErrorResponse(
                ERROR_CODES.INSTANCE_NOT_CONNECTED,
                "Instance is not connected to WhatsApp"
              )
            );
        }

        // Send image message via Baileys
        const result = await baileysService.sendMediaMessage(
          instanceId,
          to,
          req.file.buffer,
          "image",
          {
            caption,
            fileName: req.file.originalname,
            mimetype: req.file.mimetype,
          }
        );

        // Update API call statistics only (message stats handled in service)
        await MessageController.updateApiCallStats(instanceId);

        logger.info("Image message sent via API", {
          instanceId,
          instanceName: req.instance.name,
          to,
          messageId: result.key.id,
          fileName: req.file.originalname,
          fileSize: req.file.size,
          apiKeyId: req.apiKey.id,
        });

        res.json(
          Helpers.createSuccessResponse(
            {
              messageId: result.key.id,
              status: "sent",
              to,
              mediaType: "image",
              fileName: req.file.originalname,
              timestamp: new Date().toISOString(),
            },
            {
              instanceName: req.instance.name,
            }
          )
        );
      } catch (error) {
        logger.error("Failed to send image message", {
          instanceId: req.instance?.id,
          error: error.message,
          apiKeyId: req.apiKey?.id,
        });

        // Failed message statistics handled in service layer

        res
          .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.MESSAGE_SEND_FAILED,
              "Failed to send image message"
            )
          );
      }
    },
  ];

  /**
   * Send document message
   * POST /api/messages/document
   */
  static sendDocumentMessage = [
    upload.single("document"),
    async (req, res) => {
      try {
        const { to, caption } = req.body;
        const instanceId = req.instance.id;

        // Validate input
        if (!to) {
          return res
            .status(HTTP_STATUS.BAD_REQUEST)
            .json(
              Helpers.createErrorResponse(
                ERROR_CODES.VALIDATION_ERROR,
                "Field 'to' is required"
              )
            );
        }

        // Validate phone number format
        if (!Helpers.isValidPhoneNumber(to)) {
          return res
            .status(HTTP_STATUS.BAD_REQUEST)
            .json(
              Helpers.createErrorResponse(
                ERROR_CODES.VALIDATION_ERROR,
                "Invalid phone number format"
              )
            );
        }

        if (!req.file) {
          return res
            .status(HTTP_STATUS.BAD_REQUEST)
            .json(
              Helpers.createErrorResponse(
                ERROR_CODES.VALIDATION_ERROR,
                "Document file is required"
              )
            );
        }

        // Validate caption length if provided
        if (caption && caption.length > 1024) {
          return res
            .status(HTTP_STATUS.BAD_REQUEST)
            .json(
              Helpers.createErrorResponse(
                ERROR_CODES.VALIDATION_ERROR,
                "Caption cannot exceed 1024 characters"
              )
            );
        }

        // Check if instance is connected
        const instanceStatus = baileysService.getInstanceStatus(instanceId);
        if (!instanceStatus.isConnected) {
          return res
            .status(HTTP_STATUS.BAD_REQUEST)
            .json(
              Helpers.createErrorResponse(
                ERROR_CODES.INSTANCE_NOT_CONNECTED,
                "Instance is not connected to WhatsApp"
              )
            );
        }

        // Send document message via Baileys
        const result = await baileysService.sendMediaMessage(
          instanceId,
          to,
          req.file.buffer,
          "document",
          {
            caption,
            fileName: req.file.originalname,
            mimetype: req.file.mimetype,
          }
        );

        // Update API call statistics only (message stats handled in service)
        await MessageController.updateApiCallStats(instanceId);

        logger.info("Document message sent via API", {
          instanceId,
          instanceName: req.instance.name,
          to,
          messageId: result.key.id,
          fileName: req.file.originalname,
          fileSize: req.file.size,
          apiKeyId: req.apiKey.id,
        });

        res.json(
          Helpers.createSuccessResponse(
            {
              messageId: result.key.id,
              status: "sent",
              to,
              mediaType: "document",
              fileName: req.file.originalname,
              timestamp: new Date().toISOString(),
            },
            {
              instanceName: req.instance.name,
            }
          )
        );
      } catch (error) {
        logger.error("Failed to send document message", {
          instanceId: req.instance?.id,
          error: error.message,
          apiKeyId: req.apiKey?.id,
        });

        // Failed message statistics handled in service layer

        res
          .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.MESSAGE_SEND_FAILED,
              "Failed to send document message"
            )
          );
      }
    },
  ];

  /**
   * Send audio message
   * POST /api/messages/audio
   */
  static sendAudioMessage = [
    upload.single("audio"),
    async (req, res) => {
      try {
        const { to } = req.body;
        const instanceId = req.instance.id;

        // Validate input
        if (!to) {
          return res
            .status(HTTP_STATUS.BAD_REQUEST)
            .json(
              Helpers.createErrorResponse(
                ERROR_CODES.VALIDATION_ERROR,
                "Field 'to' is required"
              )
            );
        }

        // Validate phone number format
        if (!Helpers.isValidPhoneNumber(to)) {
          return res
            .status(HTTP_STATUS.BAD_REQUEST)
            .json(
              Helpers.createErrorResponse(
                ERROR_CODES.VALIDATION_ERROR,
                "Invalid phone number format"
              )
            );
        }

        if (!req.file) {
          return res
            .status(HTTP_STATUS.BAD_REQUEST)
            .json(
              Helpers.createErrorResponse(
                ERROR_CODES.VALIDATION_ERROR,
                "Audio file is required"
              )
            );
        }

        // Check if instance is connected
        const instanceStatus = baileysService.getInstanceStatus(instanceId);
        if (!instanceStatus.isConnected) {
          return res
            .status(HTTP_STATUS.BAD_REQUEST)
            .json(
              Helpers.createErrorResponse(
                ERROR_CODES.INSTANCE_NOT_CONNECTED,
                "Instance is not connected to WhatsApp"
              )
            );
        }

        // Send audio message via Baileys
        const result = await baileysService.sendMediaMessage(
          instanceId,
          to,
          req.file.buffer,
          "audio",
          {
            fileName: req.file.originalname,
            mimetype: req.file.mimetype,
          }
        );

        // Update API call statistics only (message stats handled in service)
        await MessageController.updateApiCallStats(instanceId);

        logger.info("Audio message sent via API", {
          instanceId,
          instanceName: req.instance.name,
          to,
          messageId: result.key.id,
          fileName: req.file.originalname,
          fileSize: req.file.size,
          apiKeyId: req.apiKey.id,
        });

        res.json(
          Helpers.createSuccessResponse(
            {
              messageId: result.key.id,
              status: "sent",
              to,
              mediaType: "audio",
              fileName: req.file.originalname,
              timestamp: new Date().toISOString(),
            },
            {
              instanceName: req.instance.name,
            }
          )
        );
      } catch (error) {
        logger.error("Failed to send audio message", {
          instanceId: req.instance?.id,
          error: error.message,
          apiKeyId: req.apiKey?.id,
        });

        // Failed message statistics handled in service layer

        res
          .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.MESSAGE_SEND_FAILED,
              "Failed to send audio message"
            )
          );
      }
    },
  ];

  /**
   * Send location message
   * POST /api/messages/location
   */
  static async sendLocationMessage(req, res) {
    try {
      const { to, latitude, longitude, name, address } = req.body;
      const instanceId = req.instance.id;

      // Validate input
      if (!to || !latitude || !longitude) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.VALIDATION_ERROR,
              "Fields 'to', 'latitude', and 'longitude' are required"
            )
          );
      }

      // Check if instance is connected
      const instanceStatus = baileysService.getInstanceStatus(instanceId);
      if (!instanceStatus.isConnected) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.INSTANCE_NOT_CONNECTED,
              "Instance is not connected to WhatsApp"
            )
          );
      }

      // Send location message via Baileys service
      const result = await baileysService.sendLocationMessage(instanceId, to, {
        latitude: parseFloat(latitude),
        longitude: parseFloat(longitude),
        name: name || "",
        address: address || "",
      });

      // Update API call statistics only (message stats handled in service)
      await MessageController.updateApiCallStats(instanceId);

      logger.info("Location message sent via API", {
        instanceId,
        instanceName: req.instance.name,
        to,
        messageId: result.key.id,
        latitude,
        longitude,
        apiKeyId: req.apiKey.id,
      });

      res.json(
        Helpers.createSuccessResponse(
          {
            messageId: result.key.id,
            status: "sent",
            to,
            messageType: "location",
            location: { latitude, longitude, name, address },
            timestamp: new Date().toISOString(),
          },
          {
            instanceName: req.instance.name,
          }
        )
      );
    } catch (error) {
      logger.error("Failed to send location message", {
        instanceId: req.instance?.id,
        error: error.message,
        apiKeyId: req.apiKey?.id,
      });

      // Failed message statistics handled in service layer

      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.MESSAGE_SEND_FAILED,
            "Failed to send location message"
          )
        );
    }
  }

  /**
   * Check if phone numbers are registered on WhatsApp
   * POST /api/contacts/check
   */
  static async checkContacts(req, res) {
    try {
      const { phoneNumbers } = req.body;
      const instanceId = req.instance.id;

      // Validate input
      if (
        !phoneNumbers ||
        !Array.isArray(phoneNumbers) ||
        phoneNumbers.length === 0
      ) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.VALIDATION_ERROR,
              "Field 'phoneNumbers' must be a non-empty array"
            )
          );
      }

      if (phoneNumbers.length > 50) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.VALIDATION_ERROR,
              "Maximum 50 phone numbers allowed per request"
            )
          );
      }

      // Check if instance is connected
      const instanceStatus = baileysService.getInstanceStatus(instanceId);
      if (!instanceStatus.isConnected) {
        return res
          .status(HTTP_STATUS.BAD_REQUEST)
          .json(
            Helpers.createErrorResponse(
              ERROR_CODES.INSTANCE_NOT_CONNECTED,
              "Instance is not connected to WhatsApp"
            )
          );
      }

      // Check each phone number
      const results = [];
      for (const phone of phoneNumbers) {
        try {
          const result = await baileysService.checkPhoneNumber(
            instanceId,
            phone
          );
          results.push({
            phone,
            exists: result.exists,
            jid: result.jid,
          });
        } catch (error) {
          results.push({
            phone,
            exists: false,
            error: error.message,
          });
        }
      }

      // Update API call statistics
      await MessageController.updateApiCallStats(instanceId);

      logger.info("Contact check completed via API", {
        instanceId,
        instanceName: req.instance.name,
        phoneCount: phoneNumbers.length,
        validCount: results.filter((r) => r.exists).length,
        apiKeyId: req.apiKey.id,
      });

      res.json(
        Helpers.createSuccessResponse(
          {
            results,
            total: results.length,
            valid: results.filter((r) => r.exists).length,
            invalid: results.filter((r) => !r.exists).length,
          },
          {
            instanceName: req.instance.name,
          }
        )
      );
    } catch (error) {
      logger.error("Failed to check contacts", {
        instanceId: req.instance?.id,
        error: error.message,
        apiKeyId: req.apiKey?.id,
      });

      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to check contacts"
          )
        );
    }
  }

  /**
   * Get instance information
   * GET /api/instance/info
   */
  static async getInstanceInfo(req, res) {
    try {
      const instanceId = req.instance.id;
      const instanceStatus = baileysService.getInstanceStatus(instanceId);

      const info = {
        id: req.instance.id,
        name: req.instance.name,
        status: req.instance.status,
        phone: instanceStatus.phone,
        displayName: instanceStatus.displayName,
        isConnected: instanceStatus.isConnected,
        connectionState: instanceStatus.connectionState,
        lastConnectedAt: req.instance.lastConnectedAt,
        lastDisconnectedAt: req.instance.lastDisconnectedAt,
        createdAt: req.instance.createdAt,
      };

      res.json(
        Helpers.createSuccessResponse(info, {
          instanceName: req.instance.name,
        })
      );
    } catch (error) {
      logger.error("Failed to get instance info", {
        instanceId: req.instance?.id,
        error: error.message,
        apiKeyId: req.apiKey?.id,
      });

      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to get instance information"
          )
        );
    }
  }

  /**
   * Get message statistics
   * GET /api/stats
   */
  static async getStats(req, res) {
    try {
      const instanceId = req.instance.id;
      const { period = "7" } = req.query; // Default to 7 days

      const prisma = databaseConfig.getClient();

      // Calculate date range
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - parseInt(period));

      // Get message statistics
      const stats = await prisma.messageStat.findMany({
        where: {
          instanceId,
          date: {
            gte: startDate.toISOString().split("T")[0],
            lte: endDate.toISOString().split("T")[0],
          },
        },
        orderBy: {
          date: "asc",
        },
      });

      // Calculate totals
      const totals = stats.reduce(
        (acc, stat) => ({
          messagesSent: acc.messagesSent + stat.messagesSent,
          messagesReceived: acc.messagesReceived + stat.messagesReceived,
          messagesFailed: acc.messagesFailed + stat.messagesFailed,
          apiCalls: acc.apiCalls + stat.apiCalls,
        }),
        { messagesSent: 0, messagesReceived: 0, messagesFailed: 0, apiCalls: 0 }
      );

      // Update API call statistics
      await MessageController.updateApiCallStats(instanceId);

      res.json(
        Helpers.createSuccessResponse(
          {
            period: parseInt(period),
            totals,
            daily: stats,
          },
          {
            instanceName: req.instance.name,
          }
        )
      );
    } catch (error) {
      logger.error("Failed to get statistics", {
        instanceId: req.instance?.id,
        error: error.message,
        apiKeyId: req.apiKey?.id,
      });

      res
        .status(HTTP_STATUS.INTERNAL_SERVER_ERROR)
        .json(
          Helpers.createErrorResponse(
            ERROR_CODES.INTERNAL_ERROR,
            "Failed to get statistics"
          )
        );
    }
  }

  /**
   * Update API call statistics
   * @param {string} instanceId - Instance ID
   */
  static async updateApiCallStats(instanceId) {
    try {
      const prisma = databaseConfig.getClient();
      const today = new Date().toISOString().split("T")[0];

      await prisma.messageStat.upsert({
        where: {
          instanceId_date: {
            instanceId,
            date: today,
          },
        },
        update: {
          apiCalls: {
            increment: 1,
          },
        },
        create: {
          instanceId,
          date: today,
          apiCalls: 1,
        },
      });
    } catch (error) {
      logger.error("Failed to update API call stats", {
        instanceId,
        error: error.message,
      });
    }
  }
}

export default MessageController;
