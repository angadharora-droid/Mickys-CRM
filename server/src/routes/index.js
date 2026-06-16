const express = require('express');

const { authenticate, authorize } = require('../middleware/auth');
const { loginLimiter, authLimiter, generateLimiter, emailLimiter } = require('../middleware/security');
const validate = require('../middleware/validate');
const v = require('../validators');

const auth = require('../controllers/auth.controller');
const users = require('../controllers/user.controller');
const rateItems = require('../controllers/rateItem.controller');
const leads = require('../controllers/lead.controller');
const dashboard = require('../controllers/dashboard.controller');
const activity = require('../controllers/activity.controller');
const settings = require('../controllers/settings.controller');

const router = express.Router();

const ADMIN = 'admin';
const EXEC = 'sales_exec';

// ---------- Auth ----------
router.post('/auth/login', loginLimiter, validate(v.loginSchema), auth.login);
router.post('/auth/refresh', authLimiter, auth.refresh);
router.post('/auth/logout', auth.logout);
router.get('/auth/me', authenticate, auth.me);
router.post('/auth/change-password', authLimiter, authenticate, validate(v.changePasswordSchema), auth.changePassword);

// ---------- Users (admin only, except exec picker list) ----------
router.get('/users', authenticate, users.listUsers); // role-filtered lists used by lead-assignment pickers
router.get('/users/:id', authenticate, authorize(ADMIN), users.getUser);
router.post('/users', authenticate, authorize(ADMIN), validate(v.createUserSchema), users.createUser);
router.put('/users/:id', authenticate, authorize(ADMIN), validate(v.updateUserSchema), users.updateUser);
router.delete('/users/:id', authenticate, authorize(ADMIN), users.deleteUser);

// ---------- Rate master (two masters: distributor & institutional) ----------
router.get('/rate-items', authenticate, rateItems.listRateItems);
router.get('/rate-items/categories', authenticate, rateItems.listCategories);
router.get('/rate-items/:id', authenticate, rateItems.getRateItem);
router.post('/rate-items', authenticate, authorize(ADMIN), validate(v.rateItemSchema), rateItems.createRateItem);
router.put('/rate-items/:id', authenticate, authorize(ADMIN), validate(v.rateItemSchema.partial()), rateItems.updateRateItem);
router.delete('/rate-items/:id', authenticate, authorize(ADMIN), rateItems.deleteRateItem);

// ---------- Leads + Kit pipeline ----------
router.post('/leads', authenticate, authorize(EXEC, ADMIN), validate(v.leadSchema), leads.createLead);
router.get('/leads', authenticate, leads.listLeads);
router.get('/leads/:id', authenticate, leads.getLead);
router.put('/leads/:id', authenticate, validate(v.updateLeadSchema), leads.updateLead);
router.delete('/leads/:id', authenticate, leads.deleteLead);
router.post('/leads/:id/kit-type', authenticate, validate(v.kitTypeSchema), leads.selectKitType);
router.put('/leads/:id/rates', authenticate, validate(v.ratesConfirmSchema), leads.confirmRates);
router.post('/leads/:id/generate', authenticate, generateLimiter, leads.generateLeadKit);
router.post('/leads/:id/unlock', authenticate, leads.unlockLead);
router.get('/leads/:id/kit.zip', authenticate, leads.downloadZip);
router.get('/leads/:id/documents/:idx', authenticate, leads.downloadDocument);
router.post('/leads/:id/email', authenticate, emailLimiter, validate(v.emailKitSchema), leads.emailKit);

// ---------- Dashboards ----------
router.get('/dashboard/admin', authenticate, authorize(ADMIN), dashboard.adminAnalytics);
router.get('/dashboard/lead-tracker', authenticate, authorize(ADMIN), dashboard.leadTracker);
router.get('/dashboard/exec', authenticate, authorize(EXEC), dashboard.execAnalytics);

// ---------- Activity Logs ----------
router.get('/activity-logs', authenticate, authorize(ADMIN), activity.listLogs);

// ---------- Settings ----------
router.get('/settings', authenticate, authorize(ADMIN), settings.getSettings);
router.put('/settings', authenticate, authorize(ADMIN), validate(v.settingsSchema), settings.updateSettings);
router.post('/settings/test-email', authenticate, authorize(ADMIN), emailLimiter, settings.testEmail);

module.exports = router;
