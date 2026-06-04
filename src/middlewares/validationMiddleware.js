// src/middlewares/validationMiddleware.js

export const validateEmail = (email) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
};

export const validatePassword = (password) => {
    // At least 8 characters, 1 uppercase, 1 lowercase, 1 number
    const passwordRegex = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/;
    return passwordRegex.test(password);
};

export const validatePhone = (phone) => {
    const phoneRegex = /^(\+233|0)[2-5][0-9]{8}$/;
    return phoneRegex.test(phone);
};

export const validateRegistration = (req, res, next) => {
    const {
        email, password,
        // Accept both camelCase (open-register) and snake_case (admin/self-register)
        firstName, first_name,
        lastName,  last_name,
    } = req.body;

    const fn = firstName || first_name;
    const ln = lastName  || last_name;

    if (!email || !password || !fn || !ln) {
        return res.status(400).json({
            success: false,
            error: "Email, password, first name, and last name are required"
        });
    }

    if (!validateEmail(email)) {
        return res.status(400).json({
            success: false,
            error: "Invalid email format"
        });
    }

    if (!validatePassword(password)) {
        return res.status(400).json({
            success: false,
            error: "Password must be at least 8 characters with uppercase, lowercase, and number"
        });
    }

    if (fn.length < 2 || ln.length < 2) {
        return res.status(400).json({
            success: false,
            error: "First name and last name must be at least 2 characters"
        });
    }

    next();
};

export const validateLogin = (req, res, next) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({
            success: false,
            error: "Email and password are required"
        });
    }

    if (!validateEmail(email)) {
        return res.status(400).json({
            success: false,
            error: "Invalid email format"
        });
    }

    next();
};

export const validateProfileUpdate = (req, res, next) => {
    const { email, phone_number } = req.body;

    if (email && !validateEmail(email)) {
        return res.status(400).json({
            success: false,
            error: "Invalid email format"
        });
    }

    if (phone_number && !validatePhone(phone_number)) {
        return res.status(400).json({
            success: false,
            error: "Invalid phone number format. Use Ghana format: +233XXXXXXXXX or 0XXXXXXXXX"
        });
    }

    next();
};