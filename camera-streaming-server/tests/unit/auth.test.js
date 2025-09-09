// camera-streaming-server/tests/unit/auth.test.js
const request = require('supertest');
// const app = require('../../server');
const app = require('../testServer');

describe('Authentication API', () => {
  test('POST /api/authenticate - valid credentials', async () => {
    const response = await request(app)
      .post('/api/authenticate')
      .send({
        deviceId: 'test-device-123',
        deviceSecret: process.env.DEVICE_SECRET
      });
    
    expect(response.status).toBe(200);
    expect(response.body.token).toBeDefined();
    expect(response.body.expiresIn).toBe(3600000);
  });

  test('POST /api/authenticate - invalid credentials', async () => {
    const response = await request(app)
      .post('/api/authenticate')
      .send({
        deviceId: 'test-device-123',
        deviceSecret: 'wrong-secret'
      });
    
    expect(response.status).toBe(401);
    expect(response.body.error).toBe('Unauthorized device');
  });
});


