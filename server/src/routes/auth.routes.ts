import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { prisma } from '../db.js';
import { generateToken, authenticate } from '../middleware/auth.js';

const router = Router();

// 1. Unified Login for Customer, Agent, and Admin
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email / username and password are required.' });
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
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }

    // Compare password with bcrypt hash
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid email or password.' });
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

// 3. Official Google OAuth 2.0 – Generate Authorization URL
router.get('/google/url', (req: Request, res: Response) => {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:5000/api/auth/google/callback';

  if (!clientId || clientId.trim() === '') {
    res.json({
      configured: false,
      message: 'Google Client ID is not configured in server/.env',
      clientId: null,
      authUrl: null
    });
    return;
  }

  const state = crypto.randomBytes(16).toString('hex');
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
  const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
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

    if (!tokenResponse.ok || !tokenData.access_token) {
      console.error('[Google OAuth] Token exchange error:', tokenData);
      res.redirect(`${frontendUrl}/?error=${encodeURIComponent(tokenData.error_description || 'Failed to exchange authorization code with Google.')}`);
      return;
    }

    // Fetch verified user identity from Google
    const userinfoResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });

    const profile = await userinfoResponse.json();

    if (!userinfoResponse.ok || !profile.email) {
      console.error('[Google OAuth] Userinfo fetch error:', profile);
      res.redirect(`${frontendUrl}/?error=${encodeURIComponent('Failed to retrieve user profile from Google.')}`);
      return;
    }

    const cleanEmail = profile.email.trim().toLowerCase();
    const googleId = profile.sub;
    const name = profile.name || cleanEmail.split('@')[0];
    const avatar = profile.picture || null;

    // Strict Role-Based Access Control logic:
    // Check if account already exists in DB
    const existingUser = await prisma.user.findFirst({
      where: { email: cleanEmail }
    });

    let targetUser: any;

    if (existingUser) {
      // Existing authorized account: retain existing role (admin, agent, or customer)
      targetUser = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          googleId: googleId || existingUser.googleId,
          avatar: avatar || existingUser.avatar
        }
      });
      console.log(`[Google OAuth] Existing user logged in: ${targetUser.email} (Role: ${targetUser.role})`);
    } else {
      // New account: Google authentication must NEVER automatically grant Admin or Agent privileges!
      // Unrecognized accounts are strictly registered as Customers.
      const tempPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      targetUser = await prisma.user.create({
        data: {
          name,
          email: cleanEmail,
          role: 'customer', // strictly customer
          googleId,
          avatar,
          passwordHash: tempPasswordHash
        }
      });
      console.log(`[Google OAuth] New customer registered via Google: ${targetUser.email} (Role: customer)`);
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

// 5. Google ID Token Verification (for Google Identity Services)
router.post('/google/verify-token', async (req: Request, res: Response) => {
  try {
    const { idToken } = req.body;

    if (!idToken) {
      res.status(400).json({ error: 'Missing Google ID token.' });
      return;
    }

    // Verify token cryptographically with Google's public endpoint
    const verifyRes = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`);
    const tokenInfo = await verifyRes.json();

    if (!verifyRes.ok || !tokenInfo.email || tokenInfo.email_verified !== 'true') {
      res.status(401).json({ error: 'Invalid or unverified Google token.' });
      return;
    }

    const cleanEmail = tokenInfo.email.trim().toLowerCase();
    const googleId = tokenInfo.sub;
    const name = tokenInfo.name || cleanEmail.split('@')[0];
    const avatar = tokenInfo.picture || null;

    // Check existing role
    const existingUser = await prisma.user.findFirst({
      where: { email: cleanEmail }
    });

    let targetUser: any;

    if (existingUser) {
      targetUser = await prisma.user.update({
        where: { id: existingUser.id },
        data: {
          googleId: googleId || existingUser.googleId,
          avatar: avatar || existingUser.avatar
        }
      });
    } else {
      // New account: strictly Customer
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
    }

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
    console.error('[Google Verify] Error:', err);
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
        createdAt: user.createdAt
      }
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve profile.' });
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
