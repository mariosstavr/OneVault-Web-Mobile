require('dotenv').config(); 
const express = require('express');
const path = require('path');
const multer = require('multer');
const nodemailer = require('nodemailer');
const favicon = require('serve-favicon');
const { db } = require('./firebase');
const cookieParser = require('cookie-parser');
const msal = require('@azure/msal-node');
const { Client } = require('@microsoft/microsoft-graph-client');
require('isomorphic-fetch'); 
const app = express();

const msalConfig = {
    auth: {
        clientId: process.env.ONEDRIVE_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${process.env.ONEDRIVE_TENANT_ID}`,
        clientSecret: process.env.ONEDRIVE_CLIENT_SECRET,
    }
};
const cca = new msal.ConfidentialClientApplication(msalConfig);

let cachedToken = null;
let tokenExpiryTime = null;

const getUserByUsername = async (username) => {
    const userRef = db.ref(`users/${username}`);
    const snapshot = await userRef.once('value');
    const user = snapshot.val();
    if (user) return user;
    throw new Error('User not found');
};

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

//Microsoft Graph access token
const getAccessToken = async () => {
    if (cachedToken && tokenExpiryTime > Date.now()) {
        console.log('Using cached token');
        return cachedToken;
    }

    const tokenRequest = { scopes: ["https://graph.microsoft.com/.default"] };
    try {
        const response = await cca.acquireTokenByClientCredential(tokenRequest);
        cachedToken = response.accessToken;
        tokenExpiryTime = Date.now() + (response.expiresIn || 3600) * 1000; // Default to 1 hour
        return cachedToken;
    } catch (error) {
        console.error('Error acquiring token:', error);
        throw new Error('Unable to get access token for OneDrive');
    }
};


const getAuthenticatedClient = (accessToken) => Client.init({
    authProvider: (done) => done(null, accessToken),
});


const fetchOneDriveData = async (endpoint) => {
    const accessToken = await getAccessToken();
    const client = getAuthenticatedClient(accessToken);
    return await client.api(endpoint).get();
};


const getDirectoryTree = (files) => {
    const tree = {};
    files.forEach(file => {
        const parts = file.name.split('/');
        let currentLevel = tree;
        parts.forEach((part, index) => {
            if (index === parts.length - 1) {
                currentLevel[part] = { type: file.folder ? 'folder' : 'file', downloadUrl: file['@microsoft.graph.downloadUrl'] || null };
            } else {
                currentLevel[part] = currentLevel[part] || {};
                currentLevel = currentLevel[part];
            }
        });
    });
    return tree;
};


app.use((err, req, res, next) => {
    console.error('Error:', err.message);
    res.status(err.status || 500).json({ success: false, message: err.message || 'Internal server error' });
});

// Parse incoming request bodies
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

app.post('/login', async (req, res, next) => {
    const { username, password } = req.body;

    try {
        const user = await getUserByUsername(username);
        if (user && user.password === password) {
            const { vat, isPayroll } = user;

            res.cookie('vat', vat, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 86400000 });
            res.cookie('isPayroll', isPayroll, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 86400000 });

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
        return next(error);
    }
});

app.get('/get-folder-structure/:vat', async (req, res, next) => {
    const vat = req.params.vat;
    if (!vat) {
        return res.status(403).json({ error: 'Forbidden: No VAT provided' });
    }

    try {
        const accessToken = await getAccessToken();
        const client = getAuthenticatedClient(accessToken);

        const sharedFolderId = "SHARED FOLDER ID"; // SharedFolder ID
        const response = await client.api(`***URL/FOLDER/items/${sharedFolderId}/children`).get();

        // Find the matching folder using VAT
        const matchingFolder = response.value.find(folder => folder.name.endsWith(vat));
        if (!matchingFolder) {
            return res.status(404).json({ error: `No folder found for VAT: ${vat}` });
        }

        // Get the children of the matching folder
        const vatFolderContents = await client.api(`UNIQUE FOLDER FOR EACH URER IN THIS PROJECT DEPENDS VAT ${matchingFolder.id}/children`).get();

        // Find the "00 ΑΡΧΕΙΟ ΠΕΛΑΤΗ" folder inside the VAT folder
        const targetFolder = vatFolderContents.value.find(folder => folder.name === "00 ΑΡΧΕΙΟ ΠΕΛΑΤΗ");
        if (!targetFolder) {
            return res.status(404).json({ error: `Folder "00 ΑΡΧΕΙΟ ΠΕΛΑΤΗ" not found in VAT folder` });
        }

        // Get the contents of "00 ΑΡΧΕΙΟ ΠΕΛΑΤΗ"
        const targetFolderContents = await client.api(`SUBFOLDER ID${targetFolder.id}/children`).get();

        // Format the data for the frontend
        const formattedData = targetFolderContents.value.map(item => ({
            name: item.name,
            type: item.folder ? 'folder' : 'file',
            lastModifiedDateTime: item.lastModifiedDateTime || 'Unknown', 
        }));

        res.json(formattedData);

    } catch (error) {
        return next(error);
    }
});

app.get('/get-fmy-folder-structure/:vat', async (req, res, next) => {
    const vat = req.params.vat;
    if (!vat) {
        return res.status(403).json({ error: 'Forbidden: No VAT provided' });
    }

    try {
        const accessToken = await getAccessToken();
        const client = getAuthenticatedClient(accessToken);

        const sharedFolderId = "5TPZZ4G5HJTC4BE"; // ONE DRIVE FOLDER ID
        const response = await client.api(`FOLDER ID ${sharedFolderId}/children`).get();

        // Find the matching folder using VAT
        const matchingFolder = response.value.find(folder => folder.name.endsWith(vat));
        if (!matchingFolder) {
            return res.status(404).json({ error: `No folder found for VAT: ${vat}` });
        }

        // Get the children of the matching folder (VAT folder)
        const vatFolderContents = await client.api(`FOLDER ID/${matchingFolder.id}/children`).get();

        // Find the "00 ΑΡΧΕΙΟ ΠΕΛΑΤΗ" folder inside the VAT folder
        const targetFolder = vatFolderContents.value.find(folder => folder.name === "ΦΜΥ");
        if (!targetFolder) {
            return res.status(404).json({ error: ` SUBFOLDER FOLDER NOT FOUND MESSAGE` });
        }

        
        const targetFolderContents = await client.api(`FOLDER ID/${targetFolder.id}/children`).get();

        
        const formattedData = targetFolderContents.value.map(item => ({
            name: item.name,
            type: item.folder ? 'folder' : 'file',
            lastModifiedDateTime: item.lastModifiedDateTime || 'Unknown', 
        }));

        res.json(formattedData);

    } catch (error) {
        return next(error);
    }
});


app.get('/get-afm-folder-structure/:vat', async (req, res, next) => {
    const vat = req.params.vat;
    if (!vat) {
        return res.status(403).json({ error: 'DOESNT FOUND THE FOLDER THE FOLDER CALLED AFM IN USERS FOLDER' });
    }

    try {
        const accessToken = await getAccessToken();
        const client = getAuthenticatedClient(accessToken);

        const sharedFolderId = "SHARED FOLDER ID"; 
        const response = await client.api(`FOLDER ID/items/${sharedFolderId}/children`).get();

        
        const matchingFolder = response.value.find(folder => folder.name.endsWith(vat));
        if (!matchingFolder) {
            return res.status(404).json({ error: `No folder found for unique number: ${vat}` });
        }

        
        const vatFolderContents = await client.api(`FOLDER ID/items/${matchingFolder.id}/children`).get();

        
        const targetFolder = vatFolderContents.value.find(folder => folder.name === "ΑΦΜ");
        if (!targetFolder) {
            return res.status(404).json({ error: `DOESNT FOUND AFM SUBFOLDER` });
        }
        
        const targetFolderContents = await client.api(`ID FOLDER/${targetFolder.id}/children`).get();
        const formattedData = targetFolderContents.value.map(item => ({
            name: item.name,
            type: item.folder ? 'folder' : 'file',
            lastModifiedDateTime: item.lastModifiedDateTime || 'Unknown', 
        }));

        res.json(formattedData);

    } catch (error) {
        return next(error);
    }
});

app.get('/contact', (req, res) => {
    const vat = req.cookies.vat;
    const showPayroll = req.cookies.isPayroll === '1';

    if (!vat) {
        console.log('Redirecting to homepage: VAT not found in cookies');
        return res.redirect('/');
    }

    console.log('Rendering contact page for VAT:', vat);
    res.render('contact', { vat, showPayroll });
});


app.post('/submit_contact', async (req, res, next) => {
    const message = req.body.message;
    const vat = req.cookies.vat;

    try {
        if (!vat) return res.status(401).send('<script>alert("Cannot upload"); window.location.href="/";</script>');

        const user = await getUserByVAT(vat);

        const mailOptions = {
            from: user.email,
            to: 'dgggdssgds@test.com',
            subject: `myApp - ΑΦΜ: ${vat}`,
            text: `nEmail: ${user.email}\n\nMessage:\n${message}`
        };

        const transporter = nodemailer.createTransport({
            host: 'mail.server.com',
            port: 488,
            secure: true,
            auth: {
                user: process.env.MAIL_USER,
                pass: process.env.MAIL_PASS
            }
        });

        await transporter.sendMail(mailOptions);
        res.status(200).send('<script>alert("the mail complete."); window.location.href="/contact";</script>');
    } catch (error) {
        next(error);
    }
});


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
        if (file.mimetype === 'application/zip') return cb(null, false); 
        cb(null, allowedTypes.includes(file.mimetype));
    },
    limits: { fileSize: 10 * 1024 * 1024 }
});


app.post('/upload', upload.array('files', 10), async (req, res, next) => {
    const vat = req.cookies.vat?.toString();
    if (!vat) {
        return res.status(403).json({ error: 'Forbidden: No VAT in cookies' });
    }

    if (!req.files || req.files.length === 0) {
        return res.status(400).send('<script>alert("select Files to upload ;)"); window.location.href="/invoice";</script>');
    }

    try {
        const sharedFolderId = "shared folder id"; 
        const accessToken = await getAccessToken();
        const client = getAuthenticatedClient(accessToken);

        //Get the SharedFolder's contents
        const folderResponse = await client.api(`folder id/items/${sharedFolderId}/children`).get();
        let vatFolder = folderResponse.value.find(folder => folder.name.endsWith(vat));

        
        if (!vatFolder) {
            vatFolder = await client.api(`SharedFolder ID/${vat}:/children`).post({
                folder: {},
                "@microsoft.graph.conflictBehavior": "fail"
            });
        }

        
        const vatFolderContents = await client.api(`id users folder/items/${vatFolder.id}/children`).get();
        let targetFolder = vatFolderContents.value.find(folder => folder.name === "Upload user Folder");

        
        if (!targetFolder) {
            targetFolder = await client.api(`/${vatFolder.id}/children`).post({
                name: "name_folder",
                folder: {},
                "@microsoft.graph.conflictBehavior": "fail"
            });
        }

        
        await Promise.all(req.files.map(async (file) => {
            const fileStream = Buffer.from(file.buffer);
            const fileName = file.originalname;
            return client.api(`api client one drive/${targetFolder.id}:/${fileName}:/content`).put(fileStream);
        }));

        res.send('<script>alert("Files uploaded successfully."); window.location.href="/invoice";</script>');
    } catch (error) {
        next(error);
    }
});

const axios = require('axios');

app.get('/download/:fileName', async (req, res, next) => {
    const fileName = decodeURIComponent(req.params.fileName); 
    const vat = req.cookies.vat?.toString(); 

    if (!vat) {
        return res.status(403).json({ error: 'Forbidden: No VAT in cookies' });
    }

    try {
        const accessToken = await getAccessToken(); 
        const client = getAuthenticatedClient(accessToken);
        const sharedFolderId = "sharedFolderId"; 
        const folderResponse = await client.api(`api one drive/${sharedFolderId}/children`).get();
        const matchingFolder = folderResponse.value.find(folder => folder.name.endsWith(vat));

        if (!matchingFolder) {
            return res.status(404).json({ error: `folder not found${vat}. });
        }

        const vatFolderContents = await client.api(`folder id}/children`).get();
        const targetFolder = vatFolderContents.value.find(folder => folder.name === "Upload user Folder");

        if (!targetFolder) {
            return res.status(404).json({ error: `NOT FOUND FOLDER${vat}` });
        }
  
        const targetFolderContents = await client.api(`/drives/the folder id we want/items/${targetFolder.id}/children`).get();
        const fileItem = targetFolderContents.value.find(item => item.name === fileName);

        if (!fileItem) {
            return res.status(404).json({ error: `FOLDER NOT FOUND${vat}. ` });
        }
        const downloadUrl = fileItem['@microsoft.graph.downloadUrl'];
        if (!downloadUrl) {
            return res.status(404).json({ error: 'FALSE ' });
        }

 
        const encodedUrl = encodeURI(downloadUrl);
        const fileResponse = await axios({
            url: encodedUrl,
            method: 'GET',
            responseType: 'stream',
        });

       
        const fileExtension = fileName.split('.').pop().toLowerCase();
        let contentType = fileResponse.headers['content-type'] || 'application/octet-stream';

        if (fileExtension === 'pdf') {
            res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
            contentType = 'application/pdf';
        } else {
            res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
        }
        res.setHeader('Content-Type', contentType);
        fileResponse.data.pipe(res);

    } catch (error) {
        console.error('Error downloading file from OneDrive:', error);
        return next(error);
    }
});

