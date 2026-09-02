const router = require('express').Router();
const ctrl   = require('../controllers/adminController');
const { authenticate } = require('../middleware/authenticate');
const { isAdmin }      = require('../middleware/authorize');

router.use(authenticate, isAdmin);

/**
 * @swagger
 * tags:
 *   name: Admin
 *   description: Admin only endpoints — requires admin role
 */

/**
 * @swagger
 * /api/admin/stats:
 *   get:
 *     tags: [Admin]
 *     summary: Get platform statistics
 *     responses:
 *       200:
 *         description: Platform stats including total users, companies, jobs, applications
 *       403:
 *         description: Not an admin
 */

/**
 * @swagger
 * /api/admin/audit-logs:
 *   get:
 *     tags: [Admin]
 *     summary: Get all audit logs with optional filters
 *     parameters:
 *       - in: query
 *         name: action
 *         schema:
 *           type: string
 *         description: "Filter by action type e.g. USER_LOGIN, JOB_CREATED"
 *       - in: query
 *         name: user_id
 *         schema:
 *           type: integer
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: List of audit log entries
 */

/**
 * @swagger
 * /api/admin/users:
 *   get:
 *     tags: [Admin]
 *     summary: Get all users with optional search and filter
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by email or name
 *       - in: query
 *         name: role
 *         schema:
 *           type: string
 *           enum: [admin, employer, jobseeker]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: List of all users
 */

/**
 * @swagger
 * /api/admin/users/{id}:
 *   patch:
 *     tags: [Admin]
 *     summary: Update a user role, active status, or verified status
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               role:
 *                 type: string
 *                 enum: [admin, employer, jobseeker]
 *               is_active:
 *                 type: boolean
 *               is_verified:
 *                 type: boolean
 *     responses:
 *       200:
 *         description: User updated successfully
 *       400:
 *         description: Cannot deactivate own account
 *       404:
 *         description: User not found
 *   delete:
 *     tags: [Admin]
 *     summary: Soft delete a user and revoke all their tokens
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: User deleted successfully
 *       400:
 *         description: Cannot delete own account
 *       404:
 *         description: User not found
 */

/**
 * @swagger
 * /api/admin/companies:
 *   get:
 *     tags: [Admin]
 *     summary: Get all companies with optional search
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: List of all companies
 */

/**
 * @swagger
 * /api/admin/jobs:
 *   get:
 *     tags: [Admin]
 *     summary: Get all jobs with optional filters
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, published, closed, expired]
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 10
 *     responses:
 *       200:
 *         description: List of all jobs
 */

/**
 * @swagger
 * /api/admin/jobs/{id}/featured:
 *   patch:
 *     tags: [Admin]
 *     summary: Toggle featured status of a job
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Featured status toggled
 *       404:
 *         description: Job not found
 */

/**
 * @swagger
 * /api/admin/jobs/{id}:
 *   delete:
 *     tags: [Admin]
 *     summary: Delete any job (admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Job deleted successfully
 *       404:
 *         description: Job not found
 */

router.get('/stats',               ctrl.getStats);
router.get('/audit-logs',          ctrl.getAuditLogs);
router.get('/users',               ctrl.getUsers);
router.patch('/users/:id',         ctrl.updateUser);
router.delete('/users/:id',        ctrl.deleteUser);
router.get('/companies',           ctrl.getCompanies);
router.get('/jobs',                ctrl.getJobs);
router.patch('/jobs/:id/featured', ctrl.toggleFeatured);
router.delete('/jobs/:id',         ctrl.deleteJob);

module.exports = router;
