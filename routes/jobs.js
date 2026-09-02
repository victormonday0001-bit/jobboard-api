const router   = require('express').Router();
const { body } = require('express-validator');
const ctrl     = require('../controllers/jobController');
const { authenticate, optionalAuth }  = require('../middleware/authenticate');
const { isEmployer, requireVerified } = require('../middleware/authorize');
const validate                        = require('../middleware/validate');

const jobRules = [
  body('title').trim().notEmpty().withMessage('Job title is required.').isLength({ max: 200 }),
  body('description').notEmpty().withMessage('Job description is required.'),
  body('type').optional()
    .isIn(['full-time','part-time','contract','internship','remote'])
    .withMessage('Invalid job type.'),
  body('experience_level').optional()
    .isIn(['entry','mid','senior','lead','executive'])
    .withMessage('Invalid experience level.'),
  body('salary_min').optional({ checkFalsy: true }).isInt({ min: 0 }),
  body('salary_max').optional({ checkFalsy: true }).isInt({ min: 0 }),
  body('status').optional().isIn(['draft','published']).withMessage('Status must be draft or published.'),
];

const updateJobRules = [
  body('title').optional().trim().isLength({ max: 200 }),
  body('type').optional().isIn(['full-time','part-time','contract','internship','remote']),
  body('experience_level').optional().isIn(['entry','mid','senior','lead','executive']),
  body('salary_min').optional({ checkFalsy: true }).isInt({ min: 0 }),
  body('salary_max').optional({ checkFalsy: true }).isInt({ min: 0 }),
  body('status').optional().isIn(['draft','published','closed']),
];

/**
 * @swagger
 * tags:
 *   name: Jobs
 *   description: Job posting and search endpoints
 */

/**
 * @swagger
 * /api/jobs:
 *   get:
 *     tags: [Jobs]
 *     summary: Search and filter all published jobs
 *     security: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by keyword in title or description
 *       - in: query
 *         name: type
 *         schema:
 *           type: string
 *           enum: [full-time, part-time, contract, internship, remote]
 *       - in: query
 *         name: experience_level
 *         schema:
 *           type: string
 *           enum: [entry, mid, senior, lead, executive]
 *       - in: query
 *         name: location
 *         schema:
 *           type: string
 *       - in: query
 *         name: is_remote
 *         schema:
 *           type: boolean
 *       - in: query
 *         name: salary_min
 *         schema:
 *           type: integer
 *       - in: query
 *         name: salary_max
 *         schema:
 *           type: integer
 *       - in: query
 *         name: sort
 *         schema:
 *           type: string
 *           enum: [newest, oldest, salary, relevant]
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
 *         description: List of published jobs with pagination
 *   post:
 *     tags: [Jobs]
 *     summary: Create a new job posting (verified employers only)
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - title
 *               - description
 *             properties:
 *               title:
 *                 type: string
 *                 example: "Senior Backend Developer"
 *               description:
 *                 type: string
 *                 example: "We need an experienced Node.js developer"
 *               requirements:
 *                 type: string
 *               responsibilities:
 *                 type: string
 *               benefits:
 *                 type: string
 *               type:
 *                 type: string
 *                 enum: [full-time, part-time, contract, internship, remote]
 *               experience_level:
 *                 type: string
 *                 enum: [entry, mid, senior, lead, executive]
 *               location:
 *                 type: string
 *                 example: "Lagos, Nigeria"
 *               country:
 *                 type: string
 *                 example: "Nigeria"
 *               is_remote:
 *                 type: boolean
 *               salary_min:
 *                 type: integer
 *                 example: 80000
 *               salary_max:
 *                 type: integer
 *                 example: 120000
 *               salary_currency:
 *                 type: string
 *                 example: "USD"
 *               is_salary_visible:
 *                 type: boolean
 *               status:
 *                 type: string
 *                 enum: [draft, published]
 *               deadline:
 *                 type: string
 *                 format: date
 *     responses:
 *       201:
 *         description: Job created successfully
 *       400:
 *         description: No company found or validation error
 *       403:
 *         description: Not an employer or email not verified
 */

/**
 * @swagger
 * /api/jobs/skills:
 *   get:
 *     tags: [Jobs]
 *     summary: Get all available skills
 *     security: []
 *     responses:
 *       200:
 *         description: List of all skills
 */

/**
 * @swagger
 * /api/jobs/saved:
 *   get:
 *     tags: [Jobs]
 *     summary: Get all saved jobs for the logged in user
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *     responses:
 *       200:
 *         description: List of saved jobs
 *       401:
 *         description: Not authenticated
 */

/**
 * @swagger
 * /api/jobs/me:
 *   get:
 *     tags: [Jobs]
 *     summary: Get all jobs posted by the logged in employer
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [draft, published, closed]
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
 *         description: List of employer jobs including drafts
 *       403:
 *         description: Not an employer
 */

/**
 * @swagger
 * /api/jobs/{slug}:
 *   get:
 *     tags: [Jobs]
 *     summary: Get a single job by slug
 *     security: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *         example: senior-backend-developer
 *     responses:
 *       200:
 *         description: Full job details with company info and skills
 *       404:
 *         description: Job not found
 *   put:
 *     tags: [Jobs]
 *     summary: Update an existing job (employer only)
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               title:
 *                 type: string
 *               description:
 *                 type: string
 *               salary_min:
 *                 type: integer
 *               salary_max:
 *                 type: integer
 *               status:
 *                 type: string
 *                 enum: [draft, published, closed]
 *     responses:
 *       200:
 *         description: Job updated successfully
 *       403:
 *         description: Not your job
 *       404:
 *         description: Job not found
 *   delete:
 *     tags: [Jobs]
 *     summary: Soft delete a job
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job deleted successfully
 *       403:
 *         description: Not your job
 *       404:
 *         description: Job not found
 */

/**
 * @swagger
 * /api/jobs/{slug}/close:
 *   patch:
 *     tags: [Jobs]
 *     summary: Close a job — no new applications accepted
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job closed successfully
 *       403:
 *         description: Not your job
 *       404:
 *         description: Job not found
 */

/**
 * @swagger
 * /api/jobs/{slug}/save:
 *   post:
 *     tags: [Jobs]
 *     summary: Save or unsave a job (toggle)
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Job saved or unsaved
 *       401:
 *         description: Not authenticated
 *       404:
 *         description: Job not found
 */

router.get('/',        optionalAuth, ctrl.getJobs);
router.get('/skills',               ctrl.getSkills);
router.get('/saved',   authenticate, ctrl.getSavedJobs);
router.get('/me',      authenticate, isEmployer, ctrl.getMyJobs);
router.get('/:slug',   optionalAuth, ctrl.getJob);

router.post('/',
  authenticate, isEmployer, requireVerified,
  jobRules, validate,
  ctrl.createJob
);

router.put('/:slug',
  authenticate, isEmployer,
  updateJobRules, validate,
  ctrl.updateJob
);

router.delete('/:slug',      authenticate, isEmployer, ctrl.deleteJob);
router.patch('/:slug/close', authenticate, isEmployer, ctrl.closeJob);
router.post('/:slug/save',   authenticate,             ctrl.toggleSaveJob);

module.exports = router;
