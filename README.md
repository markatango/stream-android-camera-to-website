# Stream android camera to website in real-time
This repo comprises an Android app, a web server, and a web client.

## Function
This software allows an Android phone to stream video from its camera to a website in real-time.  The website serves a client that allows a user to see the camera image, start and stop streaming, and take snapshots.

## Tested platform versions
* __Server and client__:

node version: 18.18.0

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
FRONTEND_URL=<http://<frontend server url:port> // needed for websocket to push things to the client
NODE_ENV=production
```
3. Run `npm start` to start the server.

### Web client installation
1. Run `npm install` to populate the node_modules.
2. Create a `.env` file in the client root folder with the following contents:
 ```
 REACT_APP_BACKEND_URL=http://<backend server ip:port>
 ```
3. Run `npm start` to start the client in your web browser.

Alternatively, run `npm run build` to build a performant client. Host the client `/build` package on the same machine as the server (or adjust endpoints, above, as needed).  Here is an example of a location block detail for NGINX:

```
        location /remotecamera {
              alias /var/www/html/remotecamera;
              try_files $uri $uri/ /remotecamera/index.html;
        }

        ## eliminate the following temporary fixes by including {"homepage":"/remotecamera"} in package.json and rebuild.
        #========================================================
        # Handle static assets
        location /static/ {
              alias /var/www/html/remotecamera/static/;
              expires 1y;
              add_header Cache-Control "public, immutable";
        }

        # Handle common root files
        location ~* ^/(manifest\.json|robots\.txt|favicon\.ico|logo192\.png)$ {
            root /var/www/html/remotecamera;
        }
        #========================================================

```

### Android application build and installation
1. Open the Android project in Android Studio.
2. Add the following lines to `local.properties` file in the root folder:
   - `DEVICE_SECRET=<your-secret-key>` to the `local.properties` //  Make sure this value matches the one you put in the server `.env` file.
   - `SERVER_URL=http://<your server ip:port>`
3. Enable Developer Mode on your Android phone.  Note: consult the Internet to learn how to do this.
4. Connect your Android phone to Android Studio. (The USB debug mode seems to be more reliable than the Wifi debug mode).
5. Sync gradle.
6. Clean and build project. The app will download to your phone.

## Operation
This is pretty self-explanatory.
1. Open the app on your Android phone.
2. Press "Connect".
3. Refresh the webpage, or press the `Refresh Devices` button on the webpage.
4. Select your phone from the list of available devices.
5. Press `Start Streaming` or `Stop Streaming` on your phone or on the web page as you wish.  The phone state and wewb page state are synchronized.

   
