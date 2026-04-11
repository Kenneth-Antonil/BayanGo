/**
 * BayanGo Backend Core — Constants
 * Shared constants for Cloud Functions: URLs, status labels, allowed origins.
 */

const APP_ICON = "https://i.imgur.com/wL8wcBB.jpeg";
const USER_APP_URL = "https://bayango.store/bayango-user.html";
const RIDER_APP_URL = "https://bayango.store/bayango-rider.html";
const ADMIN_APP_URL = "https://bayango.store/bayango-admin.html";
const MERCHANT_APP_URL = "https://bayango.store/merchant/";

const ORDER_STATUS_LABELS = {
  merchant_pending: "Inihahanda ng merchant ang order",
  pending:   "Nai-receive na ang order",
  pickup:    "Pinipickup na sa merchant",
  buying:    "Now buying from the market",
  otw:       "On the way to you",
  in_boat:   "Nasa bangka na",
  delivered: "Delivered!",
  cancelled: "Na-cancel ang order",
};

const MERCHANT_STATUS_LABELS = {
  accepted:  "Tinanggap ng merchant ang order mo",
  preparing: "Inihahanda na ng merchant ang order mo",
  ready:     "Ready na ang order mo mula sa merchant",
};

const REFUND_STATUS_LABELS = {
  completed: "Refund processed",
  pending:   "Pending refund",
  rejected:  "Refund rejected",
};

const ADMIN_ALLOWED_ORIGINS = [
  "https://bayango.store",
  "https://www.bayango.store",
  "https://admin.bayango.store",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
];

module.exports = {
  APP_ICON,
  USER_APP_URL,
  RIDER_APP_URL,
  ADMIN_APP_URL,
  MERCHANT_APP_URL,
  ORDER_STATUS_LABELS,
  MERCHANT_STATUS_LABELS,
  REFUND_STATUS_LABELS,
  ADMIN_ALLOWED_ORIGINS,
};
