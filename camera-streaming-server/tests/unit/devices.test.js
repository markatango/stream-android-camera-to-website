const request = require('supertest');
// const app = require('../../server');
const app = require('../testServer');

describe('Device Management API', () => {
  test('GET /api/devices - returns active devices', async () => {
    const response = await request(app).get('/api/devices');
    expect(response.status).toBe(200);
    expect(response.body.devices).toBeInstanceOf(Array);
    expect(response.body.count).toBeDefined();
  });

  test('GET /api/health - returns server status', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
    expect(response.body.uptime).toBeDefined();
  });
});