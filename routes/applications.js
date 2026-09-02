const router   = require('express').Router();
const { body } = require('express-validator');
const ctrl     = require('../controllers/applicationController');
const { authenticate }                             = require('../middleware/authenticate');
const { isEmployer, isJobseeker, requireVerified } = require('../middleware/authorize');
const { cvUpload }                                 = require('../middleware/upload');
const { uploadLimiter }                            = require('../middleware/rateLimit');
const validate                                     = require('../middleware/validate');

/**
 * @swagger
 * tags:
 *   name: Applications
 *   description: Job application endpoints
 */

/**
 * @swagger
 * /api/applications/my:
 *   get:
 *     tags: [Applications]
 *     summary: Get all applications for the logged in jobseeker
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, reviewing, shortlisted, interview, offered, rejected, withdrawn]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *     responses:
 *       200:
 *         description: List of jobseeker applications
 *       401:
 *         description: Not authenticated
 */

/**
 * @swagger
 * /api/applications/notifications:
 *   get:
 *     tags: [Applications]
 *     summary: Get all notifications for the logged in user
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *     responses:
 *       200:
 *         description: List of notifications with unread count
 *       401:
 *         description: Not authenticated
 */

/**
 * @swagger
 * /api/applications/notifications/read:
 *   patch:
 *     tags: [Applications]
 *     summary: Mark all notifications as read
 *     responses:
 *       200:
 *         description: All notifications marked as read
 *       401:
 *         description: Not authenticated
 */

/**
 * @swagger
 * /api/applications/profile:
 *   put:
 *     tags: [Applications]
 *     summary: Update jobseeker profile and optionally upload CV
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               headline:
 *                 type: string
 *                 example: "Senior Backend Developer"
 *               bio:
 *                 type: string
 *               location:
 *                 type: string
 *                 example: "Lagos, Nigeria"
 *               website:
 *                 type: string
 *               linkedin:
 *                 type: string
 *               github:
 *                 type: string
 *               years_experience:
 *                 type: integer
 *                 example: 3
 *               desired_role:
 *                 type: string
 *               desired_salary:
 *                 type: integer
 *               job_type:
 *                 type: string
 *                 enum: [full-time, part-time, contract, remote]
 *               is_open_to_work:
 *                 type: boolean
 *               cv:
 *                 type: string
 *                 format: binary
 *                 description: "PDF only, max 5MB"
 *     responses:
 *       200:
 *         description: Profile updated successfully
 *       403:
 *         description: Not a jobseeker or email not verified
 */

/**
 * @swagger
 * /api/applications/jobs/{slug}:
 *   get:
 *     tags: [Applications]
 *     summary: Get all applications for a specific job (employer only)
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *         example: senior-backend-developer
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [pending, reviewing, shortlisted, interview, offered, rejected]
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *     responses:
 *       200:
 *         description: List of applications with applicant details
 *       404:
 *         description: Job not found or not your job
 *   post:
 *     tags: [Applications]
 *     summary: Apply to a job (verified jobseekers only)
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *         example: senior-backend-developer
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               cover_letter:
 *                 type: string
 *                 example: "I am very interested in this role"
 *               cv:
 *                 type: string
 *                 format: binary
 *                 description: "PDF only, max 5MB. Optional if CV already on profile."
 *     responses:
 *       201:
 *         description: Application submitted successfully
 *       400:
 *         description: Job closed, deadline passed, or no CV found
 *       403:
 *         description: Not a jobseeker or email not verified
 *       409:
 *         description: Already applied to this job
 */

/**
 * @swagger
 * /api/applications/{id}:
 *   get:
 *     tags: [Applications]
 *     summary: Get a single application by ID
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Application details
 *       403:
 *         description: Not authorized to view this application
 *       404:
 *         description: Application not found
 */

/**
 * @swagger
 * /api/applications/{id}/status:
 *   patch:
 *     tags: [Applications]
 *     summary: Update application status (employer only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - status
 *             properties:
 *               status:
 *                 type: string
 *                 enum: [reviewing, shortlisted, interview, offered, rejected]
 *               employer_notes:
 *                 type: string
 *                 example: "Strong candidate with excellent Node.js skills"
 *     responses:
 *       200:
 *         description: Application status updated
 *       400:
 *         description: Invalid status
 *       404:
 *         description: Application not found or not your job
 */

/**
 * @swagger
 * /api/applications/{id}/withdraw:
 *   patch:
 *     tags: [Applications]
 *     summary: Withdraw an application (jobseeker only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Application withdrawn successfully
 *       400:
 *         description: Cannot withdraw a decided application
 *       403:
 *         description: Not your application
 */

router.get('/my',                   authenticate,              ctrl.getMyApplications);
router.get('/notifications',        authenticate,              ctrl.getNotifications);
router.patch('/notifications/read', authenticate,              ctrl.markNotificationsRead);

router.put('/profile',
  authenticate, isJobseeker, requireVerified,
  uploadLimiter, cvUpload.single('cv'),
  ctrl.updateProfile
);

router.get('/jobs/:slug',  authenticate, isEmployer, ctrl.getJobApplications);

router.post('/jobs/:slug/apply',
  authenticate, isJobseeker, requireVerified,
  uploadLimiter, cvUpload.single('cv'),
  ctrl.applyToJob
);

router.get('/:id',     authenticate, ctrl.getApplication);

router.patch('/:id/status',
  authenticate, isEmployer,
  body('status').notEmpty().withMessage('Status is required.'),
  validate,
  ctrl.updateStatus
);

router.patch('/:id/withdraw', authenticate, isJobseeker, ctrl.withdrawApplication);

module.exports = router;
