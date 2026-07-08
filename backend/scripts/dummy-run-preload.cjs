// Preloaded (via `-r`) BEFORE the app graph is imported, so the neutralised
// backend/.env.dummyrun populates process.env first. The app also loads the
// real backend/.env at runtime, but dotenv is no-override — so the blank keys
// set here can never be clobbered. Keeps the dummy run fully offline.
require('dotenv').config({
  path: require('path').join(__dirname, '..', '.env.dummyrun'),
});
