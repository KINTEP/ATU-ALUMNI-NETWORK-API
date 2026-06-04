// src/controllers/tracerStudyController.js
import pool from "../config/db.js";

const tracerStudyController = {

    // ==================== RESPONSES ====================

    getAllResponses: async (req, res) => {
        try {
            const { programme, year, current_status, sector, page=1, limit=20, sort_by='submitted_at', sort_order='DESC' } = req.query;

            let queryText = `
                SELECT tsr.*, u.first_name || ' ' || u.last_name as user_name, u.email as user_email
                FROM tracer_study_responses tsr
                LEFT JOIN users u ON tsr.user_id = u.id
                WHERE tsr.is_completed = true
            `;
            const queryParams = [];
            let p = 0;

            if (programme) { p++; queryText += ` AND tsr.programme_of_study = $${p}`; queryParams.push(programme); }
            if (year)      { p++; queryText += ` AND tsr.year_of_graduation = $${p}`; queryParams.push(year); }
            if (current_status) { p++; queryText += ` AND tsr.current_status = $${p}`; queryParams.push(current_status); }
            if (sector)    { p++; queryText += ` AND tsr.sector = $${p}`; queryParams.push(sector); }

            const countResult = await pool.query(queryText.replace(/SELECT[\s\S]*?FROM/i, 'SELECT COUNT(*) FROM'), queryParams);
            const totalResponses = parseInt(countResult.rows[0].count);

            const validSortFields = ['submitted_at','created_at','year_of_graduation','full_name','programme_of_study','current_status'];
            const sortField = validSortFields.includes(sort_by) ? sort_by : 'submitted_at';
            const order = sort_order.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
            const offset = (page-1)*limit;

            p++; queryText += ` ORDER BY tsr.${sortField} ${order} LIMIT $${p}`; queryParams.push(parseInt(limit));
            p++; queryText += ` OFFSET $${p}`; queryParams.push(offset);

            const result = await pool.query(queryText, queryParams);

            res.status(200).json({
                success: true, count: result.rows.length, total: totalResponses,
                pagination: { page: parseInt(page), limit: parseInt(limit), total_pages: Math.ceil(totalResponses/limit) },
                data: result.rows
            });
        } catch (error) {
            console.error("Get responses error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch tracer study responses" });
        }
    },

    getResponseById: async (req, res) => {
        try {
            const result = await pool.query(
                `SELECT tsr.*, u.first_name || ' ' || u.last_name as user_name, u.profile_picture as user_picture
                 FROM tracer_study_responses tsr
                 LEFT JOIN users u ON tsr.user_id = u.id
                 WHERE tsr.id = $1`,
                [req.params.id]
            );
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Response not found" });
            res.status(200).json({ success: true, data: result.rows[0] });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch response" });
        }
    },

    getMyResponse: async (req, res) => {
        try {
            const userId = req.user.id || req.user.userId;
            const result = await pool.query(
                "SELECT * FROM tracer_study_responses WHERE user_id = $1",
                [userId]
            );
            if (result.rows.length === 0) {
                return res.status(404).json({ success: false, error: "No response found", has_submitted: false });
            }
            res.status(200).json({ success: true, has_submitted: true, data: result.rows[0] });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch your response" });
        }
    },

    checkSubmissionStatus: async (req, res) => {
        try {
            const userId = req.user.id || req.user.userId;
            const result = await pool.query(
                "SELECT id, submitted_at FROM tracer_study_responses WHERE user_id = $1",
                [userId]
            );
            res.status(200).json({
                success: true,
                has_submitted: result.rows.length > 0,
                submission_date: result.rows.length > 0 ? result.rows[0].submitted_at : null
            });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to check submission status" });
        }
    },

    // ── Submit response ────────────────────────────────────────────────────
    submitResponse: async (req, res) => {
        try {
            const userId = req.user.id || req.user.userId;

            const {
                full_name, index_number, programme_of_study, year_of_graduation, email, phone_number,
                current_status, time_to_first_job, main_challenge,
                job_title, employer_name, sector, job_related_to_field, monthly_income_range,
                how_found_job, job_level,
                skills_relevance_rating, skills_to_strengthen, job_satisfaction_rating,
                programme_quality_rating, internship_support_satisfaction, would_recommend_atu,
                is_alumni_member, willing_to_mentor, preferred_contact_method, willing_to_collaborate
            } = req.body;

            if (!full_name || !index_number || !programme_of_study || !year_of_graduation || !email || !phone_number || !current_status) {
                return res.status(400).json({ success: false, error: "Required fields are missing" });
            }

            const existingResponse = await pool.query(
                "SELECT id FROM tracer_study_responses WHERE user_id = $1", [userId]
            );
            if (existingResponse.rows.length > 0) {
                return res.status(409).json({ success: false, error: "You have already submitted a tracer study response" });
            }

            if (['Employed','Self-employed'].includes(current_status) && (!job_title || !employer_name || !sector)) {
                return res.status(400).json({ success: false, error: "Job title, employer name, and sector are required for employed/self-employed status" });
            }

            // ── Pass willing_to_mentor, willing_to_collaborate, is_alumni_member
            // as plain strings — columns are now TEXT so 'true', 'false', 'Maybe',
            // 'Not aware' are all valid values.
            const result = await pool.query(
                `INSERT INTO tracer_study_responses (
                    user_id, full_name, index_number, programme_of_study, year_of_graduation,
                    email, phone_number, current_status, time_to_first_job, main_challenge,
                    job_title, employer_name, sector, job_related_to_field, monthly_income_range,
                    how_found_job, job_level, skills_relevance_rating, skills_to_strengthen,
                    job_satisfaction_rating, programme_quality_rating, internship_support_satisfaction,
                    would_recommend_atu, is_alumni_member, willing_to_mentor,
                    preferred_contact_method, willing_to_collaborate
                ) VALUES (
                    $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
                    $11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                    $21,$22,$23,$24,$25,$26,$27
                ) RETURNING *`,
                [
                    userId,
                    full_name,
                    index_number,
                    programme_of_study,
                    year_of_graduation,
                    email,
                    phone_number,
                    current_status,
                    time_to_first_job          || null,
                    main_challenge             || null,
                    job_title                  || null,
                    employer_name              || null,
                    sector                     || null,
                    job_related_to_field       || null,
                    monthly_income_range       || null,
                    how_found_job              || null,
                    job_level                  || null,
                    skills_relevance_rating    || null,
                    skills_to_strengthen       || null,
                    job_satisfaction_rating    || null,
                    programme_quality_rating   || null,
                    internship_support_satisfaction || null,
                    would_recommend_atu        || null,
                    // ── TEXT columns — pass value as-is (null if empty) ──
                    is_alumni_member  != null && is_alumni_member  !== '' ? String(is_alumni_member)  : null,
                    willing_to_mentor != null && willing_to_mentor !== '' ? String(willing_to_mentor) : null,
                    preferred_contact_method   || null,
                    willing_to_collaborate != null && willing_to_collaborate !== '' ? String(willing_to_collaborate) : null
                ]
            );

            res.status(201).json({
                success: true,
                message: "Tracer study response submitted successfully",
                data: result.rows[0]
            });
        } catch (error) {
            console.error("Submit response error:", error);
            res.status(500).json({ success: false, error: "Failed to submit tracer study response" });
        }
    },

    updateResponse: async (req, res) => {
        try {
            const { id } = req.params;
            const userId = parseInt(req.user.id || req.user.userId);

            const responseCheck = await pool.query(
                "SELECT user_id FROM tracer_study_responses WHERE id = $1", [id]
            );
            if (responseCheck.rows.length === 0) return res.status(404).json({ success: false, error: "Response not found" });
            if (parseInt(responseCheck.rows[0].user_id) !== userId) {
                return res.status(403).json({ success: false, error: "You don't have permission to update this response" });
            }

            const allowedFields = [
                'full_name','index_number','programme_of_study','year_of_graduation','email','phone_number',
                'current_status','time_to_first_job','main_challenge','job_title','employer_name','sector',
                'job_related_to_field','monthly_income_range','how_found_job','job_level',
                'skills_relevance_rating','skills_to_strengthen','job_satisfaction_rating',
                'programme_quality_rating','internship_support_satisfaction','would_recommend_atu',
                'is_alumni_member','willing_to_mentor','preferred_contact_method','willing_to_collaborate'
            ];

            const updates = [], values = [];
            let p = 0;
            Object.keys(req.body).forEach(key => {
                if (allowedFields.includes(key)) {
                    p++;
                    updates.push(`${key} = $${p}`);
                    // Stringify the three TEXT columns that may carry non-boolean values
                    if (['is_alumni_member','willing_to_mentor','willing_to_collaborate'].includes(key)) {
                        values.push(req.body[key] != null ? String(req.body[key]) : null);
                    } else {
                        values.push(req.body[key]);
                    }
                }
            });

            if (updates.length === 0) return res.status(400).json({ success: false, error: "No valid fields to update" });

            values.push(id); p++;
            const result = await pool.query(
                `UPDATE tracer_study_responses SET ${updates.join(', ')} WHERE id = $${p} RETURNING *`, values
            );

            res.status(200).json({ success: true, message: "Response updated successfully", data: result.rows[0] });
        } catch (error) {
            console.error("Update response error:", error);
            res.status(500).json({ success: false, error: "Failed to update response" });
        }
    },

    deleteResponse: async (req, res) => {
        try {
            const result = await pool.query(
                "DELETE FROM tracer_study_responses WHERE id = $1 RETURNING *", [req.params.id]
            );
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "Response not found" });
            res.status(200).json({ success: true, message: "Response deleted successfully" });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to delete response" });
        }
    },

    // ==================== ANALYTICS ====================

    getAnalytics: async (req, res) => {
        try {
            const [analyticsResult, employmentByProgramme, employmentBySector, timeToEmployment, jobRelevance, incomeDistribution, responsesByYear, mainChallenges] = await Promise.all([
                pool.query("SELECT * FROM tracer_study_analytics"),
                pool.query(`SELECT programme_of_study, COUNT(*) as total_responses, COUNT(CASE WHEN current_status IN ('Employed','Self-employed') THEN 1 END) as employed_count, ROUND(COUNT(CASE WHEN current_status IN ('Employed','Self-employed') THEN 1 END)::numeric/COUNT(*)::numeric*100,2) as employment_rate FROM tracer_study_responses WHERE is_completed=true GROUP BY programme_of_study ORDER BY employment_rate DESC`),
                pool.query(`SELECT sector, COUNT(*) as count FROM tracer_study_responses WHERE sector IS NOT NULL AND is_completed=true GROUP BY sector ORDER BY count DESC`),
                pool.query(`SELECT time_to_first_job, COUNT(*) as count FROM tracer_study_responses WHERE time_to_first_job IS NOT NULL AND is_completed=true GROUP BY time_to_first_job ORDER BY CASE time_to_first_job WHEN 'Less than 3 months' THEN 1 WHEN '3-6 months' THEN 2 WHEN '6-12 months' THEN 3 WHEN 'More than a year' THEN 4 ELSE 5 END`),
                pool.query(`SELECT job_related_to_field, COUNT(*) as count FROM tracer_study_responses WHERE job_related_to_field IS NOT NULL AND is_completed=true GROUP BY job_related_to_field ORDER BY count DESC`),
                pool.query(`SELECT monthly_income_range, COUNT(*) as count FROM tracer_study_responses WHERE monthly_income_range IS NOT NULL AND monthly_income_range!='Prefer not to say' AND is_completed=true GROUP BY monthly_income_range ORDER BY count DESC`),
                pool.query(`SELECT year_of_graduation, COUNT(*) as count FROM tracer_study_responses WHERE is_completed=true GROUP BY year_of_graduation ORDER BY year_of_graduation DESC`),
                pool.query(`SELECT main_challenge, COUNT(*) as count FROM tracer_study_responses WHERE main_challenge IS NOT NULL AND is_completed=true GROUP BY main_challenge ORDER BY count DESC`)
            ]);

            res.status(200).json({
                success: true,
                data: {
                    overview: analyticsResult.rows[0],
                    employment_by_programme: employmentByProgramme.rows,
                    employment_by_sector: employmentBySector.rows,
                    time_to_employment: timeToEmployment.rows,
                    job_relevance: jobRelevance.rows,
                    income_distribution: incomeDistribution.rows,
                    responses_by_year: responsesByYear.rows,
                    main_challenges: mainChallenges.rows
                }
            });
        } catch (error) {
            console.error("Get analytics error:", error);
            res.status(500).json({ success: false, error: "Failed to fetch analytics" });
        }
    },

    getAnalyticsByProgramme: async (req, res) => {
        try {
            const { programme } = req.params;
            const [stats, sectorDistribution, incomeDistribution] = await Promise.all([
                pool.query(`SELECT COUNT(*) as total_responses, COUNT(CASE WHEN current_status='Employed' THEN 1 END) as employed_count, COUNT(CASE WHEN current_status='Self-employed' THEN 1 END) as self_employed_count, COUNT(CASE WHEN current_status='Unemployed' THEN 1 END) as unemployed_count, COUNT(CASE WHEN current_status='Pursuing further studies' THEN 1 END) as further_studies_count, ROUND(AVG(skills_relevance_rating),2) as avg_skills_relevance, ROUND(AVG(job_satisfaction_rating),2) as avg_job_satisfaction, COUNT(CASE WHEN would_recommend_atu='Yes' THEN 1 END) as would_recommend_count FROM tracer_study_responses WHERE programme_of_study=$1 AND is_completed=true`, [programme]),
                pool.query(`SELECT sector, COUNT(*) as count FROM tracer_study_responses WHERE programme_of_study=$1 AND sector IS NOT NULL AND is_completed=true GROUP BY sector ORDER BY count DESC`, [programme]),
                pool.query(`SELECT monthly_income_range, COUNT(*) as count FROM tracer_study_responses WHERE programme_of_study=$1 AND monthly_income_range IS NOT NULL AND monthly_income_range!='Prefer not to say' AND is_completed=true GROUP BY monthly_income_range ORDER BY count DESC`, [programme])
            ]);
            res.status(200).json({ success: true, programme, data: { statistics: stats.rows[0], sector_distribution: sectorDistribution.rows, income_distribution: incomeDistribution.rows } });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch programme analytics" });
        }
    },

    getAnalyticsByYear: async (req, res) => {
        try {
            const { year } = req.params;
            const [stats, programmeDistribution] = await Promise.all([
                pool.query(`SELECT COUNT(*) as total_responses, COUNT(CASE WHEN current_status='Employed' THEN 1 END) as employed_count, COUNT(CASE WHEN current_status='Self-employed' THEN 1 END) as self_employed_count, COUNT(CASE WHEN current_status='Unemployed' THEN 1 END) as unemployed_count, ROUND(AVG(skills_relevance_rating),2) as avg_skills_relevance, ROUND(AVG(job_satisfaction_rating),2) as avg_job_satisfaction FROM tracer_study_responses WHERE year_of_graduation=$1 AND is_completed=true`, [year]),
                pool.query(`SELECT programme_of_study, COUNT(*) as count FROM tracer_study_responses WHERE year_of_graduation=$1 AND is_completed=true GROUP BY programme_of_study ORDER BY count DESC`, [year])
            ]);
            res.status(200).json({ success: true, year: parseInt(year), data: { statistics: stats.rows[0], programme_distribution: programmeDistribution.rows } });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch year analytics" });
        }
    },

    // ── Mentors list — uses TEXT comparison now ────────────────────────────
    getMentorsList: async (req, res) => {
        try {
            const { programme, sector } = req.query;
            let queryText = `
                SELECT tsr.id, tsr.full_name, tsr.email, tsr.phone_number, tsr.programme_of_study,
                    tsr.year_of_graduation, tsr.job_title, tsr.employer_name, tsr.sector,
                    tsr.preferred_contact_method, u.profile_picture
                FROM tracer_study_responses tsr
                LEFT JOIN users u ON tsr.user_id = u.id
                WHERE tsr.willing_to_mentor = 'true'
                AND tsr.is_completed = true
                AND tsr.current_status IN ('Employed', 'Self-employed')
            `;
            const queryParams = [];
            let p = 0;
            if (programme) { p++; queryText += ` AND tsr.programme_of_study = $${p}`; queryParams.push(programme); }
            if (sector)    { p++; queryText += ` AND tsr.sector = $${p}`; queryParams.push(sector); }
            queryText += ` ORDER BY tsr.year_of_graduation DESC`;
            const result = await pool.query(queryText, queryParams);
            res.status(200).json({ success: true, count: result.rows.length, data: result.rows });
        } catch (error) {
            res.status(500).json({ success: false, error: "Failed to fetch mentors list" });
        }
    },

    exportResponses: async (req, res) => {
        try {
            const { programme, year } = req.query;
            let queryText = `
                SELECT id, full_name, index_number, programme_of_study, year_of_graduation,
                    email, phone_number, current_status, time_to_first_job, main_challenge,
                    job_title, employer_name, sector, job_related_to_field,
                    monthly_income_range, how_found_job, job_level,
                    skills_relevance_rating, job_satisfaction_rating,
                    programme_quality_rating, internship_support_satisfaction, would_recommend_atu,
                    is_alumni_member, willing_to_mentor, preferred_contact_method,
                    willing_to_collaborate, submitted_at
                FROM tracer_study_responses WHERE is_completed = true
            `;
            const queryParams = [];
            let p = 0;
            if (programme) { p++; queryText += ` AND programme_of_study = $${p}`; queryParams.push(programme); }
            if (year)      { p++; queryText += ` AND year_of_graduation = $${p}`; queryParams.push(year); }
            queryText += ` ORDER BY submitted_at DESC`;

            const result = await pool.query(queryText, queryParams);
            if (result.rows.length === 0) return res.status(404).json({ success: false, error: "No responses found" });

            const headers = Object.keys(result.rows[0]);
            const csvRows = [
                headers.join(','),
                ...result.rows.map(row =>
                    headers.map(header => {
                        const value = row[header];
                        if (value === null) return '';
                        const stringValue = String(value);
                        return (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n'))
                            ? `"${stringValue.replace(/"/g, '""')}"`
                            : stringValue;
                    }).join(',')
                )
            ];

            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=tracer_study_responses_${Date.now()}.csv`);
            res.status(200).send(csvRows.join('\n'));
        } catch (error) {
            console.error("Export responses error:", error);
            res.status(500).json({ success: false, error: "Failed to export responses" });
        }
    }
};

export default tracerStudyController;