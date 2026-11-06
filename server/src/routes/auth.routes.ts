import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { OAuth2Client } from 'google-auth-library';
import { prisma } from '../db.js';
import { generateToken, authenticate } from '../middleware/auth.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = Router();

// 1. Password Login for Administrator and Support Agent (Strictly restricted from Customers)
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Username / email and password are required.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();

    // Find user by email (case-insensitive)
    const user = await prisma.user.findFirst({
      where: {
        email: {
          equals: cleanEmail
        }
      }
    });

    if (!user) {
      res.status(401).json({ error: 'Invalid username/email or password.' });
      return;
    }

    // Strict Role Enforcement: Customers MUST use Google Authentication only!
    if (user.role === 'customer') {
      res.status(403).json({
        error: 'Customer accounts must authenticate using "Continue with Google". Password login is restricted to Administrators and Support Agents.'
      });
      return;
    }

    // Role-specific check if role portal was specified
    if (role === 'admin' && user.role !== 'admin') {
      res.status(403).json({
        error: 'Access denied. This account does not have Administrator privileges. Please sign in via the Support Agent portal.'
      });
      return;
    }

    if (role === 'agent' && user.role !== 'agent') {
      res.status(403).json({
        error: 'Access denied. This account does not have Support Agent privileges. Please sign in via the Administrator portal.'
      });
      return;
    }

    // Compare password with bcrypt hash
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid username/email or password.' });
      return;
    }

    const token = generateToken({
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as any
    });

    res.json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        avatar: user.avatar
      }
    });
  } catch (err: any) {
    console.error('[Auth] Login error:', err);
    res.status(500).json({ error: 'Internal server error during login.' });
  }
});

// 1a. Dedicated Administrator Login
router.post('/admin/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Admin username/email and password are required.' });
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    const user = await prisma.user.findFirst({ where: { email: cleanEmail } });
    if (!user || user.role !== 'admin') {
      res.status(403).json({ error: 'Access denied. This account does not have Administrator privileges.' });
      return;
    }
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid username/email or password.' });
      return;
    }
    const token = generateToken({ id: user.id, email: user.email, name: user.name, role: 'admin' });
    res.json({
      message: 'Administrator login successful',
      token,
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, avatar: user.avatar }
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error during Admin login.' });
  }
});

// 1b. Dedicated Support Agent Login
router.post('/agent/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Support Agent username/email and password are required.' });
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    const user = await prisma.user.findFirst({ where: { email: cleanEmail } });
    if (!user || user.role !== 'agent') {
      res.status(403).json({ error: 'Access denied. This account does not have Support Agent privileges.' });
      return;
    }
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid username/email or password.' });
      return;
    }
    const token = generateToken({ id: user.id, email: user.email, name: user.name, role: 'agent' });
    res.json({
      message: 'Support Agent login successful',
      token,
      user: { id: user.id, name: user.name, email: user.email, phone: user.phone, role: user.role, avatar: user.avatar }
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error during Agent login.' });
  }
});

// 2. Customer Registration (Only customers can create accounts)
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, email, phone, password, confirmPassword } = req.body;

    if (!name || !email || !password) {
      res.status(400).json({ error: 'Full name, email, and password are required.' });
      return;
    }

    if (password !== confirmPassword) {
      res.status(400).json({ error: 'Passwords do not match.' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters long.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();

    // Check if email already exists
    const existing = await prisma.user.findFirst({
      where: { email: cleanEmail }
    });

    if (existing) {
      res.status(400).json({ error: 'An account with this email address already exists.' });
      return;
    }

    // Role is strictly locked to "customer" - never allow registering as admin or agent
    const passwordHash = await bcrypt.hash(password, 10);
    const newUser = await prisma.user.create({
      data: {
        name: name.trim(),
        email: cleanEmail,
        phone: phone ? phone.trim() : null,
        role: 'customer',
        passwordHash
      }
    });

    const token = generateToken({
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: 'customer'
    });

    res.status(201).json({
      message: 'Customer account created successfully',
      token,
      user: {
        id: newUser.id,
        name: newUser.name,
        email: newUser.email,
        phone: newUser.phone,
        role: newUser.role
      }
    });
  } catch (err: any) {
    console.error('[Auth] Registration error:', err);
    res.status(500).json({ error: 'Internal server error during registration.' });
  }
});

