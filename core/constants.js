/**
 * BayanGo Core Constants
 * Shared constants used across the app — categories, order statuses, legal content, locations.
 * Loaded as a plain <script> tag. All exports live on window.BayanGoCore.
 */
(function () {
  const CATEGORIES = [
    { id:"isda",     label:"Fish",          icon:"fish",               color:"#0EA5E9" },
    { id:"karne",    label:"Meat",          icon:"drumstick-bite",     color:"#EF4444" },
    { id:"gulay",    label:"Vegetables",    icon:"leaf",               color:"#22C55E" },
    { id:"prutas",   label:"Fruits",        icon:"apple-whole",        color:"#F97316" },
    { id:"ulam",     label:"Cooked Meals",  icon:"bowl-food",          color:"#A855F7" },
    { id:"sari",     label:"General Goods",  icon:"store",              color:"#EC4899" },
    { id:"gamot",    label:"Medicine",       icon:"pills",              color:"#14B8A6" },
    { id:"hardware", label:"Hardware",       icon:"screwdriver-wrench", color:"#F59E0B" },
  ];

  const ORDER_STATUSES = [
    { key:"pending",   label:"Pending",   icon:"hourglass-half", desc:"Your order has been received" },
    { key:"buying",    label:"Buying",    icon:"cart-shopping",  desc:"Now buying from the market" },
    { key:"otw",       label:"OTW",       icon:"motorcycle",     desc:"On the way to you" },
    { key:"delivered", label:"Delivered", icon:"circle-check",   desc:"Delivered!" },
  ];

  const ISLAND_ORDER_STATUSES = [
    { key:"pending",   label:"Pending",     icon:"hourglass-half", desc:"Your order has been received" },
    { key:"buying",    label:"Buying",      icon:"cart-shopping",  desc:"Now buying from the market" },
    { key:"in_boat",   label:"In the Boat", icon:"ship",           desc:"On the boat and heading to you" },
    { key:"delivered", label:"Delivered",   icon:"circle-check",   desc:"Delivered!" },
  ];

  const ORDER_STATUS_COLORS = {
    pending:   { bg:"#F3F4F6", color:"#555",    label:"Pending",      icon:"hourglass-half" },
    buying:    { bg:"#FEF3C7", color:"#92400E", label:"Buying",       icon:"cart-shopping"  },
    otw:       { bg:"#DBEAFE", color:"#1D4ED8", label:"OTW",          icon:"motorcycle"     },
    in_boat:   { bg:"#EFF6FF", color:"#1D4ED8", label:"In the Boat",  icon:"ship"           },
    delivered: { bg:"#DCFCE7", color:"#166534", label:"Delivered",    icon:"circle-check"   },
    cancelled: { bg:"#FEE2E2", color:"#B91C1C", label:"Cancelled",    icon:"ban"            },
  };

  const getOrderStatuses = (order) =>
    order?.locationType === "Island" ? ISLAND_ORDER_STATUSES : ORDER_STATUSES;

  const BINANGONAN_PUBLIC_MARKET = { lat:14.4584, lng:121.1971, label:"Binangonan Public Market" };

  const ORDER_CANCEL_WINDOW_MS = 15 * 60 * 1000;

  const LEGAL_CONTENT = {
    about: {
      title: "About Us",
      icon: "circle-info",
      updatedAt: "March 28, 2026",
      sections: [
        {
          heading: "Sino ang BayanGo",
          body: "BayanGo is a local concierge app for Binangonan that helps make market shopping fast and reliable. Our goal is to make ordering fresh goods and daily essentials simple for families in mainland and island areas."
        },
        {
          heading: "Aming Misyon",
          body: "Deliver the right products on time, provide clear order status updates, and dependable customer support for every order."
        },
        {
          heading: "Contact",
          body: "Para sa concerns, makipag-ugnayan sa BayanGo team gamit ang official Facebook page o contact number na ibinigay sa inyo."
        },
      ],
    },
    privacy: {
      title: "Privacy Policy",
      icon: "shield-halved",
      updatedAt: "March 28, 2026",
      sections: [
        {
          heading: "Anong data ang kinokolekta",
          body: "We collect basic account details (email, name, phone, address), order details, and your location pin so we can deliver your order accurately."
        },
        {
          heading: "How data is used",
          body: "Data is used for order processing, delivery coordination, customer support, and sending order notifications if you allow notifications."
        },
        {
          heading: "Pag-share ng impormasyon",
          body: "We do not sell your personal data. We only share necessary information with riders/admins to fulfill orders and support requests."
        },
        {
          heading: "Data protection",
          body: "The app uses secure backend services. You can update your profile details anytime in Account settings."
        },
      ],
    },
    terms: {
      title: "Terms and Conditions",
      icon: "file-contract",
      updatedAt: "March 28, 2026",
      sections: [
        {
          heading: "Paggamit ng serbisyo",
          body: "By using BayanGo, you agree to provide accurate and complete delivery information and follow app policies."
        },
        {
          heading: "Order at presyo",
          body: "Prices, availability, and estimated totals may change based on market conditions. The final computed total will be shown in the app before order placement."
        },
        {
          heading: "Cancellation at delivery",
          body: "There is a limited cancellation window for eligible orders. Once a rider is assigned or the allowed window has passed, the order may no longer be cancelable."
        },
        {
          heading: "Liability",
          body: "BayanGo strives to provide reliable service, but delays may happen due to weather, traffic, or item availability."
        },
      ],
    },
  };

  const LEGAL_LINKS = [
    { key:"about", label:"About Us", icon:"circle-info", href:"about-us.html" },
    { key:"privacy", label:"Privacy Policy", icon:"shield-halved", href:"privacy-policy.html" },
    { key:"terms", label:"Terms & Conditions", icon:"file-contract", href:"terms-of-condition.html" },
  ];

  // Expose on shared namespace
  window.BayanGoCore = window.BayanGoCore || {};
  Object.assign(window.BayanGoCore, {
    CATEGORIES,
    ORDER_STATUSES,
    ISLAND_ORDER_STATUSES,
    ORDER_STATUS_COLORS,
    getOrderStatuses,
    BINANGONAN_PUBLIC_MARKET,
    ORDER_CANCEL_WINDOW_MS,
    LEGAL_CONTENT,
    LEGAL_LINKS,
  });
})();
