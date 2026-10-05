// Lambda prototype behind API Gateway. Replace repository functions with DynamoDB in V2.
const claims = new Map();
const response = (statusCode, body) => ({ statusCode, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
exports.handler = async (event) => {
  const method = event.requestContext?.http?.method || event.httpMethod || 'GET';
  const path = event.rawPath || event.path || '/claims';
  const userId = event.requestContext?.authorizer?.jwt?.claims?.sub || event.queryStringParameters?.userId || 'prototype-user';
  if (method === 'GET' && path === '/claims') return response(200, [...claims.values()].filter((claim) => claim.userId === userId));
  if (method === 'POST' && path === '/claims') { const input = JSON.parse(event.body || '{}'); const claim = { ...input, id: `CLM-${Date.now()}`, userId, status: input.status === 'draft' ? 'draft' : 'review', createdAt: new Date().toISOString() }; claims.set(claim.id, claim); return response(201, claim); }
  return response(404, { message: 'Route not found' });
};