app.get('/download-fmy/:fileName', async (req, res, next) => {
    const fileName = decodeURIComponent(req.params.fileName); 
    const vat = req.cookies.vat?.toString(); 

    if (!vat) {
        return res.status(403).json({ error: 'Forbidden: No VAT in cookies' });
    }

    try {
        const accessToken = await getAccessToken(); 
        const client = getAuthenticatedClient(accessToken);

        
        const sharedFolderId = "SHARED FOLDER ID"; 
        const folderResponse = await client.api(`API`).get();

        //Find the folder named with the VAT
        const matchingFolder = folderResponse.value.find(folder => folder.name.endsWith(vat));

        if (!matchingFolder) {
            return res.status(404).json({ error: `FOLDER NOT FOUND'}});
        }

        //Fetch the contents of the VAT folder
        const vatFolderContents = await client.api(`API id}`).get();
        

app.get('/download-afm/:fileName', async (req, res, next) => {
    const fileName = decodeURIComponent(req.params.fileName); // Decode the file name
    const vat = req.cookies.vat?.toString(); // Fetch unique number from cookies

    if (!vat) {
        return res.status(403).json({ error: 'Forbidden: No unique number in cookies' });
    }

    try {
        const accessToken = await getAccessToken(); 
        const client = getAuthenticatedClient(accessToken);
        const sharedFolderId = "SHARED FOLDER ID"; 
        const folderResponse = await client.api(`sharedFolderId`).get();
        const matchingFolder = folderResponse.value.find(folder => folder.name.endsWith(vat));

        if (!matchingFolder) {
            return res.status(404).json({ error:});
        }

        //Fetch the contents of the VAT folder
        const vatFolderContents = await client.api(`Folderid}`).get();

        //Find the "ΑΦΜ" folder
        const targetFolder = vatFolderContents.value.find(folder => folder.name === "ΑΦΜ");

        if (!targetFolder) {
            return res.status(404).json({ error: });
        }

        //Fetch the contents of the "ΑΦΜ" folder
        const targetFolderContents = await client.api(`Folder id}`).get();

        //Find the file in the "ΑΦΜ" folder
        const fileItem = targetFolderContents.value.find(item => item.name === fileName);

        if (!fileItem) {
            return res.status(404).json({ error: 'File not found in "ΑΦΜ"' });
        }

        //Get the download URL for the file
        const downloadUrl = fileItem['@microsoft.graph.downloadUrl'];

        if (!downloadUrl) {
            return res.status(404).json({ FILE error:});
        }

        //Fetch the file data from OneDrive using Axios and stream it to the client
        const encodedUrl = encodeURI(downloadUrl);
        const fileResponse = await axios({
            url: encodedUrl,
            method: 'GET',
            responseType: 'stream',
        });

        //Set appropriate headers for file download
        const fileExtension = fileName.split('.').pop().toLowerCase();
        let contentType = fileResponse.headers['content-type'] || 'application/octet-stream';

        if (fileExtension === 'pdf') {
            res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
            contentType = 'application/pdf';
        } else {
            res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`);
        }

        res.setHeader('Content-Type', contentType);

        
        fileResponse.data.pipe(res);

    } catch (error) {
        console.error('Error downloading file from OneDrive:', error);
        return next(error);
    }
});

app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    next();
});

