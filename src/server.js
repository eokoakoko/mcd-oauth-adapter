const express = require('express');
const axios = require('axios');
const crypto = require('crypto');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// 读取环境变量
const {
  PUBLIC_BASE_URL,
  PORT = 8787,
  MCD_MCP_URL = 'https://mcp.mcd.cn',
  MCD_MCP_TOKEN,
  ADAPTER_OWNER_PASSWORD,
  OAUTH_ACCESS_TOKEN_TTL_SECONDS = 900,
  OAUTH_REFRESH_TOKEN_TTL_SECONDS = 2592000,
  OAUTH_AUTHORIZATION_CODE_TTL_SECONDS = 300,
} = process.env;

// 内存存储（生产环境建议用Redis）
const authCodes = new Map();
const accessTokens = new Map();
const refreshTokens = new Map();

// ============ OAuth Discovery ============
app.get('/.well-known/oauth-authorization-server', (req, res) => {
  res.json({
    issuer: PUBLIC_BASE_URL,
    authorization_endpoint: `${PUBLIC_BASE_URL}/authorize`,
    token_endpoint: `${PUBLIC_BASE_URL}/token`,
    registration_endpoint: `${PUBLIC_BASE_URL}/register`,
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
    authorization_response_iss_parameter_supported: true,
  });
});

app.get('/.well-known/oauth-protected-resource/mcp', (req, res) => {
  res.json({
    resource: `${PUBLIC_BASE_URL}/mcp`,
    authorization_servers: [PUBLIC_BASE_URL],
    bearer_methods_supported: ['header'],
    scopes_supported: ['mcp'],
  });
});

