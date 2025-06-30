import crypto from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import config from "../config/environment.js";

class Helpers {
  /**
   * Hash password using bcrypt
   * @param {string} password - Plain text password
   * @returns {Promise<string>} - Hashed password
   */
  static async hashPassword(password) {
    return bcrypt.hash(password, config.security.bcryptRounds);
  }

  /**
   * Compare password with hash
   * @param {string} password - Plain text password
   * @param {string} hash - Hashed password
   * @returns {Promise<boolean>} - Match result
   */
  static async comparePassword(password, hash) {
    return bcrypt.compare(password, hash);
  }

  /**
   * Generate JWT token
   * @param {object} payload - Token payload
   * @param {string} expiresIn - Token expiration
   * @returns {string} - JWT token
   */
  static generateJWT(payload, expiresIn = config.jwt.expiresIn) {
    return jwt.sign(payload, config.jwt.secret, { expiresIn });
  }

  /**
   * Verify JWT token
   * @param {string} token - JWT token
   * @returns {object} - Decoded payload
   */
  static verifyJWT(token) {
    return jwt.verify(token, config.jwt.secret);
  }

  /**
   * Generate API key
   * @param {string} prefix - Key prefix (e.g., 'cs_' for customer service)
   * @returns {string} - Generated API key
   */
  static generateApiKey(prefix = "wa_") {
    const randomBytes = crypto.randomBytes(config.security.apiKeyLength);
    return prefix + randomBytes.toString("hex");
  }

  /**
   * Hash API key for storage
   * @param {string} apiKey - Plain API key
   * @returns {string} - SHA-256 hash
   */
  static hashApiKey(apiKey) {
    return crypto.createHash("sha256").update(apiKey).digest("hex");
  }

  /**
   * Generate secure random string
   * @param {number} length - String length
   * @returns {string} - Random string
   */
  static generateSecureRandom(length = 32) {
    return crypto.randomBytes(length).toString("hex");
  }

  /**
   * Validate phone number format
   * @param {string} phone - Phone number
   * @returns {boolean} - Validation result
   */
  static isValidPhoneNumber(phone) {
    // Remove all non-digit characters
    const cleaned = phone.replace(/\D/g, "");

    // Check if it's a valid international format (8-15 digits)
    return /^\d{8,15}$/.test(cleaned);
  }

  /**
   * Format phone number for WhatsApp JID
   * @param {string} phone - Phone number
   * @returns {string} - Formatted JID
   */
  static formatPhoneToJID(phone) {
    const cleaned = phone.replace(/\D/g, "");
    return `${cleaned}@s.whatsapp.net`;
  }

  /**
   * Extract phone number from JID
   * @param {string} jid - WhatsApp JID
   * @returns {string} - Phone number
   */
  static extractPhoneFromJID(jid) {
    return jid.split("@")[0];
  }

  /**
   * Generate request ID for tracking
   * @returns {string} - Unique request ID
   */
  static generateRequestId() {
    return "req_" + crypto.randomBytes(8).toString("hex");
  }

  /**
   * Sanitize user input
   * @param {string} input - User input
   * @returns {string} - Sanitized input
   */
  static sanitizeInput(input) {
    if (typeof input !== "string") return input;

    return input
      .trim()
      .replace(/[<>]/g, "") // Remove potential HTML tags
      .substring(0, 1000); // Limit length
  }

  /**
   * Create standardized API response
   * @param {boolean} success - Success status
   * @param {object} data - Response data
   * @param {object} meta - Response metadata
   * @returns {object} - Standardized response
   */
  static createResponse(success, data = null, meta = {}) {
    const response = {
      success,
      timestamp: new Date().toISOString(),
      ...meta,
    };

    if (success) {
      response.data = data;
    } else {
      response.error = data;
    }

    return response;
  }

  /**
   * Create error response
   * @param {string} code - Error code
   * @param {string} message - Error message
   * @param {object} details - Error details
   * @returns {object} - Error response
   */
  static createErrorResponse(code, message, details = {}) {
    return this.createResponse(false, {
      code,
      message,
      details,
    });
  }

  /**
   * Validate email format
   * @param {string} email - Email address
   * @returns {boolean} - Validation result
   */
  static isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Generate subscription name from user name
   * @param {string} userName - User name
   * @returns {string} - Subscription name
   */
  static generateSubscriptionName(userName) {
    return `${userName}'s Subscription`;
  }

  /**
   * Check if string is JWT token
   * @param {string} token - Token string
   * @returns {boolean} - Is JWT token
   */
  static isJWTToken(token) {
    return token.split(".").length === 3;
  }

  /**
   * Sleep/delay function
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} - Promise that resolves after delay
   */
  static sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get client IP address from request
   * @param {object} req - Express request object
   * @returns {string} - Client IP address
   */
  static getClientIP(req) {
    return (
      req.ip ||
      req.connection.remoteAddress ||
      req.socket.remoteAddress ||
      (req.connection.socket ? req.connection.socket.remoteAddress : null) ||
      "0.0.0.0"
    );
  }

  /**
   * Parse JSON safely
   * @param {string} jsonString - JSON string
   * @param {any} defaultValue - Default value if parsing fails
   * @returns {any} - Parsed JSON or default value
   */
  static safeJSONParse(jsonString, defaultValue = null) {
    try {
      return JSON.parse(jsonString);
    } catch (error) {
      return defaultValue;
    }
  }

  /**
   * Stringify JSON safely
   * @param {any} obj - Object to stringify
   * @param {string} defaultValue - Default value if stringify fails
   * @returns {string} - JSON string or default value
   */
  static safeJSONStringify(obj, defaultValue = "{}") {
    try {
      return JSON.stringify(obj);
    } catch (error) {
      return defaultValue;
    }
  }
}

export default Helpers;
