import express from "express";
import UserController from "../controllers/user.controller.js";
import AuthMiddleware from "../middleware/auth.middleware.js";
import {
  ValidationMiddleware,
  ValidationSchemas,
} from "../middleware/validation.middleware.js";
import RateLimitMiddleware from "../middleware/rateLimit.middleware.js";

const router = express.Router();

// All user management routes require authentication
router.use(AuthMiddleware.authenticateRequest);

/**
 * @route POST /api/users
 * @desc Create new user (Admin only)
 * @access Private (Administrator role required)
 */
router.post(
  "/",
  AuthMiddleware.requireRole("ADMINISTRATOR"),
  RateLimitMiddleware.createAuthLimiter(),
  ValidationMiddleware.validate(ValidationSchemas.createUser),
  UserController.createUser
);

/**
 * @route GET /api/users
 * @desc Get all users in subscription (Admin only)
 * @access Private (Administrator role required)
 */
router.get(
  "/",
  AuthMiddleware.requireRole("ADMINISTRATOR"),
  ValidationMiddleware.validatePagination(),
  UserController.getUsers
);

/**
 * @route GET /api/users/subscription/usage
 * @desc Get subscription usage statistics (Admin only)
 * @access Private (Administrator role required)
 */
router.get(
  "/subscription/usage",
  AuthMiddleware.requireRole("ADMINISTRATOR"),
  UserController.getSubscriptionUsage
);

/**
 * @route GET /api/users/:id
 * @desc Get user by ID (Admin only)
 * @access Private (Administrator role required)
 */
router.get(
  "/:id",
  AuthMiddleware.requireRole("ADMINISTRATOR"),
  UserController.getUserById
);

/**
 * @route PUT /api/users/:id
 * @desc Update user (Admin only)
 * @access Private (Administrator role required)
 */
router.put(
  "/:id",
  AuthMiddleware.requireRole("ADMINISTRATOR"),
  ValidationMiddleware.validate(ValidationSchemas.updateUser),
  UserController.updateUser
);

/**
 * @route DELETE /api/users/:id
 * @desc Delete user (Admin only)
 * @access Private (Administrator role required)
 */
router.delete(
  "/:id",
  AuthMiddleware.requireRole("ADMINISTRATOR"),
  UserController.deleteUser
);

export default router;
