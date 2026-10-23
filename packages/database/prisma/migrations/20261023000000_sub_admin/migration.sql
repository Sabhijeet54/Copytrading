-- Sub-admin: admin panel access without platform-critical actions
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'SUB_ADMIN';
