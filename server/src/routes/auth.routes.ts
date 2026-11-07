import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../db.js';
import { generateToken, authenticate } from '../middleware/auth.js';

const router = Router();

// Helper to sanitize and format user object for client response
function formatUserResponse(user: any) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone || null,
    role: user.role,
    avatar: user.avatar || null,
    preferredLanguage: user.preferredLanguage || 'en',
    supportedLanguages: user.supportedLanguages || 'en,ta,te,ml,hi',
    agentStatus: user.agentStatus || 'available',
    maxConcurrentCalls: user.maxConcurrentCalls || 1,
    createdAt: user.createdAt
  };
}

// 1. Unified Password Login (Supports Customer, Support Agent, and Administrator)
router.post('/login', async (req: Request, res: Response) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      res.status(400).json({ error: 'Email address and password are required.' });
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
      res.status(401).json({ error: 'Invalid email address or password.' });
      return;
    }

    // Role-specific check if a role portal was explicitly targeted
    if (role === 'admin' && user.role !== 'admin') {
      res.status(403).json({
        error: 'Access denied. This account does not have Administrator privileges. Please sign in via the appropriate portal.'
      });
      return;
    }

    if (role === 'agent' && user.role !== 'agent') {
      res.status(403).json({
        error: 'Access denied. This account does not have Support Agent privileges. Please sign in via the appropriate portal.'
      });
      return;
    }

    if (role === 'customer' && user.role !== 'customer') {
      res.status(403).json({
        error: `Access denied. This account is registered as ${user.role}. Please sign in via the ${user.role === 'admin' ? 'Administrator' : 'Support Agent'} portal.`
      });
      return;
    }

    // Compare password with bcrypt hash
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid email address or password.' });
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
      user: formatUserResponse(user)
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
      res.status(400).json({ error: 'Administrator email and password are required.' });
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
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }
    const token = generateToken({ id: user.id, email: user.email, name: user.name, role: 'admin' });
    res.json({
      message: 'Administrator login successful',
      token,
      user: formatUserResponse(user)
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
      res.status(400).json({ error: 'Support Agent email and password are required.' });
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
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }
    const token = generateToken({ id: user.id, email: user.email, name: user.name, role: 'agent' });
    res.json({
      message: 'Support Agent login successful',
      token,
      user: formatUserResponse(user)
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error during Agent login.' });
  }
});

// 1c. Dedicated Customer Login
router.post('/customer/login', async (req: Request, res: Response) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      res.status(400).json({ error: 'Customer email and password are required.' });
      return;
    }
    const cleanEmail = email.trim().toLowerCase();
    const user = await prisma.user.findFirst({ where: { email: cleanEmail } });
    if (!user || user.role !== 'customer') {
      res.status(403).json({ error: 'Access denied. No customer account found with this email.' });
      return;
    }
    const isValid = await bcrypt.compare(password, user.passwordHash);
    if (!isValid) {
      res.status(401).json({ error: 'Invalid email or password.' });
      return;
    }
    const token = generateToken({ id: user.id, email: user.email, name: user.name, role: 'customer' });
    res.json({
      message: 'Customer login successful',
      token,
      user: formatUserResponse(user)
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Internal server error during Customer login.' });
  }
});

// 2. Customer Registration (Creates verified Customer account and automatically signs them in)
router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, email, phone, password, confirmPassword } = req.body;

    // Field presence validation
    if (!name || typeof name !== 'string' || !name.trim()) {
      res.status(400).json({ error: 'Full name is required.' });
      return;
    }

    if (!email || typeof email !== 'string' || !email.trim()) {
      res.status(400).json({ error: 'Email address is required.' });
      return;
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const cleanEmail = email.trim().toLowerCase();
    if (!emailRegex.test(cleanEmail)) {
      res.status(400).json({ error: 'Please provide a valid email address.' });
      return;
    }

    if (!password || typeof password !== 'string') {
      res.status(400).json({ error: 'Password is required.' });
      return;
    }

    if (password.length < 6) {
      res.status(400).json({ error: 'Password must be at least 6 characters long.' });
      return;
    }

    if (password !== confirmPassword) {
      res.status(400).json({ error: 'Passwords do not match.' });
      return;
    }

    // Check if email already exists
    const existing = await prisma.user.findFirst({
      where: { email: cleanEmail }
    });

    if (existing) {
      res.status(400).json({ error: 'An account with this email address already exists. Please sign in instead.' });
      return;
    }

    // Securely hash password with bcrypt
    const passwordHash = await bcrypt.hash(password, 10);

    // Save customer record strictly locked to role: 'customer'
    const newUser = await prisma.user.create({
      data: {
        name: name.trim(),
        email: cleanEmail,
        phone: phone && typeof phone === 'string' && phone.trim() ? phone.trim() : null,
        role: 'customer',
        passwordHash,
        preferredLanguage: 'en'
      }
    });

    // Auto-login: Issue JWT token
    const token = generateToken({
      id: newUser.id,
      email: newUser.email,
      name: newUser.name,
      role: 'customer'
    });

    res.status(201).json({
      message: 'Account created successfully.',
      token,
      user: formatUserResponse(newUser)
    });
  } catch (err: any) {
    console.error('[Auth] Registration error:', err);
    res.status(500).json({ error: 'Internal server error during customer registration.' });
  }
});

// 3. Current user session profile
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
      user: formatUserResponse(user)
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve profile.' });
  }
});

// 4. Update user preferences (language, agent availability)
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
      user: formatUserResponse(user)
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update preferences.' });
  }
});

// 5. Forgot Password
router.post('/forgot-password', async (req: Request, res: Response) => {
  try {
    const { email } = req.body;
    if (!email) {
      res.status(400).json({ error: 'Email address is required.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const user = await prisma.user.findFirst({
      where: { email: cleanEmail }
    });

    if (user) {
      // In production, send email with reset link or token
      console.log(`[Auth] Password reset requested for: ${cleanEmail}`);
    }

    res.json({
      message: 'If an account exists with this email address, password reset instructions have been sent.'
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Error processing forgot password request.' });
  }
});

export default router;
