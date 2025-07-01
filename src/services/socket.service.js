import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import config from "../config/environment.js";
import logger from "../utils/logger.js";
import databaseConfig from "../config/database.js";

class SocketService {
  constructor() {
    this.io = null;
    this.userSockets = new Map(); // userId -> Set of socket IDs
    this.instanceRooms = new Map(); // instanceId -> Set of socket IDs
  }

  initialize(server) {
    this.io = new Server(server, {
      cors: {
        origin: config.cors.origin,
        methods: ["GET", "POST"],
        allowedHeaders: ["Authorization", "Content-Type"],
        credentials: config.cors.credentials,
      },
      transports: ["websocket", "polling"],
    });

    this.setupAuthentication();
    this.setupConnectionHandlers();
  }

  async getUserById(userId) {
    const prisma = databaseConfig.getClient();
    return prisma.user.findUnique({ where: { id: userId } });
  }

  setupAuthentication() {
    this.io.use(async (socket, next) => {
      try {
        const token =
          socket.handshake.auth.token || socket.handshake.query.token;
        if (!token) {
          return next(new Error("Authentication required"));
        }

        const decoded = jwt.verify(token, config.jwt.secret);
        const user = await this.getUserById(decoded.userId);

        if (!user) {
          return next(new Error("User not found"));
        }

        socket.userId = user.id;
        socket.subscriptionId = user.subscriptionId;
        socket.userRole = user.role;

        next();
      } catch (error) {
        next(new Error("Authentication failed"));
      }
    });
  }

  setupConnectionHandlers() {
    this.io.on("connection", (socket) => {
      logger.info("Socket.IO client connected", {
        socketId: socket.id,
        userId: socket.userId,
        subscriptionId: socket.subscriptionId,
      });

      // Join user to their subscription room
      socket.join(`subscription:${socket.subscriptionId}`);

      // Track user socket
      if (!this.userSockets.has(socket.userId)) {
        this.userSockets.set(socket.userId, new Set());
      }
      this.userSockets.get(socket.userId).add(socket.id);

      // Handle instance room subscriptions
      socket.on("subscribe:instance", (instanceId) => {
        this.subscribeToInstance(socket, instanceId);
      });

      socket.on("unsubscribe:instance", (instanceId) => {
        this.unsubscribeFromInstance(socket, instanceId);
      });

      socket.on("disconnect", () => {
        this.handleDisconnect(socket);
      });
    });
  }

  async validateInstanceAccess(subscriptionId, instanceId) {
    const prisma = databaseConfig.getClient();
    const instance = await prisma.instance.findFirst({
      where: { id: instanceId, subscriptionId },
    });
    return !!instance;
  }

  // Per-instance real-time communication
  async subscribeToInstance(socket, instanceId) {
    // Validate instance ownership
    if (
      !(await this.validateInstanceAccess(socket.subscriptionId, instanceId))
    ) {
      socket.emit("error", { message: "Access denied to instance" });
      return;
    }

    const roomName = `instance:${instanceId}`;
    socket.join(roomName);

    if (!this.instanceRooms.has(instanceId)) {
      this.instanceRooms.set(instanceId, new Set());
    }
    this.instanceRooms.get(instanceId).add(socket.id);

    logger.info("Socket subscribed to instance", {
      socketId: socket.id,
      instanceId,
      userId: socket.userId,
    });
  }

  unsubscribeFromInstance(socket, instanceId) {
    const roomName = `instance:${instanceId}`;
    socket.leave(roomName);

    if (this.instanceRooms.has(instanceId)) {
      this.instanceRooms.get(instanceId).delete(socket.id);
    }

    logger.info("Socket unsubscribed from instance", {
      socketId: socket.id,
      instanceId,
      userId: socket.userId,
    });
  }

  handleDisconnect(socket) {
    logger.info("Socket.IO client disconnected", {
      socketId: socket.id,
      userId: socket.userId,
    });

    if (this.userSockets.has(socket.userId)) {
      this.userSockets.get(socket.userId).delete(socket.id);
    }

    // Also remove from any instance rooms
    for (const [instanceId, sockets] of this.instanceRooms.entries()) {
      if (sockets.has(socket.id)) {
        sockets.delete(socket.id);
      }
    }
  }

  // Emit to specific instance subscribers
  emitToInstance(instanceId, event, data) {
    const roomName = `instance:${instanceId}`;
    this.io.to(roomName).emit(event, {
      instanceId,
      timestamp: new Date().toISOString(),
      ...data,
    });
  }

  // Emit to subscription (all instances)
  emitToSubscription(subscriptionId, event, data) {
    const roomName = `subscription:${subscriptionId}`;
    this.io.to(roomName).emit(event, {
      subscriptionId,
      timestamp: new Date().toISOString(),
      ...data,
    });
  }

  // Instance-specific event emitters
  emitInstanceStatusChange(
    instanceId,
    subscriptionId,
    oldStatus,
    newStatus,
    metadata = {}
  ) {
    this.emitToInstance(instanceId, "instance:status:changed", {
      oldStatus,
      newStatus,
      metadata,
    });

    // Also emit to subscription level for dashboard updates
    this.emitToSubscription(subscriptionId, "instance:status:changed", {
      instanceId,
      oldStatus,
      newStatus,
      metadata,
    });
  }

  emitInstanceQRGenerated(instanceId, subscriptionId, qrData) {
    this.emitToInstance(instanceId, "instance:qr:generated", {
      qrCode: qrData.qr,
      expiry: qrData.expiry,
      attempt: qrData.attempt,
    });
  }

  emitInstanceError(instanceId, subscriptionId, error) {
    this.emitToInstance(instanceId, "instance:error", {
      error: error.message,
      code: error.code,
      timestamp: new Date().toISOString(),
    });
  }
}

export default new SocketService();
