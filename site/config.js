/*
  Renewed Purpose Ministry: all church details live in this one file.
  Anything in square brackets [like this] is a placeholder to replace.
  Leave a value as "" to hide that item on the site.
*/
window.RPM_CONFIG = {
  churchName: "Renewed Purpose Ministry",
  shortName: "RPM",
  tagline: "liberating lives, restoring destinies...",
  pastorName: "Pastor John Oyakhilome",

  // Logo files in site/icons/. Black for light backgrounds, white for dark.
  logoDark: "icons/logo-black.png",
  logoLight: "icons/logo-white.png",

  // The live site address, used in shared links. No trailing slash.
  websiteUrl: "https://kunnab.github.io/rpm-app",

  // Google Apps Script web app URL. Leave empty to preview with sample content.
  apiUrl: "",

  youtube: {
    channelUrl: "",   // e.g. https://www.youtube.com/@yourchannel
    channelId: ""     // starts with UC..., used for the sermon feed
  },

  whatsapp: {
    channelLink: "",  // https://whatsapp.com/channel/...
    groupLink: ""     // https://chat.whatsapp.com/... (optional)
  },

  address: {
    lines: ["[Venue name]", "[Street]", "[Town]", "[Postcode]"],
    mapLink: ""       // Google Maps link to the venue
  },

  contactEmail: "",

  // day: 0 = Sunday, 1 = Monday ... 6 = Saturday. time is 24-hour, UK time.
  serviceTimes: [
    { day: 0, time: "10:00", name: "[Sunday Service]", durationMins: 150 },
    { day: 3, time: "19:00", name: "[Midweek Service]", durationMins: 90 }
  ],

  givingLink: "",
  givingText: "[Short note about giving, from the church]",

  social: {
    facebook: "",
    instagram: "",
    youtube: "",
    tiktok: ""
  },

  about: "[About us text from the church]",
  pastorBio: "[Short introduction to Pastor John Oyakhilome]",

  colours: {
    ink: "#141414",       // logo black: headings, buttons
    accent: "#B08A4E",    // muted gold: highlights
    paper: "#FAF7F2"      // warm off-white background
  }
};
