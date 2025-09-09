// Global test setup
process.env.NODE_ENV = 'test';
process.env.DEVICE_SECRET = 'test-secret-key-for-testing';
process.env.PORT = '3002';

console.log('🧪 Test environment initialized');

// Clean up after all tests
afterAll(async () => {
  // Close any open handles
  await new Promise(resolve => setTimeout(resolve, 100)); // Small delay
  
  // If you have any timers, intervals, or other resources, clean them up here
  console.log('🧹 Test cleanup completed');
});