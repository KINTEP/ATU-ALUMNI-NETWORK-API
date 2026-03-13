// src/controllers/adminUserController.js
import pool from "../config/db.js";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import emailService from "../services/emailService.js";
import smsService from "../services/smsService.js";

const adminUserController = {
    // ==================== BULK IMPORT ALUMNI ====================
    bulkImportAlumni: async (req, res) => {
        try {
            const { alumni, sendCredentials = true, notifyVia = 'both' } = req.body;
            
            if (!Array.isArray(alumni) || alumni.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: "Alumni array is required and must not be empty"
                });
            }

            const results = {
                imported: 0,
                failed: 0,
                skipped: 0,
                details: []
            };

            for (const alumnus of alumni) {
                try {
                    // Validate required fields
                    if (!alumnus.email || !alumnus.first_name || !alumnus.last_name) {
                        results.failed++;
                        results.details.push({
                            email: alumnus.email,
                            student_id: alumnus.student_id,
                            status: 'failed',
                            error: 'Missing required fields (email, first_name, last_name)'
                        });
                        continue;
                    }

                    // Check if user already exists by email or student_id
                    const existingUser = await pool.query(
                        "SELECT id FROM users WHERE email = $1 OR (student_id = $2 AND student_id IS NOT NULL)",
                        [alumnus.email, alumnus.student_id]
                    );

                    if (existingUser.rows.length > 0) {
                        results.skipped++;
                        results.details.push({
                            email: alumnus.email,
                            student_id: alumnus.student_id,
                            status: 'skipped',
                            reason: 'User already exists (duplicate email or student ID)'
                        });
                        continue;
                    }

                    // Generate random password
                    const tempPassword = crypto.randomBytes(8).toString('hex');
                    const passwordHash = await bcrypt.hash(tempPassword, 10);

                    // Insert user
                    const insertQuery = `
                        INSERT INTO users (
                            email, password_hash, first_name, last_name, other_name,
                            phone_number, role, graduation_year, program_of_study, major,
                            faculty, department, current_company, job_title,
                            current_city, current_country, bio, skills, interests,
                            is_verified, student_id
                        ) VALUES (
                            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                            $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
                        ) RETURNING id, email, first_name, last_name, student_id
                    `;

                    const values = [
                        alumnus.email,
                        passwordHash,
                        alumnus.first_name,
                        alumnus.last_name,
                        alumnus.other_name || null,
                        alumnus.phone_number || null,
                        'alumni',
                        alumnus.graduation_year || null,
                        alumnus.program_of_study || null,
                        alumnus.major || null,
                        alumnus.faculty || null,
                        alumnus.department || null,
                        alumnus.current_company || null,
                        alumnus.job_title || null,
                        alumnus.current_city || null,
                        alumnus.current_country || null,
                        alumnus.bio || null,
                        alumnus.skills || null,
                        alumnus.interests || null,
                        true,
                        alumnus.student_id || null
                    ];

                    const result = await pool.query(insertQuery, values);
                    const newUser = result.rows[0];

                    results.imported++;
                    results.details.push({
                        email: alumnus.email,
                        student_id: alumnus.student_id,
                        status: 'imported',
                        userId: newUser.id
                    });

                    // Send credentials if requested
                    if (sendCredentials) {
                        await sendLoginCredentials(
                            newUser,
                            tempPassword,
                            alumnus.phone_number,
                            notifyVia
                        );
                    }

                } catch (error) {
                    console.error(`Error importing ${alumnus.email}:`, error);
                    results.failed++;
                    results.details.push({
                        email: alumnus.email,
                        student_id: alumnus.student_id,
                        status: 'failed',
                        error: error.message
                    });
                }
            }

            res.status(200).json({
                success: true,
                message: "Bulk import completed",
                summary: {
                    total: alumni.length,
                    imported: results.imported,
                    skipped: results.skipped,
                    failed: results.failed
                },
                details: results.details
            });

        } catch (error) {
            console.error("Bulk import error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to import alumni"
            });
        }
    },

    // ==================== ADD SINGLE ALUMNI ====================
    addSingleAlumni: async (req, res) => {
        try {
            const {
                email, first_name, last_name, other_name, phone_number,
                graduation_year, program_of_study, major, faculty, department,
                current_company, job_title, current_city, current_country,
                bio, skills, interests, sendCredentials = true, notifyVia = 'both'
            } = req.body;

            // Validate required fields
            if (!email || !first_name || !last_name) {
                return res.status(400).json({
                    success: false,
                    error: "Email, first name, and last name are required"
                });
            }

            // Check if user exists
            const existingUser = await pool.query(
                "SELECT id FROM users WHERE email = $1",
                [email]
            );

            if (existingUser.rows.length > 0) {
                return res.status(400).json({
                    success: false,
                    error: "User with this email already exists"
                });
            }

            // Generate random password
            const tempPassword = crypto.randomBytes(8).toString('hex');
            const passwordHash = await bcrypt.hash(tempPassword, 10);

            // Insert user
            const insertQuery = `
                INSERT INTO users (
                    email, password_hash, first_name, last_name, other_name,
                    phone_number, role, graduation_year, program_of_study, major,
                    faculty, department, current_company, job_title,
                    current_city, current_country, bio, skills, interests,
                    is_verified
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, $13, $14, $15, $16, $17, $18, $19, $20
                ) RETURNING *
            `;

            const values = [
                email, passwordHash, first_name, last_name, other_name,
                phone_number, 'alumni', graduation_year, program_of_study, major,
                faculty, department, current_company, job_title,
                current_city, current_country, bio, skills, interests, true
            ];

            const result = await pool.query(insertQuery, values);
            const newUser = result.rows[0];

            // Send credentials
            if (sendCredentials) {
                await sendLoginCredentials(newUser, tempPassword, phone_number, notifyVia);
            }

            res.status(201).json({
                success: true,
                message: "Alumni added successfully",
                data: {
                    id: newUser.id,
                    email: newUser.email,
                    name: `${newUser.first_name} ${newUser.last_name}`,
                    credentialsSent: sendCredentials
                }
            });

        } catch (error) {
            console.error("Add alumni error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to add alumni"
            });
        }
    },

    // ==================== DELETE USER ====================
    deleteUser: async (req, res) => {
        try {
            const { id } = req.params;
            
            const result = await pool.query(
                "DELETE FROM users WHERE id = $1 RETURNING id",
                [id]
            );

            if (result.rowCount === 0) {
                return res.status(404).json({
                    success: false,
                    error: "User not found"
                });
            }

            res.status(200).json({
                success: true,
                message: "User deleted permanently"
            });
        } catch (error) {
            console.error("Delete user error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to delete user"
            });
        }
    },

    // ==================== REACTIVATE USER ====================
    reactivateUser: async (req, res) => {
        try {
            const { id } = req.params;
            
            await pool.query(
                "UPDATE users SET is_active = true WHERE id = $1",
                [id]
            );

            res.status(200).json({
                success: true,
                message: "User reactivated successfully"
            });
        } catch (error) {
            console.error("Reactivate user error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to reactivate user"
            });
        }
    },

    // ==================== RESEND CREDENTIALS ====================
    resendCredentials: async (req, res) => {
        try {
            const { user_id } = req.params;
            const { notifyVia = 'both', resetPassword = true } = req.body;

            // Get user
            const userResult = await pool.query(
                "SELECT * FROM users WHERE id = $1",
                [user_id]
            );

            if (userResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: "User not found"
                });
            }

            const user = userResult.rows[0];
            let password = null;

            // Generate new password if requested
            if (resetPassword) {
                password = crypto.randomBytes(8).toString('hex');
                const passwordHash = await bcrypt.hash(password, 10);
                
                await pool.query(
                    "UPDATE users SET password_hash = $1 WHERE id = $2",
                    [passwordHash, user_id]
                );
            }

            // Send credentials
            await sendLoginCredentials(user, password, user.phone_number, notifyVia);

            res.status(200).json({
                success: true,
                message: "Credentials sent successfully"
            });

        } catch (error) {
            console.error("Resend credentials error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to resend credentials"
            });
        }
    }
};

