// src/controllers/authController.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";
import emailService from "../services/emailService.js";

const authController = {

    // ==================== REGISTER (open registration) ====================
    register: async (req, res) => {
        try {
            const {
                // Accept both camelCase (open-register form) and snake_case
                email,
                password,
                firstName,   first_name,
                lastName,    last_name,
                phoneNumber, phone_number,
                studentId,   student_id,
                level,
                programOfStudy, program_of_study,
                graduationYear, graduation_year,
            } = req.body;

            // Normalise to snake_case regardless of which the caller sent
            const fn        = (firstName  || first_name   || '').trim();
            const ln        = (lastName   || last_name    || '').trim();
            const phone     = phoneNumber || phone_number || null;
            const sid       = studentId   || student_id   || null;
            const program   = programOfStudy || program_of_study || null;
            const gradYear  = graduationYear || graduation_year  || null;

            // Always alumni on self-registration
            const role = 'alumni';

            // Check if user already exists
            const existingUser = await pool.query(
                "SELECT id FROM users WHERE email = $1",
                [email.toLowerCase()]
            );

            if (existingUser.rows.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: "Email already registered"
                });
            }

            // Hash password
            const salt = await bcrypt.genSalt(10);
            const password_hash = await bcrypt.hash(password, salt);

            // Create user — insert all available fields
            const result = await pool.query(
                `INSERT INTO users (
                    email, password_hash, first_name, last_name,
                    phone_number, student_id, program_of_study, graduation_year,
                    role, is_claimed
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true)
                RETURNING id, email, first_name, last_name, role, created_at`,
                [
                    email.toLowerCase(),
                    password_hash,
                    fn,
                    ln,
                    phone,
                    sid,
                    program,
                    gradYear ? parseInt(gradYear) : null,
                    role
                ]
            );

            const user = result.rows[0];

            // Save level separately if your DB has that column
            // (non-fatal if column doesn't exist yet)
            if (level) {
                try {
                    await pool.query(
                        "UPDATE users SET level = $1 WHERE id = $2",
                        [level, user.id]
                    );
                } catch (_) {
                    // column may not exist yet — ignore
                }
            }

            const token = jwt.sign(
                { userId: user.id, email: user.email, role: user.role },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRE || '7d' }
            );

            // Send welcome email (non-fatal)
            try {
                await emailService.sendEmail({
                    to: user.email,
                    subject: 'Welcome to the ATU Alumni Network!',
                    html: getOpenRegisterWelcomeEmail(user.first_name)
                });
            } catch (emailErr) {
                console.warn('Welcome email failed (non-fatal):', emailErr.message);
            }

            res.status(201).json({
                success: true,
                message: "Registration successful! A welcome email has been sent.",
                data: {
                    user: {
                        id:         user.id,
                        email:      user.email,
                        first_name: user.first_name,
                        last_name:  user.last_name,
                        role:       user.role,
                        created_at: user.created_at
                    },
                    token
                }
            });

        } catch (error) {
            console.error("Registration error:", error);
            res.status(500).json({
                success: false,
                error: "Registration failed"
            });
        }
    },

    // ==================== LOGIN ====================
    login: async (req, res) => {
        try {
            const { email, password } = req.body;

            const result = await pool.query(
                `SELECT 
                    id, email, password_hash, first_name, last_name, 
                    role, is_active, is_verified, profile_picture
                FROM users 
                WHERE email = $1`,
                [email.toLowerCase()]
            );

            if (result.rows.length === 0) {
                return res.status(401).json({
                    success: false,
                    error: "Invalid email or password"
                });
            }

            const user = result.rows[0];

            if (!user.is_active) {
                return res.status(403).json({
                    success: false,
                    error: "Account is deactivated. Please contact support."
                });
            }

            const isPasswordValid = await bcrypt.compare(password, user.password_hash);

            if (!isPasswordValid) {
                return res.status(401).json({
                    success: false,
                    error: "Invalid email or password"
                });
            }

            await pool.query(
                "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1",
                [user.id]
            );

            const token = jwt.sign(
                { userId: user.id, email: user.email, role: user.role },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRE || '7d' }
            );

            res.status(200).json({
                success: true,
                message: "Login successful",
                data: {
                    user: {
                        id:              user.id,
                        email:           user.email,
                        first_name:      user.first_name,
                        last_name:       user.last_name,
                        role:            user.role,
                        is_verified:     user.is_verified,
                        profile_picture: user.profile_picture
                    },
                    token
                }
            });

        } catch (error) {
            console.error("Login error:", error);
            res.status(500).json({
                success: false,
                error: "Login failed"
            });
        }
    },

    // ==================== GET CURRENT USER ====================
    getMe: async (req, res) => {
        try {
            const userId = req.user.id;

            const result = await pool.query(
                `SELECT 
                    id, email, first_name, last_name, other_name, phone_number,
                    date_of_birth, gender, student_id, graduation_year, 
                    program_of_study, major, faculty, department,
                    current_company, job_title, industry, years_of_experience,
                    current_city, current_country, hometown,
                    bio, profile_picture, cover_photo,
                    linkedin_url, twitter_url, facebook_url, website_url,
                    skills, interests,
                    role, is_verified, is_active, email_verified, is_claimed,
                    profile_visibility, show_email, show_phone,
                    last_login, created_at, updated_at
                FROM users 
                WHERE id = $1`,
                [userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: "User not found"
                });
            }

            res.status(200).json({
                success: true,
                data: result.rows[0]
            });

        } catch (error) {
            console.error("Get profile error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to fetch profile"
            });
        }
    },

    // ==================== CHANGE PASSWORD ====================
    changePassword: async (req, res) => {
        try {
            const userId = req.user.id;
            const { current_password, new_password } = req.body;

            if (!current_password || !new_password) {
                return res.status(400).json({
                    success: false,
                    error: "Current password and new password are required"
                });
            }

            const result = await pool.query(
                "SELECT password_hash FROM users WHERE id = $1",
                [userId]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: "User not found"
                });
            }

            const isValid = await bcrypt.compare(current_password, result.rows[0].password_hash);

            if (!isValid) {
                return res.status(401).json({
                    success: false,
                    error: "Current password is incorrect"
                });
            }

            const salt = await bcrypt.genSalt(10);
            const newPasswordHash = await bcrypt.hash(new_password, salt);

            await pool.query(
                "UPDATE users SET password_hash = $1 WHERE id = $2",
                [newPasswordHash, userId]
            );

            res.status(200).json({
                success: true,
                message: "Password changed successfully"
            });

        } catch (error) {
            console.error("Change password error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to change password"
            });
        }
    },

    // ==================== REQUEST PASSWORD RESET ====================
    requestPasswordReset: async (req, res) => {
        try {
            const { email } = req.body;

            if (!email) {
                return res.status(400).json({
                    success: false,
                    error: "Email is required"
                });
            }

            const result = await pool.query(
                "SELECT id, first_name FROM users WHERE email = $1",
                [email.toLowerCase()]
            );

            if (result.rows.length === 0) {
                return res.status(200).json({
                    success: true,
                    message: "If the email exists, a password reset link has been sent"
                });
            }

            const user = result.rows[0];

            const resetToken = jwt.sign(
                { userId: user.id, type: 'password_reset' },
                process.env.JWT_SECRET,
                { expiresIn: '1h' }
            );

            const frontendUrl = process.env.FRONTEND_URL || 'https://atu-alumni-network.web.app';
            const resetLink = `${frontendUrl}/reset-password?token=${resetToken}`;

            const emailResult = await emailService.sendEmail({
                to: email.toLowerCase(),
                subject: 'Reset Your ATU Alumni Network Password',
                html: getPasswordResetEmailTemplate(user.first_name, resetLink)
            });

            if (!emailResult.success) {
                console.error('Password reset email failed:', emailResult.error);
                return res.status(500).json({
                    success: false,
                    error: "Failed to send reset email. Please try again."
                });
            }

            res.status(200).json({
                success: true,
                message: "If the email exists, a password reset link has been sent"
            });

        } catch (error) {
            console.error("Request password reset error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to process password reset request"
            });
        }
    },

    // ==================== RESET PASSWORD ====================
    resetPassword: async (req, res) => {
        try {
            const { token, new_password } = req.body;

            if (!token || !new_password) {
                return res.status(400).json({
                    success: false,
                    error: "Token and new password are required"
                });
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            if (decoded.type !== 'password_reset') {
                return res.status(400).json({
                    success: false,
                    error: "Invalid reset token"
                });
            }

            const userCheck = await pool.query(
                "SELECT id, is_active FROM users WHERE id = $1",
                [decoded.userId]
            );

            if (userCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: "Account not found"
                });
            }

            if (!userCheck.rows[0].is_active) {
                return res.status(403).json({
                    success: false,
                    error: "Account is deactivated. Please contact support."
                });
            }

            const salt = await bcrypt.genSalt(10);
            const password_hash = await bcrypt.hash(new_password, salt);

            await pool.query(
                "UPDATE users SET password_hash = $1 WHERE id = $2",
                [password_hash, decoded.userId]
            );

            res.status(200).json({
                success: true,
                message: "Password reset successfully"
            });

        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                return res.status(400).json({
                    success: false,
                    error: "Reset token has expired. Please request a new one."
                });
            }
            if (error.name === 'JsonWebTokenError') {
                return res.status(400).json({
                    success: false,
                    error: "Invalid reset token"
                });
            }
            console.error("Reset password error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to reset password"
            });
        }
    },

    // ==================== VERIFY EMAIL ====================
    verifyEmail: async (req, res) => {
        try {
            const { token } = req.body;

            if (!token) {
                return res.status(400).json({
                    success: false,
                    error: "Verification token is required"
                });
            }

            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            if (decoded.type !== 'email_verification') {
                return res.status(400).json({
                    success: false,
                    error: "Invalid verification token"
                });
            }

            await pool.query(
                "UPDATE users SET email_verified = true, is_verified = true WHERE id = $1",
                [decoded.userId]
            );

            res.status(200).json({
                success: true,
                message: "Email verified successfully"
            });

        } catch (error) {
            if (error.name === 'TokenExpiredError') {
                return res.status(400).json({
                    success: false,
                    error: "Verification token has expired. Please request a new one."
                });
            }
            console.error("Verify email error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to verify email"
            });
        }
    },

    // ==================== LOGOUT ====================
    logout: async (req, res) => {
        try {
            res.status(200).json({
                success: true,
                message: "Logged out successfully"
            });
        } catch (error) {
            console.error("Logout error:", error);
            res.status(500).json({
                success: false,
                error: "Logout failed"
            });
        }
    },

    // ==================== VERIFY ALUMNI (STAGE 1 OF SELF-REGISTRATION) ====================
    verifyAlumni: async (req, res) => {
        try {
            const { index_number, full_name, graduation_year } = req.body;

            if (!index_number || !full_name || !graduation_year) {
                return res.status(400).json({
                    success: false,
                    error: "Index number, full name, and graduation year are required"
                });
            }

            if (full_name.trim().length < 3) {
                return res.status(400).json({
                    success: false,
                    error: "Please enter your full name (at least 3 characters)"
                });
            }

            const result = await pool.query(
                `SELECT id, first_name, last_name, other_name, graduation_year, student_id, is_claimed
                 FROM users
                 WHERE student_id ILIKE $1
                 AND is_active = true`,
                [index_number.trim()]
            );

            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: "No alumni record found with that index number. Please contact admin."
                });
            }

            const alumni = result.rows[0];

            if (alumni.is_claimed) {
                return res.status(409).json({
                    success: false,
                    error: "This alumni record already has an account. Please login or reset your password."
                });
            }

            const dbFullName = [alumni.first_name, alumni.other_name, alumni.last_name]
                .filter(Boolean)
                .join(' ')
                .toLowerCase()
                .replace(/\s+/g, ' ')
                .trim();

            const inputFullName = full_name
                .toLowerCase()
                .replace(/\s+/g, ' ')
                .trim();

            const nameMatch = inputFullName.length >= 5 && (
                dbFullName.includes(inputFullName) ||
                inputFullName.includes(dbFullName) ||
                dbFullName === inputFullName
            );

            const yearMatch = parseInt(alumni.graduation_year) === parseInt(graduation_year);

            if (!nameMatch || !yearMatch) {
                return res.status(400).json({
                    success: false,
                    error: "Details do not match our records. Please check your information."
                });
            }

            const verifiedToken = jwt.sign(
                {
                    userId:     alumni.id,
                    student_id: alumni.student_id,
                    type:       'self_registration'
                },
                process.env.JWT_SECRET,
                { expiresIn: '30m' }
            );

            res.status(200).json({
                success: true,
                message: "Identity verified. Please complete your registration.",
                data: {
                    verified_token:  verifiedToken,
                    first_name:      alumni.first_name,
                    last_name:       alumni.last_name,
                    graduation_year: alumni.graduation_year
                }
            });

        } catch (error) {
            console.error("Verify alumni error:", error);
            res.status(500).json({
                success: false,
                error: "Verification failed. Please try again."
            });
        }
    },

    // ==================== SELF REGISTER (STAGE 2 OF SELF-REGISTRATION) ====================
    selfRegister: async (req, res) => {
        try {
            const { verified_token, email, password, phone_number } = req.body;

            if (!verified_token || !email || !password) {
                return res.status(400).json({
                    success: false,
                    error: "Verification token, email, and password are required"
                });
            }

            if (password.length < 8) {
                return res.status(400).json({
                    success: false,
                    error: "Password must be at least 8 characters"
                });
            }

            let decoded;
            try {
                decoded = jwt.verify(verified_token, process.env.JWT_SECRET);
            } catch (err) {
                return res.status(400).json({
                    success: false,
                    error: err.name === 'TokenExpiredError'
                        ? "Verification session expired. Please start again."
                        : "Invalid verification token."
                });
            }

            if (decoded.type !== 'self_registration') {
                return res.status(400).json({
                    success: false,
                    error: "Invalid token type"
                });
            }

            const userCheck = await pool.query(
                "SELECT id, is_claimed FROM users WHERE id = $1 AND is_active = true",
                [decoded.userId]
            );

            if (userCheck.rows.length === 0 || userCheck.rows[0].is_claimed) {
                return res.status(409).json({
                    success: false,
                    error: "This account has already been registered."
                });
            }

            const emailCheck = await pool.query(
                "SELECT id FROM users WHERE email = $1 AND id != $2",
                [email.toLowerCase(), decoded.userId]
            );

            if (emailCheck.rows.length > 0) {
                return res.status(409).json({
                    success: false,
                    error: "That email address is already registered to another account."
                });
            }

            const salt = await bcrypt.genSalt(10);
            const password_hash = await bcrypt.hash(password, salt);

            const result = await pool.query(
                `UPDATE users 
                SET email = $1,
                    password_hash = $2,
                    phone_number = $3,
                    is_claimed = true,
                    is_verified = true,
                    email_verified = true,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = $4
                RETURNING id, email, first_name, last_name, role, graduation_year, is_verified`,
                [email.toLowerCase(), password_hash, phone_number || null, decoded.userId]
            );

            const user = result.rows[0];

            const token = jwt.sign(
                { userId: user.id, email: user.email, role: user.role },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRE || '7d' }
            );

            try {
                await emailService.sendEmail({
                    to: user.email,
                    subject: 'Welcome to the ATU Alumni Network!',
                    html: getSelfRegisterWelcomeEmail(user.first_name)
                });
            } catch (emailErr) {
                console.warn('Welcome email failed (non-fatal):', emailErr.message);
            }

            res.status(200).json({
                success: true,
                message: "Registration complete! Welcome to the ATU Alumni Network.",
                data: { user, token }
            });

        } catch (error) {
            console.error("Self register error:", error);
            res.status(500).json({
                success: false,
                error: "Registration failed. Please try again."
            });
        }
    },
};