// ============ OAuth Authorize ============
app.get('/authorize', (req, res) => {
  const { client_id, redirect_uri, code_challenge, state, scope } = req.query;
  
  // 返回简单的授权页面
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>授权麦当劳 MCP</title></head>
    <body style="font-family: sans-serif; max-width: 400px; margin: 50px auto;">
      <h2>🔑 授权麦当劳 MCP</h2>
      <p>请输入适配器密码以授权 ChatGPT 访问麦当劳 MCP。</p>
      <form method="POST" action="/authorize">
        <input type="hidden" name="client_id" value="${client_id || ''}">
        <input type="hidden" name="redirect_uri" value="${redirect_uri || ''}">
        <input type="hidden" name="code_challenge" value="${code_challenge || ''}">
        <input type="hidden" name="state" value="${state || ''}">
        <input type="hidden" name="scope" value="${scope || 'mcp'}">
        <div style="margin-bottom: 15px;">
          <label>密码：</label>
          <input type="password" name="password" style="width: 100%; padding: 8px; margin-top: 5px;">
        </div>
        <button type="submit" style="padding: 10px 30px; background: #007bff; color: white; border: none; border-radius: 5px;">允许</button>
      </form>
    </body>
    </html>
  `);
});

app.post('/authorize', (req, res) => {
  const { password, client_id, redirect_uri, code_challenge, state, scope } = req.body;
  
  // 验证密码
  if (password !== ADAPTER_OWNER_PASSWORD) {
    return res.status(401).send('密码错误，请返回重试');
  }
  
  // 生成授权码
  const code = crypto.randomBytes(32).toString('hex');
  const codeData = {
    client_id,
    redirect_uri,
    code_challenge,
    scope: scope || 'mcp',
    created_at: Date.now(),
  };
  authCodes.set(code, codeData);
  
  // 设置过期时间
  setTimeout(() => authCodes.delete(code), OAUTH_AUTHORIZATION_CODE_TTL_SECONDS * 1000);
  
  // 构造重定向URI
  const redirectUrl = new URL(redirect_uri);
  redirectUrl.searchParams.set('code', code);
  if (state) redirectUrl.searchParams.set('state', state);
  redirectUrl.searchParams.set('iss', PUBLIC_BASE_URL);
  
  res.redirect(302, redirectUrl.toString());
});

// ============ OAuth Token ============
app.post('/token', (req, res) => {
  const { grant_type, code, redirect_uri, client_id, refresh_token } = req.body;
  
  if (grant_type === 'authorization_code') {
    // 验证授权码
    const codeData = authCodes.get(code);
    if (!codeData) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid code' });
    }
    
    // 验证 redirect_uri
    if (codeData.redirect_uri !== redirect_uri) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Redirect URI mismatch' });
    }
    
    // 删除已使用的授权码
    authCodes.delete(code);
    
    // 生成 Access Token 和 Refresh Token
    const accessToken = crypto.randomBytes(32).toString('hex');
    const refreshToken = crypto.randomBytes(32).toString('hex');
    
    accessTokens.set(accessToken, {
      client_id: codeData.client_id,
      scope: codeData.scope,
      created_at: Date.now(),
    });
    refreshTokens.set(refreshToken, accessToken);
    
    // 设置 Access Token 过期
    setTimeout(() => accessTokens.delete(accessToken), OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000);
    setTimeout(() => refreshTokens.delete(refreshToken), OAUTH_REFRESH_TOKEN_TTL_SECONDS * 1000);
    
    res.json({
      access_token: accessToken,
      token_type: 'Bearer',
      expires_in: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: codeData.scope,
    });
    
  } else if (grant_type === 'refresh_token') {
    const accessToken = refreshTokens.get(refresh_token);
    if (!accessToken || !accessTokens.has(accessToken)) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'Invalid refresh token' });
    }
    
    // 生成新的 Access Token
    const newAccessToken = crypto.randomBytes(32).toString('hex');
    const tokenData = accessTokens.get(accessToken);
    accessTokens.delete(accessToken);
    accessTokens.set(newAccessToken, tokenData);
    setTimeout(() => accessTokens.delete(newAccessToken), OAUTH_ACCESS_TOKEN_TTL_SECONDS * 1000);
    
    res.json({
      access_token: newAccessToken,
      token_type: 'Bearer',
      expires_in: OAUTH_ACCESS_TOKEN_TTL_SECONDS,
      scope: tokenData.scope,
    });
    
  } else {
    res.status(400).json({ error: 'unsupported_grant_type' });
  }
});

// ============ 动态客户端注册 (DCR) ============
app.post('/register', (req, res) => {
  // 简化版DCR：直接返回客户端信息
  res.json({
    client_id: 'mcd-chatgpt-client',
    client_secret: crypto.randomBytes(16).toString('hex'),
    client_id_issued_at: Math.floor(Date.now() / 1000),
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    scope: 'mcp',
    token_endpoint_auth_method: 'none',
  });
});

// ============ MCP 代理 ============
app.all('/mcp', async (req, res) => {
  // 验证 Access Token
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).set('WWW-Authenticate', 'Bearer').json({
      error: 'unauthorized',
      error_description: 'Missing or invalid access token'
    });
  }
  
  const token = authHeader.substring(7);
  if (!accessTokens.has(token)) {
    return res.status(401).set('WWW-Authenticate', 'Bearer').json({
      error: 'invalid_token',
      error_description: 'Access token expired or invalid'
    });
  }
  
  try {
    // 转发请求到麦当劳 MCP
    const response = await axios({
      method: req.method,
      url: MCD_MCP_URL + req.url,
      headers: {
        'Authorization': `Bearer ${MCD_MCP_TOKEN}`,
        'Content-Type': req.headers['content-type'] || 'application/json',
        'Accept': req.headers['accept'] || 'application/json',
      },
      data: req.body,
      params: req.query,
    });
    
    res.status(response.status).json(response.data);
  } catch (error) {
    if (error.response) {
      res.status(error.response.status).json(error.response.data);
    } else {
      res.status(500).json({ error: 'upstream_error', message: error.message });
    }
  }
});

// ============ 健康检查 ============
app.get('/healthz', (req, res) => {
  res.json({
    status: 'ok',
    service: 'mcd-chatgpt-oauth-adapter',
    oauth: 'ready',
    upstream: 'not-contacted',
    orderCreation: 'blocked',
  });
});

// ============ 启动服务器 ============
app.listen(PORT, '127.0.0.1', () => {
  console.log(`🚀 Server running on http://127.0.0.1:${PORT}`);
  console.log(`🔗 Public URL: ${PUBLIC_BASE_URL}`);
});
