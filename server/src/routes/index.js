const express = require('express');

const { authenticate, authorize } = require('../middleware/auth');
const { loginLimiter, authLimiter, generateLimiter, emailLimiter } = require('../middleware/security');
const validate = require('../middleware/validate');
const upload = require('../middleware/upload');
const v = require('../validators');

const auth = require('../controllers/auth.controller');
const users = require('../controllers/user.controller');
const rateItems = require('../controllers/rateItem.controller');
const leads = require('../controllers/lead.controller');
const dashboard = require('../controllers/dashboard.controller');
const activity = require('../controllers/activity.controller');
const settings = require('../controllers/settings.controller');
const exportKit = require('../controllers/export.controller');

const router = express.Router();

const ADMIN = 'admin';
const EXEC = 'sales_exec';
const PR = 'pr_manager';

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
router.get('/cities', authenticate, leads.listCities);
router.get('/follow-ups', authenticate, leads.listFollowUps);
router.get('/action-points', authenticate, leads.listActionPoints);
router.get('/instructions', authenticate, leads.listInstructions);
router.post('/leads', authenticate, authorize(EXEC, ADMIN, PR), validate(v.leadSchema), leads.createLead);
router.get('/leads', authenticate, leads.listLeads);
router.get('/leads/:id', authenticate, leads.getLead);
router.put('/leads/:id', authenticate, validate(v.updateLeadSchema), leads.updateLead);
router.delete('/leads/:id', authenticate, leads.deleteLead);
router.post('/leads/:id/kit-type', authenticate, validate(v.kitTypeSchema), leads.selectKitType);
router.put('/leads/:id/rates', authenticate, validate(v.ratesConfirmSchema), leads.confirmRates);
router.put('/leads/:id/export-config', authenticate, validate(v.exportConfirmSchema), leads.confirmExportConfig);
router.post('/leads/:id/generate', authenticate, generateLimiter, validate(v.generateKitSchema), leads.generateLeadKit);
router.put('/leads/:id/terms', authenticate, validate(v.saveTermsSchema), leads.saveTerms);
router.post('/leads/:id/unlock', authenticate, leads.unlockLead);
router.post('/leads/:id/notes', authenticate, validate(v.noteSchema), leads.addNote);
router.put('/leads/:id/notes/:noteId', authenticate, validate(v.noteSchema), leads.updateNote);
router.delete('/leads/:id/notes/:noteId', authenticate, leads.deleteNote);
router.post('/leads/:id/instructions', authenticate, authorize(ADMIN), validate(v.instructionSchema), leads.addInstruction);
router.post('/leads/:id/instructions/:instrId/done', authenticate, leads.closeInstruction);
router.delete('/leads/:id/instructions/:instrId', authenticate, authorize(ADMIN), leads.deleteInstruction);
router.put('/leads/:id/action-point', authenticate, validate(v.actionPointSchema), leads.setActionPoint);
router.put('/leads/:id/follow-up', authenticate, validate(v.followUpSchema), leads.updateFollowUp);
router.post('/leads/:id/follow-up/close', authenticate, validate(v.closeFollowUpSchema), leads.closeFollowUp);
router.post('/leads/:id/attachments', authenticate, upload.array('files', 10), leads.uploadAttachments);
router.get('/leads/:id/attachments/:attId', authenticate, leads.downloadAttachment);
router.patch('/leads/:id/attachments/:attId', authenticate, leads.renameAttachment);
router.delete('/leads/:id/attachments/:attId', authenticate, leads.deleteAttachment);
router.get('/leads/:id/kit.zip', authenticate, leads.downloadZip);
router.get('/leads/:id/documents/:idx', authenticate, leads.downloadDocument);
router.post('/leads/:id/email', authenticate, emailLimiter, validate(v.emailKitSchema), leads.emailKit);
router.post('/leads/:id/deliver-manual', authenticate, validate(v.manualDeliverySchema), leads.markDelivered);

// ---------- Export Kit ----------
router.get('/export/config', authenticate, exportKit.getExportConfig);
// Destination countries (CIR + part-load freight); management is admin-only.
router.get('/export/countries', authenticate, exportKit.listCountries);
router.post('/export/countries', authenticate, authorize(ADMIN), validate(v.exportCountrySchema), exportKit.createCountry);
router.put('/export/countries/:id', authenticate, authorize(ADMIN), validate(v.exportCountrySchema.partial()), exportKit.updateCountry);
router.delete('/export/countries/:id', authenticate, authorize(ADMIN), exportKit.deleteCountry);
// Daily-synced exchange rates; refresh/override is admin-only.
router.get('/export/exchange-rates', authenticate, exportKit.getExchangeRates);
router.post('/export/exchange-rates/refresh', authenticate, authorize(ADMIN), exportKit.refreshExchangeRates);
router.put('/export/exchange-rates', authenticate, authorize(ADMIN), validate(v.exchangeRatesSchema), exportKit.updateExchangeRates);
// Live shipment preview used by the lead export step. Generation itself runs
// through the lead pipeline (PUT /leads/:id/export-config → generated kit).
router.post('/export/rate-card/preview', authenticate, validate(v.exportRateCardSchema), exportKit.previewRateCard);

// ---------- Dashboards ----------
router.get('/dashboard/admin', authenticate, authorize(ADMIN), dashboard.adminAnalytics);
router.get('/dashboard/lead-tracker', authenticate, authorize(ADMIN), dashboard.leadTracker);
router.get('/dashboard/exec', authenticate, authorize(EXEC, PR), dashboard.execAnalytics);

// ---------- Activity Logs ----------
router.get('/activity-logs', authenticate, authorize(ADMIN), activity.listLogs);

// ---------- Settings ----------
router.get('/settings', authenticate, authorize(ADMIN), settings.getSettings);
router.put('/settings', authenticate, authorize(ADMIN), validate(v.settingsSchema), settings.updateSettings);
router.post('/settings/test-email', authenticate, authorize(ADMIN), emailLimiter, settings.testEmail);

module.exports = router;
