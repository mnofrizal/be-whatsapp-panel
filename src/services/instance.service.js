import databaseConfig from "../config/database.js";
import config from "../config/environment.js";
import logger from "../utils/logger.js";
import baileysService from "./baileys.service.js";
import socketService from "./socket.service.js";
import { ERROR_CODES, INSTANCE_STATUS } from "../utils/constants.js";

class InstanceService {
  /**
   * Create a new WhatsApp instance
   * @param {string} userId - User ID creating the instance
   * @param {string} subscriptionId - Subscription ID
   * @param {Object} instanceData - Instance configuration
   */
  async createInstance(userId, subscriptionId, instanceData) {
    const prisma = databaseConfig.getClient();

    try {
      logger.info("Creating new instance", {
        userId,
        subscriptionId,
        instanceName: instanceData.name,
      });

      // Validate subscription limits
      await this.validateInstanceLimit(subscriptionId);

      // Check if instance name is unique within subscription
      const existingInstance = await prisma.instance.findFirst({
        where: {
          subscriptionId,
          name: instanceData.name,
        },
      });

      if (existingInstance) {
        throw new Error(
          `Instance name '${instanceData.name}' already exists in this subscription`
        );
      }

      // Create instance in database
      const instance = await prisma.instance.create({
        data: {
          name: instanceData.name,
          subscriptionId,
          createdById: userId,
          status: "DISCONNECTED",
          settings: JSON.stringify(instanceData.settings || {}),
          isActive: true,
        },
        include: {
          subscription: true,
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      // Increment instance count
      await this.incrementInstanceCount(subscriptionId);

      // Initialize Baileys instance
      await baileysService.createInstance(
        instance.id,
        instanceData.settings || {}
      );

      logger.info("Instance created successfully", {
        instanceId: instance.id,
        instanceName: instance.name,
        userId,
        subscriptionId,
      });

      return instance;
    } catch (error) {
      logger.error("Failed to create instance", {
        userId,
        subscriptionId,
        instanceName: instanceData.name,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get instance by ID with subscription validation
   * @param {string} instanceId - Instance ID
   * @param {string} subscriptionId - Subscription ID for validation
   */
  async getInstance(instanceId, subscriptionId) {
    const prisma = databaseConfig.getClient();

    try {
      const instance = await prisma.instance.findFirst({
        where: {
          id: instanceId,
          subscriptionId,
        },
        include: {
          subscription: {
            select: {
              id: true,
              name: true,
              tier: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          apiKeys: {
            select: {
              id: true,
              name: true,
              isActive: true,
              createdAt: true,
              lastUsedAt: true,
            },
          },
          _count: {
            select: {
              apiKeys: true,
              messageStats: true,
              contacts: true,
            },
          },
        },
      });

      if (!instance) {
        throw new Error("Instance not found");
      }

      // Get real-time status from Baileys
      const baileysStatus = baileysService.getInstanceStatus(instanceId);

      return {
        ...instance,
        settings: instance.settings ? JSON.parse(instance.settings) : {},
        realTimeStatus: baileysStatus,
      };
    } catch (error) {
      logger.error("Failed to get instance", {
        instanceId,
        subscriptionId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get instance by ID with subscription validation (alias for getInstance)
   * @param {string} instanceId - Instance ID
   * @param {string} subscriptionId - Subscription ID for validation
   */
  async getInstanceById(instanceId, subscriptionId) {
    return this.getInstance(instanceId, subscriptionId);
  }

  /**
   * Get instance by name with subscription validation
   * @param {string} instanceName - Instance name
   * @param {string} subscriptionId - Subscription ID for validation
   */
  async getInstanceByName(instanceName, subscriptionId) {
    const prisma = databaseConfig.getClient();

    try {
      const instance = await prisma.instance.findFirst({
        where: {
          name: instanceName,
          subscriptionId,
        },
        include: {
          subscription: {
            select: {
              id: true,
              name: true,
              tier: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
          apiKeys: {
            select: {
              id: true,
              name: true,
              isActive: true,
              createdAt: true,
              lastUsedAt: true,
            },
          },
          _count: {
            select: {
              apiKeys: true,
              messageStats: true,
              contacts: true,
            },
          },
        },
      });

      if (!instance) {
        throw new Error("Instance not found");
      }

      // Get real-time status from Baileys
      const baileysStatus = baileysService.getInstanceStatus(instance.id);

      return {
        ...instance,
        settings: instance.settings ? JSON.parse(instance.settings) : {},
        realTimeStatus: baileysStatus,
      };
    } catch (error) {
      logger.error("Failed to get instance by name", {
        instanceName,
        subscriptionId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get all instances for a subscription
   * @param {string} subscriptionId - Subscription ID
   * @param {Object} options - Query options (pagination, sorting, filtering)
   */
  async getInstances(subscriptionId, options = {}) {
    const prisma = databaseConfig.getClient();

    try {
      const {
        page = 1,
        per_page = 20,
        sort = "desc",
        sort_by = "createdAt",
        status,
        search,
      } = options;

      const skip = (page - 1) * per_page;

      // Build where clause
      const where = {
        subscriptionId,
      };

      if (status) {
        where.status = status;
      }

      if (search) {
        where.OR = [
          { name: { contains: search, mode: "insensitive" } },
          { displayName: { contains: search, mode: "insensitive" } },
          { phone: { contains: search, mode: "insensitive" } },
        ];
      }

      // Get instances with pagination
      const [instances, totalCount] = await Promise.all([
        prisma.instance.findMany({
          where,
          include: {
            createdBy: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
            _count: {
              select: {
                apiKeys: true,
                messageStats: true,
                contacts: true,
              },
            },
          },
          orderBy: {
            [sort_by]: sort,
          },
          skip,
          take: parseInt(per_page),
        }),
        prisma.instance.count({ where }),
      ]);

      // Add real-time status for each instance
      const instancesWithStatus = instances.map((instance) => {
        const baileysStatus = baileysService.getInstanceStatus(instance.id);
        return {
          ...instance,
          settings: instance.settings ? JSON.parse(instance.settings) : {},
          realTimeStatus: baileysStatus,
        };
      });

      const totalPages = Math.ceil(totalCount / per_page);

      return {
        instances: instancesWithStatus,
        pagination: {
          page: parseInt(page),
          per_page: parseInt(per_page),
          total: totalCount,
          total_pages: totalPages,
          has_next: page < totalPages,
          has_prev: page > 1,
        },
      };
    } catch (error) {
      logger.error("Failed to get instances", {
        subscriptionId,
        options,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Update instance
   * @param {string} instanceId - Instance ID
   * @param {string} subscriptionId - Subscription ID for validation
   * @param {Object} updateData - Update data
   */
  async updateInstance(instanceId, subscriptionId, updateData) {
    const prisma = databaseConfig.getClient();

    try {
      logger.info("Updating instance", {
        instanceId,
        subscriptionId,
        updateData,
      });

      // Check if instance exists and belongs to subscription
      const existingInstance = await prisma.instance.findFirst({
        where: {
          id: instanceId,
          subscriptionId,
        },
      });

      if (!existingInstance) {
        throw new Error("Instance not found");
      }

      // Check if name is being changed and if it's unique
      if (updateData.name && updateData.name !== existingInstance.name) {
        const nameExists = await prisma.instance.findFirst({
          where: {
            subscriptionId,
            name: updateData.name,
            id: { not: instanceId },
          },
        });

        if (nameExists) {
          throw new Error(`Instance name '${updateData.name}' already exists`);
        }
      }

      // Prepare update data
      const dbUpdateData = { ...updateData };

      // Handle settings JSON
      if (updateData.settings) {
        dbUpdateData.settings = JSON.stringify(updateData.settings);
      }

      // Update instance
      const updatedInstance = await prisma.instance.update({
        where: { id: instanceId },
        data: dbUpdateData,
        include: {
          subscription: {
            select: {
              id: true,
              name: true,
              tier: true,
            },
          },
          createdBy: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });

      logger.info("Instance updated successfully", {
        instanceId,
        subscriptionId,
        changes: updateData,
      });

      return {
        ...updatedInstance,
        settings: updatedInstance.settings
          ? JSON.parse(updatedInstance.settings)
          : {},
      };
    } catch (error) {
      logger.error("Failed to update instance", {
        instanceId,
        subscriptionId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Delete instance
   * @param {string} instanceId - Instance ID
   * @param {string} subscriptionId - Subscription ID for validation
   */
  async deleteInstance(instanceId, subscriptionId) {
    const prisma = databaseConfig.getClient();

    try {
      logger.info("Deleting instance", {
        instanceId,
        subscriptionId,
      });

      // Check if instance exists and belongs to subscription
      const existingInstance = await prisma.instance.findFirst({
        where: {
          id: instanceId,
          subscriptionId,
        },
        include: {
          apiKeys: true,
        },
      });

      if (!existingInstance) {
        throw new Error("Instance not found");
      }

      // Disconnect and cleanup Baileys instance
      await baileysService.deleteInstance(instanceId);

      // Delete instance from database (cascade will handle related records)
      await prisma.instance.delete({
        where: { id: instanceId },
      });

      // Decrement instance count
      await this.decrementInstanceCount(subscriptionId);

      logger.info("Instance deleted successfully", {
        instanceId,
        subscriptionId,
        instanceName: existingInstance.name,
      });

      return {
        message: "Instance deleted successfully",
        instanceId,
        instanceName: existingInstance.name,
      };
    } catch (error) {
      logger.error("Failed to delete instance", {
        instanceId,
        subscriptionId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Connect instance to WhatsApp
   * @param {string} instanceId - Instance ID
   * @param {string} subscriptionId - Subscription ID for validation
   */
  async connectInstance(instanceId, subscriptionId) {
    try {
      logger.info("Connecting instance", { instanceId, subscriptionId });

      // Validate instance ownership
      await this.getInstance(instanceId, subscriptionId);

      // Connect via Baileys
      await baileysService.connectInstance(instanceId);

      logger.info("Instance connection initiated", { instanceId });

      return {
        message: "Instance connection initiated",
        instanceId,
      };
    } catch (error) {
      logger.error("Failed to connect instance", {
        instanceId,
        subscriptionId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Disconnect instance from WhatsApp
   * @param {string} instanceId - Instance ID
   * @param {string} subscriptionId - Subscription ID for validation
   */
  async disconnectInstance(instanceId, subscriptionId) {
    try {
      logger.info("Disconnecting instance", { instanceId, subscriptionId });

      // Validate instance ownership
      await this.getInstance(instanceId, subscriptionId);

      // Disconnect via Baileys
      await baileysService.disconnectInstance(instanceId);

      logger.info("Instance disconnected", { instanceId });

      return {
        message: "Instance disconnected successfully",
        instanceId,
      };
    } catch (error) {
      logger.error("Failed to disconnect instance", {
        instanceId,
        subscriptionId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Logout instance (sign out and delete session)
   * @param {string} instanceId - Instance ID
   * @param {string} subscriptionId - Subscription ID for validation
   */
  async logoutInstance(instanceId, subscriptionId) {
    const prisma = databaseConfig.getClient();

    try {
      logger.info("Logging out instance", { instanceId, subscriptionId });

      // Validate instance ownership
      const instance = await this.getInstance(instanceId, subscriptionId);

      if (!instance) {
        throw new Error("Instance not found");
      }

      // Call logout on baileys service (this will delete session)
      await baileysService.logoutInstance(instanceId);

      // Update instance status to DISCONNECTED and clear session data
      const updatedInstance = await prisma.instance.update({
        where: { id: instanceId },
        data: {
          status: INSTANCE_STATUS.DISCONNECTED,
          lastConnectedAt: null,
          qrCode: null,
          qrCodeExpiry: null,
          phone: null,
          displayName: null,
        },
      });

      logger.info("Instance logged out successfully", {
        instanceId,
        subscriptionId,
        status: updatedInstance.status,
      });

      return {
        instanceId,
        status: updatedInstance.status,
        message: "Instance logged out and session deleted successfully",
      };
    } catch (error) {
      logger.error("Failed to logout instance", {
        instanceId,
        subscriptionId,
        error: error.message,
      });

      // Update status to ERROR if logout fails
      try {
        await prisma.instance.update({
          where: { id: instanceId },
          data: {
            status: INSTANCE_STATUS.ERROR,
            lastError: `Failed to logout: ${error.message}`,
            lastErrorAt: new Date(),
          },
        });
      } catch (updateError) {
        logger.error("Failed to update instance status after logout error", {
          instanceId,
          error: updateError.message,
        });
      }

      throw new Error(`Failed to logout instance: ${error.message}`);
    }
  }

  /**
   * Restart instance connection
   * @param {string} instanceId - Instance ID
   * @param {string} subscriptionId - Subscription ID for validation
   */
  async restartInstance(instanceId, subscriptionId) {
    try {
      logger.info("Restarting instance", { instanceId, subscriptionId });

      // Validate instance ownership
      const instance = await this.getInstance(instanceId, subscriptionId);

      // Use the dedicated restart method that doesn't set manual disconnect flag
      await baileysService.restartInstance(instanceId);

      logger.info("Instance restarted", { instanceId });

      return {
        message: "Instance restarted successfully",
        instanceId,
      };
    } catch (error) {
      logger.error("Failed to restart instance", {
        instanceId,
        subscriptionId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get instance QR code
   * @param {string} instanceId - Instance ID
   * @param {string} subscriptionId - Subscription ID for validation
   */
  async getInstanceQR(instanceId, subscriptionId) {
    try {
      // Validate instance ownership
      await this.getInstance(instanceId, subscriptionId);

      // Get QR code from Baileys
      const qrData = await baileysService.getQRCode(instanceId);

      if (!qrData) {
        return {
          message:
            "No QR code available. Instance may be connected or connecting.",
          qrCode: null,
        };
      }

      return {
        message: "QR code retrieved successfully",
        qrCode: qrData.qr,
        expiry: qrData.expiry,
      };
    } catch (error) {
      logger.error("Failed to get instance QR", {
        instanceId,
        subscriptionId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get instance status
   * @param {string} instanceId - Instance ID
   * @param {string} subscriptionId - Subscription ID for validation
   */
  async getInstanceStatus(instanceId, subscriptionId) {
    try {
      // Validate instance ownership
      const instance = await this.getInstance(instanceId, subscriptionId);

      // Get real-time status from Baileys
      const baileysStatus = baileysService.getInstanceStatus(instanceId);

      return {
        instanceId,
        instanceName: instance.name,
        databaseStatus: instance.status,
        realTimeStatus: baileysStatus,
        phone: instance.phone,
        displayName: instance.displayName,
        lastConnectedAt: instance.lastConnectedAt,
        lastDisconnectedAt: instance.lastDisconnectedAt,
        connectionAttempts: instance.connectionAttempts,
        lastError: instance.lastError,
        lastErrorAt: instance.lastErrorAt,
      };
    } catch (error) {
      logger.error("Failed to get instance status", {
        instanceId,
        subscriptionId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Validate subscription instance limit
   * @param {string} subscriptionId - Subscription ID
   */
  async validateInstanceLimit(subscriptionId) {
    const prisma = databaseConfig.getClient();

    try {
      const subscription = await prisma.subscription.findUnique({
        where: { id: subscriptionId },
        include: {
          _count: {
            select: {
              instances: true,
            },
          },
        },
      });

      if (!subscription) {
        throw new Error("Subscription not found");
      }

      if (!subscription.isActive) {
        throw new Error("Subscription is not active");
      }

      const currentInstances = subscription._count.instances;
      const maxInstances = subscription.maxInstances;

      if (currentInstances >= maxInstances) {
        const tierLimits = {
          BASIC: 5,
          PRO: 20,
          MAX: 40,
        };

        throw new Error(
          `Instance limit reached. Current: ${currentInstances}/${maxInstances}. ` +
            `Upgrade to a higher tier for more instances. ` +
            `Available tiers: BASIC (${tierLimits.BASIC}), PRO (${tierLimits.PRO}), MAX (${tierLimits.MAX})`
        );
      }

      logger.info("Instance limit validation passed", {
        subscriptionId,
        currentInstances,
        maxInstances,
        tier: subscription.tier,
      });

      return true;
    } catch (error) {
      logger.error("Instance limit validation failed", {
        subscriptionId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Increment instance count for subscription
   * @param {string} subscriptionId - Subscription ID
   */
  async incrementInstanceCount(subscriptionId) {
    const prisma = databaseConfig.getClient();

    try {
      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: {
          currentInstances: {
            increment: 1,
          },
        },
      });

      logger.info("Instance count incremented", { subscriptionId });
    } catch (error) {
      logger.error("Failed to increment instance count", {
        subscriptionId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Decrement instance count for subscription
   * @param {string} subscriptionId - Subscription ID
   */
  async decrementInstanceCount(subscriptionId) {
    const prisma = databaseConfig.getClient();

    try {
      await prisma.subscription.update({
        where: { id: subscriptionId },
        data: {
          currentInstances: {
            decrement: 1,
          },
        },
      });

      logger.info("Instance count decremented", { subscriptionId });
    } catch (error) {
      logger.error("Failed to decrement instance count", {
        subscriptionId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Get subscription usage statistics
   * @param {string} subscriptionId - Subscription ID
   */
  async getSubscriptionUsage(subscriptionId) {
    const prisma = databaseConfig.getClient();

    try {
      const subscription = await prisma.subscription.findUnique({
        where: { id: subscriptionId },
        include: {
          instances: {
            select: {
              id: true,
              name: true,
              status: true,
              createdAt: true,
              createdBy: {
                select: {
                  id: true,
                  name: true,
                  email: true,
                },
              },
            },
          },
          _count: {
            select: {
              instances: true,
              users: true,
            },
          },
        },
      });

      if (!subscription) {
        throw new Error("Subscription not found");
      }

      // Get current month usage
      const currentMonth = new Date();
      currentMonth.setDate(1);
      currentMonth.setHours(0, 0, 0, 0);

      const monthlyUsage = await prisma.usageRecord.aggregate({
        where: {
          subscriptionId,
          recordType: "MESSAGES_SENT",
          recordDate: {
            gte: currentMonth,
          },
        },
        _sum: {
          count: true,
        },
      });

      const tierLimits = config.subscriptionLimits[subscription.tier] || {
        maxInstances: subscription.maxInstances,
        monthlyMessages: 0,
      };

      return {
        subscription: {
          id: subscription.id,
          name: subscription.name,
          tier: subscription.tier,
          isActive: subscription.isActive,
        },
        limits: {
          maxInstances: tierLimits.maxInstances,
          monthlyMessages: tierLimits.monthlyMessages,
        },
        usage: {
          currentInstances: subscription._count.instances,
          currentUsers: subscription._count.users,
          monthlyMessages: monthlyUsage._sum.count || 0,
        },
        instances: subscription.instances,
      };
    } catch (error) {
      logger.error("Failed to get subscription usage", {
        subscriptionId,
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Initialize instances on service startup
   */
  async initializeInstances() {
    const prisma = databaseConfig.getClient();

    try {
      logger.info("Initializing instances on startup");

      // Get all active instances (both connected and disconnected)
      const activeInstances = await prisma.instance.findMany({
        where: {
          isActive: true,
        },
        select: {
          id: true,
          name: true,
          status: true,
          settings: true,
        },
      });

      logger.info(
        `Found ${activeInstances.length} active instances to initialize`
      );

      // Initialize all instances (this creates the Baileys configuration without connecting)
      for (const instance of activeInstances) {
        try {
          const settings = instance.settings
            ? JSON.parse(instance.settings)
            : {};

          // Initialize Baileys instance (without connecting)
          await baileysService.createInstance(instance.id, settings);

          // If instance was previously connected, attempt to reconnect
          if (instance.status === "CONNECTED") {
            try {
              await baileysService.connectInstance(instance.id);
              logger.info("Instance reconnected on startup", {
                instanceId: instance.id,
                instanceName: instance.name,
              });
            } catch (connectError) {
              logger.warn("Failed to reconnect instance on startup", {
                instanceId: instance.id,
                instanceName: instance.name,
                error: connectError.message,
              });

              // Update status to DISCONNECTED since reconnection failed
              await prisma.instance.update({
                where: { id: instance.id },
                data: {
                  status: "DISCONNECTED",
                  lastError: `Failed to reconnect on startup: ${connectError.message}`,
                  lastErrorAt: new Date(),
                },
              });
            }
          } else {
            logger.info("Instance initialized (disconnected)", {
              instanceId: instance.id,
              instanceName: instance.name,
              status: instance.status,
            });
          }
        } catch (error) {
          logger.error("Failed to initialize instance", {
            instanceId: instance.id,
            instanceName: instance.name,
            error: error.message,
          });

          // Update status to ERROR
          await prisma.instance.update({
            where: { id: instance.id },
            data: {
              status: "ERROR",
              lastError: `Failed to initialize on startup: ${error.message}`,
              lastErrorAt: new Date(),
            },
          });
        }
      }

      logger.info("Instance initialization complete");
    } catch (error) {
      logger.error("Failed to initialize instances", {
        error: error.message,
      });
    }
  }

  /**
   * Cleanup instances on service shutdown
   */
  async cleanup() {
    try {
      logger.info("Cleaning up instance service");
      await baileysService.cleanup();
      logger.info("Instance service cleanup complete");
    } catch (error) {
      logger.error("Failed to cleanup instance service", {
        error: error.message,
      });
    }
  }
}

// Create singleton instance
const instanceService = new InstanceService();

export default instanceService;
