// ./components/MainApp.js
import React, { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import { auth } from '../../services/firebaseConfig';
import VideoStreamManager from '../VideoStreamManager';
import { AuthService } from '../../services/authService'; // Adjust path as needed
import './MainApp.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || 'http://localhost:3001';

function MainApp({ user }) {
  const [socket, setSocket] = useState(null);
  const [connected, setConnected] = useState(false);
  const [devices, setDevices] = useState([]);
  const [selectedDevice, setSelectedDevice] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastFrame, setLastFrame] = useState(null);
  const [streamStats, setStreamStats] = useState(null);
  
  const canvasRef = useRef(null);
  const streamManagerRef = useRef(null);


  // Initialize VideoStreamManager when canvas is ready
  useEffect(() => {
    if (canvasRef.current && !streamManagerRef.current) {
      console.log('🎥 Initializing VideoStreamManager');
      streamManagerRef.current = new VideoStreamManager(canvasRef.current);
      
      // Update stats every 5 seconds
      const statsInterval = setInterval(() => {
        if (streamManagerRef.current) {
          setStreamStats(streamManagerRef.current.getStats());
        }
      }, 5000);
      
      return () => {
        clearInterval(statsInterval);
        if (streamManagerRef.current) {
          streamManagerRef.current.destroy();
          streamManagerRef.current = null;
        }
      };
    }
  }, []); // Empty dependency array - runs only on component mount

useEffect(() => {
    // Function to initialize socket connection with Firebase auth
    const initializeSocket = async () => {
        // Don't connect if no user is authenticated
        if (!auth.currentUser) {
            console.error('No authenticated user for socket connection');
            return null;
        }

        try {
            console.log('Initializing socket connection with Firebase auth...');
            const firebaseToken = await auth.currentUser.getIdToken();
            console.log('Firebase token obtained for socket connection');

            const newSocket = io(process.env.REACT_APP_BACKEND_URL, {
                auth: {
                    firebaseToken: firebaseToken
                }
            });

            // Basic connection events
            newSocket.on('connect', () => {
                console.log('🔗 Connected to server with Firebase auth');
                setConnected(true);
                fetchDevices();
            });

            newSocket.on('connected', (data) => {
                console.log('✅ Server welcome message:', data);
            });

            newSocket.on('disconnect', () => {
                console.log('❌ Disconnected from server');
                setConnected(false);
                setIsStreaming(false);
            });

            newSocket.on('connect_error', (error) => {
                console.error('🚫 Connection error:', error.message);
                setConnected(false);
            });

            // Camera feed handling
            newSocket.on('camera-feed', (data) => {
                if (data.deviceId === selectedDevice && streamManagerRef.current) {
                    streamManagerRef.current.addFrame(data.frame);
                    console.log('📹 Received frame for device:', data.deviceId);
                    setLastFrame(data.frame);
                }
            });

            // Streaming state changes
            newSocket.on('streaming-state-changed', (data) => {
                console.log('📡 Streaming state changed:', data);
                if (data.deviceId === selectedDevice) {
                    setIsStreaming(data.isStreaming);
                    
                    // Clear buffer when streaming stops
                    if (!data.isStreaming && streamManagerRef.current) {
                        streamManagerRef.current.clearBuffer();
                    }
                }
            });

            // Initial streaming status
            newSocket.on('streaming-status', (data) => {
                console.log('📊 Initial streaming status:', data);
                const deviceStatus = data.devices.find(d => d.deviceId === selectedDevice);
                if (deviceStatus) {
                    setIsStreaming(deviceStatus.isStreaming);
                    if (deviceStatus.lastFrame) {
                        setLastFrame(deviceStatus.lastFrame);
                        if (streamManagerRef.current) {
                            streamManagerRef.current.addFrame(deviceStatus.lastFrame);
                        }
                    }
                }
            });

            // Snapshot handling
            newSocket.on('snapshot-ready', (data) => {
                if (data.deviceId === selectedDevice) {
                    const snapshot = {
                        id: Date.now(),
                        timestamp: new Date(data.timestamp).toLocaleString(),
                        imageData: data.imageData,
                        isLastFrame: data.isLastFrame || false
                    };
                    setSnapshots(prev => [snapshot, ...prev]);
                }
            });

            newSocket.on('snapshot-error', (data) => {
                console.error('📷 Snapshot error:', data);
                alert(`Snapshot error: ${data.error}`);
            });

            newSocket.on('command-error', (data) => {
                console.error('⚠️ Command error:', data);
                alert(`Command error: ${data.error}`);
            });

            // Set the socket in state
            setSocket(newSocket);

            return newSocket; // Return for cleanup
        } catch (error) {
            console.error('❌ Failed to initialize socket with Firebase auth:', error);
            setConnected(false);
            return null;
        }
    };

    // Initialize the socket and get reference for cleanup
    const socketPromise = initializeSocket();

    // Cleanup function
    return () => {
        socketPromise.then(newSocket => {
            if (newSocket) {
                console.log('🧹 Cleaning up socket connection');
                newSocket.disconnect();
            }
        });
    };
}, [selectedDevice]);

    

  // Device selection handler with buffer reset
  const handleDeviceChange = (deviceId) => {
    setSelectedDevice(deviceId);
    setIsStreaming(false);
    setLastFrame(null);
    
    // Clear stream buffer when switching devices
    if (streamManagerRef.current) {
      streamManagerRef.current.clearBuffer();
    }
  };

  const handleSignOut = async () => {
    try {
        if (window.confirm('Are you sure you want to sign out?')) {
            await AuthService.signOut();
        }
    } catch (error) {
        console.error('Error signing out:', error);
        alert('Error signing out. Please try again.');
    }
};

  const fetchDevices = async () => {
    try {
      const response = await fetch(`${BACKEND_URL}/api/devices`);
      const data = await response.json();
      setDevices(data.devices);
    } catch (error) {
      console.error('Failed to fetch devices:', error);
    }
  };

  const toggleStreaming = () => {
    if (!socket || !selectedDevice) return;

    if (isStreaming) {
      socket.emit('stop-streaming', { deviceId: selectedDevice });
    } else {
      // Clear buffer before starting new stream
      if (streamManagerRef.current) {
        streamManagerRef.current.clearBuffer();
      }
      socket.emit('start-streaming', { deviceId: selectedDevice });
    }
  };

  const takeSnapshot = () => {
    if (!socket || !selectedDevice) return;
    
    socket.emit('request-snapshot', {
      deviceId: selectedDevice,
      timestamp: Date.now()
    });
  };

  const downloadSnapshot = (snapshot) => {
    const link = document.createElement('a');
    link.href = `data:image/jpeg;base64,${snapshot.imageData}`;
    link.download = `snapshot_${snapshot.id}.jpg`;
    link.click();
  };

  // Manual buffer clear for testing
  const clearBuffer = () => {
    if (streamManagerRef.current) {
      streamManagerRef.current.clearBuffer();
    }
  };

  // Add this before your return statement
const initializeStreamManager = useCallback((canvas) => {
  if (canvas && !streamManagerRef.current) {
    console.log('🎥 Initializing VideoStreamManager');
    streamManagerRef.current = new VideoStreamManager(canvas);
    
    // Update stats every 5 seconds
    const statsInterval = setInterval(() => {
      if (streamManagerRef.current) {
        setStreamStats(streamManagerRef.current.getStats());
      }
    }, 5000);
    
    // Store interval reference for cleanup
    streamManagerRef.current.statsInterval = statsInterval;
  }
}, []);

// Keep this useEffect for cleanup
    useEffect(() => {
      return () => {
        if (streamManagerRef.current) {
          if (streamManagerRef.current.statsInterval) {
            clearInterval(streamManagerRef.current.statsInterval);
          }
          streamManagerRef.current.destroy();
          streamManagerRef.current = null;
        }
      };
    }, []);

  return (
    <div className="App">
      <header className="App-header">
        <h1>Remote Camera Viewer</h1>
        <div className="connection-status">
          Status: {connected ? '🟢 Connected' : '🔴 Disconnected'}
        </div>

          {/* <button
        onClick={handleSignOut}
        className="bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-md text-sm font-medium"
        style={{
            backgroundColor: '#dc2626',
            color: 'white',
            padding: '8px 16px',
            borderRadius: '6px',
            border: 'none',
            cursor: 'pointer',
            fontSize: '14px',
            fontWeight: '500'
        }}
        >
            Sign Out
        </button> */}

      </header>

      
      <div style={{
          backgroundColor: 'white',
          borderBottom: '1px solid #e5e7eb',
          padding: '12px 24px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center'
      }}>
          <h1 style={{ margin: 0, fontSize: '20px', fontWeight: '600' }}>
              📹 Camera Streaming System
          </h1>
          
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
              <span style={{ fontSize: '14px', color: '#374151' }}>
                  {user?.displayName || user?.email}
              </span>
              <button
                  onClick={handleSignOut}
                  style={{
                      backgroundColor: '#dc2626',
                      color: 'white',
                      padding: '8px 16px',
                      borderRadius: '6px',
                      border: 'none',
                      cursor: 'pointer',
                      fontSize: '14px'
                  }}
              >
                  Sign Out
              </button>
          </div>
      </div>

      <main className="main-content">
        <div className="device-selection">
          <h2>Available Devices</h2>
          <select 
            value={selectedDevice || ''} 
            onChange={(e) => handleDeviceChange(e.target.value)}
            disabled={!connected}
          >
            <option value="">Select a device...</option>
            {devices.map(device => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.deviceId} (Connected: {new Date(device.connectedAt).toLocaleString()})
              </option>
            ))}
          </select>
          <button onClick={fetchDevices} disabled={!connected}>
            Refresh Devices
          </button>
        </div>

        {selectedDevice && (
          <div className="camera-section">
            <div className="camera-controls">
              <button 
                onClick={toggleStreaming}
                disabled={!connected}
                className={isStreaming ? 'streaming-button' : 'start-button'}
              >
                {isStreaming ? 'Stop Streaming' : 'Start Streaming'}
              </button>
              <button 
                onClick={takeSnapshot}
                disabled={!connected}
                className="snapshot-button"
              >
                📸 Take Snapshot
              </button>
              <button 
                onClick={clearBuffer}
                disabled={!connected}
                className="clear-buffer-button"
              >
                🔄 Clear Buffer
              </button>
            </div>

            {/* Performance Stats Display */}
            {streamStats && (
              <div className="performance-stats">
                <h3>Stream Performance</h3>
                <div className="stats-grid">
                  <div>Buffer Size: {streamStats.bufferSize}</div>
                  <div>Avg Latency: {streamStats.averageLatency.toFixed(1)}ms</div>
                  <div>Processed: {streamStats.processedFrames}</div>
                  <div>Dropped: {streamStats.droppedFrames}</div>
                  <div>Drop Rate: {streamStats.dropRate.toFixed(1)}%</div>
                </div>
              </div>
            )}

            <div className="video-container">
              <canvas 
                ref={initializeStreamManager}
                style={{ 
                  display: 'block',
                  maxWidth: '100%',
                  height: 'auto',
                  backgroundColor: lastFrame ? 'transparent' : '#000',
                  transform: 'rotate(90deg)',
                  transformOrigin: 'center center'
                }}
              />
              {!lastFrame && (
                <div className="no-video-message">
                  {isStreaming ? 'Waiting for video feed...' : 'No video feed. Press "Start Streaming" to begin.'}
                </div>
              )}
            </div>
          </div>
        )}

        {snapshots.length > 0 && (
          <div className="snapshots-section">
            <h2>Snapshots ({snapshots.length})</h2>
            <div className="snapshots-grid">
              {snapshots.map(snapshot => (
                <div key={snapshot.id} className="snapshot-item">
                  <img 
                    src={`data:image/jpeg;base64,${snapshot.imageData}`}
                    alt={`Snapshot ${snapshot.id}`}
                  />
                  <div className="snapshot-info">
                    <span>{snapshot.timestamp}</span>
                    {snapshot.isLastFrame && <span className="last-frame-badge">Last Frame</span>}
                    <button onClick={() => downloadSnapshot(snapshot)}>
                      ⬇️ Download
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default MainApp;