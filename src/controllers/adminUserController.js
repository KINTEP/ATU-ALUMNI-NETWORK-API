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

            // ✅ FIX: Wrap entire import in a transaction so a crash mid-import
            // doesn't leave the DB in a partial state. Each alumnus is still
            // processed individually so we can report per-row results, but the
            // whole batch commits or rolls back together.
            const client = await pool.connect();

            try {
                await client.query('BEGIN');

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
                        const existingUser = await client.query(
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

                        // ✅ FIX: RETURNING only safe fields — no password_hash exposed
                        const insertQuery = `
                            INSERT INTO users (
                                email, password_hash, first_name, last_name, other_name,
                                phone_number, role, graduation_year, program_of_study, major,
                                faculty, department, current_company, job_title,
                                current_city, current_country, bio, skills, interests,
                                is_verified, student_id, is_claimed
                            ) VALUES (
                                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                                $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
                            ) RETURNING id, email, first_name, last_name, phone_number, student_id
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
                            true,           // is_verified
                            alumnus.student_id || null,
                            false           // is_claimed — not yet claimed by the alumni themselves
                        ];

                        const result = await client.query(insertQuery, values);
                        const newUser = result.rows[0];

                        results.imported++;
                        results.details.push({
                            email: alumnus.email,
                            student_id: alumnus.student_id,
                            status: 'imported',
                            userId: newUser.id
                        });

                        // Send credentials if requested (outside transaction — email failures shouldn't rollback)
                        if (sendCredentials) {
                            try {
                                await sendLoginCredentials(newUser, tempPassword, alumnus.phone_number, notifyVia);
                            } catch (notifyErr) {
                                console.warn(`Credential notification failed for ${alumnus.email}:`, notifyErr.message);
                            }
                        }

                    } catch (rowError) {
                        console.error(`Error importing ${alumnus.email}:`, rowError);
                        results.failed++;
                        results.details.push({
                            email: alumnus.email,
                            student_id: alumnus.student_id,
                            status: 'failed',
                            error: rowError.message
                        });
                    }
                }

                await client.query('COMMIT');

            } catch (txError) {
                await client.query('ROLLBACK');
                throw txError;
            } finally {
                client.release();
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

            // ✅ FIX: RETURNING only safe fields — original used RETURNING * which includes password_hash
            const insertQuery = `
                INSERT INTO users (
                    email, password_hash, first_name, last_name, other_name,
                    phone_number, role, graduation_year, program_of_study, major,
                    faculty, department, current_company, job_title,
                    current_city, current_country, bio, skills, interests,
                    is_verified, is_claimed
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21
                ) RETURNING id, email, first_name, last_name, phone_number
            `;

            const values = [
                email, passwordHash, first_name, last_name, other_name || null,
                phone_number || null, 'alumni', graduation_year || null,
                program_of_study || null, major || null, faculty || null,
                department || null, current_company || null, job_title || null,
                current_city || null, current_country || null, bio || null,
                skills || null, interests || null,
                true,   // is_verified
                false   // is_claimed — admin-created, not yet claimed by alumni
            ];

            const result = await pool.query(insertQuery, values);
            const newUser = result.rows[0];

            // Send credentials
            if (sendCredentials) {
                try {
                    await sendLoginCredentials(newUser, tempPassword, phone_number, notifyVia);
                } catch (notifyErr) {
                    console.warn('Credential notification failed (non-fatal):', notifyErr.message);
                }
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

    // ==================== DEACTIVATE USER (SOFT DELETE) ====================
    // ✅ FIX: Original used hard DELETE which cascades and destroys all alumni data permanently.
    // Use soft delete (is_active = false) instead. A separate permanent delete endpoint
    // can be added if truly needed, but should require additional confirmation.
    deactivateUser: async (req, res) => {
        try {
            const { id } = req.params;

            const result = await pool.query(
                "UPDATE users SET is_active = false WHERE id = $1 RETURNING id, email, first_name, last_name",
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
                message: "User deactivated successfully. Their data is preserved and the account can be reactivated.",
                data: {
                    id: result.rows[0].id,
                    email: result.rows[0].email,
                    name: `${result.rows[0].first_name} ${result.rows[0].last_name}`
                }
            });
        } catch (error) {
            console.error("Deactivate user error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to deactivate user"
            });
        }
    },

    // ==================== PERMANENT DELETE USER (ADMIN ONLY — IRREVERSIBLE) ====================
    // Only use when truly necessary (e.g. GDPR request). Separate from deactivate.
    permanentDeleteUser: async (req, res) => {
        try {
            const { id } = req.params;
            const { confirm } = req.body;

            // Require explicit confirmation in request body
            if (confirm !== 'DELETE_PERMANENTLY') {
                return res.status(400).json({
                    success: false,
                    error: "To permanently delete a user, send { confirm: 'DELETE_PERMANENTLY' } in the request body. This action cannot be undone."
                });
            }

            const result = await pool.query(
                "DELETE FROM users WHERE id = $1 RETURNING id, email",
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
                message: "User permanently deleted",
                data: { id: result.rows[0].id, email: result.rows[0].email }
            });
        } catch (error) {
            console.error("Permanent delete user error:", error);
            res.status(500).json({
                success: false,
                error: "Failed to permanently delete user"
            });
        }
    },

    // ==================== REACTIVATE USER ====================
    reactivateUser: async (req, res) => {
        try {
            const { id } = req.params;

            const result = await pool.query(
                "UPDATE users SET is_active = true WHERE id = $1 RETURNING id, email, first_name, last_name",
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
                message: "User reactivated successfully",
                data: {
                    id: result.rows[0].id,
                    email: result.rows[0].email,
                    name: `${result.rows[0].first_name} ${result.rows[0].last_name}`
                }
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

            // Validate notifyVia value
            if (!['email', 'sms', 'both'].includes(notifyVia)) {
                return res.status(400).json({
                    success: false,
                    error: "notifyVia must be 'email', 'sms', or 'both'"
                });
            }

            // Get user — only safe fields
            const userResult = await pool.query(
                "SELECT id, email, first_name, last_name, phone_number FROM users WHERE id = $1",
                [user_id]
            );

            if (userResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: "User not found"
                });
            }

            const user = userResult.rows[0];

            // Validate SMS is possible if requested
            if ((notifyVia === 'sms' || notifyVia === 'both') && !user.phone_number) {
                return res.status(400).json({
                    success: false,
                    error: "User has no phone number on record. Use notifyVia 'email' instead."
                });
            }

            if (!resetPassword) {
                return res.status(400).json({
                    success: false,
                    error: "No credentials to send. Set resetPassword to true to generate a new password."
                });
            }

            // Generate and save new password
            const password = crypto.randomBytes(8).toString('hex');
            const passwordHash = await bcrypt.hash(password, 10);

            await pool.query(
                "UPDATE users SET password_hash = $1 WHERE id = $2",
                [passwordHash, user_id]
            );

            // Send credentials
            const sendResult = await sendLoginCredentials(
                user, password, user.phone_number, notifyVia
            );

            const emailOk = sendResult.email?.success;
            const smsOk = sendResult.sms?.success;
            const anySucceeded = emailOk || smsOk;

            if (!anySucceeded) {
                return res.status(500).json({
                    success: false,
                    error: "Credentials were reset but failed to deliver via any channel.",
                    delivery: {
                        email: emailOk ? "sent" : "failed",
                        sms: smsOk ? "sent" : "failed"
                    }
                });
            }

            res.status(200).json({
                success: true,
                message: "Credentials reset and sent successfully",
                delivery: {
                    email: notifyVia === 'sms' ? "skipped" : emailOk ? "sent" : "failed",
                    sms: notifyVia === 'email' ? "skipped" : !user.phone_number ? "no phone" : smsOk ? "sent" : "failed"
                }
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
    const loginUrl = process.env.FRONTEND_URL || 'https://atu-alumni-network.web.app';

    const emailSent = { success: false };
    const smsSent = { success: false };

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

    if ((notifyVia === 'sms' || notifyVia === 'both') && phoneNumber) {
        try {
            const smsMessage = `Welcome to ATU Alumni Network!\n\nEmail: ${user.email}\nPassword: ${password}\n\nLogin: ${loginUrl}\n\nChange your password after first login.`;
            smsSent.result = await smsService.sendSMS(phoneNumber, smsMessage);
            smsSent.success = smsSent.result?.success || false;
        } catch (error) {
            console.error('SMS send error:', error);
        }
    }

    return { email: emailSent, sms: smsSent };
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
                <div style="background: linear-gradient(135deg, #1e3a8a, #f59e0b); padding: 40px 30px; text-align: center;">
                    <h1 style="color: white; margin: 0; font-size: 28px;">🎓 Welcome to ATU Alumni Network</h1>
                </div>
                <div style="padding: 40px 30px;">
                    <h2 style="color: #1e3a8a; margin-bottom: 20px;">Hello ${user.first_name}!</h2>
                    <p style="font-size: 16px; line-height: 1.6; color: #374151;">
                        Your account has been created on the ATU Alumni Network. Below are your login credentials:
                    </p>
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
                    <div style="background: #fef3c7; padding: 20px; border-radius: 8px; margin: 25px 0; border-left: 4px solid #f59e0b;">
                        <p style="color: #92400e; margin: 0; font-weight: 500;">
                            ⚠️ <strong>Important:</strong> Please change your password immediately after your first login.
                        </p>
                    </div>
                    <div style="text-align: center; margin: 35px 0;">
                        <a href="${loginUrl}/login"
                           style="background: linear-gradient(135deg, #1e3a8a, #1e40af); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; display: inline-block;">
                            Login Now →
                        </a>
                    </div>
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
                    <p style="font-size: 16px; line-height: 1.6; color: #374151;">
                        Best regards,<br>
                        <strong>The ATU Alumni Team</strong>
                    </p>
                </div>
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