import { config } from '../../../config.js';
import { mockProvider } from './mock.js';
import { razorpayProvider } from './razorpay.js';
import { stripeProvider } from './stripe.js';

const providers = { mock: mockProvider, razorpay: razorpayProvider, stripe: stripeProvider };

export function getProvider(name = config.paymentProvider) {
  const p = providers[name];
  if (!p) throw new Error(`Unknown payment provider "${name}"`);
  return p;
}
