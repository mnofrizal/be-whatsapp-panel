import express from "express";
import AuthController from "../controllers/auth.controller.js";
import AuthMiddleware from "../middleware/auth.middleware.js";
import {
  ValidationMiddleware,
  ValidationSchemas,
} from "../middleware/validation.middleware.js";
import RateLimitMiddleware from "../middleware/rateLimit.middleware.js";

const router = express.Router();

/**
 * @route POST /api/auth/register
 * @desc Register new user with Basic subscription
 * @access Public
 */
router.post(
  "/register",
  RateLimitMiddleware.createAuthLimiter(),
  ValidationMiddleware.validate(ValidationSchemas.userRegistration),
  AuthController.register
);

/**
 * @route POST /api/auth/login
 * @desc User login
 * @access Public
 */
router.post(
  "/login",
  RateLimitMiddleware.createAuthLimiter(),
  ValidationMiddleware.validate(ValidationSchemas.userLogin),
  AuthController.login
);

/**
 * @route GET /api/auth/me
 * @desc Get current user information
 * @access Private (JWT required)
 */
router.get("/me", AuthMiddleware.authenticateRequest, AuthController.me);

/**
 * @route POST /api/auth/change-password
 * @desc Change user password
 * @access Private (JWT required)
 */
router.post(
  "/change-password",
  AuthMiddleware.authenticateRequest,
  ValidationMiddleware.validate(ValidationSchemas.changePassword),
  AuthController.changePassword
);

/**
 * @route POST /api/auth/refresh
 * @desc Refresh JWT token
 * @access Private (JWT required)
 */
router.post(
  "/refresh",
  AuthMiddleware.authenticateRequest,
  AuthController.refresh
);

/**
 * @route POST /api/auth/logout
 * @desc User logout (for audit logging)
 * @access Private (JWT required)
 */
router.post(
  "/logout",
  AuthMiddleware.authenticateRequest,
  AuthController.logout
);

export default router;
