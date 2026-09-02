const { validationResult } = require('express-validator');

const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    const formatted = {};
    errors.array().forEach(err => {
      if (!formatted[err.path]) formatted[err.path] = err.msg;
    });
    return res.status(400).json({
      success: false,
      error:   'Validation failed.',
      fields:  formatted,
    });
  }
  next();
};

module.exports = validate;
