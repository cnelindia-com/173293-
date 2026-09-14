import { Router } from 'express';
import {
  getConfig,
  createIntent,
  confirmPayment,
  payWithCod,
  paymentHistory,
  listPaymentMethods,
  removePaymentMethod,
  createIntentValidators,
  codValidators,
  idParam,
} from '../controllers/paymentsController.js';
import { protect } from '../middleware/auth.js';
import validate from '../middleware/validate.js';
import { body } from 'express-validator';

const router = Router();

router.get('/config', getConfig);

router.use(protect);

router.post('/create-intent', createIntentValidators, validate, createIntent);
router.post('/cod', codValidators, validate, payWithCod);
router.post(
  '/confirm',
  body('paymentIntentId').notEmpty().withMessage('paymentIntentId is required'),
  validate,
  confirmPayment
);
router.get('/history', paymentHistory);
router.get('/methods', listPaymentMethods);
router.delete('/methods/:id', idParam, validate, removePaymentMethod);

export default router;
