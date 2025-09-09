const request = require('supertest');
const { app } = require('../../server');

// Mock Firebase for integration tests
jest.mock('../../services/firebaseAdmin', () => ({
  auth: { verifyIdToken: jest.fn() },
  db: { collection: jest.fn() }
}));

describe('Server Integration Tests', () => {
  test('GET /api/health should return server status', async () => {
    const response = await request(app).get('/api/health');
    
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  test('GET /api/devices should return device list', async () => {
    const response = await request(app).get('/api/devices');
    
    expect(response.status).toBe(200);
    expect(response.body.devices).toBeInstanceOf(Array);
  });

  test('POST /api/authenticate should work with valid credentials', async () => {
    const response = await request(app)
      .post('/api/authenticate')
      .send({
        deviceId: 'test-device',
        deviceSecret: process.env.DEVICE_SECRET
      });
    
    expect(response.status).toBe(200);
    expect(response.body.token).toBeDefined();
  });
});