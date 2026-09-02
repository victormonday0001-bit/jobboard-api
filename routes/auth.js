const router   = require('express').Router();
const { body } = require('express-validator');
const ctrl     = require('../controllers/authController');
const { authenticate }              = require('../middleware/authenticate');
const validate                      = require('../middleware/validate');
const { authLimiter, resetLimiter } = require('../middleware/rateLimit');

const registerRules = [
  body('email').isEmail().withMessage('Enter a valid email address.').normalizeEmail(),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
    .matches(/(?=.*[A-Z])/).withMessage('Must include at least one uppercase letter.')
    .matches(/(?=.*[0-9])/).withMessage('Must include at least one number.'),
  body('first_name').trim().notEmpty().withMessage('First name is required.').isLength({ max: 50 }),
  body('last_name').trim().notEmpty().withMessage('Last name is required.').isLength({ max: 50 }),
  body('role').optional().isIn(['jobseeker', 'employer']).withMessage('Role must be jobseeker or employer.'),
];

const loginRules = [
  body('email').isEmail().withMessage('Enter a valid email.').normalizeEmail(),
  body('password').notEmpty().withMessage('Password is required.'),
];

const changePasswordRules = [
  body('current_password').notEmpty().withMessage('Current password is required.'),
  body('new_password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
    .matches(/(?=.*[A-Z])/).withMessage('Must include uppercase letter.')
    .matches(/(?=.*[0-9])/).withMessage('Must include a number.'),
];

const resetPasswordRules = [
  body('token').notEmpty().withMessage('Reset token is required.'),
  body('password')
    .isLength({ min: 8 }).withMessage('Password must be at least 8 characters.')
    .matches(/(?=.*[A-Z])/).withMessage('Must include uppercase letter.')
    .matches(/(?=.*[0-9])/).withMessage('Must include a number.'),
];

/**
 * @swagger
 * tags:
 *   name: Auth
 *   description: Authentication endpoints
 */

/**
 * @swagger
 * /api/auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register a new account and receive tokens immediately
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *               - first_name
 *               - last_name
 *             properties:
 *               email:
 *                 type: string
 *                 example: "victor@test.com"
 *               password:
 *                 type: string
 *                 example: "Password1"
 *               first_name:
 *                 type: string
 *                 example: "Victor"
 *               last_name:
 *                 type: string
 *                 example: "Monday"
 *               role:
 *                 type: string
 *                 enum: [jobseeker, employer]
 *                 default: jobseeker
 *     responses:
 *       201:
 *         description: Account created. Tokens issued immediately.
 *       400:
 *         description: Validation error
 *       409:
 *         description: Email already exists
 */

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login and receive tokens
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *               - password
 *             properties:
 *               email:
 *                 type: string
 *                 example: "victor@test.com"
 *               password:
 *                 type: string
 *                 example: "Password1"
 *     responses:
 *       200:
 *         description: Login successful. Returns accessToken and refreshToken.
 *       401:
 *         description: Invalid email or password
 *       403:
 *         description: Account deactivated
 */

/**
 * @swagger
 * /api/auth/refresh-token:
 *   post:
 *     tags: [Auth]
 *     summary: Get a new access token using refresh token
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - refresh_token
 *             properties:
 *               refresh_token:
 *                 type: string
 *     responses:
 *       200:
 *         description: New access token issued
 *       401:
 *         description: Invalid or expired refresh token
 */

/**
 * @swagger
 * /api/auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Logout from current device
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               refresh_token:
 *                 type: string
 *     responses:
 *       200:
 *         description: Logged out successfully
 *       401:
 *         description: Not authenticated
 */

/**
 * @swagger
 * /api/auth/logout-all:
 *   post:
 *     tags: [Auth]
 *     summary: Logout from ALL devices simultaneously
 *     responses:
 *       200:
 *         description: Logged out from all devices
 *       401:
 *         description: Not authenticated
 */

/**
 * @swagger
 * /api/auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Get current logged in user profile
 *     responses:
 *       200:
 *         description: Current user details
 *       401:
 *         description: Not authenticated
 */

/**
 * @swagger
 * /api/auth/verify-email:
 *   get:
 *     tags: [Auth]
 *     summary: Verify email address using token from email link
 *     security: []
 *     parameters:
 *       - in: query
 *         name: token
 *         required: true
 *         schema:
 *           type: string
 *         description: Token from the verification email
 *     responses:
 *       200:
 *         description: Email verified successfully
 *       400:
 *         description: Invalid or expired token
 */

/**
 * @swagger
 * /api/auth/resend-verification:
 *   post:
 *     tags: [Auth]
 *     summary: Resend email verification link
 *     responses:
 *       200:
 *         description: Verification email sent
 *       401:
 *         description: Not authenticated
 */

/**
 * @swagger
 * /api/auth/forgot-password:
 *   post:
 *     tags: [Auth]
 *     summary: Request a password reset email
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - email
 *             properties:
 *               email:
 *                 type: string
 *                 example: "victor@test.com"
 *     responses:
 *       200:
 *         description: Reset email sent if account exists
 */

/**
 * @swagger
 * /api/auth/reset-password:
 *   post:
 *     tags: [Auth]
 *     summary: Reset password using token from email
 *     security: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - token
 *               - password
 *             properties:
 *               token:
 *                 type: string
 *               password:
 *                 type: string
 *                 example: "NewPassword1"
 *     responses:
 *       200:
 *         description: Password reset successfully
 *       400:
 *         description: Invalid or expired token
 */

/**
 * @swagger
 * /api/auth/change-password:
 *   put:
 *     tags: [Auth]
 *     summary: Change password while logged in
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - current_password
 *               - new_password
 *             properties:
 *               current_password:
 *                 type: string
 *                 example: "Password1"
 *               new_password:
 *                 type: string
 *                 example: "NewPassword1"
 *     responses:
 *       200:
 *         description: Password changed successfully
 *       400:
 *         description: Current password incorrect
 *       401:
 *         description: Not authenticated
 */

router.post('/register',            authLimiter,  registerRules,      validate, ctrl.register);
router.post('/login',               authLimiter,  loginRules,         validate, ctrl.login);
router.post('/refresh-token',       body('refresh_token').notEmpty(), validate, ctrl.refreshToken);
router.post('/logout',              authenticate,                               ctrl.logout);
router.post('/logout-all',          authenticate,                               ctrl.logoutAll);
router.get ('/verify-email',                                                    ctrl.verifyEmail);
router.post('/resend-verification', authenticate, resetLimiter,                 ctrl.resendVerification);
router.post('/forgot-password',     resetLimiter, body('email').isEmail(), validate, ctrl.forgotPassword);
router.post('/reset-password',      resetPasswordRules, validate,              ctrl.resetPassword);
router.get ('/me',                  authenticate,                               ctrl.getMe);
router.put ('/change-password',     authenticate, changePasswordRules, validate, ctrl.changePassword);

module.exports = router;
