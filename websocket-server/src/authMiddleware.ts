import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

export interface AuthenticatedRequest extends Request {
  userId?: string;
}

export function authenticateToken(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    res.status(401).json({ error: 'Access token required' });
    return;
  }

  try {
    // For Supabase JWT tokens, we need to verify with the Supabase JWT secret
    const supabaseJwtSecret = process.env.SUPABASE_JWT_SECRET;
    if (!supabaseJwtSecret) {
      throw new Error('SUPABASE_JWT_SECRET environment variable is required');
    }

    const decoded = jwt.verify(token, supabaseJwtSecret) as any;
    req.userId = decoded.sub; // Supabase user ID is in the 'sub' claim
    next();
  } catch (error) {
    console.error('Token validation error:', error);
    res.status(403).json({ error: 'Invalid or expired token' });
    return;
  }
}

export function extractUserIdFromToken(token: string): string | null {
  try {
    const supabaseJwtSecret = process.env.SUPABASE_JWT_SECRET;
    if (!supabaseJwtSecret) {
      console.error('SUPABASE_JWT_SECRET environment variable is required');
      return null;
    }

    const decoded = jwt.verify(token, supabaseJwtSecret) as any;
    return decoded.sub;
  } catch (error) {
    console.error('Token extraction error:', error);
    return null;
  }
} 