// ==================== HELPER FUNCTIONS ====================

async function sendLoginCredentials(user, password, phoneNumber, notifyVia = 'both') {
    const loginUrl = process.env.FRONTEND_URL || 'https://alumni.atu.edu.gh';
    
    const emailSent = { success: false };
    const smsSent = { success: false };

    // Send Email
    if (notifyVia === 'email' || notifyVia === 'both') {
        try {
            const emailHtml = getCredentialsEmailTemplate(user, password, loginUrl);
            emailSent.result = await emailService.sendEmail({
                to: user.email,
                subject: 'Welcome to ATU Alumni Network - Your Login Credentials',
                html: emailHtml
            });
            emailSent.success = emailSent.result?.success || false;
        } catch (error) {
            console.error('Email send error:', error);
        }
    }

    // Send SMS
    if ((notifyVia === 'sms' || notifyVia === 'both') && phoneNumber) {
        try {
            const smsMessage = `Welcome to ATU Alumni Network!\n\nEmail: ${user.email}\nPassword: ${password}\n\nLogin: ${loginUrl}\n\nChange your password after first login.`;
            smsSent.result = await smsService.sendSMS(phoneNumber, smsMessage);
            smsSent.success = smsSent.result?.success || false;
        } catch (error) {
            console.error('SMS send error:', error);
        }
    }

    return {
        email: emailSent,
        sms: smsSent
    };
}

