const mongoose = require('mongoose');

/**
 * A city a user added from the city dropdown because it isn't on the built-in
 * Indian list (config/indianCities.js) — typically a foreign city on an export
 * lead. `key` is the name lowercased with everything but letters stripped, the
 * same key the canonical list matches on, so "Bandar Seri Begawan" and
 * "bandar seri-begawan" can never both exist.
 */
const citySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    key: { type: String, required: true, unique: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true }
);

module.exports = mongoose.model('City', citySchema);
