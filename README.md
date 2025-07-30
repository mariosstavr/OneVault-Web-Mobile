 Secure OneDrive Document Portal with Firebase Auth & Microsoft Graph API
This project is a secure document management and file-sharing web portal designed for an accounting office, built using Node.js, Express, and EJS, with seamless integration of Firebase Realtime Database for user authentication and Microsoft Graph API for interacting with OneDrive.

🔐 Key Features:
User Authentication: Login system powered by Firebase; each user is identified by their unique VAT number and role access.

Role-Based Views: Dynamic rendering of views (e.g. payroll, invoices, contact) based on user roles stored in cookies.

OneDrive Integration:

Fetch and display OneDrive folder structures (per user).

View and download specific files from folders.

Secure document download streaming via Microsoft Graph's @microsoft.graph.downloadUrl.

Upload multiple documents directly into designated user-specific OneDrive folders.

MSAL OAuth 2.0: Confidential client flow with token caching to reduce token requests.

Contact Form: Sends email to the administrator via Nodemailer using authenticated user’s email.

Responsive Frontend: Rendered with EJS templates and localized (UTF-8) for Greek language.

🧰 Stack:
Backend: Node.js, Express

Authentication: Firebase Realtime DB

Cloud Storage: OneDrive via Microsoft Graph API

OAuth 2.0: MSAL for Azure app authentication

Frontend: EJS templates, static HTML/CSS/JS

Email: Nodemailer (SMTP)

File Uploads: Multer (with file validation)

🔒 Security Considerations:
Cookies are HTTP-only and optionally secure (for production).

Strict file type checks (no .zip uploads).

No access to endpoints without authentication (VAT-based checks).
