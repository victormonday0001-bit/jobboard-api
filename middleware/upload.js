const multer = require('multer');
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');

const uploadsBase = path.join(__dirname, '..', process.env.UPLOADS_DIR || 'uploads');
const logosDir    = path.join(uploadsBase, 'logos');
const cvsDir      = path.join(uploadsBase, 'cvs');

[uploadsBase, logosDir, cvsDir].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const createStorage = (destination) => multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, destination),
  filename:    (_req, file, cb) => {
    const rand = crypto.randomBytes(16).toString('hex');
    const ext  = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}-${rand}${ext}`);
  },
});

const imageFilter = (_req, file, cb) => {
  const allowed     = ['image/jpeg', 'image/png', 'image/webp'];
  const allowedExts = ['.jpg', '.jpeg', '.png', '.webp'];
  const ext         = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(file.mimetype) && allowedExts.includes(ext)) {
    cb(null, true);
  } else {
    cb(new Error('Only JPEG, PNG, and WebP images are allowed.'));
  }
};

const pdfFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (file.mimetype === 'application/pdf' && ext === '.pdf') {
    cb(null, true);
  } else {
    cb(new Error('Only PDF files are allowed for CVs.'));
  }
};

const logoUpload = multer({
  storage:    createStorage(logosDir),
  fileFilter: imageFilter,
  limits:     { fileSize: parseInt(process.env.MAX_LOGO_SIZE_MB || 2) * 1024 * 1024 },
});

const cvUpload = multer({
  storage:    createStorage(cvsDir),
  fileFilter: pdfFilter,
  limits:     { fileSize: parseInt(process.env.MAX_CV_SIZE_MB || 5) * 1024 * 1024 },
});

module.exports = { logoUpload, cvUpload };
