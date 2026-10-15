import { config } from '../../config.js';

// Local/dev provider: the "payment link" is a page on this server with a Pay button.
export const mockProvider = {
  name: 'mock',

  async createPaymentLink({ payment }) {
    return { providerRef: `mock_${payment._id}`, url: `${config.publicBaseUrl}/pay/mock/${payment._id}` };
  },

  async cancelPaymentLink() {},

  async refund({ amount }) {
    return { providerRef: `mock_rfnd_${Date.now()}`, status: 'refunded', amount };
  },

  parseWebhook() {
    return null; // mock payments are completed through /pay/mock/:id
  },
};
