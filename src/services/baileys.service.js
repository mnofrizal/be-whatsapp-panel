import {
  makeWASocket,
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import path from "path";
import fs from "fs/promises";
import databaseConfig from "../config/database.js";
import logger from "../utils/logger.js";
import config from "../config/environment.js";
import socketService from "./socket.service.js";
import { INSTANCE_STATUS } from "../utils/constants.js";

class BaileysService {
  constructor() {
    this.instances = new Map(); // instanceId -> socket connection
    this.qrCodes = new Map(); // instanceId -> qr code data
    this.connectionStates = new Map(); // instanceId -> connection state
    this.reconnectAttempts = new Map(); // instanceId -> attempt count
    this.qrAttempts = new Map(); // instanceId -> QR code attempt count
    this.manualDisconnects = new Map(); // instanceId -> boolean (track manual disconnections)
    this.maxReconnectAttempts = 5;
    this.maxQRAttempts = 3; // Limit QR attempts per connection session
    this.reconnectDelay = 5000; // 5 seconds base delay
  }

  /**
   * Initialize a new WhatsApp instance (without connecting)
   * @param {string} instanceId - Unique instance identifier
   * @param {Object} config - Instance configuration
   */
  async createInstance(instanceId, instanceConfig = {}) {
    try {
      logger.info(`Initializing Baileys instance: ${instanceId}`, {
        instanceId,
      });

      // Check if instance already exists
      if (this.instances.has(instanceId)) {
        throw new Error(`Instance ${instanceId} already exists`);
      }

      // Create auth directory for this instance
      const authDir = path.join(process.cwd(), "sessions", instanceId);
      await fs.mkdir(authDir, { recursive: true });

      // Store instance configuration for later use
      this.instanceConfigs = this.instanceConfigs || new Map();
      this.instanceConfigs.set(instanceId, {
        authDir,
        config: instanceConfig,
      });

      // Set initial state as disconnected
      this.connectionStates.set(instanceId, INSTANCE_STATUS.DISCONNECTED);
      this.reconnectAttempts.set(instanceId, 0);

      logger.info(`Baileys instance initialized successfully: ${instanceId}`, {
        instanceId,
      });
      return { instanceId, status: INSTANCE_STATUS.DISCONNECTED };
    } catch (error) {
      logger.error("Failed to initialize Baileys instance", {
        instanceId,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Connect an existing instance (creates socket and starts connection)
   * @param {string} instanceId - Instance identifier
   */
  async connectInstance(instanceId) {
    try {
      logger.info("Connecting instance", { instanceId });

      // Clear manual disconnect flag when manually connecting
      this.manualDisconnects.delete(instanceId);

      // Check if instance is already connected
      if (this.instances.has(instanceId)) {
        const currentState = this.connectionStates.get(instanceId);
        if (
          currentState === INSTANCE_STATUS.CONNECTED ||
          currentState === INSTANCE_STATUS.CONNECTING
        ) {
          logger.info("Instance already connecting/connected", {
            instanceId,
            currentState,
          });
          return this.instances.get(instanceId);
        }
      }

      // Get instance configuration
      const instanceConfig = this.instanceConfigs?.get(instanceId);
      if (!instanceConfig) {
        throw new Error(
          `Instance ${instanceId} not initialized. Call createInstance first.`
        );
      }

      // Initialize auth state
      const { state, saveCreds } = await useMultiFileAuthState(
        instanceConfig.authDir
      );

      // Get latest Baileys version
      const { version, isLatest } = await fetchLatestBaileysVersion();
      logger.info("Using Baileys version", { version, isLatest, instanceId });

      // Create socket configuration
      const socketConfig = {
        version,
        auth: state,
        printQRInTerminal: false, // We'll handle QR codes ourselves
        logger: this.createBaileysLogger(instanceId),
        browser: ["WhatsApp API", "Chrome", "1.0.0"],
        defaultQueryTimeoutMs: 60000,
        connectTimeoutMs: 60000,
        keepAliveIntervalMs: 30000,
        ...instanceConfig.config,
      };

      // Create WhatsApp socket
      const socket = makeWASocket(socketConfig);

      // Store instance
      this.instances.set(instanceId, socket);
      this.connectionStates.set(instanceId, INSTANCE_STATUS.CONNECTING);
      this.reconnectAttempts.set(instanceId, 0);
      this.qrAttempts.set(instanceId, 0); // Reset QR attempts for new connection

      // Set up event handlers
      this.setupEventHandlers(instanceId, socket, saveCreds);

      // Update database status
      await this.updateInstanceStatus(instanceId, INSTANCE_STATUS.CONNECTING);

      logger.info("Instance connection initiated", { instanceId });
      return socket;
    } catch (error) {
      logger.error("Failed to connect instance", {
        instanceId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Disconnect an instance
   * @param {string} instanceId - Instance identifier
   */
  async disconnectInstance(instanceId) {
    try {
      logger.info("Disconnecting instance (preserving session)", {
        instanceId,
      });

      // Mark as manual disconnect to prevent auto-reconnection
      this.manualDisconnects.set(instanceId, true);

      const socket = this.instances.get(instanceId);
      if (socket) {
        // Only close the connection, don't logout (preserve session)
        socket.end();
        this.instances.delete(instanceId);
      }

      // Clean up state but preserve session
      this.qrCodes.delete(instanceId);
      this.connectionStates.set(instanceId, INSTANCE_STATUS.DISCONNECTED);
      this.reconnectAttempts.delete(instanceId);
      this.qrAttempts.delete(instanceId);

      // Update database status
      await this.updateInstanceStatus(instanceId, INSTANCE_STATUS.DISCONNECTED);

      logger.info("Instance disconnected successfully (session preserved)", {
        instanceId,
      });
    } catch (error) {
      logger.error("Failed to disconnect instance", {
        instanceId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Restart an instance (disconnect and reconnect)
   * @param {string} instanceId - Instance identifier
   */
  async restartInstance(instanceId) {
    try {
      logger.info("Restarting instance", { instanceId });

      // For restart, we don't want to set manual disconnect flag
      // Just disconnect and immediately reconnect
      const socket = this.instances.get(instanceId);
      if (socket) {
        socket.end();
        this.instances.delete(instanceId);
      }

      // Clean up state but don't set manual disconnect flag
      this.qrCodes.delete(instanceId);
      this.connectionStates.set(instanceId, INSTANCE_STATUS.DISCONNECTED);
      this.reconnectAttempts.delete(instanceId);
      this.qrAttempts.delete(instanceId);

      // Immediately reconnect
      await this.connectInstance(instanceId);

      logger.info("Instance restarted successfully", { instanceId });
    } catch (error) {
      logger.error("Failed to restart instance", {
        instanceId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Logout an instance (sign out and delete session)
   * @param {string} instanceId - Instance identifier
   */
  async logoutInstance(instanceId) {
    try {
      logger.info("Logging out instance (deleting session)", { instanceId });

      const socket = this.instances.get(instanceId);
      if (socket) {
        // Call logout to delete session completely
        await socket.logout();
        socket.end();
        this.instances.delete(instanceId);
      }

      // Clean up all state and session data
      this.qrCodes.delete(instanceId);
      this.connectionStates.delete(instanceId);
      this.reconnectAttempts.delete(instanceId);
      this.qrAttempts.delete(instanceId);

      // Remove session files
      const authDir = path.join(process.cwd(), "sessions", instanceId);
      try {
        await fs.rm(authDir, { recursive: true, force: true });
        logger.info("Session files deleted", { instanceId, authDir });
      } catch (error) {
        logger.warn("Failed to delete session files", {
          instanceId,
          authDir,
          error: error.message,
        });
      }

      // Update database status
      await this.updateInstanceStatus(instanceId, INSTANCE_STATUS.DISCONNECTED);

      logger.info("Instance logged out successfully (session deleted)", {
        instanceId,
      });
    } catch (error) {
      logger.error("Failed to logout instance", {
        instanceId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Force disconnect an instance without auto-reconnection
   * @param {string} instanceId - Instance identifier
   * @param {string} reason - Reason for forced disconnection
   */
  async forceDisconnect(instanceId, reason) {
    try {
      const instanceName = await this.getInstanceName(instanceId);
      logger.info(
        `Force disconnecting instance [${instanceName}] - ${reason}`,
        {
          instanceId,
          instanceName,
          reason,
        }
      );

      const socket = this.instances.get(instanceId);
      if (socket) {
        try {
          // Remove event listeners to prevent further connection updates
          socket.removeAllListeners();
          // Try to close socket gracefully
          if (typeof socket.end === "function") {
            socket.end();
          }
          if (typeof socket.close === "function") {
            socket.close();
          }
        } catch (socketError) {
          logger.warn("Error closing socket during force disconnect", {
            instanceId,
            error: socketError.message,
          });
        }
        this.instances.delete(instanceId);
      }

      // Clean up state and mark as force disconnected to prevent auto-reconnection
      this.qrCodes.delete(instanceId);
      this.connectionStates.set(instanceId, "FORCE_DISCONNECTED");
      this.qrAttempts.delete(instanceId);
      this.reconnectAttempts.set(instanceId, 999); // Set high value to prevent reconnection

      // Update database status with error
      await this.updateInstanceStatus(
        instanceId,
        INSTANCE_STATUS.DISCONNECTED,
        reason
      );

      logger.info(
        `Instance [${instanceName}] force disconnected successfully - manual reconnection required`,
        {
          instanceId,
          instanceName,
          reason,
        }
      );
    } catch (error) {
      logger.error("Failed to force disconnect instance", {
        instanceId,
        reason,
        error: error.message,
        stack: error.stack,
      });
      // Don't throw error to prevent cascading failures
    }
  }

  /**
   * Delete an instance completely
   * @param {string} instanceId - Instance identifier
   */
  async deleteInstance(instanceId) {
    try {
      logger.info("Deleting instance", { instanceId });

      // Logout first to properly sign out from WhatsApp servers
      await this.logoutInstance(instanceId);

      logger.info("Instance deleted successfully", { instanceId });
    } catch (error) {
      logger.error("Failed to delete instance", {
        instanceId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get current QR code for an instance
   * @param {string} instanceId - Instance identifier
   */
  async getQRCode(instanceId) {
    const qrData = this.qrCodes.get(instanceId);
    if (!qrData) {
      return null;
    }

    // Check if QR code is expired
    if (qrData.expiry && new Date() > qrData.expiry) {
      this.qrCodes.delete(instanceId);
      return null;
    }

    return qrData;
  }

  /**
   * Get instance connection status
   * @param {string} instanceId - Instance identifier
   */
  getInstanceStatus(instanceId) {
    const socket = this.instances.get(instanceId);
    const connectionState = this.connectionStates.get(instanceId);
    const reconnectAttempts = this.reconnectAttempts.get(instanceId) || 0;
    const qrAttempts = this.qrAttempts.get(instanceId) || 0;

    return {
      exists: !!socket,
      connectionState: connectionState || INSTANCE_STATUS.DISCONNECTED,
      reconnectAttempts,
      qrAttempts,
      maxQRAttempts: this.maxQRAttempts,
      isConnected: socket?.user ? true : false,
      phone: socket?.user?.id ? socket.user.id.split(":")[0] : null,
      displayName: socket?.user?.name || null,
    };
  }

  /**
   * Send text message
   * @param {string} instanceId - Instance identifier
   * @param {string} to - Recipient phone number
   * @param {string} message - Message text
   */
  async sendTextMessage(instanceId, to, message) {
    try {
      const socket = this.instances.get(instanceId);
      if (!socket) {
        throw new Error(`Instance ${instanceId} not found`);
      }

      if (!socket.user) {
        throw new Error(`Instance ${instanceId} is not connected`);
      }

      // Format phone number to JID
      const jid = this.formatPhoneToJID(to);

      // Send message
      const result = await socket.sendMessage(jid, { text: message });

      logger.info("Text message sent", {
        instanceId,
        to: jid,
        messageId: result.key.id,
      });

      return result;
    } catch (error) {
      logger.error("Failed to send text message", {
        instanceId,
        to,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Send media message
   * @param {string} instanceId - Instance identifier
   * @param {string} to - Recipient phone number
   * @param {Buffer} media - Media buffer
   * @param {string} mediaType - Media type (image, video, audio, document)
   * @param {Object} options - Additional options
   */
  async sendMediaMessage(instanceId, to, media, mediaType, options = {}) {
    try {
      const socket = this.instances.get(instanceId);
      if (!socket) {
        throw new Error(`Instance ${instanceId} not found`);
      }

      if (!socket.user) {
        throw new Error(`Instance ${instanceId} is not connected`);
      }

      // Format phone number to JID
      const jid = this.formatPhoneToJID(to);

      // Prepare media message
      const mediaMessage = {
        [mediaType]: media,
        caption: options.caption || "",
        fileName:
          options.fileName || `file.${this.getFileExtension(mediaType)}`,
        mimetype: options.mimetype || this.getMimeType(mediaType),
      };

      // Send message
      const result = await socket.sendMessage(jid, mediaMessage);

      logger.info("Media message sent", {
        instanceId,
        to: jid,
        mediaType,
        messageId: result.key.id,
      });

      return result;
    } catch (error) {
      logger.error("Failed to send media message", {
        instanceId,
        to,
        mediaType,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Check if phone number is registered on WhatsApp
   * @param {string} instanceId - Instance identifier
   * @param {string} phone - Phone number to check
   */
  async checkPhoneNumber(instanceId, phone) {
    try {
      const socket = this.instances.get(instanceId);
      if (!socket) {
        throw new Error(`Instance ${instanceId} not found`);
      }

      if (!socket.user) {
        throw new Error(`Instance ${instanceId} is not connected`);
      }

      const jid = this.formatPhoneToJID(phone);
      const [result] = await socket.onWhatsApp(jid);

      return {
        exists: !!result?.exists,
        jid: result?.jid || jid,
      };
    } catch (error) {
      logger.error("Failed to check phone number", {
        instanceId,
        phone,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Setup event handlers for a socket
   * @param {string} instanceId - Instance identifier
   * @param {Object} socket - Baileys socket
   * @param {Function} saveCreds - Save credentials function
   */
  setupEventHandlers(instanceId, socket, saveCreds) {
    // Connection updates
    socket.ev.on("connection.update", async (update) => {
      await this.handleConnectionUpdate(instanceId, update);
    });

    // Credentials update
    socket.ev.on("creds.update", saveCreds);

    // Messages (for webhook/statistics)
    socket.ev.on("messages.upsert", async (messageUpdate) => {
      await this.handleMessagesUpsert(instanceId, messageUpdate);
    });

    // Contacts update
    socket.ev.on("contacts.update", async (contacts) => {
      await this.handleContactsUpdate(instanceId, contacts);
    });
  }

  /**
   * Handle connection updates
   * @param {string} instanceId - Instance identifier
   * @param {Object} update - Connection update
   */
  async handleConnectionUpdate(instanceId, update) {
    try {
      const { connection, lastDisconnect, qr } = update;

      // Check if instance was force disconnected - ignore all updates
      const connectionState = this.connectionStates.get(instanceId);
      if (connectionState === "FORCE_DISCONNECTED") {
        logger.debug(
          "Ignoring connection update for force disconnected instance",
          {
            instanceId,
            connection,
          }
        );
        return;
      }

      logger.info("Connection update", {
        instanceId,
        connection,
        lastDisconnect: lastDisconnect?.error?.message,
      });

      if (qr) {
        await this.handleQRCode(instanceId, qr);
      }

      if (connection === "close") {
        await this.handleConnectionClose(instanceId, lastDisconnect);
      } else if (connection === "open") {
        await this.handleConnectionOpen(instanceId);
      } else if (connection === "connecting") {
        const attempts = this.reconnectAttempts.get(instanceId) || 0;
        const newStatus =
          attempts > 0 ? INSTANCE_STATUS.RECONNECTING : INSTANCE_STATUS.INIT;
        this.connectionStates.set(instanceId, newStatus);
        await this.updateInstanceStatus(instanceId, newStatus);
      }
    } catch (error) {
      logger.error("Error handling connection update", {
        instanceId,
        error: error.message,
      });
    }
  }

  /**
   * Handle QR code generation
   * @param {string} instanceId - Instance identifier
   * @param {string} qr - QR code string
   */
  async handleQRCode(instanceId, qr) {
    try {
      // Check if instance was force disconnected - ignore QR generation
      const connectionState = this.connectionStates.get(instanceId);
      if (connectionState === "FORCE_DISCONNECTED") {
        logger.debug("Ignoring QR code for force disconnected instance", {
          instanceId,
        });
        return;
      }

      this.connectionStates.set(instanceId, INSTANCE_STATUS.QR_REQUIRED);
      await this.updateInstanceStatus(instanceId, INSTANCE_STATUS.QR_REQUIRED);

      // Get instance name for better logging
      const instanceName = await this.getInstanceName(instanceId);

      // Increment QR attempt counter
      const currentAttempts = this.qrAttempts.get(instanceId) || 0;
      const newAttempts = currentAttempts + 1;

      logger.info(
        `QR code attempt #${newAttempts} for instance [${instanceName}]`,
        {
          instanceId,
          instanceName,
          attempt: newAttempts,
          maxAttempts: this.maxQRAttempts,
        }
      );

      // Check if we've exceeded the maximum QR attempts
      if (newAttempts > this.maxQRAttempts) {
        logger.warn(
          `Maximum QR attempts reached for instance [${instanceName}], stopping connection`,
          {
            instanceId,
            instanceName,
            attempts: newAttempts,
            maxAttempts: this.maxQRAttempts,
          }
        );

        // Disconnect the instance and prevent auto-reconnection
        await this.forceDisconnect(instanceId, "Maximum QR attempts reached");
        return;
      }

      // Update QR attempt counter AFTER checking the limit
      this.qrAttempts.set(instanceId, newAttempts);

      // The raw QR string is 'qr'
      const expiry = new Date(Date.now() + 60000); // 1 minute expiry

      // Store raw QR code
      this.qrCodes.set(instanceId, {
        qr: qr, // Store raw QR string
        expiry,
        raw: qr,
        attempt: newAttempts,
      });

      // Update database with raw QR string
      const prisma = databaseConfig.getClient();
      const instance = await prisma.instance.update({
        where: { id: instanceId },
        data: {
          qrCode: qr, // Store raw QR string
          qrCodeExpiry: expiry,
        },
      });

      socketService.emitInstanceQRGenerated(
        instanceId,
        instance.subscriptionId,
        {
          qr,
          expiry,
          attempt: newAttempts,
        }
      );

      logger.info(
        `QR code #${newAttempts} generated successfully for instance [${instanceName}] - expires in 60 seconds`,
        {
          instanceId,
          instanceName,
          attempt: newAttempts,
          expiry,
        }
      );
    } catch (error) {
      logger.error("Failed to handle QR code", {
        instanceId,
        error: error.message,
        stack: error.stack,
      });
    }
  }

  /**
   * Handle connection close
   * @param {string} instanceId - Instance identifier
   * @param {Object} lastDisconnect - Last disconnect info
   */
  async handleConnectionClose(instanceId, lastDisconnect) {
    try {
      const shouldReconnect =
        lastDisconnect?.error instanceof Boom
          ? lastDisconnect.error.output.statusCode !==
            DisconnectReason.loggedOut
          : true;

      this.connectionStates.set(instanceId, INSTANCE_STATUS.DISCONNECTED);

      // Check if this was a manual disconnect
      const isManualDisconnect = this.manualDisconnects.get(instanceId);
      if (isManualDisconnect) {
        logger.info("Manual disconnect detected, not attempting reconnection", {
          instanceId,
        });
        await this.updateInstanceStatus(
          instanceId,
          INSTANCE_STATUS.DISCONNECTED
        );
        return; // Don't attempt reconnection for manual disconnects
      }

      // Check if disconnection was due to QR timeout and max attempts reached
      const qrAttempts = this.qrAttempts.get(instanceId) || 0;
      const isQRTimeout =
        lastDisconnect?.error instanceof Boom &&
        lastDisconnect.error.output.statusCode === DisconnectReason.timedOut;

      if (isQRTimeout && qrAttempts >= this.maxQRAttempts) {
        // Max QR attempts reached, don't auto-reconnect
        logger.info("Max QR attempts reached, manual reconnection required", {
          instanceId,
          qrAttempts,
          maxQRAttempts: this.maxQRAttempts,
        });

        await this.updateInstanceStatus(
          instanceId,
          INSTANCE_STATUS.DISCONNECTED,
          `Maximum QR attempts (${this.maxQRAttempts}) reached. Manual reconnection required.`
        );

        // Clean up QR attempts counter
        this.qrAttempts.delete(instanceId);
        return;
      }

      await this.updateInstanceStatus(instanceId, INSTANCE_STATUS.DISCONNECTED);

      if (shouldReconnect) {
        await this.attemptReconnect(instanceId);
      } else {
        logger.info("Instance logged out, not reconnecting", { instanceId });
        await this.deleteInstance(instanceId);
      }
    } catch (error) {
      logger.error("Error handling connection close", {
        instanceId,
        error: error.message,
      });
    }
  }

  /**
   * Handle connection open
   * @param {string} instanceId - Instance identifier
   */
  async handleConnectionOpen(instanceId) {
    try {
      const socket = this.instances.get(instanceId);
      if (!socket) return;

      this.connectionStates.set(instanceId, INSTANCE_STATUS.CONNECTED);
      this.reconnectAttempts.set(instanceId, 0);

      // Clear QR code
      this.qrCodes.delete(instanceId);

      // Prepare connection data
      const connectionData = {
        phone: socket.user?.id ? socket.user.id.split(":")[0] : null,
        displayName: socket.user?.name || null,
        lastConnectedAt: new Date(),
        qrCode: null,
        qrCodeExpiry: null,
        connectionAttempts: 0,
      };

      // Update status and connection info in one go
      await this.updateInstanceStatus(
        instanceId,
        INSTANCE_STATUS.CONNECTED,
        null,
        connectionData
      );

      logger.info("Instance connected successfully", {
        instanceId,
        phone: socket.user?.id,
        displayName: socket.user?.name,
      });
    } catch (error) {
      logger.error("Error handling connection open", {
        instanceId,
        error: error.message,
      });
    }
  }

  /**
   * Attempt to reconnect an instance
   * @param {string} instanceId - Instance identifier
   */
  async attemptReconnect(instanceId) {
    try {
      const attempts = this.reconnectAttempts.get(instanceId) || 0;
      const connectionState = this.connectionStates.get(instanceId);

      // Check if instance was force disconnected (due to max QR attempts)
      if (connectionState === "FORCE_DISCONNECTED" || attempts >= 900) {
        logger.info("Instance force disconnected, skipping auto-reconnection", {
          instanceId,
          connectionState,
          attempts,
        });
        return;
      }

      if (attempts >= this.maxReconnectAttempts) {
        logger.warn("Max reconnect attempts reached", { instanceId, attempts });
        await this.updateInstanceStatus(
          instanceId,
          INSTANCE_STATUS.ERROR,
          "Max reconnect attempts reached"
        );
        return;
      }

      const delay = this.reconnectDelay * Math.pow(2, attempts); // Exponential backoff
      logger.info("Scheduling reconnect", { instanceId, attempts, delay });

      setTimeout(async () => {
        try {
          // Double-check if still should reconnect
          const currentState = this.connectionStates.get(instanceId);
          if (currentState === "FORCE_DISCONNECTED") {
            logger.info(
              "Instance was force disconnected, canceling reconnect",
              {
                instanceId,
              }
            );
            return;
          }

          this.reconnectAttempts.set(instanceId, attempts + 1);
          await this.connectInstance(instanceId);
        } catch (error) {
          logger.error("Reconnect attempt failed", {
            instanceId,
            attempts: attempts + 1,
            error: error.message,
          });
        }
      }, delay);
    } catch (error) {
      logger.error("Error in reconnect attempt", {
        instanceId,
        error: error.message,
      });
    }
  }

  /**
   * Handle incoming messages (for statistics)
   * @param {string} instanceId - Instance identifier
   * @param {Object} messageUpdate - Message update
   */
  async handleMessagesUpsert(instanceId, messageUpdate) {
    try {
      // This is for statistics only - we don't store message content
      const { messages, type } = messageUpdate;

      if (type === "notify") {
        // Count received messages for statistics
        const receivedCount = messages.filter((msg) => !msg.key.fromMe).length;

        if (receivedCount > 0) {
          await this.updateMessageStats(instanceId, "received", receivedCount);
        }
      }
    } catch (error) {
      logger.error("Error handling messages upsert", {
        instanceId,
        error: error.message,
      });
    }
  }

  /**
   * Handle contacts update
   * @param {string} instanceId - Instance identifier
   * @param {Array} contacts - Updated contacts
   */
  async handleContactsUpdate(instanceId, contacts) {
    try {
      // Update contacts in database
      const prisma = databaseConfig.getClient();

      for (const contact of contacts) {
        await prisma.contact.upsert({
          where: {
            instanceId_jid: {
              instanceId,
              jid: contact.id,
            },
          },
          update: {
            name: contact.name || contact.notify,
            notify: contact.notify,
          },
          create: {
            instanceId,
            jid: contact.id,
            name: contact.name || contact.notify,
            notify: contact.notify,
          },
        });
      }

      logger.info("Contacts updated", { instanceId, count: contacts.length });
    } catch (error) {
      logger.error("Error handling contacts update", {
        instanceId,
        error: error.message,
      });
    }
  }

  /**
   * Update instance status in database
   * @param {string} instanceId - Instance identifier
   * @param {string} status - New status
   * @param {string} error - Error message (optional)
   */
  async updateInstanceStatus(
    instanceId,
    newStatus,
    error = null,
    extraData = {}
  ) {
    try {
      const prisma = databaseConfig.getClient();

      const currentInstance = await prisma.instance.findUnique({
        where: { id: instanceId },
        select: { status: true, subscriptionId: true },
      });
      const oldStatus = currentInstance?.status;

      const updateData = {
        status: newStatus,
        updatedAt: new Date(),
        ...extraData,
      };

      if (newStatus === INSTANCE_STATUS.DISCONNECTED) {
        updateData.lastDisconnectedAt = new Date();
      }

      if (error) {
        updateData.lastError = error;
        updateData.lastErrorAt = new Date();
      } else if (newStatus === INSTANCE_STATUS.CONNECTED) {
        // Clear previous error on successful connection
        updateData.lastError = null;
        updateData.lastErrorAt = null;
      }

      await prisma.instance.update({
        where: { id: instanceId },
        data: updateData,
      });

      if (oldStatus !== newStatus) {
        socketService.emitInstanceStatusChange(
          instanceId,
          currentInstance.subscriptionId,
          oldStatus,
          newStatus,
          { error, timestamp: new Date().toISOString(), ...extraData }
        );
      }
      return currentInstance;
    } catch (dbError) {
      logger.error("Failed to update instance status", {
        instanceId,
        status: newStatus,
        error: dbError.message,
      });
    }
  }

  /**
   * Update message statistics
   * @param {string} instanceId - Instance identifier
   * @param {string} type - Message type (sent/received)
   * @param {number} count - Message count
   */
  async updateMessageStats(instanceId, type, count = 1) {
    try {
      const prisma = databaseConfig.getClient();
      const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

      const field = type === "sent" ? "messagesSent" : "messagesReceived";

      await prisma.messageStat.upsert({
        where: {
          instanceId_date: {
            instanceId,
            date: today,
          },
        },
        update: {
          [field]: {
            increment: count,
          },
        },
        create: {
          instanceId,
          date: today,
          [field]: count,
        },
      });
    } catch (error) {
      logger.error("Failed to update message stats", {
        instanceId,
        type,
        count,
        error: error.message,
      });
    }
  }

  /**
   * Create Baileys logger for an instance
   * @param {string} instanceId - Instance identifier
   */
  createBaileysLogger(instanceId) {
    return {
      level: config.nodeEnv === "development" ? "debug" : "warn",
      child: () => this.createBaileysLogger(instanceId),
      trace: (...args) => logger.debug(`[Baileys:${instanceId}]`, ...args),
      debug: (...args) => logger.debug(`[Baileys:${instanceId}]`, ...args),
      info: (...args) => logger.info(`[Baileys:${instanceId}]`, ...args),
      warn: (...args) => logger.warn(`[Baileys:${instanceId}]`, ...args),
      error: (...args) => logger.error(`[Baileys:${instanceId}]`, ...args),
      fatal: (...args) => logger.error(`[Baileys:${instanceId}]`, ...args),
    };
  }

  /**
   * Format phone number to WhatsApp JID
   * @param {string} phone - Phone number
   */
  formatPhoneToJID(phone) {
    // Remove all non-numeric characters
    const cleanPhone = phone.replace(/\D/g, "");

    // Add country code if not present (assuming international format)
    const formattedPhone = cleanPhone.startsWith("62")
      ? cleanPhone
      : `62${cleanPhone}`;

    return `${formattedPhone}@s.whatsapp.net`;
  }

  /**
   * Get file extension for media type
   * @param {string} mediaType - Media type
   */
  getFileExtension(mediaType) {
    const extensions = {
      image: "jpg",
      video: "mp4",
      audio: "mp3",
      document: "pdf",
    };
    return extensions[mediaType] || "bin";
  }

  /**
   * Get MIME type for media type
   * @param {string} mediaType - Media type
   */
  getMimeType(mediaType) {
    const mimeTypes = {
      image: "image/jpeg",
      video: "video/mp4",
      audio: "audio/mpeg",
      document: "application/pdf",
    };
    return mimeTypes[mediaType] || "application/octet-stream";
  }

  /**
   * Get instance name from database
   * @param {string} instanceId - Instance identifier
   */
  async getInstanceName(instanceId) {
    try {
      const prisma = databaseConfig.getClient();
      const instance = await prisma.instance.findUnique({
        where: { id: instanceId },
        select: { name: true },
      });
      return instance?.name || instanceId;
    } catch (error) {
      logger.error("Failed to get instance name", {
        instanceId,
        error: error.message,
      });
      return instanceId; // Fallback to instanceId
    }
  }

  /**
   * Get all active instances
   */
  getAllInstances() {
    return Array.from(this.instances.keys()).map((instanceId) => ({
      instanceId,
      status: this.getInstanceStatus(instanceId),
    }));
  }

  /**
   * Cleanup all instances (for graceful shutdown)
   */
  async cleanup() {
    logger.info("Cleaning up Baileys service");

    const instanceIds = Array.from(this.instances.keys());
    await Promise.all(
      instanceIds.map((instanceId) => this.disconnectInstance(instanceId))
    );

    // Clear all maps
    this.instances.clear();
    this.qrCodes.clear();
    this.connectionStates.clear();
    this.reconnectAttempts.clear();
    this.qrAttempts.clear();
    this.manualDisconnects.clear();
    this.instanceConfigs?.clear();

    logger.info("Baileys service cleanup complete");
  }
}

// Create singleton instance
const baileysService = new BaileysService();

export default baileysService;
