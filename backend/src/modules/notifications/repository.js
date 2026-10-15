import { Notification } from '../../models/index.js';
import { paginate } from '../../utils/pagination.js';

export const record = (data) => Notification.create(data);

export const list = (hotelId, page) => paginate(Notification, { hotel: hotelId }, page, { populate: ['booking', 'code'] });

export const forBooking = (bookingId) => Notification.find({ booking: bookingId }).sort({ createdAt: 1 });
