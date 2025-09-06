// src/VideoStreamManager.js
class VideoStreamManager {
  constructor(canvasElement) {
    this.canvas = canvasElement;
    this.ctx = this.canvas.getContext('2d');
    
    // Buffer management
    this.frameBuffer = [];
    this.maxBufferSize = 3; // Keep only 3 frames max
    this.isProcessing = false;
    this.lastFrameTime = 0;
    this.targetFPS = 30;
    this.frameInterval = 1000 / this.targetFPS;
    
    // Performance monitoring
    this.droppedFrames = 0;
    this.processedFrames = 0;
    this.latencyHistory = [];
    
    // Start render loop
    this.startRenderLoop();
  }

  // Add frame with aggressive buffer management
  addFrame(frameData) {
    const now = performance.now();
    
    // Drop frame if buffer is full (prevents accumulation)
    if (this.frameBuffer.length >= this.maxBufferSize) {
      this.frameBuffer.shift(); // Remove oldest frame
      this.droppedFrames++;
      console.log(`Frame dropped - buffer full. Dropped: ${this.droppedFrames}`);
    }
    
    // Add frame with metadata
    this.frameBuffer.push({
      data: frameData,
      timestamp: now,
      receivedAt: now
    });
  }

  // Render loop with frame dropping
  startRenderLoop() {
    const render = () => {
      const now = performance.now();
      
      // Only process if enough time has passed and we have frames
      if (now - this.lastFrameTime >= this.frameInterval && this.frameBuffer.length > 0) {
        this.processNextFrame();
        this.lastFrameTime = now;
      }
      
      requestAnimationFrame(render);
    };
    
    requestAnimationFrame(render);
  }

  // Process frame with latency tracking
  async processNextFrame() {
    if (this.isProcessing || this.frameBuffer.length === 0) return;
    
    this.isProcessing = true;
    const frame = this.frameBuffer.shift();
    const startTime = performance.now();
    
    try {
      // Skip old frames (older than 200ms)
      const frameAge = startTime - frame.receivedAt;
      if (frameAge > 200) {
        this.droppedFrames++;
        console.log(`Frame dropped - too old: ${frameAge}ms`);
        this.isProcessing = false;
        return;
      }
      
      // Create and draw image
      const img = new Image();
      img.onload = () => {
        // Update canvas size if needed
        if (this.canvas.width !== img.width || this.canvas.height !== img.height) {
          this.canvas.width = img.width;
          this.canvas.height = img.height;
        }
        
        // Clear canvas and draw
        this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
        this.ctx.drawImage(img, 0, 0);
        
        // Update performance metrics
        const endTime = performance.now();
        const totalLatency = endTime - frame.timestamp;
        this.latencyHistory.push(totalLatency);
        
        // Keep only last 30 latency measurements
        if (this.latencyHistory.length > 30) {
          this.latencyHistory.shift();
        }
        
        this.processedFrames++;
        this.isProcessing = false;
        
        // Log performance occasionally
        if (this.processedFrames % 30 === 0) {
          this.logPerformance();
        }
      };
      
      img.onerror = () => {
        console.error('Error loading frame image');
        this.isProcessing = false;
      };
      
      img.src = `data:image/jpeg;base64,${frame.data}`;
      
    } catch (error) {
      console.error('Frame processing error:', error);
      this.isProcessing = false;
    }
  }

  // Performance monitoring
  logPerformance() {
    const avgLatency = this.latencyHistory.length > 0 
      ? this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length 
      : 0;
    const dropRate = (this.droppedFrames / (this.processedFrames + this.droppedFrames)) * 100;
    
    console.log(`📊 Performance - Avg Latency: ${avgLatency.toFixed(1)}ms, Drop Rate: ${dropRate.toFixed(1)}%, Buffer: ${this.frameBuffer.length}`);
  }

  // Clear buffer to reset latency
  clearBuffer() {
    this.frameBuffer = [];
    console.log('🔄 Frame buffer cleared');
  }

  // Get performance stats
  getStats() {
    const avgLatency = this.latencyHistory.length > 0 
      ? this.latencyHistory.reduce((a, b) => a + b, 0) / this.latencyHistory.length 
      : 0;
    
    return {
      bufferSize: this.frameBuffer.length,
      droppedFrames: this.droppedFrames,
      processedFrames: this.processedFrames,
      averageLatency: avgLatency,
      dropRate: (this.droppedFrames / (this.processedFrames + this.droppedFrames)) * 100
    };
  }

  // Cleanup method
  destroy() {
    this.frameBuffer = [];
    console.log('🗑️ VideoStreamManager destroyed');
  }
}

export default VideoStreamManager;