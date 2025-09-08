# Real-Time Android Camera Streaming System

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Platform](https://img.shields.io/badge/platform-Android%20%7C%20Web-green.svg)
![Node.js](https://img.shields.io/badge/node.js-v20.0.0-brightgreen.svg)
![React](https://img.shields.io/badge/react-v19.1.1-blue.svg)
![Android](https://img.shields.io/badge/android-API%2024%2B-green.svg)
![Socket.IO](https://img.shields.io/badge/Socket.IO-v4.8.1-black.svg)
![Firebase](https://img.shields.io/badge/Firebase-Admin-orange.svg)
![CameraX](https://img.shields.io/badge/CameraX-latest-green.svg)
![Express](https://img.shields.io/badge/Express-v5.1.0-lightgrey.svg)
![Latency](https://img.shields.io/badge/latency-%3C500ms-success.svg)
![Frame Rate](https://img.shields.io/badge/frame%20rate-2--30%20FPS-blue.svg)
![Compression](https://img.shields.io/badge/compression-85%25%20reduction-green.svg)
![Status](https://img.shields.io/badge/status-active-success.svg)


This repo comprises an Android app, a web server, and a web client.

## Function
This software allows an Android phone to stream video from its camera to a website in real-time.  The website serves a client that allows a user to see the camera image, start and stop streaming, and take snapshots.

## Tested platform versions
* __Server and client__:

node version: 20,0,0

npm version: 9.8.1

* __Android Studio__:

2025.1.2 Patch 1
  
* __You__:
  
Assumes you know your way around Android Studio and a node/react web server.

## Installation

### Web server installation
1. Run `npm install` to populate the node_modules.
2. Create a file `.env` in the server root folder and populate with:
```
PORT=<server port number>
DEVICE_SECRET=<your-secret-key>
FRONTEND_URL=<http://<frontend server url> // needed for websocket to push things to the client; port is not needed if using the example nginx server block.
NODE_ENV=production
```

3. Create a file `config/service-account-key.json` in the server root folder and populate with your firebase service account info something like this:
```
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "abc123...",
  "private_key": "-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQC...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-xyz@your-project.iam.gserviceaccount.com",
  "client_id": "123456789012345678901",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/firebase-adminsdk-xyz%40your-project.iam.gserviceaccount.com"
}
```

3. Run `npm start` to start the server.

### Web client installation
1. Run `npm install` to populate the node_modules.
2. Create a `.env` file in the client root folder with the following contents:
 ```
 REACT_APP_BACKEND_URL=http://<backend server ip:port>
       ...
 REACT_APP_environment variables for firebase authentication and firestore database.
 ```
3. Run `npm start` to start the client in your web browser.

Alternatively, run `npm run build` to build a performant client. See `nginx server block` and `environment variables for SSL server` for deployment on a remote server with full authentication hooks.   Adjust as needed for your implementation.

### Android application build and installation
1. Open the Android project in Android Studio.
2. Add the following lines to `local.properties` file in the root folder:
   - `DEVICE_SECRET=<your-secret-key>` to the `local.properties` //  Make sure this value matches the one you put in the server `.env` file.
   - `SERVER_URL=http://<your server ip>`  # Note: port number is not needed if you use something like the example NGINX server block.
3. Enable Developer Mode on your Android phone.  Note: consult the Internet to learn how to do this.
4. Connect your Android phone to Android Studio. (The USB debug mode seems to be more reliable than the Wifi debug mode).
5. Sync gradle.
6. Clean and build project. The app will download to your phone.

## Operation
This is pretty self-explanatory.  The `main` branch supports firebase authentication.  So after creating an account and logging in:
1. Open the app on your Android phone.
2. Press "Connect".
3. Refresh the webpage, or press the `Refresh Devices` button on the webpage.
4. Select your phone from the list of available devices.
5. Press `Start Streaming` or `Stop Streaming` on your phone or on the web page as you wish.  The phone state and wewb page state are synchronized.

   