// ==================== EMAIL TEMPLATES ====================

function getOpenRegisterWelcomeEmail(firstName) {
    return `
        <!DOCTYPE html>
        <html>
        <body style="font-family: Arial, sans-serif; background:#f4f4f4; margin:0; padding:0;">
          <div style="max-width:600px; margin:0 auto; background:white;">
            <div style="background: linear-gradient(135deg, #1e3a8a, #f59e0b); padding:40px 30px; text-align:center;">
              <h1 style="color:white; margin:0;">🎓 ATU Alumni Network</h1>
            </div>
            <div style="padding:40px 30px;">
              <h2 style="color:#1e3a8a;">Welcome, ${firstName}!</h2>
              <p style="font-size:16px; color:#374151; line-height:1.6;">
                Your ATU Alumni Network account has been created successfully.
                Sign in to connect with fellow alumni, explore job opportunities,
                and stay updated on events.
              </p>
              <div style="text-align:center; margin:30px 0;">
                <a href="${process.env.FRONTEND_URL || 'https://atu-alumni-network.web.app'}/login"
                   style="background:#1e3a8a; color:white; padding:14px 36px; text-decoration:none;
                          border-radius:8px; font-weight:bold; display:inline-block;">
                  Sign In Now →
                </a>
              </div>
            </div>
            <div style="background:#f9fafb; padding:20px 30px; text-align:center; border-top:1px solid #e5e7eb;">
              <p style="color:#6b7280; font-size:13px; margin:0;">
                © ${new Date().getFullYear()} Accra Technical University Alumni Association
              </p>
            </div>
          </div>
        </body>
        </html>
    `;
}

