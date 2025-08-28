require('dotenv').config();
const express = require('express');
const path = require('path');
const multer = require('multer');
const nodemailer = require('nodemailer');
const favicon = require('serve-favicon');
const { db } = require('./firebase'); // Your Firebase setup
const cookieParser = require('cookie-parser');
const msal = require('@azure/msal-node');
const { Client } = require('@microsoft/microsoft-graph-client');
require('isomorphic-fetch');
const axios = require('axios');

const app = express();

// ---------------- MSAL (OneDrive) Configuration ----------------
const msalConfig = {
    auth: {
        clientId: process.env.ONEDRIVE_CLIENT_ID, // Add your OneDrive client ID in .env
        authority: `https://login.microsoftonline.com/${process.env.ONEDRIVE_TENANT_ID}`, // Tenant ID in .env
        clientSecret: process.env.ONEDRIVE_CLIENT_SECRET, // Secret in .env
    }
};
const cca = new msal.ConfidentialClientApplication(msalConfig);

let cachedToken = null;
let tokenExpiryTime = null;

// ---------------- Helper Functions ----------------

// Get user from Firebase by username
const getUserByUsername = async (username) => {
    const userRef = db.ref(`users/${username}`);
    const snapshot = await userRef.once('value');
    const user = snapshot.val();
    if (user) return user;
    throw new Error('User not found');
};

// Get user by VAT
const getUserByVAT = async (vat) => {
    const userRef = db.ref('users').orderByChild('vat').equalTo(vat.toString());
    const snapshot = await userRef.once('value');
    const userData = snapshot.val();
    if (userData) {
        const userKey = Object.keys(userData)[0];
        return userData[userKey];
    }
    throw new Error('User not found for VAT');
};

// Get Microsoft Graph access token
const getAccessToken = async () => {
    if (cachedToken && tokenExpiryTime > Date.now()) {
        return cachedToken;
    }

    const tokenRequest = { scopes: ["https://graph.microsoft.com/.default"] };
    const response = await cca.acquireTokenByClientCredential(tokenRequest);
    cachedToken = response.accessToken;
    tokenExpiryTime = Date.now() + (response.expiresIn || 3600) * 1000;
    return cachedToken;
};

// Get authenticated Microsoft Graph client
const getAuthenticatedClient = (accessToken) => Client.init({
    authProvider: (done) => done(null, accessToken),
});

// ---------------- Express Middleware ----------------
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(favicon(path.join(__dirname, 'public', 'favicon.ico')));
app.use(express.static(path.join(__dirname, 'public')));
app.use(cookieParser());

app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

app.use((req, res, next) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    next();
});

// Error handler
app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    res.status(err.status || 500).json({ success: false, message: err.message || 'Internal server error' });
});

// ---------------- Routes ----------------

// Login route
app.post('/login', async (req, res, next) => {
    const { username, password } = req.body;
    try {
        const user = await getUserByUsername(username);
        if (user && user.password === password) {
            res.cookie('vat', user.vat, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 86400000 });
            res.cookie('isPayroll', user.isPayroll, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 86400000 });
            res.status(200).json({ success: true, message: 'Login successful' });
        } else {
            throw new Error('Invalid username or password');
        }
    } catch (error) {
        next(error);
    }
});

app.get('/logout', (req, res) => {
    res.clearCookie('vat');
    res.clearCookie('isPayroll');
    res.redirect('/');
});

app.get('/', (req, res) => {
    res.render('homepage', { showPayroll: false });
});

app.get('/index', (req, res) => {
    const { vat, isPayroll } = req.cookies;
    if (!vat) return res.redirect('/');
    res.render('index', { vat, showPayroll: isPayroll === '1' });
});

app.get('/payroll', (req, res) => {
    const { vat, isPayroll } = req.cookies;
    if (!vat) return res.redirect('/');
    res.render('payroll', { vat, showPayroll: isPayroll === '1' });
});

