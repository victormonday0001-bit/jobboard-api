const router   = require('express').Router();
const { body } = require('express-validator');
const ctrl     = require('../controllers/companyController');
const { authenticate }                         = require('../middleware/authenticate');
const { isEmployer, isAdmin, requireVerified } = require('../middleware/authorize');
const { logoUpload }                           = require('../middleware/upload');
const { uploadLimiter }                        = require('../middleware/rateLimit');
const validate                                 = require('../middleware/validate');

const createCompanyRules = [
  body('name').trim().notEmpty().withMessage('Company name is required.').isLength({ max: 150 }),
  body('website').optional({ checkFalsy: true }).isURL().withMessage('Website must be a valid URL.'),
  body('email').optional({ checkFalsy: true }).isEmail(),
  body('size').optional({ checkFalsy: true }).isIn(['1-10','11-50','51-200','201-500','501-1000','1000+']),
  body('founded_year').optional({ checkFalsy: true }).isInt({ min: 1800, max: new Date().getFullYear() }),
];

const updateCompanyRules = [
  body('name').optional({ checkFalsy: true }).trim().isLength({ max: 150 }),
  body('website').optional({ checkFalsy: true }).isURL().withMessage('Website must be a valid URL.'),
  body('email').optional({ checkFalsy: true }).isEmail(),
  body('size').optional({ checkFalsy: true }).isIn(['1-10','11-50','51-200','201-500','501-1000','1000+']),
  body('founded_year').optional({ checkFalsy: true }).isInt({ min: 1800, max: new Date().getFullYear() }),
];

/**
 * @swagger
 * tags:
 *   name: Companies
 *   description: Company management endpoints
 */

/**
 * @swagger
 * /api/companies:
 *   get:
 *     tags: [Companies]
 *     summary: Browse all active companies
 *     security: []
 *     parameters:
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search by company name or industry
 *       - in: query
 *         name: industry
 *         schema:
 *           type: string
 *       - in: query
 *         name: size
 *         schema:
 *           type: string
 *           enum: [1-10, 11-50, 51-200, 201-500, 501-1000, 1000+]
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
 *         description: List of companies with pagination
 *   post:
 *     tags: [Companies]
 *     summary: Create a company (verified employers only)
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *             properties:
 *               name:
 *                 type: string
 *                 example: "Tech Lagos"
 *               description:
 *                 type: string
 *               website:
 *                 type: string
 *                 example: "https://techlagos.com"
 *               email:
 *                 type: string
 *                 example: "info@techlagos.com"
 *               phone:
 *                 type: string
 *               industry:
 *                 type: string
 *                 example: "Technology"
 *               size:
 *                 type: string
 *                 enum: [1-10, 11-50, 51-200, 201-500, 501-1000, 1000+]
 *               founded_year:
 *                 type: integer
 *                 example: 2015
 *               location:
 *                 type: string
 *                 example: "Lagos, Nigeria"
 *               country:
 *                 type: string
 *                 example: "Nigeria"
 *               logo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Company created successfully
 *       403:
 *         description: Not an employer or email not verified
 *       409:
 *         description: Company already exists
 *   put:
 *     tags: [Companies]
 *     summary: Update the employer company
 *     requestBody:
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               website:
 *                 type: string
 *               industry:
 *                 type: string
 *               size:
 *                 type: string
 *                 enum: [1-10, 11-50, 51-200, 201-500, 501-1000, 1000+]
 *               location:
 *                 type: string
 *               country:
 *                 type: string
 *               logo:
 *                 type: string
 *                 format: binary
 *     responses:
 *       200:
 *         description: Company updated successfully
 *       404:
 *         description: Company not found
 *   delete:
 *     tags: [Companies]
 *     summary: Delete the employer company (soft delete)
 *     responses:
 *       200:
 *         description: Company and all its jobs removed
 *       404:
 *         description: Company not found
 */

/**
 * @swagger
 * /api/companies/me:
 *   get:
 *     tags: [Companies]
 *     summary: Get the logged in employer company with job stats
 *     responses:
 *       200:
 *         description: Employer company details
 *       404:
 *         description: No company found
 */

/**
 * @swagger
 * /api/companies/{slug}:
 *   get:
 *     tags: [Companies]
 *     summary: Get a company by slug (public)
 *     security: []
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *         example: tech-lagos
 *     responses:
 *       200:
 *         description: Company details with recent jobs
 *       404:
 *         description: Company not found
 */

/**
 * @swagger
 * /api/companies/{id}/verify:
 *   patch:
 *     tags: [Companies]
 *     summary: Verify a company (admin only)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: Company verified successfully
 *       404:
 *         description: Company not found
 */

router.get('/',      ctrl.getCompanies);
router.get('/me',    authenticate, isEmployer, ctrl.getMyCompany);
router.get('/:slug', ctrl.getCompany);

router.post('/',
  authenticate, isEmployer, requireVerified,
  uploadLimiter, logoUpload.single('logo'),
  createCompanyRules, validate,
  ctrl.createCompany
);

router.put('/',
  authenticate, isEmployer,
  uploadLimiter, logoUpload.single('logo'),
  updateCompanyRules, validate,
  ctrl.updateCompany
);

router.delete('/',          authenticate, isEmployer, ctrl.deleteCompany);
router.patch('/:id/verify', authenticate, isAdmin,    ctrl.verifyCompany);

module.exports = router;
