// src/controllers/authController.js
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import pool from "../config/db.js";

const authController = {
    // Register new user
    register: async (req, res) => {
        try {
            const {
                email,
                password,
                first_name,
                last_name,
                other_name,
                phone_number,
                role = 'alumni'
            } = req.body;

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

            // Create user
            const result = await pool.query(
                `INSERT INTO users (
                    email, password_hash, first_name, last_name, other_name, 
                    phone_number, role
                )
                VALUES ($1, $2, $3, $4, $5, $6, $7)
                RETURNING id, email, first_name, last_name, role, created_at`,
                [email.toLowerCase(), password_hash, first_name, last_name, other_name || null, phone_number || null, role]
            );

            const user = result.rows[0];

            // Generate JWT token
            const token = jwt.sign(
                { userId: user.id, email: user.email, role: user.role },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRE || '1m' }
            );

            res.status(201).json({
                success: true,
                message: "Registration successful",
                data: {
                    user: {
                        id: user.id,
                        email: user.email,
                        first_name: user.first_name,
                        last_name: user.last_name,
                        role: user.role,
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

    // Login user
    login: async (req, res) => {
        try {
            const { email, password } = req.body;

            // Find user
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

            // Check if account is active
            if (!user.is_active) {
                return res.status(403).json({
                    success: false,
                    error: "Account is deactivated. Please contact support."
                });
            }

            // Verify password
            const isPasswordValid = await bcrypt.compare(password, user.password_hash);

            if (!isPasswordValid) {
                return res.status(401).json({
                    success: false,
                    error: "Invalid email or password"
                });
            }

            // Update last login
            await pool.query(
                "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1",
                [user.id]
            );

            // Generate JWT token
            const token = jwt.sign(
                { userId: user.id, email: user.email, role: user.role },
                process.env.JWT_SECRET,
                { expiresIn: process.env.JWT_EXPIRE || '1m' }
            );

            res.status(200).json({
                success: true,
                message: "Login successful",
                data: {
                    user: {
                        id: user.id,
                        email: user.email,
                        first_name: user.first_name,
                        last_name: user.last_name,
                        role: user.role,
                        is_verified: user.is_verified,
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

    // Get current user profile
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
                    role, is_verified, is_active, email_verified,
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

    // Change password
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

            // Get current password hash
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

            // Verify current password
            const isValid = await bcrypt.compare(current_password, result.rows[0].password_hash);

            if (!isValid) {
                return res.status(401).json({
                    success: false,
                    error: "Current password is incorrect"
                });
            }

            // Hash new password
            const salt = await bcrypt.genSalt(10);
            const newPasswordHash = await bcrypt.hash(new_password, salt);

            // Update password
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

    // Request password reset
    requestPasswordReset: async (req, res) => {
        try {
            const { email } = req.body;

            if (!email) {
                return res.status(400).json({
                    success: false,
                    error: "Email is required"
                });
            }

            // Check if user exists
            const result = await pool.query(
                "SELECT id, first_name FROM users WHERE email = $1",
                [email.toLowerCase()]
            );

            // Always return success to prevent email enumeration
            if (result.rows.length === 0) {
                return res.status(200).json({
                    success: true,
                    message: "If the email exists, a password reset link has been sent"
                });
            }

            // Generate reset token (valid for 1 hour)
            const resetToken = jwt.sign(
                { userId: result.rows[0].id, type: 'password_reset' },
                process.env.JWT_SECRET,
                { expiresIn: '1m' }
            );

            // In production, send email with reset link
            // For now, just return the token (REMOVE THIS IN PRODUCTION)
            console.log(`Password reset token for ${email}: ${resetToken}`);

            res.status(200).json({
                success: true,
                message: "If the email exists, a password reset link has been sent",
                // REMOVE in production:
                resetToken: resetToken // Only for testing
            });

        } catch (error) {
            console.error("Request password reset error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to process password reset request"
            });
        }
    },

    // Reset password with token
    resetPassword: async (req, res) => {
        try {
            const { token, new_password } = req.body;

            if (!token || !new_password) {
                return res.status(400).json({
                    success: false,
                    error: "Token and new password are required"
                });
            }

            // Verify token
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            if (decoded.type !== 'password_reset') {
                return res.status(400).json({
                    success: false,
                    error: "Invalid reset token"
                });
            }

            // Hash new password
            const salt = await bcrypt.genSalt(10);
            const password_hash = await bcrypt.hash(new_password, salt);

            // Update password
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

    // Verify email
    verifyEmail: async (req, res) => {
        try {
            const { token } = req.body;

            if (!token) {
                return res.status(400).json({
                    success: false,
                    error: "Verification token is required"
                });
            }

            // Verify token
            const decoded = jwt.verify(token, process.env.JWT_SECRET);

            if (decoded.type !== 'email_verification') {
                return res.status(400).json({
                    success: false,
                    error: "Invalid verification token"
                });
            }

            // Update user
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

    // Logout (client-side token removal, but log it server-side)
    logout: async (req, res) => {
        try {
            // In a more advanced setup, you might store tokens in a blacklist
            // For now, just send success response
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
    }
};

export default authController;