app.get('/fmy', (req, res) => {
    const { vat, isPayroll } = req.cookies;
    if (!vat) return res.redirect('/');
    res.render('fmy', { vat, showPayroll: isPayroll === '1' });
});

app.get('/afm', (req, res) => {
    const { vat, isPayroll } = req.cookies;
    if (!vat) return res.redirect('/');
    res.render('afm', { vat, showPayroll: isPayroll === '1' });
});

app.get('/invoice', (req, res) => {
    const { vat, isPayroll } = req.cookies;
    if (vat) res.render('invoice', { vat, showPayroll: isPayroll === '1' });
    else res.redirect('/');
});

app.get('/files', async (req, res, next) => {
    const vat = req.cookies.vat?.toString();
    if (!vat) return res.redirect('/');
    try {
        const showPayroll = req.cookies.isPayroll === '1';
        res.render('files', { vat, showPayroll });
    } catch (error) {
        next(error);
    }
});

// ---------------- Upload / Download Routes ----------------

// Configure multer
const storage = multer.memoryStorage();
const upload = multer({
    storage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = [
            'image/jpeg', 'image/png', 'application/pdf', 'text/plain',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'text/csv', 'text/html',
        ];
        cb(null, allowedTypes.includes(file.mimetype));
    },
    limits: { fileSize: 10 * 1024 * 1024 } // 10 MB
});

// File upload route
app.post('/upload', upload.array('files', 10), async (req, res, next) => {
    const vat = req.cookies.vat?.toString();
    if (!vat) return res.status(403).json({ error: 'No VAT in cookies' });

    if (!req.files || req.files.length === 0) {
        return res.status(400).send('<script>alert("Select files to upload."); window.location.href="/invoice";</script>');
    }

    try {
        const accessToken = await getAccessToken();
        const client = getAuthenticatedClient(accessToken);

        // --------- USER INPUT REQUIRED ---------
        const sharedFolderId = "YOUR_SHARED_FOLDER_ID"; // Add your OneDrive shared folder ID here

        // Implement logic to create/fetch user-specific folders in OneDrive
        // Upload each file to OneDrive
        await Promise.all(req.files.map(async (file) => {
            const fileStream = Buffer.from(file.buffer);
            const fileName = file.originalname;
            // --------- USER INPUT REQUIRED ---------
            const targetFolderId = "USER_TARGET_FOLDER_ID"; // Add folder ID for uploads
            await client.api(`/drives/YOUR_DRIVE_ID/items/${targetFolderId}:/${fileName}:/content`).put(fileStream);
        }));

        res.send('<script>alert("Files uploaded successfully."); window.location.href="/invoice";</script>');
    } catch (error) {
        next(error);
    }
});

// Contact form submission route
app.post('/submit_contact', async (req, res, next) => {
    const message = req.body.message;
    const vat = req.cookies.vat;

    try {
        if (!vat) return res.status(401).send('<script>alert("Cannot upload"); window.location.href="/";</script>');

        const user = await getUserByVAT(vat);

        // --------- USER INPUT REQUIRED ---------
        const transporter = nodemailer.createTransport({
            host: 'YOUR_SMTP_HOST', // Add your SMTP host
            port: 587,               // Adjust port if needed
            secure: false,           // true for 465, false for other ports
            auth: {
                user: process.env.MAIL_USER, // Add in .env
                pass: process.env.MAIL_PASS  // Add in .env
            }
        });

        const mailOptions = {
            from: user.email,
            to: 'RECIPIENT_EMAIL', // Add recipient email
            subject: `myApp - VAT: ${vat}`,
            text: `Email: ${user.email}\n\nMessage:\n${message}`
        };

        await transporter.sendMail(mailOptions);
        res.status(200).send('<script>alert("The mail was sent successfully."); window.location.href="/contact";</script>');

    } catch (error) {
        next(error);
    }
});

// ---------------- Start Server ----------------
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});
