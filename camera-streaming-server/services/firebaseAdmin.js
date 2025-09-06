const admin = require('firebase-admin');

// Download service account key from Firebase Console
const serviceAccount = require('../config/service-account-key.json');

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const auth = admin.auth();

module.exports = { admin, db, auth };
