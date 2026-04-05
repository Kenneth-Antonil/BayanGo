/**
 * BayanGo Core — Pricing Engine
 * Delivery fee calculation, live market pricing, and currency formatting.
 */
(function () {
  const BASE_DELIVERY_FEE = 49;
  const ISLAND_DELIVERY_FEE = 80;
  const KM_RATE_2_TO_10 = 6;
  const KM_RATE_BEYOND_10 = 5;
  const DEFAULT_MARKET_FACTOR = 1;

  const computeDeliveryFee = (distanceKm, baseFee = BASE_DELIVERY_FEE) => {
    if (!Number.isFinite(distanceKm) || distanceKm <= 2) return baseFee;
    if (distanceKm <= 10) return baseFee + Math.ceil(distanceKm - 2) * KM_RATE_2_TO_10;
    return baseFee + (8 * KM_RATE_2_TO_10) + Math.ceil(distanceKm - 10) * KM_RATE_BEYOND_10;
  };

  const fmt = (n) => "₱" + Number(n).toLocaleString("en-PH", { minimumFractionDigits: 0 });

  const roundPrice = (n) => Math.max(0, Math.round(Number(n) || 0));

  const computeLivePrice = (product, marketPricing = {}) => {
    const base = Number(product?.basePrice ?? product?.price ?? 0);
    if (product?.autoPriceEnabled === false) return roundPrice(base);
    const factor = Number(marketPricing?.[product?.cat]) || DEFAULT_MARKET_FACTOR;
    return roundPrice(base * factor);
  };

  window.BayanGoCore = window.BayanGoCore || {};
  Object.assign(window.BayanGoCore, {
    BASE_DELIVERY_FEE,
    ISLAND_DELIVERY_FEE,
    KM_RATE_2_TO_10,
    KM_RATE_BEYOND_10,
    DEFAULT_MARKET_FACTOR,
    computeDeliveryFee,
    fmt,
    roundPrice,
    computeLivePrice,
  });
})();
