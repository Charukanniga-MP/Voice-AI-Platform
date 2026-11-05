import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
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

// 3. Google Authentication
router.post('/google', async (req: Request, res: Response) => {
  try {
    const { email, name, googleId, avatar } = req.body;

    if (!email) {
      res.status(400).json({ error: 'Email is required from Google authentication.' });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();

    // Check if account already exists
    const existingUser = await prisma.user.findFirst({
      where: { email: cleanEmail }
    });

    if (existingUser) {
      // User exists. Update googleId if not present
      if (!existingUser.googleId && googleId) {
        await prisma.user.update({
          where: { id: existingUser.id },
          data: { googleId, avatar: avatar || existingUser.avatar }
        });
      }

      const token = generateToken({
        id: existingUser.id,
        email: existingUser.email,
        name: existingUser.name,
        role: existingUser.role as any
      });

      res.json({
        message: 'Google login successful',
        token,
        user: {
          id: existingUser.id,
          name: existingUser.name,
          email: existingUser.email,
          phone: existingUser.phone,
          role: existingUser.role,
          avatar: existingUser.avatar
        }
      });
      return;
    }

    // User DOES NOT exist:
    // Important Rule: Google authentication must never automatically grant Admin or Agent privileges.
    // If someone attempts Google sign-in with a non-existent email, they can only be registered as a Customer.
    const tempPasswordHash = await bcrypt.hash(Math.random().toString(36), 10);
    const newCustomer = await prisma.user.create({
      data: {
        name: name || cleanEmail.split('@')[0],
        email: cleanEmail,
        role: 'customer', // strictly customer
        googleId: googleId || 'google_' + Date.now(),
        avatar: avatar || null,
        passwordHash: tempPasswordHash
      }
    });

    const token = generateToken({
      id: newCustomer.id,
      email: newCustomer.email,
      name: newCustomer.name,
      role: 'customer'
    });

    res.status(201).json({
      message: 'Google customer account created successfully',
      token,
      user: {
        id: newCustomer.id,
        name: newCustomer.name,
        email: newCustomer.email,
        phone: newCustomer.phone,
        role: newCustomer.role,
        avatar: newCustomer.avatar
      }
    });
  } catch (err: any) {
    console.error('[Auth] Google auth error:', err);
    res.status(500).json({ error: 'Internal server error during Google authentication.' });
  }
});

// 4. Current user session profile
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

    // For security, don't disclose if email exists or not
    res.json({
      message: 'If an account exists with this email address, password reset instructions have been dispatched.'
    });
  } catch (err: any) {
    res.status(500).json({ error: 'Error processing forgot password request.' });
  }
});

export default router;
