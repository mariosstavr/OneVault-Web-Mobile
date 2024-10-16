const express = require('express');
const path = require('path');
const xlsx = require('xlsx');
const bodyParser = require('body-parser');
const session = require('express-session');
const multer = require('multer');
const fs = require('fs');
const nodemailer = require('nodemailer');
const https = require('https'); // Include HTTPS module

const app = express();

// Parse incoming request bodies
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Configure session middleware
app.use(session({
    secret: 'your_secret_key',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }
}));

// Serve static files including CSS from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Set the views directory and the view engine
app.set('views', path.join(__dirname, 'views'));
app.set('view engine', 'ejs');

// Ensure UTF-8 encoding for all responses
app.use((req, res, next) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    next();
});

// Define a route to render the homepage
app.get('/', (req, res) => {
    res.render('homepage');
});

// Define a route to render the index page
app.get('/index', (req, res) => {
    if (req.session.vat) {
        res.render('index', { vat: req.session.vat });
    } else {
        res.redirect('/');
    }
});

// Define a route for logging out
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Function to read credentials from the Excel file
const readCredentials = () => {
    const filePath = path.join(__dirname, 'data', 'credentials.xlsx');
    const workbook = xlsx.readFile(filePath);
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    return xlsx.utils.sheet_to_json(sheet).map(row => ({
        username: row.username,
        password: row.password.toString(),
        vat: row.vat, // assuming the column is named 'vat' in the excel file
        email: row.email // assuming the column is named 'email' in the excel file
    }));
};

app.post('/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        const credentials = readCredentials();
        const user = credentials.find(cred => cred.username === username && cred.password === password);
        if (user) {
            req.session.vat = user.vat;
            res.json({ message: 'Login successful', vat: user.vat });
        } else {
            res.status(401).json({ message: 'Το username ή ο κωδικός είναι λανθασμένα' });
        }
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Error processing login request' });
    }
});

// Middleware to handle file uploads with multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const vat = req.session.vat.toString(); // Ensure VAT is treated as a string
        const folderPath = path.join('D:', vat);
        if (!fs.existsSync(folderPath)) {
            fs.mkdirSync(folderPath, { recursive: true });
        }
        cb(null, folderPath);
    },
    filename: (req, file, cb) => {
        const originalFilename = Buffer.from(file.originalname, 'latin1').toString('utf8'); // Handle file names correctly
        const folderPath = path.join('D:', req.session.vat.toString());
        
        // Function to generate a unique filename
        const generateUniqueFilename = (folderPath, originalFilename) => {
            let filename = originalFilename;
            let counter = 1;

            // Check if the file already exists in the folder
            while (fs.existsSync(path.join(folderPath, filename))) {
                // Append a counter to the filename to make it unique
                const ext = path.extname(originalFilename);
                const basename = path.basename(originalFilename, ext);
                filename = `${basename} (${counter})${ext}`;
                counter++;
            }

            return filename;
        };

        // Generate a unique filename for the uploaded file
        const uniqueFilename = generateUniqueFilename(folderPath, originalFilename);
        
        cb(null, uniqueFilename);
    }
});

// Define allowed file types
const fileFilter = (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'application/pdf', 'text/plain', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];

    if (allowedTypes.includes(file.mimetype)) {
        cb(null, true);
    } else {
        cb(new Error('Supported files only: JPEG, PNG, PDF, TXT και XLSX.'));
    }
};

const upload = multer({ storage, fileFilter, limits: { fileSize: 10 * 1024 * 1024 } }); // Limit files to 10 MB

app.post('/upload', upload.array('files', 10), (req, res) => { // Allow up to 10 files to be uploaded
    if (req.session.vat) {
        res.send('<script>alert("success"); window.location.href="/invoice";</script>');
    } else {
        res.status(401).send('<script>alert("failed"); window.location.href="/";</script>');
    }
});

// Handle POST request to /submit_contact
app.post('/submit_contact', (req, res) => {
    // Process the contact form submission here
    // Example: Send an email using nodemailer
    const message = req.body.message; // Assuming 'message' is the name attribute of your textarea input
    const vat = req.session.vat;

    const credentials = readCredentials();
    const user = credentials.find(cred => cred.vat === vat);
    if (!user) {
        return res.status(401).send('<script>alert("Σφάλμα: Ανεπαρκή δικαιώματα πρόσβασης."); window.location.href="/";</script>');
    }

    const mailOptions = {
        from: user.email,
        to: '*******@***.com',
        subject: `webapp - ${vat}`,
        text: `: ${vat}\nEmail: ${user.email}\n\nMessage:\n${message}`
    };

    transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
            console.error(error);
            res.status(500).send('<script>alert("failed"); window.location.href="/contact";</script>');
        } else {
            res.status(200).send('<script>alert("message send completed"); window.location.href="/contact";</script>');
        }
    });
});



// Render invoice page
app.get('/invoice', (req, res) => {
    if (req.session.vat) {
        res.render('invoice', { vat: req.session.vat });
    } else {
        res.redirect('/');
    }
});

// Render contact page
app.get('/contact', (req, res) => {
    if (req.session.vat) {
        const credentials = readCredentials();
        const user = credentials.find(cred => cred.vat === req.session.vat);
        if (user) {
            res.render('contact', { vat: req.session.vat, email: user.email });
        } else {
            res.redirect('/');
        }
    } else {
        res.redirect('/');
    }
});

// Nodemailer transporter setup
const transporter = nodemailer.createTransport({
    host: '******',
    port: 465,
    secure: true,
    auth: {
        user: '****',
        pass: '***'
    }
});