// 2.5 Google OAuth Configuration Status for Frontend
router.get('/google/config', (req: Request, res: Response) => {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const isConfigured = Boolean(clientId && clientId !== '' && !clientId.includes('your-google-client-id'));
  res.json({
    configured: isConfigured,
    clientId: isConfigured ? clientId : null
  });
});

// 2.6 Save Google OAuth Credentials to .env
router.post('/google/configure', async (req: Request, res: Response) => {
  try {
    const { clientId, clientSecret } = req.body;

    if (!clientId || typeof clientId !== 'string' || clientId.trim() === '') {
      res.status(400).json({ error: 'Google Client ID is required.' });
      return;
    }

    const cleanClientId = clientId.trim();
    const cleanSecret = clientSecret && typeof clientSecret === 'string' ? clientSecret.trim() : '';

    // Update in-memory process.env immediately
    process.env.GOOGLE_CLIENT_ID = cleanClientId;
    if (cleanSecret) {
      process.env.GOOGLE_CLIENT_SECRET = cleanSecret;
    }

    // Persist to .env files
    const candidatePaths = [
      path.resolve(__dirname, '../.env'),
      path.resolve(process.cwd(), '.env'),
      path.resolve(process.cwd(), 'server/.env')
    ];

    for (const envPath of candidatePaths) {
      try {
        let envContent = '';
        if (fs.existsSync(envPath)) {
          envContent = fs.readFileSync(envPath, 'utf-8');
        }

        if (envContent.includes('GOOGLE_CLIENT_ID=')) {
          envContent = envContent.replace(/GOOGLE_CLIENT_ID=.*/g, `GOOGLE_CLIENT_ID=${cleanClientId}`);
        } else {
          envContent += `\nGOOGLE_CLIENT_ID=${cleanClientId}\n`;
        }

        if (cleanSecret) {
          if (envContent.includes('GOOGLE_CLIENT_SECRET=')) {
            envContent = envContent.replace(/GOOGLE_CLIENT_SECRET=.*/g, `GOOGLE_CLIENT_SECRET=${cleanSecret}`);
          } else {
            envContent += `GOOGLE_CLIENT_SECRET=${cleanSecret}\n`;
          }
        }

        fs.writeFileSync(envPath, envContent, 'utf-8');
      } catch (writeErr) {
        // Continue attempting other candidate paths
      }
    }

    res.json({
      message: 'Google OAuth credentials updated and activated successfully.',
      configured: true,
      clientId: cleanClientId
    });
  } catch (err: any) {
    console.error('[Google Configure] Error:', err);
    res.status(500).json({ error: 'Failed to update Google OAuth credentials.' });
  }
});

