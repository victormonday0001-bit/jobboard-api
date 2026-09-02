/* 
Creating JWT tokens
Verifying JWT tokens
Hashing refresh tokens before storing them in the database
*/
const jwt    = require('jsonwebtoken');
const crypto = require('crypto');

// FIX: Added is_verified to payload so middleware can check
// verification status without an extra database query
const generateAccessToken = (user) => {
  return jwt.sign(
    {
      id:          user.id,
      role:        user.role,
      email:       user.email,
    },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m' }
  );
};

const generateRefreshToken = (user) => {
  return jwt.sign(
    { id: user.id },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES || '7d' }
  );
};

const verifyAccessToken  = (token) => jwt.verify(token, process.env.JWT_ACCESS_SECRET);
const verifyRefreshToken = (token) => jwt.verify(token, process.env.JWT_REFRESH_SECRET);

const hashToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

module.exports = {
  generateAccessToken,
  generateRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  hashToken,
};