function getCredentialsEmailTemplate(user, password, loginUrl) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="margin: 0; padding: 0; font-family: Arial, sans-serif; background-color: #f4f4f4;">
            <div style="max-width: 600px; margin: 0 auto; background-color: white;">
                <!-- Header -->
                <div style="background: linear-gradient(135deg, #1e3a8a, #f59e0b); padding: 40px 30px; text-align: center;">
                    <h1 style="color: white; margin: 0; font-size: 28px;">🎓 Welcome to ATU Alumni Network</h1>
                </div>

                <!-- Content -->
                <div style="padding: 40px 30px;">
                    <h2 style="color: #1e3a8a; margin-bottom: 20px;">Hello ${user.first_name}!</h2>
                    
                    <p style="font-size: 16px; line-height: 1.6; color: #374151;">
                        Your account has been created on the ATU Alumni Network. Below are your login credentials:
                    </p>

                    <!-- Credentials Box -->
                    <div style="background: #f8fafc; padding: 25px; border-radius: 12px; margin: 25px 0; border-left: 4px solid #f59e0b;">
                        <p style="margin: 0 0 15px 0; font-size: 16px; color: #1e3a8a;">
                            <strong>📧 Email:</strong><br>
                            <span style="font-size: 18px; color: #374151;">${user.email}</span>
                        </p>
                        <p style="margin: 0; font-size: 16px; color: #1e3a8a;">
                            <strong>🔐 Password:</strong><br>
                            <span style="font-size: 18px; font-family: monospace; color: #374151; background: white; padding: 8px 12px; display: inline-block; border-radius: 4px;">${password}</span>
                        </p>
                    </div>

                    <!-- Warning Box -->
                    <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #f59e0b;">
                        <p style="color: #92400e; margin: 0; font-weight: 500;">
                            ⚠️ <strong>Important:</strong> Please change your password immediately after your first login for security purposes.
                        </p>
                    </div>

                    <!-- Login Button -->
                    <div style="text-align: center; margin: 35px 0;">
                        <a href="${loginUrl}/login" 
                           style="background: linear-gradient(135deg, #1e3a8a, #1e40af); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block; box-shadow: 0 4px 12px rgba(30, 58, 138, 0.3);">
                            Login Now →
                        </a>
                    </div>

                    <!-- What to Do Next -->
                    <div style="background: #ecfdf5; padding: 25px; border-radius: 12px; margin: 25px 0;">
                        <h3 style="color: #065f46; margin-top: 0; margin-bottom: 15px;">🚀 Get Started:</h3>
                        <ul style="color: #374151; line-height: 1.8; margin: 0; padding-left: 20px;">
                            <li>Complete your profile information</li>
                            <li>Upload a profile picture</li>
                            <li>Connect with fellow alumni</li>
                            <li>Explore job opportunities</li>
                            <li>Register for upcoming events</li>
                        </ul>
                    </div>

                    <p style="font-size: 16px; line-height: 1.6; color: #374151; margin-top: 30px;">
                        If you have any questions or need assistance, please contact us at 
                        <a href="mailto:support@atu.edu.gh" style="color: #1e3a8a;">support@atu.edu.gh</a>
                    </p>

                    <p style="font-size: 16px; line-height: 1.6; color: #374151;">
                        Best regards,<br>
                        <strong>The ATU Alumni Team</strong>
                    </p>
                </div>

                <!-- Footer -->
                <div style="background: #f9fafb; padding: 20px 30px; border-top: 1px solid #e5e7eb; text-align: center;">
                    <p style="font-size: 14px; color: #6b7280; margin: 0;">
                        © ${new Date().getFullYear()} Accra Technical University Alumni Association
                    </p>
                    <p style="font-size: 12px; color: #9ca3af; margin: 10px 0 0 0;">
                        This email contains sensitive login information. Please do not share it with others.
                    </p>
                </div>
            </div>
        </body>
        </html>
    `;
}

export default adminUserController;