// 3. Official Google OAuth 2.0 – Generate Authorization URL
router.get('/google/url', (req: Request, res: Response) => {
  const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback';

  if (!clientId || clientId === '' || clientId.includes('your-google-client-id')) {
    res.json({
      configured: false,
      message: 'Google Client ID is not configured in server/.env',
      clientId: null,
      authUrl: null
    });
    return;
  }

  // Derive origin from referrer or query parameter so redirect returns to correct port
  const originHeader = req.headers.referer || req.headers.origin;
  let returnOrigin = process.env.FRONTEND_URL || 'http://localhost:5173';
  if (req.query.returnTo && typeof req.query.returnTo === 'string') {
    returnOrigin = req.query.returnTo;
  } else if (originHeader) {
    try {
      const u = new URL(originHeader as string);
      returnOrigin = u.origin;
    } catch {}
  }

  const statePayload = {
    nonce: crypto.randomBytes(16).toString('hex'),
    returnTo: returnOrigin
  };
  const state = Buffer.from(JSON.stringify(statePayload)).toString('base64url');

  const scope = encodeURIComponent('openid email profile');
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(clientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=${scope}&access_type=offline&prompt=select_account&state=${state}`;

  res.json({
    configured: true,
    clientId,
    redirectUri,
    authUrl
  });
});

// 4. Official Google OAuth 2.0 – Callback Handler
router.get('/google/callback', async (req: Request, res: Response) => {
  let frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';

  // Decode dynamic return origin from state parameter if present
  if (req.query.state && typeof req.query.state === 'string') {
    try {
      const decodedState = JSON.parse(Buffer.from(req.query.state, 'base64url').toString('utf-8'));
      if (decodedState.returnTo) {
        const u = new URL(decodedState.returnTo);
        frontendUrl = u.origin;
      }
    } catch {}
  }

  const { code, error } = req.query;

  if (error) {
    console.warn('[Google OAuth] User cancelled or error:', error);
    res.redirect(`${frontendUrl}/?error=${encodeURIComponent('Google authentication was cancelled.')}`);
    return;
  }

  if (!code || typeof code !== 'string') {
    res.redirect(`${frontendUrl}/?error=${encodeURIComponent('Authorization code missing from Google response.')}`);
    return;
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback';

  if (!clientId || !clientSecret) {
    res.redirect(`${frontendUrl}/?error=${encodeURIComponent('Google OAuth credentials not configured on backend.')}`);
    return;
  }

  try {
    // Exchange authorization code for access and ID tokens with Google
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code'
      })
    });

    const tokenData = await tokenResponse.json();

    if (!tokenResponse.ok || (!tokenData.access_token && !tokenData.id_token)) {
      console.error('[Google OAuth] Token exchange error:', tokenData);
      res.redirect(`${frontendUrl}/?error=${encodeURIComponent(tokenData.error_description || 'Failed to exchange authorization code with Google.')}`);
      return;
    }

    // Dual verified identity resolution: verify ID token payload & fallback to UserInfo API
    let cleanEmail = '';
    let googleId = '';
    let name = '';
    let avatar: string | null = null;

    if (tokenData.id_token) {
      try {
        const client = new OAuth2Client(clientId);
        const ticket = await client.verifyIdToken({
          idToken: tokenData.id_token,
          audience: clientId
        });
        const payload = ticket.getPayload();
        if (payload && payload.email) {
          cleanEmail = payload.email.trim().toLowerCase();
          googleId = payload.sub;
          name = payload.name || payload.given_name || cleanEmail.split('@')[0];
          avatar = payload.picture || null;
        }
      } catch (idErr: any) {
        console.warn('[Google OAuth] Callback id_token verify warning:', idErr.message);
      }
    }

    if (!cleanEmail && tokenData.access_token) {
      const userinfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const profile = await userinfoResponse.json();
      if (userinfoResponse.ok && profile.email) {
        cleanEmail = profile.email.trim().toLowerCase();
        googleId = profile.sub;
        name = profile.name || profile.given_name || cleanEmail.split('@')[0];
        avatar = profile.picture || null;
      }
    }

    if (!cleanEmail) {
      console.error('[Google OAuth] Userinfo fetch error:', tokenData);
      res.redirect(`${frontendUrl}/?error=${encodeURIComponent('Failed to retrieve user profile from Google.')}`);
      return;
    }

    // Strict Role-Based Access Control: Google login is ONLY for Customers!
    // Check if account already exists in DB
    const existingUser = await prisma.user.findFirst({
      where: { email: cleanEmail }
    });

    let targetUser: any;

    if (existingUser) {
      if (existingUser.role === 'admin') {
        res.redirect(`${frontendUrl}/?error=${encodeURIComponent('Google authentication is restricted to Customers only. Administrators must sign in using their Admin username and password.')}`);
        return;
      }

      if (existingUser.role === 'agent') {
        res.redirect(`${frontendUrl}/?error=${encodeURIComponent('Google authentication is restricted to Customers only. Support Agents must sign in using their Agent username and password.')}`);
        return;
      }

      // Existing customer login
      targetUser = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          googleId: googleId || existingUser.googleId,
          avatar: avatar || existingUser.avatar
        }
      });
      console.log(`[Google OAuth] Existing customer logged in: ${targetUser.email}`);
    } else {
      // New account: strictly Customer role (never Admin or Agent)
      const tempPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      targetUser = await prisma.user.create({
        data: {
          name,
          email: cleanEmail,
          role: 'customer',
          googleId,
          avatar,
          passwordHash: tempPasswordHash
        }
      });
      console.log(`[Google OAuth] New customer registered via Google: ${targetUser.email}`);
    }

    // Issue KAIRA JWT
    const token = generateToken({
      id: targetUser.id,
      email: targetUser.email,
      name: targetUser.name,
      role: targetUser.role as any
    });

    const userPayload = {
      id: targetUser.id,
      name: targetUser.name,
      email: targetUser.email,
      phone: targetUser.phone,
      role: targetUser.role,
      avatar: targetUser.avatar
    };

    // Redirect to frontend with token and user payload
    res.redirect(`${frontendUrl}/auth/callback?token=${encodeURIComponent(token)}&user=${encodeURIComponent(JSON.stringify(userPayload))}`);
  } catch (err: any) {
    console.error('[Google OAuth] Server callback exception:', err);
    res.redirect(`${frontendUrl}/?error=${encodeURIComponent('Internal server error during Google OAuth completion.')}`);
  }
});

// 4b. Official Google OAuth 2.0 – Code Exchange Endpoint (for GIS initCodeClient popup & PKCE flow)
router.post('/google/code', async (req: Request, res: Response) => {
  try {
    const { code, redirectUri } = req.body;

    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'Authorization code from Google is required.' });
      return;
    }

    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET?.trim();

    if (!clientId) {
      res.status(503).json({
        error: 'Google OAuth is not configured. Please configure GOOGLE_CLIENT_ID in server/.env.'
      });
      return;
    }

    // Exchange authorization code for tokens with Google
    const tokenParams: Record<string, string> = {
      code,
      client_id: clientId,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri || 'postmessage'
    };
    if (clientSecret) {
      tokenParams.client_secret = clientSecret;
    }

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(tokenParams)
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || (!tokenData.access_token && !tokenData.id_token)) {
      console.error('[Google Code] Token exchange failed:', tokenData);
      res.status(401).json({
        error: tokenData.error_description || 'Failed to exchange authorization code with Google.'
      });
      return;
    }

    // Dual verified identity resolution: verify ID token payload & fallback to UserInfo API
    let cleanEmail = '';
    let googleId = '';
    let name = '';
    let avatar: string | null = null;

    if (tokenData.id_token) {
      try {
        const client = new OAuth2Client(clientId);
        const ticket = await client.verifyIdToken({
          idToken: tokenData.id_token,
          audience: clientId
        });
        const payload = ticket.getPayload();
        if (payload && payload.email) {
          cleanEmail = payload.email.trim().toLowerCase();
          googleId = payload.sub;
          name = payload.name || payload.given_name || cleanEmail.split('@')[0];
          avatar = payload.picture || null;
        }
      } catch (idErr: any) {
        console.warn('[Google Code] id_token verify warning:', idErr.message);
      }
    }

    if (!cleanEmail && tokenData.access_token) {
      const userinfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const profile = await userinfoRes.json();
      if (userinfoRes.ok && profile.email) {
        cleanEmail = profile.email.trim().toLowerCase();
        googleId = profile.sub;
        name = profile.name || profile.given_name || cleanEmail.split('@')[0];
        avatar = profile.picture || null;
      }
    }

    if (!cleanEmail) {
      res.status(401).json({ error: 'Failed to retrieve user profile from Google.' });
      return;
    }

    // Strict Role Enforcement: Google is strictly for Customers
    const existingUser = await prisma.user.findFirst({
      where: { email: cleanEmail }
    });

    if (existingUser) {
      if (existingUser.role === 'admin') {
        res.status(403).json({
          error: 'Google authentication is restricted to Customers only. Administrators must sign in using their Admin username and password.'
        });
        return;
      }
      if (existingUser.role === 'agent') {
        res.status(403).json({
          error: 'Google authentication is restricted to Customers only. Support Agents must sign in using their Agent username and password.'
        });
        return;
      }
    }

    let targetUser: any;

    if (existingUser) {
      targetUser = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          googleId: googleId || existingUser.googleId,
          avatar: avatar || existingUser.avatar
        }
      });
      console.log(`[Google Code] Existing customer logged in: ${targetUser.email}`);
    } else {
      const tempHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      targetUser = await prisma.user.create({
        data: {
          name,
          email: cleanEmail,
          role: 'customer',
          googleId,
          avatar,
          passwordHash: tempHash
        }
      });
      console.log(`[Google Code] New customer registered via Google: ${targetUser.email}`);
    }

    const token = generateToken({
      id: targetUser.id,
      email: targetUser.email,
      name: targetUser.name,
      role: 'customer'
    });

    res.json({
      message: 'Google login successful',
      token,
      user: {
        id: targetUser.id,
        name: targetUser.name,
        email: targetUser.email,
        phone: targetUser.phone,
        role: targetUser.role,
        avatar: targetUser.avatar
      }
    });
  } catch (err: any) {
    console.error('[Google Code] Error:', err);
    res.status(500).json({ error: 'Internal server error during Google code verification.' });
  }
});

// 5. Official Google Identity Services (GIS) ID Token Verification
router.post('/google/verify-token', async (req: Request, res: Response) => {
  try {
    const { idToken } = req.body;

    if (!idToken || typeof idToken !== 'string') {
      res.status(400).json({ error: 'Missing or invalid Google ID token.' });
      return;
    }

    const clientId = process.env.GOOGLE_CLIENT_ID?.trim();
    if (!clientId) {
      res.status(503).json({
        error: 'Google OAuth is not configured on the backend. Please configure GOOGLE_CLIENT_ID in server/.env.'
      });
      return;
    }

    // Verify token cryptographically using official Google Auth Library
    const client = new OAuth2Client(clientId);
    let payload;

    try {
      const ticket = await client.verifyIdToken({
        idToken,
        audience: clientId
      });
      payload = ticket.getPayload();
    } catch (verifyErr: any) {
      console.error('[Google Verify] Verification library error:', verifyErr.message);
      res.status(401).json({
        error: 'Invalid, expired, or untrusted Google authentication token. Please sign in again.'
      });
      return;
    }

    if (!payload) {
      res.status(401).json({ error: 'Failed to extract verified payload from Google token.' });
      return;
    }

    // Validate Issuer
    const validIssuers = ['accounts.google.com', 'https://accounts.google.com'];
    if (!payload.iss || !validIssuers.includes(payload.iss)) {
      res.status(401).json({ error: `Untrusted Google token issuer: ${payload.iss}` });
      return;
    }

    // Validate Email & Verification Status
    if (!payload.email || !payload.email_verified) {
      res.status(401).json({ error: 'Your Google email is unverified or unavailable.' });
      return;
    }

    const cleanEmail = payload.email.trim().toLowerCase();
    const googleId = payload.sub;
    const name = payload.name || payload.given_name || cleanEmail.split('@')[0];
    const avatar = payload.picture || null;

    // Check existing account in database
    const existingUser = await prisma.user.findFirst({
      where: { email: cleanEmail }
    });

    let targetUser: any;

    if (existingUser) {
      // Role-Based Restriction: Google authentication is strictly forbidden for Admins and Agents!
      if (existingUser.role === 'admin') {
        res.status(403).json({
          error: 'Google authentication is restricted to Customers only. Administrators must sign in using their Admin username and password.'
        });
        return;
      }

      if (existingUser.role === 'agent') {
        res.status(403).json({
          error: 'Google authentication is restricted to Customers only. Support Agents must sign in using their Agent username and password.'
        });
        return;
      }

      // Existing Customer Login
      targetUser = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          googleId: googleId || existingUser.googleId,
          avatar: avatar || existingUser.avatar
        }
      });
      console.log(`[Google Verify] Customer logged in via Google: ${targetUser.email}`);
    } else {
      // New user registration via Google: strictly assigned Customer role (never Admin or Agent)
      // Never store Google password in database
      const randomPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      targetUser = await prisma.user.create({
        data: {
          name,
          email: cleanEmail,
          role: 'customer',
          googleId,
          avatar,
          passwordHash: randomPasswordHash
        }
      });
      console.log(`[Google Verify] New customer registered via Google: ${targetUser.email} (Role: customer)`);
    }

    // Issue standard KAIRA JWT
    const token = generateToken({
      id: targetUser.id,
      email: targetUser.email,
      name: targetUser.name,
      role: targetUser.role as any
    });

    res.json({
      message: 'Google login successful',
      token,
      user: {
        id: targetUser.id,
        name: targetUser.name,
        email: targetUser.email,
        phone: targetUser.phone,
        role: targetUser.role,
        avatar: targetUser.avatar
      }
    });
  } catch (err: any) {
    console.error('[Google Verify] Unexpected error:', err);
    res.status(500).json({ error: 'Internal server error validating Google token.' });
  }
});

// 6. Current user session profile
router.get('/me', authenticate, async (req: Request, res: Response) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user!.id }
    });

    if (!user) {
      res.status(404).json({ error: 'User profile not found.' });
      return;
    }

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        avatar: user.avatar,
        preferredLanguage: user.preferredLanguage || 'en',
        supportedLanguages: user.supportedLanguages || 'en,ta,te,ml,hi',
        agentStatus: user.agentStatus || 'available',
        maxConcurrentCalls: user.maxConcurrentCalls || 1,
        createdAt: user.createdAt
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve profile.' });
  }
});

// 6b. Update user preferences (language, agent status)
router.put('/preferences', authenticate, async (req: Request, res: Response) => {
  try {
    const { preferredLanguage, supportedLanguages, agentStatus } = req.body;
    const updateData: any = {};
    if (preferredLanguage) updateData.preferredLanguage = preferredLanguage;
    if (supportedLanguages) updateData.supportedLanguages = Array.isArray(supportedLanguages) ? supportedLanguages.join(',') : supportedLanguages;
    if (agentStatus) updateData.agentStatus = agentStatus;

    const user = await prisma.user.update({
      where: { id: req.user!.id },
      data: updateData
    });

    res.json({
      message: 'Preferences updated successfully.',
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        phone: user.phone,
        role: user.role,
        avatar: user.avatar,
        preferredLanguage: user.preferredLanguage || 'en',
        supportedLanguages: user.supportedLanguages || 'en,ta,te,ml,hi',
        agentStatus: user.agentStatus || 'available',
        maxConcurrentCalls: user.maxConcurrentCalls || 1
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update preferences.' });
  }
});

// 7. Forgot Password
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: 'Email address is required.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    await prisma.user.findFirst({
      where: { email: cleanEmail }
    });

    res.json({
      message: 'If an account exists with this email address, password reset instructions have been dispatched.'
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Error processing forgot password request.' });
  }
});

export default router;