function getPasswordResetEmailTemplate(firstName, resetLink) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
            <div style="max-width: 600px; margin: 0 auto; background-color: white;">
                <div style="background: linear-gradient(135deg, #1e3a8a, #f59e0b); padding: 40px 30px; text-align: center;">
                    <h1 style="color: white; margin: 0; font-size: 28px;">🎓 ATU Alumni Network</h1>
                </div>
                <div style="padding: 40px 30px;">
                    <h2 style="color: #1e3a8a; margin-bottom: 20px;">Hello ${firstName},</h2>
                    <p style="font-size: 16px; line-height: 1.6; color: #374151;">
                        We received a request to reset the password for your ATU Alumni Network account.
                        Click the button below to set a new password.
                    </p>
                    <div style="text-align: center; margin: 35px 0;">
                        <a href="${resetLink}"
                           style="background: linear-gradient(135deg, #1e3a8a, #1e40af); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                            Reset My Password →
                        </a>
                    </div>
                    <p style="font-size: 14px; color: #6b7280; text-align: center;">
                        If the button doesn't work, copy and paste this link into your browser:
                    </p>
                    <p style="font-size: 13px; color: #1e3a8a; text-align: center; word-break: break-all;">
                        ${resetLink}
                    </p>
                    <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #f59e0b;">
                        <p style="color: #92400e; margin: 0; font-weight: 500;">
                            ⏰ This link will expire in <strong>1 hour</strong>.
                        </p>
                    </div>
                    <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 25px 0;">
                        <p style="color: #374151; margin: 0; font-size: 14px;">
                            🔒 <strong>Didn't request a password reset?</strong><br>
                            You can safely ignore this email. Your password will not be changed unless
                            you click the link above.
                        </p>
                    </div>
                    <p style="font-size: 16px; line-height: 1.6; color: #374151;">
                        Best regards,<br>
                        <strong>The ATU Alumni Team</strong>
                    </p>
                </div>
                <div style="background: #f9fafb; padding: 20px 30px; border-top: 1px solid #e5e7eb; text-align: center;">
                    <p style="font-size: 14px; color: #6b7280; margin: 0;">
                        © ${new Date().getFullYear()} Accra Technical University Alumni Association
                    </p>
                </div>
            </div>
        </body>
        </html>
    `;
}

function getSelfRegisterWelcomeEmail(firstName) {
    return `
        <!DOCTYPE html>
        <html>
        <body style="font-family: Arial, sans-serif; background:#f4f4f4; margin:0; padding:0;">
          <div style="max-width:600px; margin:0 auto; background:white;">
            <div style="background: linear-gradient(135deg, #1e3a8a, #f59e0b); padding:40px 30px; text-align:center;">
              <h1 style="color:white; margin:0;">🎓 ATU Alumni Network</h1>
            </div>
            <div style="padding:40px 30px;">
              <h2 style="color:#1e3a8a;">Welcome, ${firstName}!</h2>
              <p style="font-size:16px; color:#374151; line-height:1.6;">
                Your ATU Alumni Network account is now active. You can log in and connect
                with fellow alumni, find jobs, attend events, and support community projects.
              </p>
              <div style="text-align:center; margin:30px 0;">
                <a href="${process.env.FRONTEND_URL || 'https://atu-alumni-network.web.app'}/login"
                   style="background:#1e3a8a; color:white; padding:14px 36px; text-decoration:none;
                          border-radius:8px; font-weight:bold; display:inline-block;">
                  Go to My Dashboard →
                </a>
              </div>
            </div>
            <div style="background:#f9fafb; padding:20px 30px; text-align:center; border-top:1px solid #e5e7eb;">
              <p style="color:#6b7280; font-size:13px; margin:0;">
                © ${new Date().getFullYear()} Accra Technical University Alumni Association
              </p>
            </div>
          </div>
        </body>
        </html>
    `;
}

export default authController;